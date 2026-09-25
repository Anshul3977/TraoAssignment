import mongoose from "mongoose";
import { KitModel, type KitDocument } from "../models/Kit.js";

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
