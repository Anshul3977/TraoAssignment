import type { LlmClient } from "../llm/index.js";
import type { GenerateJsonOptions } from "../llm/index.js";
import { findGaps } from "../deterministic/findGaps.js";
import { categoryForRequirementKind } from "../deterministic/mergeRegenerated.js";
import type { Question, Requirement } from "../schema/index.js";
import type { CompanyBrief } from "./buildBrief.js";
import type { InterviewProcess } from "./extractInterviewProcess.js";
import {
  assignQuestionIds,
  generateBehaviouralQuestions,
  generateTechnicalQuestions,
  type GenerateQuestionsOptions,
} from "./generateQuestions.js";

export type CoverageLoopOptions = GenerateQuestionsOptions & GenerateJsonOptions;

export type CoverageLoopInput = {
  /** Full grounded requirement set. */
  requirements: readonly Requirement[];
  /** Pass-1 draft bank (already id-assigned). */
  draftQuestions: readonly Question[];
  seniority: string;
  interviewProcess?: InterviewProcess | null;
  companyBrief?: CompanyBrief | null;
  valuesText?: string | null;
};

/** One entry per generation pass (and optional final fallback note). */
export type CoveragePassLog = {
  pass: number;
  must_gaps: string[];
  nice_gaps: string[];
  /** Question ids added on this pass (empty for the initial draft snapshot). */
  added_question_ids: string[];
  origin: "draft" | "generated" | "fallback";
};

export type CoverageLoopResult = {
  questions: Question[];
  coverage: {
    uncovered_requirement_ids: string[];
    passes: number;
  };
  /** Fragment for callers to merge into kit `research_log`. */
  research_log: {
    coverage_passes: CoveragePassLog[];
  };
};

const MAX_PASSES = 3;

function reqMap(
  requirements: readonly Requirement[],
): Map<string, Requirement> {
  return new Map(requirements.map((r) => [r.id, r]));
}

function splitGaps(
  gapIds: readonly string[],
  byId: Map<string, Requirement>,
): { must: string[]; nice: string[] } {
  const must: string[] = [];
  const nice: string[] = [];
  for (const id of gapIds) {
    const r = byId.get(id);
    if (!r) continue;
    if (r.priority === "must") must.push(id);
    else nice.push(id);
  }
  return { must, nice };
}

