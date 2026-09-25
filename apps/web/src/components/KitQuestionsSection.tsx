"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { KitQuestion, QuestionCategory } from "@/lib/api";
import {
  QUESTION_CATEGORIES,
  categoryTabLabel,
  itemBadges,
  questionsInCategory,
  questionsKeptOnRegen,
  questionsReplacedOnRegen,
  shiftOrderedIds,
  type QuestionDraft,
} from "@/lib/kit-builder";
import { PHONE_LAYOUT, isTabKey, nextCategoryIndex } from "@/lib/a11y";
import { FocusTrapDialog } from "./FocusTrapDialog";

export type UndoDeletePayload = {
  question: KitQuestion;
};

type KitQuestionsSectionProps = {
  questions: KitQuestion[];
  drafts: QuestionDraft[];
  onPromptChange: (id: string, value: string) => void;
  onOutlineChange: (id: string, value: string) => void;
  onReorder: (category: QuestionCategory, orderedIds: string[]) => void;
  onMove: (id: string, category: QuestionCategory) => void;
  onPinToggle: (id: string, pinned: boolean) => void;
  onAdd: (category: QuestionCategory) => void;
  onDelete: (id: string) => void;
  onUndoDelete: (payload: UndoDeletePayload) => void;
  onRequestRegenerate: (category: QuestionCategory) => void;
  regenerating: boolean;
};

