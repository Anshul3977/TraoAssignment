import { allocateSchedule } from "./deterministic/allocateSchedule.js";
import { isLlmError, isLlmProviderError } from "./llm/errors.js";
import {
  createLlmClientFromEnv,
  type LlmClient,
} from "./llm/index.js";
import {
  crawl,
  searchDiscussion,
  type CrawlOptions,
  type ResearchBundle,
  type SearchDiscussionOptions,
  type SearchDiscussionResult,
} from "./retrieval/index.js";
import { validateKit, type Kit, type Question } from "./schema/index.js";
import {
  assignFlashcardIds,
  buildBrief,
  emptyInterviewProcess,
  ensureMustFlashcards,
  extractInterviewProcess,
  extractRequirements,
  generateFlashcards,
  generateQuestions,
  honestEmptyBrief,
  runCoverageLoop,
  type CompanyBrief,
  type InterviewProcess,
} from "./steps/index.js";
import type { DiscussionHit, ResearchPage } from "./steps/researchPages.js";

/** Progress event emitted for UI / job polling (T15 / §12). */
export type ProgressEvent = {
  step: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
};

export type PipelineInput = {
  jd: string;
  company_url: string;
  days: number;
};

export type PipelineOptions = {
  onProgress?: (event: ProgressEvent) => void;
  /** Allow private/loopback hosts (fixtures + CLI). */
  allowPrivateHosts?: boolean;
  /** Injected LLM client (tests / API). Defaults to env-configured client. */
  client?: LlmClient;
  /** Injectable crawl (tests). */
  crawlFn?: (
    companyUrl: string,
    opts?: CrawlOptions,
  ) => Promise<ResearchBundle>;
  /** Injectable discussion search (tests). */
  searchDiscussionFn?: (
    companyUrl: string,
    opts?: SearchDiscussionOptions,
  ) => Promise<SearchDiscussionResult>;
};

export type PipelineResult = {
  kit: Kit;
};

/**
 * Typed failure when no kit can be produced at all (§ FAQ / T15).
 * Partial research never uses this — those kits are `ok` with honest gaps.
 */
export class PipelineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

export function isPipelineError(err: unknown): err is PipelineError {
  return err instanceof PipelineError;
}

type SkippedEntry = { url?: string; reason: string; source?: string };

function emit(
  onProgress: PipelineOptions["onProgress"],
  event: ProgressEvent,
): void {
  onProgress?.(event);
}

function requireNonEmptyJd(jd: string): string {
  const trimmed = jd.trim();
  if (!trimmed) {
    throw new PipelineError("EMPTY_JD", "Job description is empty.");
  }
  return trimmed;
}

function requireDays(days: number): number {
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1) {
    throw new PipelineError(
      "INVALID_INPUT",
      `days must be an integer ≥ 1 (got ${String(days)}).`,
    );
  }
  return days;
}

function requireCompanyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new PipelineError("INVALID_INPUT", "company_url is empty.");
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new PipelineError(
      "INVALID_INPUT",
      `company_url is not a valid URL: ${trimmed}`,
    );
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new PipelineError(
      "INVALID_INPUT",
      `company_url must be http or https (got ${u.protocol}).`,
    );
  }
  return u.href;
}

function toResearchPage(
  page: {
    url: string;
    text: string;
    title?: string;
    description?: string;
  } | null,
): ResearchPage | null {
  if (!page) return null;
  return {
    url: page.url,
    text: page.text,
    title: page.title,
    description: page.description,
  };
}

function valuesFromAbout(aboutPages: readonly ResearchPage[]): string {
  return aboutPages
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8_000);
}

function collectPagesUsed(
  bundle: ResearchBundle,
  discussion: SearchDiscussionResult,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  if (bundle.homepage) add(bundle.homepage.url);
  for (const p of bundle.aboutPages) add(p.url);
  for (const p of bundle.hiringPages) add(p.url);
  for (const p of discussion.pages) add(p.url);
  return urls;
}

function llmUnavailable(err: unknown, step: string): PipelineError {
  const detail =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown";
  return new PipelineError(
    "LLM_UNAVAILABLE",
    `LLM unavailable at step "${step}" after retries/fallback: ${detail}`,
  );
}

function isLlmFailure(err: unknown): boolean {
  return isLlmError(err) || isLlmProviderError(err);
}

/**
 * Orchestrates retrieval → LLM steps → deterministic coverage/schedule (§3).
 * Same entry point for the batch CLI and API (project.mdc §9).
 */