function nextQuestionStart(questions: readonly Question[]): number {
  let max = 0;
  for (const q of questions) {
    if (!q.id.startsWith("q")) continue;
    const n = Number(q.id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Deterministic question for a must requirement the model never covered (§4).
 */
export function fallbackQuestionFor(
  requirement: Requirement,
): Omit<Question, "id"> {
  const category =
    categoryForRequirementKind(requirement.kind) ?? "technical";
  return {
    requirement_ids: [requirement.id],
    category,
    prompt: `Prepare to discuss: ${requirement.text}`,
    answer_outline: `Cover the must-have requirement "${requirement.text}" with a concrete example.`,
    difficulty: 2,
    meta: { origin: "fallback" },
  };
}

/**
 * Generate questions only for the given gap requirements, routed by `kind`
 * to technical (technical|domain) or behavioural. No system-design / company-fit
 * calls — those are not kind-driven (§4 / T12b).
 */
export async function generateQuestionsForGaps(
  client: LlmClient,
  gapRequirements: readonly Requirement[],
  ctx: {
    seniority: string;
    interviewProcess?: InterviewProcess | null;
    companyBrief?: CompanyBrief | null;
    valuesText?: string | null;
  },
  opts?: CoverageLoopOptions,
): Promise<Omit<Question, "id">[]> {
  if (gapRequirements.length === 0) return [];

  const technical = gapRequirements.filter(
    (r) => categoryForRequirementKind(r.kind) === "technical",
  );
  const behavioural = gapRequirements.filter(
    (r) => categoryForRequirementKind(r.kind) === "behavioural",
  );

  const out: Omit<Question, "id">[] = [];
  const categoryInput = {
    seniority: ctx.seniority,
    interviewProcess: ctx.interviewProcess,
    companyBrief: ctx.companyBrief,
    valuesText: ctx.valuesText,
  };

  if (technical.length > 0) {
    out.push(
      ...(await generateTechnicalQuestions(
        client,
        { ...categoryInput, requirements: technical },
        opts,
      )),
    );
  }
  if (behavioural.length > 0) {
    out.push(
      ...(await generateBehaviouralQuestions(
        client,
        { ...categoryInput, requirements: behavioural },
        opts,
      )),
    );
  }
  return out;
}

/**
 * Coverage / second-pass loop (§4 / T12b).
 *
 * Pass 1 = the supplied draft. While must-gaps remain and passes < 3, generate
 * questions for those must-gap requirements only (routed by kind), then
 * recompute via findGaps. After the cap, append a deterministic fallback per
 * remaining must-gap (`meta.origin='fallback'`). Nice-only gaps never trigger
 * another pass and may remain in `uncovered_requirement_ids`.
 */
export async function runCoverageLoop(
  client: LlmClient,
  input: CoverageLoopInput,
  opts?: CoverageLoopOptions,
): Promise<CoverageLoopResult> {
  const byId = reqMap(input.requirements);
  let questions: Question[] = [...input.draftQuestions];
  let passes = 1;
  const coverage_passes: CoveragePassLog[] = [];

  const snapshotGaps = () => {
    const all = findGaps([...input.requirements], questions);
    return splitGaps(all, byId);
  };

  {
    const { must, nice } = snapshotGaps();
    coverage_passes.push({
      pass: 1,
      must_gaps: must,
      nice_gaps: nice,
      added_question_ids: [],
      origin: "draft",
    });
  }

  while (true) {
    const { must } = snapshotGaps();
    if (must.length === 0 || passes >= MAX_PASSES) break;

    passes += 1;
    const gapReqs = must
      .map((id) => byId.get(id))
      .filter((r): r is Requirement => Boolean(r));

    const raw = await generateQuestionsForGaps(client, gapReqs, input, opts);
    const added = assignQuestionIds(raw, nextQuestionStart(questions));
    questions = [...questions, ...added];

    const after = snapshotGaps();
    coverage_passes.push({
      pass: passes,
      must_gaps: after.must,
      nice_gaps: after.nice,
      added_question_ids: added.map((q) => q.id),
      origin: "generated",
    });
  }

  const stillMust = snapshotGaps().must;
  if (stillMust.length > 0) {
    const fallbacks: Omit<Question, "id">[] = [];
    for (const id of stillMust) {
      const req = byId.get(id);
      if (!req) continue;
      fallbacks.push(fallbackQuestionFor(req));
    }
    const added = assignQuestionIds(fallbacks, nextQuestionStart(questions));
    questions = [...questions, ...added];
    const after = snapshotGaps();
    coverage_passes.push({
      pass: passes,
      must_gaps: after.must,
      nice_gaps: after.nice,
      added_question_ids: added.map((q) => q.id),
      origin: "fallback",
    });
  }

  // Empty draft + nice-only (or failed LLM) ⇒ no must-fallback path. Seed at
  // least one deterministic question per requirement so schedules are never
  // all-empty when the JD stated requirements.
  if (questions.length === 0 && input.requirements.length > 0) {
    const fallbacks = input.requirements.map((req) => fallbackQuestionFor(req));
    const added = assignQuestionIds(fallbacks, nextQuestionStart(questions));
    questions = [...questions, ...added];
    const after = snapshotGaps();
    coverage_passes.push({
      pass: passes,
      must_gaps: after.must,
      nice_gaps: after.nice,
      added_question_ids: added.map((q) => q.id),
      origin: "fallback",
    });
  }

  const uncovered = findGaps([...input.requirements], questions);

  return {
    questions,
    coverage: {
      uncovered_requirement_ids: uncovered,
      passes,
    },
    research_log: { coverage_passes },
  };
}