export function KitQuestionsSection({
  questions,
  drafts,
  onPromptChange,
  onOutlineChange,
  onReorder,
  onMove,
  onPinToggle,
  onAdd,
  onDelete,
  onUndoDelete,
  onRequestRegenerate,
  regenerating,
}: KitQuestionsSectionProps) {
  const [tab, setTab] = useState<QuestionCategory>("technical");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undo, setUndo] = useState<UndoDeletePayload | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();

  const inTab = questionsInCategory(questions, tab);
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = inTab.map((q) => q.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(tab, arrayMove(ids, oldIndex, newIndex));
  }

  function handleDelete(q: KitQuestion) {
    onDelete(q.id);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ question: q });
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

  const kept = questionsKeptOnRegen(questions, tab);
  const replaced = questionsReplacedOnRegen(questions, tab);

  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-lg border border-zinc-200 bg-white ${PHONE_LAYOUT.section}`}
      data-testid="questions-section"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Questions
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onAdd(tab)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            data-testid="question-add"
          >
            Add question
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={regenerating}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            data-testid="question-regen-open"
          >
            {regenerating ? "Regenerating…" : "Regenerate category"}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Question categories"
        className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200"
      >
        {QUESTION_CATEGORIES.map((cat) => {
          const selected = tab === cat;
          const count = questionsInCategory(questions, cat).length;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`q-panel-${cat}`}
              id={`q-tab-${cat}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(cat)}
              onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                if (!isTabKey(e.key)) return;
                e.preventDefault();
                const i = QUESTION_CATEGORIES.indexOf(cat);
                const next = nextCategoryIndex(
                  QUESTION_CATEGORIES.length,
                  i,
                  e.key,
                );
                const nextCat = QUESTION_CATEGORIES[next];
                if (!nextCat) return;
                setTab(nextCat);
                document.getElementById(`q-tab-${nextCat}`)?.focus();
              }}
              className={
                selected
                  ? "-mb-px border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium text-zinc-900"
                  : "px-3 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-800"
              }
              data-testid={`question-tab-${cat}`}
            >
              {categoryTabLabel(cat)}
              <span className="ml-1.5 text-xs text-zinc-400">({count})</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`q-panel-${tab}`}
        aria-labelledby={`q-tab-${tab}`}
        tabIndex={0}
        data-testid={`question-panel-${tab}`}
      >
        {inTab.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No questions in this category yet.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={inTab.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3" data-testid="questions-list">
                {inTab.map((q) => {
                  const draft = draftById.get(q.id) ?? {
                    id: q.id,
                    prompt: q.prompt,
                    answer_outline: q.answer_outline,
                  };
                  return (
                    <SortableQuestionCard
                      key={q.id}
                      question={q}
                      draft={draft}
                      categories={QUESTION_CATEGORIES}
                      orderedIds={inTab.map((item) => item.id)}
                      onPromptChange={onPromptChange}
                      onOutlineChange={onOutlineChange}
                      onMove={onMove}
                      onPinToggle={onPinToggle}
                      onDelete={() => handleDelete(q)}
                      onShift={(id, delta) => {
                        const next = shiftOrderedIds(
                          inTab.map((item) => item.id),
                          id,
                          delta,
                        );
                        if (next) onReorder(tab, next);
                      }}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {undo ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
          data-testid="question-undo-toast"
        >
          <span>Question deleted.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-medium text-zinc-900 underline"
            data-testid="question-undo"
          >
            Undo
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <RegenConfirmDialog
          category={tab}
          kept={kept}
          replacedCount={replaced.length}
          busy={regenerating}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onRequestRegenerate(tab);
          }}
        />
      ) : null}
    </section>
  );
}

function SortableQuestionCard({
  question,
  draft,
  categories,
  orderedIds,
  onPromptChange,
  onOutlineChange,
  onMove,
  onPinToggle,
  onDelete,
  onShift,
}: {
  question: KitQuestion;
  draft: QuestionDraft;
  categories: readonly QuestionCategory[];
  orderedIds: string[];
  onPromptChange: (id: string, value: string) => void;
  onOutlineChange: (id: string, value: string) => void;
  onMove: (id: string, category: QuestionCategory) => void;
  onPinToggle: (id: string, pinned: boolean) => void;
  onDelete: () => void;
  onShift: (id: string, delta: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const pinned = question.meta?.pinned === true;
  const badges = itemBadges(question.meta);
  const index = orderedIds.indexOf(question.id);
  const canUp = index > 0;
  const canDown = index >= 0 && index < orderedIds.length - 1;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "rounded-md border border-zinc-300 bg-white p-3 shadow-md"
          : "rounded-md border border-zinc-200 bg-zinc-50/50 p-3"
      }
      id={`question-${question.id}`}
      data-testid={`question-${question.id}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`cursor-grab rounded border border-zinc-200 bg-white px-2 ${PHONE_LAYOUT.tap} text-xs text-zinc-500 active:cursor-grabbing`}
          aria-label={`Reorder ${question.id}. Space then arrow keys, or use Move up and Move down.`}
          data-testid={`question-drag-${question.id}`}
          {...attributes}
          {...listeners}
          onKeyDown={(e) => {
            const fromDnd = listeners?.onKeyDown;
            if (typeof fromDnd === "function") fromDnd(e);
            if (e.defaultPrevented) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (canDown) onShift(question.id, 1);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (canUp) onShift(question.id, -1);
            }
          }}
        >
          ⋮⋮
        </button>
        <span className="font-mono text-xs text-zinc-500">{question.id}</span>
        <span className="text-xs text-zinc-400">
          Difficulty {question.difficulty}
        </span>
        {badges.map((b) => (
          <span
            key={b.key}
            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
          >
            {b.label}
          </span>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onShift(question.id, -1)}
            disabled={!canUp}
            className={`rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 ${PHONE_LAYOUT.tap}`}
            data-testid={`question-move-up-${question.id}`}
            aria-label={`Move ${question.id} up`}
          >
            Up
          </button>
          <button
            type="button"
            onClick={() => onShift(question.id, 1)}
            disabled={!canDown}
            className={`rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 ${PHONE_LAYOUT.tap}`}
            data-testid={`question-move-down-${question.id}`}
            aria-label={`Move ${question.id} down`}
          >
            Down
          </button>
          <button
            type="button"
            onClick={() => onPinToggle(question.id, !pinned)}
            className={`rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 ${PHONE_LAYOUT.tap}`}
            aria-pressed={pinned}
            data-testid={`question-pin-${question.id}`}
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="sr-only">Move {question.id} to category</span>
            <select
              value={question.category}
              onChange={(e) =>
                onMove(question.id, e.target.value as QuestionCategory)
              }
              className={`rounded-md border border-zinc-300 bg-white px-2 text-xs ${PHONE_LAYOUT.tap}`}
              data-testid={`question-move-${question.id}`}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryTabLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onDelete}
            className={`rounded-md border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 ${PHONE_LAYOUT.tap}`}
            data-testid={`question-delete-${question.id}`}
          >
            Delete
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700">Prompt</span>
        <textarea
          value={draft.prompt}
          onChange={(e) => onPromptChange(question.id, e.target.value)}
          rows={2}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          data-testid={`question-prompt-${question.id}`}
        />
      </label>

      <label className="mt-2 flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700">Answer outline</span>
        <textarea
          value={draft.answer_outline}
          onChange={(e) => onOutlineChange(question.id, e.target.value)}
          rows={3}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          data-testid={`question-outline-${question.id}`}
        />
      </label>
    </li>
  );
}

function RegenConfirmDialog({
  category,
  kept,
  replacedCount,
  busy,
  onCancel,
  onConfirm,
}: {
  category: QuestionCategory;
  kept: KitQuestion[];
  replacedCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <FocusTrapDialog
      titleId={titleId}
      onClose={onCancel}
      testId="regen-confirm-dialog"
      backdropTestId="regen-confirm-backdrop"
    >
        <h3 id={titleId} className="text-base font-semibold text-zinc-900">
          Regenerate {categoryTabLabel(category)}?
        </h3>
        <p className="mt-2 text-sm text-zinc-600">
          Unprotected AI questions in this category will be replaced (
          {replacedCount}). The following will be kept:
        </p>
        {kept.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing protected — all questions in this category may be replaced.
          </p>
        ) : (
          <ul
            className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm text-zinc-800"
            data-testid="regen-keep-list"
          >
            {kept.map((q) => {
              const badges = itemBadges(q.meta)
                .map((b) => b.label)
                .join(", ");
              return (
                <li key={q.id} className="truncate">
                  <span className="font-mono text-xs text-zinc-500">
                    {q.id}
                  </span>
                  {" — "}
                  {q.prompt.slice(0, 80)}
                  {badges ? (
                    <span className="text-zinc-500"> ({badges})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            data-testid="regen-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            data-testid="regen-confirm"
          >
            Regenerate
          </button>
        </div>
    </FocusTrapDialog>
  );
}

/** Merge-conflict prompt: never silent overwrite on 409. */
export function VersionConflictPrompt({
  message,
  onReload,
  onDismiss,
}: {
  message: string;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  return (
    <FocusTrapDialog
      titleId={titleId}
      onClose={onDismiss}
      testId="version-conflict-dialog"
      backdropTestId="version-conflict-backdrop"
    >
        <h3 id={titleId} className="text-base font-semibold text-zinc-900">
          Kit was modified elsewhere
        </h3>
        <p className="mt-2 text-sm text-zinc-600">{message}</p>
        <p className="mt-2 text-sm text-zinc-600">
          Reload the latest version, or dismiss and re-apply your changes
          manually. Your unsaved local edits will not overwrite the server
          silently.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            data-testid="conflict-dismiss"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onReload}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
            data-testid="conflict-reload"
          >
            Reload latest
          </button>
        </div>
    </FocusTrapDialog>
  );
}
