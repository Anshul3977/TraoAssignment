import type { Requirement } from "../schema/kit.js";

type Priority = Requirement["priority"];
type RequirementKind = Requirement["kind"];

/** LLM (or stub) extraction shape before deterministic grounding. */
export type ExtractedRequirement = {
  text: string;
  kind: RequirementKind;
  priority: Priority;
  /** Quote from the JD that justifies the item; verified in code. */
  evidence: string;
  /** Section heading near the evidence (e.g. "Requirements", "Nice to have"). */
  section?: string;
};

export type GroundRequirementsNotes = {
  thin_jd: boolean;
  /** Present when thin_jd is true — why the kit stays thin. */
  explanation?: string;
};

export type GroundRequirementsResult = {
  requirements: Requirement[];
  notes: GroundRequirementsNotes;
};

/** JD shorter than this (trimmed) is treated as thin even with a few hits. */
const THIN_JD_CHARS = 80;
/** Fewer than this many grounded items also marks the JD thin. */
const THIN_MIN_GROUNDED = 3;
const TOKEN_OVERLAP_MIN = 0.8;

const NICE_CUES = [
  "nice to have",
  "bonus",
  "preferred",
  "a plus",
  "ideally",
  "familiarity with",
] as const;

const MUST_CUES = [
  "you will need",
  "you have",
  "requirements",
  "required",
  "minimum",
  "must",
] as const;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Fraction of evidence tokens that appear in the JD (≥ 0.8 keeps the item). */
export function tokenOverlap(evidence: string, jd: string): number {
  const evTokens = tokenize(evidence);
  if (evTokens.length === 0) return 0;
  const jdSet = new Set(tokenize(jd));
  let hits = 0;
  for (const t of evTokens) {
    if (jdSet.has(t)) hits += 1;
  }
  return hits / evTokens.length;
}

/** Evidence must appear in the JD (substring) or clear the token-overlap bar. */
export function evidenceInJd(evidence: string, jd: string): boolean {
  const e = normalize(evidence);
  if (!e) return false;
  const j = normalize(jd);
  if (j.includes(e)) return true;
  return tokenOverlap(evidence, jd) >= TOKEN_OVERLAP_MIN;
}

function cuePriority(haystack: string): Priority | null {
  const h = normalize(haystack);
  if (!h) return null;
  // Nice first so "nice to have" / "familiarity with" win over bare "must" noise.
  for (const cue of NICE_CUES) {
    if (h.includes(cue)) return "nice";
  }
  for (const cue of MUST_CUES) {
    if (h.includes(cue)) return "must";
  }
  return null;
}

/**
 * Override LLM priority from section heading, then evidence line cues;
 * otherwise keep the extracted priority.
 * When `jd` is provided, also infer the nearest section heading above the
 * evidence so mislabelled LLM sections cannot flip must/nice.
 */
export function overridePriority(
  extracted: Pick<ExtractedRequirement, "priority" | "evidence" | "section">,
  jd?: string,
): Priority {
  if (jd) {
    const inferred = inferSectionHeading(jd, extracted.evidence || "");
    const fromInferred = cuePriority(inferred ?? "");
    if (fromInferred) return fromInferred;
  }
  const fromSection = cuePriority(extracted.section ?? "");
  if (fromSection) return fromSection;
  const fromEvidence = cuePriority(extracted.evidence);
  if (fromEvidence) return fromEvidence;
  return extracted.priority;
}

/** Find the nearest Requirements / Nice-to-have style heading above evidence. */
export function inferSectionHeading(jd: string, evidence: string): string | null {
  if (!evidence.trim()) return null;
  const j = jd;
  const idx = jdIndex(jd, evidence);
  if (!Number.isFinite(idx) || idx === Number.POSITIVE_INFINITY) return null;
  // Walk the normalised JD up to the evidence index looking for heading lines.
  const before = normalize(j).slice(0, Math.min(idx + 1, normalize(j).length));
  const headingRe =
    /\b(nice to have|nice-to-have|bonus|preferred qualifications|requirements|you will need|you have|minimum qualifications)\b/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(before)) !== null) {
    last = m[1] ?? null;
  }
  return last;
}

function jdIndex(jd: string, needle: string): number {
  const j = normalize(jd);
  const n = normalize(needle);
  if (!n) return Number.POSITIVE_INFINITY;
  const direct = j.indexOf(n);
  if (direct >= 0) return direct;
  // Fallback: first evidence token cluster position
  const tokens = tokenize(needle);
  if (tokens.length === 0) return Number.POSITIVE_INFINITY;
  const probe = tokens.slice(0, Math.min(4, tokens.length)).join(" ");
  const at = j.indexOf(probe);
  return at >= 0 ? at : Number.POSITIVE_INFINITY;
}

function dedupeKey(text: string): string {
  return normalize(text);
}

/**
 * Drop ungrounded extractions, apply priority cues, dedupe, assign `r1..rn`
 * in JD order. Never invents requirements — thin JD ⇒ thin output + notes.
 */
export function groundRequirements(
  jd: string,
  extracted: ExtractedRequirement[],
): GroundRequirementsResult {
  const grounded: Array<{
    item: ExtractedRequirement;
    priority: Priority;
    order: number;
  }> = [];

  for (const item of extracted) {
    if (!evidenceInJd(item.evidence, jd)) continue;
    grounded.push({
      item,
      priority: overridePriority(item, jd),
      order: jdIndex(jd, item.evidence || item.text),
    });
  }

  grounded.sort((a, b) => a.order - b.order || a.item.text.localeCompare(b.item.text));

  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const g of grounded) {
    const key = dedupeKey(g.item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text: g.item.text,
      kind: g.item.kind,
      priority: g.priority,
    });
  }

  const trimmedLen = jd.trim().length;
  const thin =
    trimmedLen < THIN_JD_CHARS || requirements.length < THIN_MIN_GROUNDED;

  const notes: GroundRequirementsNotes = thin
    ? {
        thin_jd: true,
        explanation:
          trimmedLen < THIN_JD_CHARS
            ? `JD is only ${trimmedLen} characters; reporting the ${requirements.length} grounded requirement(s) found without padding.`
            : `Only ${requirements.length} grounded requirement(s) found in the JD; not inventing more.`,
      }
    : { thin_jd: false };

  return { requirements, notes };
}
