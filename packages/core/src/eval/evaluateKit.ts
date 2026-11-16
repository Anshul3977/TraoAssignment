import type { Kit } from "../schema/index.js";

/**
 * Deterministic quality checks for a generated kit. No LLM: every number is
 * recomputed from the kit and the JD, so it can run on every live kit and in CI.
 */
export type KitCheck = {
  id:
    | "must_coverage"
    | "requirement_grounding"
    | "citation_validity"
    | "id_integrity"
    | "schedule_fit"
    | "question_diversity"
    | "answer_depth"
    | "brief_present";
  label: string;
  /** 0..1 */
  value: number;
  pass: boolean;
  detail: string;
};

export type KitEvaluation = {
  /** Mean of check values, 0..100. */
  score: number;
  passed: number;
  total: number;
  checks: KitCheck[];
};

const STOP = new Set(
  "and the for with you our are your will have has can from that this into using use able must nice experience years year plus strong good knowledge skills skill working work ability familiarity understanding".split(
    " ",
  ),
);

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function ratio(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function evaluateKit(kit: Kit, jd: string): KitEvaluation {
  const reqs = kit.role.requirements;
  const reqIds = new Set(reqs.map((r) => r.id));
  const qIds = new Set(kit.questions.map((q) => q.id));
  const checks: KitCheck[] = [];

  // 1. Every must-have requirement has at least one question.
  const musts = reqs.filter((r) => r.priority === "must");
  const covered = new Set(kit.questions.flatMap((q) => q.requirement_ids));
  const mustCovered = musts.filter((r) => covered.has(r.id)).length;
  const mc = ratio(mustCovered, musts.length);
  checks.push({
    id: "must_coverage",
    label: "Must-haves covered by a question",
    value: mc,
    pass: mc === 1,
    detail: `${mustCovered}/${musts.length} must-have requirements`,
  });

  // 2. Requirements are grounded in the JD text (no invented skills).
  const jdWords = new Set(words(jd));
  const grounded = reqs.filter((r) => {
    const w = words(r.text);
    if (w.length === 0) return false;
    return w.filter((x) => jdWords.has(x)).length / w.length >= 0.5;
  }).length;
  const rg = ratio(grounded, reqs.length);
  checks.push({
    id: "requirement_grounding",
    label: "Requirements found in the JD",
    value: rg,
    pass: rg >= 0.9,
    detail: `${grounded}/${reqs.length} requirements share most words with the JD`,
  });

  // 3. Cited sources are pages the crawler actually fetched.
  const fetched = new Set(kit.source.pages_used);
  const ip = (kit.research_log?.interview_process ?? {}) as { sources?: unknown };
  const cited = [
    ...kit.company_brief.sources,
    ...(Array.isArray(ip.sources) ? ip.sources.filter((s): s is string => typeof s === "string") : []),
  ];
  const validCites = cited.filter((u) => fetched.has(u)).length;
  const cv = ratio(validCites, cited.length);
  checks.push({
    id: "citation_validity",
    label: "Citations point at fetched pages",
    value: cv,
    pass: cv === 1,
    detail: `${validCites}/${cited.length} cited URLs were fetched`,
  });

  // 4. Every referenced id exists.
  const refs = [
    ...kit.questions.flatMap((q) => q.requirement_ids.map((id) => reqIds.has(id))),
    ...kit.flashcards.flatMap((f) => f.requirement_ids.map((id) => reqIds.has(id))),
    ...kit.schedule.days.flatMap((d) => d.question_ids.map((id) => qIds.has(id))),
  ];
  const okRefs = refs.filter(Boolean).length;
  const ii = ratio(okRefs, refs.length);
  checks.push({
    id: "id_integrity",
    label: "No dangling ids",
    value: ii,
    pass: ii === 1,
    detail: `${okRefs}/${refs.length} references resolve`,
  });

  // 5. Schedule uses every day, no empty days, every question scheduled.
  const days = kit.schedule.days;
  const scheduled = new Set(days.flatMap((d) => d.question_ids));
  const parts = [
    days.length === kit.schedule.days_available ? 1 : 0,
    ratio(days.filter((d) => d.minutes > 0).length, days.length),
    ratio(kit.questions.filter((q) => scheduled.has(q.id)).length, kit.questions.length),
  ];
  const sf = parts.reduce((a, b) => a + b, 0) / parts.length;
  checks.push({
    id: "schedule_fit",
    label: "Schedule fits the days",
    value: sf,
    pass: sf === 1,
    detail: `${days.length}/${kit.schedule.days_available} days, ${scheduled.size} of ${kit.questions.length} questions placed`,
  });

  // 6. Questions are not near-duplicates.
  const sets = kit.questions.map((q) => new Set(words(q.prompt)));
  let dupes = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = 0; j < i; j++) {
      if (jaccard(sets[i]!, sets[j]!) >= 0.7) {
        dupes++;
        break;
      }
    }
  }
  const qd = 1 - ratio(dupes, sets.length || 1) * (sets.length ? 1 : 0);
  checks.push({
    id: "question_diversity",
    label: "Distinct questions",
    value: qd,
    pass: dupes === 0,
    detail: dupes === 0 ? "no near-duplicate prompts" : `${dupes} near-duplicate prompt(s)`,
  });

  // 7. Answer outlines say something.
  const deep = kit.questions.filter((q) => q.answer_outline.trim().length >= 80).length;
  const ad = ratio(deep, kit.questions.length);
  checks.push({
    id: "answer_depth",
    label: "Answer outlines with substance",
    value: ad,
    pass: ad >= 0.9,
    detail: `${deep}/${kit.questions.length} outlines are 80+ characters`,
  });

  // 8. The company brief exists and cites at least one page.
  const hasSummary =
    kit.company_brief.summary.trim().length >= 40 &&
    !kit.company_brief.summary.startsWith("We could not produce a reliable company brief");
  const hasSource = kit.company_brief.sources.length > 0;
  const bp = (Number(hasSummary) + Number(hasSource)) / 2;
  checks.push({
    id: "brief_present",
    label: "Company brief written and cited",
    value: bp,
    pass: bp === 1,
    detail: !hasSummary
      ? "fallback brief: the model call failed or pages were too thin"
      : hasSource
        ? `${kit.company_brief.sources.length} source page(s) cited`
        : "brief cites no pages",
  });

  const score = Math.round((checks.reduce((a, c) => a + c.value, 0) / checks.length) * 100);
  return { score, passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
}

export { pct as formatPct };
