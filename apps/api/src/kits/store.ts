import mongoose from "mongoose";
import type { Kit } from "@prep/core";
import { KitModel, type KitDocument } from "../models/Kit.js";
import type { ResearchBundle } from "../lib/prepCore.js";

/**
 * Load a kit only when it belongs to `userId`. Returns null for bad ids or
 * another user's kit — callers must treat both as 404 (no existence leak).
 */
export async function findKitForUser(
  kitId: string,
  userId: string,
): Promise<KitDocument | null> {
  if (
    !mongoose.Types.ObjectId.isValid(kitId) ||
    !mongoose.Types.ObjectId.isValid(userId)
  ) {
    return null;
  }
  return KitModel.findOne({
    _id: kitId,
    userId,
  }).exec();
}

export function kitToPublic(doc: KitDocument) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    version: doc.version,
    title: doc.title,
    input: doc.input,
    kit: doc.kit,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function titleFromKit(kit: Kit): string {
  return (
    kit.role?.title?.trim() ||
    kit.source?.role?.trim() ||
    "Untitled kit"
  );
}

export type SaveKitResult =
  | { ok: true; doc: KitDocument }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_conflict"; doc: KitDocument };

/**
 * Optimistic concurrency: update only when `baseVersion` matches.
 * On mismatch returns the current owned document for a 409 response.
 */
export async function saveKitIfVersion(
  kitId: string,
  userId: string,
  baseVersion: number,
  kit: Kit,
  extras?: { researchBundle?: ResearchBundle | null },
): Promise<SaveKitResult> {
  if (
    !mongoose.Types.ObjectId.isValid(kitId) ||
    !mongoose.Types.ObjectId.isValid(userId)
  ) {
    return { ok: false, reason: "not_found" };
  }

  const $set: Record<string, unknown> = {
    kit,
    version: baseVersion + 1,
    title: titleFromKit(kit),
  };
  if (extras && "researchBundle" in extras) {
    $set.researchBundle = extras.researchBundle ?? undefined;
  }

  const updated = await KitModel.findOneAndUpdate(
    { _id: kitId, userId, version: baseVersion },
    { $set },
    { returnDocument: "after" },
  ).exec();

  if (updated) {
    return { ok: true, doc: updated };
  }

  const current = await findKitForUser(kitId, userId);
  if (!current) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: false, reason: "version_conflict", doc: current };
}
