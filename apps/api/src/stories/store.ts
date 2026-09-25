import type { KitDocument } from "../models/Kit.js";
import { KitModel } from "../models/Kit.js";
import { findKitForUser } from "../kits/store.js";
import type { StarStory } from "../lib/prepCore.js";

export function storiesFromDoc(doc: KitDocument): StarStory[] {
  const raw = doc.storyBank;
  if (!raw || typeof raw !== "object") return [];
  const stories = (raw as { stories?: unknown }).stories;
  if (!Array.isArray(stories)) return [];
  const out: StarStory[] = [];
  for (const item of stories) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (
      typeof s.id !== "string" ||
      typeof s.title !== "string" ||
      typeof s.situation !== "string" ||
      typeof s.task !== "string" ||
      typeof s.action !== "string" ||
      typeof s.result !== "string"
    ) {
      continue;
    }
    out.push({
      id: s.id,
      title: s.title,
      situation: s.situation,
      task: s.task,
      action: s.action,
      result: s.result,
    });
  }
  return out;
}

export async function saveStoryBank(
  kitId: string,
  userId: string,
  stories: StarStory[],
): Promise<KitDocument | null> {
  const existing = await findKitForUser(kitId, userId);
  if (!existing) return null;
  const updated = await KitModel.findOneAndUpdate(
    { _id: existing._id, userId: existing.userId },
    { $set: { storyBank: { stories } } },
    { returnDocument: "after" },
  ).exec();
  return updated;
}
