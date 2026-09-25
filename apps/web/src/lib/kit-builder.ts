/**
 * Pure helpers for the kit builder Brief + Role UI (T23a).
 * Ops shapes match docs/API.md PATCH /kits/:id.
 */

import type { KitDocument, KitItemMeta, KitOp } from "./api";

/** Debounce before flushing local edits as a PATCH op batch. */
export const SAVE_DEBOUNCE_MS = 600;

export type SaveStatus = "saved" | "saving" | "offline";

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "offline":
      return "Offline";
    case "saved":
    default:
      return "Saved";
  }
}

export type OriginBadge = {
  key: string;
  label: string;
};

/** Origin / edited badges for brief or requirement meta. */
export function itemBadges(meta: KitItemMeta | undefined): OriginBadge[] {
  const badges: OriginBadge[] = [];
  if (!meta) return badges;
  if (meta.edited === true) {
    badges.push({ key: "edited", label: "Edited" });
  }
  const origin = typeof meta.origin === "string" ? meta.origin : undefined;
  if (origin === "user") {
    badges.push({ key: "yours", label: "Yours" });
  } else if (origin === "fallback") {
    badges.push({ key: "fallback", label: "Fallback" });
  } else if (origin === "generated") {
    badges.push({ key: "ai", label: "AI" });
  }
  return badges;
}

export function isRequirementCovered(
  requirementId: string,
  uncoveredIds: readonly string[],
): boolean {
  return !uncoveredIds.includes(requirementId);
}

export type CoverageLabel = {
  covered: boolean;
  label: string;
};

export function coverageIndicator(
  requirementId: string,
  uncoveredIds: readonly string[],
): CoverageLabel {
  const covered = isRequirementCovered(requirementId, uncoveredIds);
  return {
    covered,
    label: covered ? "Covered" : "Uncovered",
  };
}

export type BriefDraft = {
  summary: string;
  what_they_do: string;
};

export type RequirementDraft = {
  id: string;
  text: string;
};

/**
 * Diff local Brief + requirement text drafts against the last-saved kit
 * and build a PATCH ops array (coalesced; 1–100 ops).
 * Skips empty strings (API requires min length 1).
 */
export function buildBriefRoleOps(
  saved: KitDocument,
  brief: BriefDraft,
  requirements: readonly RequirementDraft[],
): KitOp[] {
  const ops: KitOp[] = [];

  const briefSet: { summary?: string; what_they_do?: string } = {};
  const nextSummary = brief.summary.trim();
  const nextWhat = brief.what_they_do.trim();
  if (
    nextSummary.length > 0 &&
    nextSummary !== saved.company_brief.summary
  ) {
    briefSet.summary = nextSummary;
  }
  if (
    nextWhat.length > 0 &&
    nextWhat !== saved.company_brief.what_they_do
  ) {
    briefSet.what_they_do = nextWhat;
  }
  if (briefSet.summary !== undefined || briefSet.what_they_do !== undefined) {
    ops.push({ op: "update", target: "brief", set: briefSet });
  }

  const byId = new Map(saved.role.requirements.map((r) => [r.id, r]));
  for (const draft of requirements) {
    const savedReq = byId.get(draft.id);
    if (!savedReq) continue;
    const nextText = draft.text.trim();
    if (nextText.length === 0) continue;
    if (nextText !== savedReq.text) {
      ops.push({
        op: "update",
        target: "requirement",
        id: draft.id,
        set: { text: nextText },
      });
    }
  }

  return ops;
}

export function draftsFromKit(kit: KitDocument): {
  brief: BriefDraft;
  requirements: RequirementDraft[];
} {
  return {
    brief: {
      summary: kit.company_brief.summary,
      what_they_do: kit.company_brief.what_they_do,
    },
    requirements: kit.role.requirements.map((r) => ({
      id: r.id,
      text: r.text,
    })),
  };
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    const msg = (err as { message: string }).message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed")
    );
  }
  return false;
}
