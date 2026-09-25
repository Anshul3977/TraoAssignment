import mongoose from "mongoose";
import {
  PracticeStateModel,
  type PracticeStateDocument,
} from "../models/PracticeState.js";
import { nextLeitnerBox, type PracticeCardState } from "./leitner.js";

export type PublicPracticeCard = {
  flashcardId: string;
  box: number;
  lastConfidence: number | null;
  lastSeenAt: string | null;
};

type CardPlain = {
  flashcardId: string;
  box: number;
  lastConfidence?: number | null;
  lastSeenAt?: Date | null;
};

function cardToPublic(card: CardPlain): PublicPracticeCard {
  return {
    flashcardId: card.flashcardId,
    box: card.box,
    lastConfidence:
      card.lastConfidence === undefined || card.lastConfidence === null
        ? null
        : card.lastConfidence,
    lastSeenAt: card.lastSeenAt
      ? new Date(card.lastSeenAt).toISOString()
      : null,
  };
}

export async function findPracticeState(
  kitId: string,
  userId: string,
): Promise<PracticeStateDocument | null> {
  if (
    !mongoose.Types.ObjectId.isValid(kitId) ||
    !mongoose.Types.ObjectId.isValid(userId)
  ) {
    return null;
  }
  return PracticeStateModel.findOne({ kitId, userId }).exec();
}

export function practiceCardsToMap(
  doc: PracticeStateDocument | null,
): Map<string, PracticeCardState> {
  const map = new Map<string, PracticeCardState>();
  if (!doc) return map;
  for (const c of doc.cards ?? []) {
    map.set(c.flashcardId, {
      flashcardId: c.flashcardId,
      box: c.box,
      lastConfidence: c.lastConfidence ?? null,
      lastSeenAt: c.lastSeenAt ?? null,
    });
  }
  return map;
}

export function reviewedFlashcardIds(
  doc: PracticeStateDocument | null,
): Set<string> {
  const set = new Set<string>();
  if (!doc) return set;
  for (const c of doc.cards ?? []) {
    if (c.lastSeenAt != null) set.add(c.flashcardId);
  }
  return set;
}

/**
 * Upsert Leitner state for one flashcard review. Creates the PracticeState
 * document on first review for this user+kit.
 */
export async function recordReview(
  kitId: string,
  userId: string,
  flashcardId: string,
  confidence: number,
): Promise<PublicPracticeCard> {
  const existing = await findPracticeState(kitId, userId);
  const now = new Date();

  const prevCards: CardPlain[] = (existing?.cards ?? []).map((c) => ({
    flashcardId: c.flashcardId,
    box: c.box,
    lastConfidence: c.lastConfidence ?? null,
    lastSeenAt: c.lastSeenAt ?? null,
  }));

  const idx = prevCards.findIndex((c) => c.flashcardId === flashcardId);
  const prevBox = idx >= 0 ? prevCards[idx]!.box : undefined;
  const updated: CardPlain = {
    flashcardId,
    box: nextLeitnerBox(prevBox, confidence),
    lastConfidence: confidence,
    lastSeenAt: now,
  };

  const nextCards =
    idx >= 0
      ? prevCards.map((c, i) => (i === idx ? updated : c))
      : [...prevCards, updated];

  await PracticeStateModel.findOneAndUpdate(
    { userId, kitId },
    { $set: { cards: nextCards } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).exec();

  return cardToPublic(updated);
}
