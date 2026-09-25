import type { Kit } from "@prep/core";
import {
  allocateSchedule,
  buildBrief,
  createLlmClientFromEnv,
  generateBehaviouralQuestions,
  generateCompanyFitQuestions,
  generateSystemDesignQuestions,
  generateTechnicalQuestions,
  honestEmptyBrief,
  mergeRegenerated,
  type CompanyBrief,
  type InterviewProcess,
  type LlmClient,
  type Question,
  type ResearchBundle,
} from "../lib/prepCore.js";
import type { RegenerateBody } from "./opsSchema.js";

export class RegenerateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RegenerateError";
    this.code = code;
  }
}

export type StoredResearchBundle = ResearchBundle;

export type RegenerateDeps = {
  /** Injected LLM client (tests). Defaults to env-configured client. */
  getClient?: () => LlmClient;
  /** Override brief generation (tests). */
  buildBriefFn?: (
    bundle: ResearchBundle,
    kit: Kit,
  ) => Promise<CompanyBrief>;
  /** Override category question generation (tests). */
  generateCategoryFn?: (
    kit: Kit,
    category: Question["category"],
    bundle: ResearchBundle | null,
  ) => Promise<Question[]>;
};

function readInterviewProcess(kit: Kit): InterviewProcess | null {
  const log = kit.research_log;
  if (!log || typeof log !== "object") return null;
  const raw = (log as Record<string, unknown>).interview_process;
  if (!raw || typeof raw !== "object") return null;
  return raw as InterviewProcess;
}

function valuesTextFromBundle(bundle: ResearchBundle | null): string | null {
  if (!bundle) return null;
  const parts: string[] = [];
  for (const p of bundle.aboutPages) {
    if (p.text?.trim()) parts.push(p.text.trim());
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function toResearchPage(page: {
  url: string;
  text: string;
  title?: string;
  description?: string;
}) {
  return {
    url: page.url,
    text: page.text,
    title: page.title,
    description: page.description,
  };
}

async function defaultBuildBrief(
  client: LlmClient,
  bundle: ResearchBundle,
): Promise<CompanyBrief> {
  return buildBrief(client, {
    homepage: bundle.homepage
      ? toResearchPage(bundle.homepage)
      : null,
    aboutPages: bundle.aboutPages.map(toResearchPage),
    hiringPagesFound: bundle.hiringPages.length > 0,
  });
}

async function defaultGenerateCategory(
  client: LlmClient,
  kit: Kit,
  category: Question["category"],
  bundle: ResearchBundle | null,
): Promise<Question[]> {
  const input = {
    requirements: kit.role.requirements,
    seniority: kit.role.seniority,
    interviewProcess: readInterviewProcess(kit),
    companyBrief: kit.company_brief,
    valuesText: valuesTextFromBundle(bundle),
  };

  let drafts: Omit<Question, "id">[] = [];
  switch (category) {
    case "technical":
      drafts = await generateTechnicalQuestions(client, input);
      break;
    case "behavioural":
      drafts = await generateBehaviouralQuestions(client, input);
      break;
    case "system-design":
      drafts = await generateSystemDesignQuestions(client, {
        ...input,
        seniority: kit.role.seniority,
      });
      break;
    case "company-fit":
      drafts = await generateCompanyFitQuestions(client, input);
      break;
  }

  // mergeRegenerated assigns fresh ids; placeholders are fine.
  return drafts.map((d, i) => ({
    ...d,
    id: `candidate-${i}`,
  }));
}

function reallocateSchedule(kit: Kit): Kit["schedule"] {
  const days =
    kit.schedule.days_available > 0
      ? kit.schedule.days_available
      : kit.schedule.days.length;
  const { schedule } = allocateSchedule(
    kit.role.requirements,
    kit.questions,
    Math.max(1, days),
  );
  return schedule;
}

export type RegenerateResult = {
  kit: Kit;
  briefSkipped: boolean;
  questionsChanged: boolean;
};

/**
 * Regenerate one kit section using stored research (no re-crawl) and
 * `mergeRegenerated` from `@prep/core` deterministic helpers.
 */
export async function regenerateKitSection(
  kit: Kit,
  body: RegenerateBody,
  researchBundle: ResearchBundle | null | undefined,
  deps: RegenerateDeps = {},
): Promise<RegenerateResult> {
  const section = body.section;

  if (section === "schedule") {
    const merged = mergeRegenerated({
      kit,
      section: "schedule",
      reallocateSchedule,
    });
    return {
      kit: merged.kit,
      briefSkipped: merged.briefSkipped,
      questionsChanged: merged.questionsChanged,
    };
  }

  if (section === "brief") {
    const briefMeta = kit.company_brief.meta;
    const edited =
      briefMeta &&
      typeof briefMeta === "object" &&
      (briefMeta as { edited?: unknown }).edited === true;
    if (edited && !body.force) {
      const merged = mergeRegenerated({
        kit,
        section: "brief",
        force: false,
      });
      return {
        kit: merged.kit,
        briefSkipped: true,
        questionsChanged: false,
      };
    }

    if (!researchBundle) {
      throw new RegenerateError(
        "MISSING_RESEARCH",
        "No stored research bundle available for brief regeneration.",
      );
    }

    const brief = deps.buildBriefFn
      ? await deps.buildBriefFn(researchBundle, kit)
      : await defaultBuildBrief(
          deps.getClient?.() ?? createLlmClientFromEnv(),
          researchBundle,
        );

    // If pages were empty, prefer honest empty over LLM fabrication.
    const candidate =
      brief ??
      honestEmptyBrief({
        homepage: researchBundle.homepage
          ? toResearchPage(researchBundle.homepage)
          : null,
        aboutPages: researchBundle.aboutPages.map(toResearchPage),
        hiringPagesFound: researchBundle.hiringPages.length > 0,
      });

    const merged = mergeRegenerated({
      kit,
      section: "brief",
      force: body.force === true,
      brief: candidate,
    });
    return {
      kit: merged.kit,
      briefSkipped: merged.briefSkipped,
      questionsChanged: merged.questionsChanged,
    };
  }

  // questions
  if (!body.category) {
    throw new RegenerateError(
      "VALIDATION_ERROR",
      "category is required when section is questions.",
    );
  }

  // Questions regen can run without a bundle for technical/behavioural/
  // system-design (requirements-only). company-fit benefits from about text.
  const candidates = deps.generateCategoryFn
    ? await deps.generateCategoryFn(
        kit,
        body.category,
        researchBundle ?? null,
      )
    : await defaultGenerateCategory(
        deps.getClient?.() ?? createLlmClientFromEnv(),
        kit,
        body.category,
        researchBundle ?? null,
      );

  const merged = mergeRegenerated({
    kit,
    section: "questions",
    category: body.category,
    questions: candidates,
    reallocateSchedule,
  });

  return {
    kit: merged.kit,
    briefSkipped: merged.briefSkipped,
    questionsChanged: merged.questionsChanged,
  };
}