export async function runPipeline(
  input: PipelineInput,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const onProgress = opts.onProgress;
  const allowPrivateHosts = opts.allowPrivateHosts ?? false;
  const client = opts.client ?? createLlmClientFromEnv();
  const crawlFn = opts.crawlFn ?? crawl;
  const searchFn = opts.searchDiscussionFn ?? searchDiscussion;

  const jd = requireNonEmptyJd(input.jd);
  const companyUrl = requireCompanyUrl(input.company_url);
  const days = requireDays(input.days);

  const skipped: SkippedEntry[] = [];
  const notes: Record<string, unknown> = {};

  // --- extract (JD only; no retrieval — §3) ---
  emit(onProgress, { step: "extract", status: "running" });
  let extracted;
  try {
    extracted = await extractRequirements(client, jd);
  } catch (err) {
    emit(onProgress, {
      step: "extract",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    throw llmUnavailable(err, "extractRequirements");
  }
  if (extracted.notes.thin_jd) {
    notes.thin_jd = true;
    if (extracted.notes.explanation) {
      notes.thin_jd_explanation = extracted.notes.explanation;
    }
  }
  emit(onProgress, {
    step: "extract",
    status: "done",
    detail: `${extracted.requirements.length} grounded requirement(s)`,
  });

  // --- crawl ---
  emit(onProgress, { step: "crawl", status: "running", detail: companyUrl });
  let bundle: ResearchBundle;
  try {
    bundle = await crawlFn(companyUrl, { allowPrivateHosts });
  } catch (err) {
    // Crawl should not throw for remote failures; treat unexpected throw as unreachable.
    skipped.push({
      url: companyUrl,
      reason: err instanceof Error ? err.message : String(err),
      source: "crawl",
    });
    bundle = {
      homepage: null,
      aboutPages: [],
      hiringPages: [],
      otherPages: [],
      skipped: [],
      unreachable: true,
    };
  }
  for (const s of bundle.skipped) {
    skipped.push({ url: s.url, reason: s.reason, source: "crawl" });
  }
  emit(onProgress, {
    step: "crawl",
    status: "done",
    detail: bundle.unreachable
      ? "company unreachable"
      : `about=${bundle.aboutPages.length} hiring=${bundle.hiringPages.length}`,
  });

  // --- search discussion ---
  emit(onProgress, { step: "search_discussion", status: "running" });
  let discussion: SearchDiscussionResult;
  try {
    discussion = await searchFn(companyUrl, {
      allowPrivateHosts,
      homepageTitle: bundle.homepage?.title,
    });
  } catch (err) {
    skipped.push({
      reason: err instanceof Error ? err.message : String(err),
      source: "search_discussion",
    });
    discussion = {
      pages: [],
      companyName: extracted.company ?? "",
      log: [
        {
          provider: "pipeline",
          status: "error",
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  for (const entry of discussion.log) {
    if (entry.status === "error" || entry.status === "skipped") {
      skipped.push({
        reason: entry.detail ?? entry.status,
        source: `discussion:${entry.provider}`,
      });
    }
  }
  emit(onProgress, {
    step: "search_discussion",
    status: discussion.pages.length === 0 ? "skipped" : "done",
    detail:
      discussion.pages.length === 0
        ? "no discussion found"
        : `${discussion.pages.length} page(s)`,
  });

  const homepage = toResearchPage(bundle.homepage);
  const aboutPages = bundle.aboutPages.map(
    (p) => toResearchPage(p)!,
  ) as ResearchPage[];
  const hiringPages = bundle.hiringPages.map(
    (p) => toResearchPage(p)!,
  ) as ResearchPage[];
  const discussionHits: DiscussionHit[] = discussion.pages.map((p) => ({
    url: p.url,
    text: p.text,
    title: p.title,
  }));

  // --- brief ---
  emit(onProgress, { step: "brief", status: "running" });
  let companyBrief: CompanyBrief;
  try {
    companyBrief = await buildBrief(client, {
      homepage,
      aboutPages,
      hiringPagesFound: hiringPages.length > 0,
    });
    emit(onProgress, { step: "brief", status: "done" });
  } catch (err) {
    if (isLlmFailure(err)) {
      companyBrief = honestEmptyBrief({
        homepage,
        aboutPages,
        hiringPagesFound: hiringPages.length > 0,
      });
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        source: "brief",
      });
      emit(onProgress, {
        step: "brief",
        status: "skipped",
        detail: "LLM failed; honest empty brief",
      });
    } else {
      emit(onProgress, {
        step: "brief",
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // --- interview process ---
  emit(onProgress, { step: "interview_process", status: "running" });
  let interviewProcess: InterviewProcess;
  try {
    interviewProcess = await extractInterviewProcess(client, {
      hiringPages,
      discussion: discussionHits,
    });
    emit(onProgress, {
      step: "interview_process",
      status: interviewProcess.found ? "done" : "skipped",
      detail: interviewProcess.found
        ? `${interviewProcess.stages.length} stage(s)`
        : "not found",
    });
  } catch (err) {
    if (isLlmFailure(err)) {
      interviewProcess = emptyInterviewProcess();
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        source: "interview_process",
      });
      emit(onProgress, {
        step: "interview_process",
        status: "skipped",
        detail: "LLM failed; empty process",
      });
    } else {
      emit(onProgress, {
        step: "interview_process",
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const valuesText = valuesFromAbout(aboutPages);

  // --- questions (four category calls inside generateQuestions) ---
  emit(onProgress, { step: "questions", status: "running" });
  let draftQuestions: Question[];
  try {
    draftQuestions = await generateQuestions(client, {
      requirements: extracted.requirements,
      seniority: extracted.seniority,
      interviewProcess,
      companyBrief,
      valuesText,
    });
    emit(onProgress, {
      step: "questions",
      status: "done",
      detail: `${draftQuestions.length} draft question(s)`,
    });
  } catch (err) {
    if (isLlmFailure(err)) {
      // Degrade: empty draft; coverage loop adds deterministic must fallbacks (§4).
      draftQuestions = [];
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        source: "questions",
      });
      emit(onProgress, {
        step: "questions",
        status: "skipped",
        detail: "LLM failed; will use coverage fallbacks for musts",
      });
    } else {
      emit(onProgress, {
        step: "questions",
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // --- coverage loop ---
  emit(onProgress, { step: "coverage", status: "running" });
  let coverageResult;
  try {
    coverageResult = await runCoverageLoop(
      client,
      {
        requirements: extracted.requirements,
        draftQuestions,
        seniority: extracted.seniority,
        interviewProcess,
        companyBrief,
        valuesText,
      },
    );
    emit(onProgress, {
      step: "coverage",
      status: "done",
      detail: `passes=${coverageResult.coverage.passes} uncovered=${coverageResult.coverage.uncovered_requirement_ids.length}`,
    });
  } catch (err) {
    emit(onProgress, {
      step: "coverage",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    if (isLlmFailure(err)) {
      throw llmUnavailable(err, "coverageLoop");
    }
    throw err;
  }

  // --- flashcards ---
  emit(onProgress, { step: "flashcards", status: "running" });
  let flashcards;
  try {
    flashcards = await generateFlashcards(client, {
      questions: coverageResult.questions,
      requirements: extracted.requirements,
    });
    emit(onProgress, {
      step: "flashcards",
      status: "done",
      detail: `${flashcards.length} card(s)`,
    });
  } catch (err) {
    if (isLlmFailure(err)) {
      flashcards = assignFlashcardIds(
        ensureMustFlashcards(
          [],
          extracted.requirements,
          coverageResult.questions,
        ),
      );
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        source: "flashcards",
      });
      emit(onProgress, {
        step: "flashcards",
        status: "skipped",
        detail: "LLM failed; must fallback cards only",
      });
    } else {
      emit(onProgress, {
        step: "flashcards",
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // --- schedule (deterministic) ---
  emit(onProgress, { step: "schedule", status: "running" });
  const { schedule, notes: scheduleNotes } = allocateSchedule(
    extracted.requirements,
    coverageResult.questions,
    days,
  );
  if (scheduleNotes.schedule_overflow) {
    notes.schedule_overflow = true;
    notes.overflow_minutes = scheduleNotes.overflow_minutes;
  }
  emit(onProgress, {
    step: "schedule",
    status: "done",
    detail: `${schedule.days_available} day(s)`,
  });

  const companyName =
    extracted.company?.trim() ||
    discussion.companyName?.trim() ||
    bundle.homepage?.title?.trim() ||
    "";

  const pagesUsed = collectPagesUsed(bundle, discussion);
  const researchedAt = new Date().toISOString();

  const research_log: Record<string, unknown> = {
    skipped,
    coverage_passes: coverageResult.research_log.coverage_passes,
    interview_process: interviewProcess,
    discussion: discussion.log,
    company_unreachable: bundle.unreachable,
    pages: {
      about: bundle.aboutPages.length,
      hiring: bundle.hiringPages.length,
      other: bundle.otherPages.length,
      discussion: discussion.pages.length,
    },
  };

  const kitCandidate: Kit = {
    source: {
      company: companyName,
      company_url: companyUrl,
      role: extracted.title,
      location: extracted.location,
      jd_chars: jd.length,
      researched_at: researchedAt,
      pages_used: pagesUsed,
    },
    company_brief: companyBrief,
    role: {
      title: extracted.title,
      seniority: extracted.seniority,
      responsibilities: extracted.responsibilities,
      requirements: extracted.requirements,
    },
    questions: coverageResult.questions,
    flashcards,
    schedule,
    coverage: coverageResult.coverage,
    research_log,
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
  };

  emit(onProgress, { step: "validate", status: "running" });
  const validated = validateKit(kitCandidate);
  if (!validated.ok) {
    const detail = validated.issues
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    emit(onProgress, { step: "validate", status: "failed", detail });
    throw new PipelineError(
      "INVALID_KIT",
      `Assembled kit failed validation: ${detail}`,
    );
  }
  emit(onProgress, { step: "validate", status: "done" });

  return { kit: validated.kit };
}
