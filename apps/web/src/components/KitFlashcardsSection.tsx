"use client";

import { useId, useRef, useState } from "react";
import type { KitFlashcard } from "@/lib/api";
import { itemBadges, type FlashcardDraft } from "@/lib/kit-builder";
import { PHONE_LAYOUT } from "@/lib/a11y";

export type UndoFlashcardDeletePayload = {
  flashcard: KitFlashcard;
};

type KitFlashcardsSectionProps = {
  flashcards: KitFlashcard[];
  drafts: FlashcardDraft[];
  onFrontChange: (id: string, value: string) => void;
  onBackChange: (id: string, value: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUndoDelete: (payload: UndoFlashcardDeletePayload) => void;
};

export function KitFlashcardsSection({
  flashcards,
  drafts,
  onFrontChange,
  onBackChange,
  onAdd,
  onDelete,
  onUndoDelete,
}: KitFlashcardsSectionProps) {
  const [undo, setUndo] = useState<UndoFlashcardDeletePayload | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  function handleDelete(card: KitFlashcard) {
    onDelete(card.id);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ flashcard: card });
    undoTimerRef.current = setTimeout(() => {
      setUndo(null);
      undoTimerRef.current = null;
    }, 8000);
  }

  function handleUndo() {
    if (!undo) return;
    onUndoDelete(undo);
    setUndo(null);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-lg border border-zinc-200 bg-white ${PHONE_LAYOUT.section}`}
      data-testid="flashcards-section"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Flashcards
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          data-testid="flashcard-add"
        >
          Add flashcard
        </button>
      </div>

      {flashcards.length === 0 ? (
        <p className="text-sm text-zinc-500">No flashcards yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="flashcards-list">
          {flashcards.map((card) => {
            const draft = draftById.get(card.id) ?? {
              id: card.id,
              front: card.front,
              back: card.back,
            };
            const badges = itemBadges(card.meta);
            return (
              <li
                key={card.id}
                className="rounded-md border border-zinc-200 bg-zinc-50/50 p-3"
                data-testid={`flashcard-${card.id}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500">
                    {card.id}
                  </span>
                  {card.requirement_ids.length > 0 ? (
                    <span className="text-xs text-zinc-400">
                      {card.requirement_ids.join(", ")}
                    </span>
                  ) : null}
                  {badges.map((b) => (
                    <span
                      key={b.key}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                    >
                      {b.label}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleDelete(card)}
                    className="ml-auto rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    data-testid={`flashcard-delete-${card.id}`}
                  >
                    Delete
                  </button>
                </div>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-700">Front</span>
                  <textarea
                    value={draft.front}
                    onChange={(e) => onFrontChange(card.id, e.target.value)}
                    rows={2}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    data-testid={`flashcard-front-${card.id}`}
                  />
                </label>

                <label className="mt-2 flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-700">Back</span>
                  <textarea
                    value={draft.back}
                    onChange={(e) => onBackChange(card.id, e.target.value)}
                    rows={3}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    data-testid={`flashcard-back-${card.id}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {undo ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
          data-testid="flashcard-undo-toast"
        >
          <span>Flashcard deleted.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-medium text-zinc-900 underline"
            data-testid="flashcard-undo"
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}
