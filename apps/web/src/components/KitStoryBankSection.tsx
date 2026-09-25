"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiClientError,
  getStoryBank,
  putStoryBank,
  type StarStory,
  type StoryBankMapping,
  type StoryDraft,
} from "@/lib/api";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { PHONE_LAYOUT } from "@/lib/a11y";
import {
  MAX_STORIES,
  completeStories,
  emptyStoryDraft,
  isCompleteStory,
  storyCountHint,
} from "@/lib/story-bank";

type KitStoryBankSectionProps = {
  kitId: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export function KitStoryBankSection({ kitId }: KitStoryBankSectionProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [drafts, setDrafts] = useState<StoryDraft[]>([emptyStoryDraft()]);
  const [mapping, setMapping] = useState<StoryBankMapping | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const applyStories = useCallback((stories: StarStory[], nextMapping: StoryBankMapping) => {
    const next: StoryDraft[] =
      stories.length === 0
        ? [emptyStoryDraft()]
        : stories.map((s) => ({
            title: s.title,
            situation: s.situation,
            task: s.task,
            action: s.action,
            result: s.result,
          }));
    setDrafts(next);
    setMapping(nextMapping);
  }, []);

  const loadBank = useCallback(async () => {
    setLoad({ kind: "loading" });
    setSaveError(null);
    try {
      const data = await getStoryBank(kitId);
      applyStories(data.stories, data.mapping);
      setLoad({ kind: "ready" });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not load Story Bank.";
      setLoad({ kind: "error", message });
    }
  }, [applyStories, kitId]);

  useEffect(() => {
    void loadBank();
  }, [loadBank]);

  const onField = (
    index: number,
    field: keyof StoryDraft,
    value: string,
  ) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    );
  };

  const onAdd = () => {
    setDrafts((prev) =>
      prev.length >= MAX_STORIES ? prev : [...prev, emptyStoryDraft()],
    );
  };

  const onRemove = (index: number) => {
    setDrafts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [emptyStoryDraft()] : next;
    });
  };

  const onSave = async () => {
    const stories = completeStories(drafts);
    const incomplete = drafts.filter(
      (d) =>
        Object.values(d).some((v) => v.trim().length > 0) && !isCompleteStory(d),
    );
    if (incomplete.length > 0) {
      setSaveError("Finish every STAR field (or clear the card) before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const data = await putStoryBank(kitId, stories);
      applyStories(data.stories, data.mapping);
    } catch (err) {
      setSaveError(
        err instanceof ApiClientError
          ? err.message
          : "Could not save stories.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="story-bank-heading"
      data-testid="story-bank"
    >
      <div>
        <h2
          id="story-bank-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Story Bank
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Write 4–6 STAR stories once. Code maps them onto behavioural
          requirements by keyword overlap — interview questions reuse the same
          stories instead of a new answer each time.
        </p>
        <p className="mt-1 text-xs text-zinc-500" data-testid="story-bank-count">
          {storyCountHint(completeStories(drafts).length)}
        </p>
      </div>

      {load.kind === "loading" ? (
        <LoadingSkeleton label="Loading stories…" lines={4} />
      ) : null}

      {load.kind === "error" ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
        >
          <p>{load.message}</p>
          <button
            type="button"
            onClick={() => void loadBank()}
            className="mt-3 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {load.kind === "ready" ? (
        <>
          {mapping && mapping.uncovered.length > 0 ? (
            <ul
              className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4"
              data-testid="story-bank-uncovered"
            >
              {mapping.uncovered.map((u) => (
                <li
                  key={u.requirementId}
                  className="text-sm text-amber-950"
                  data-testid={`story-gap-${u.requirementId}`}
                >
                  {u.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-col gap-4">
            {drafts.map((draft, index) => (
              <article
                key={index}
                className={`rounded-lg border border-zinc-200 bg-white ${PHONE_LAYOUT.section}`}
                data-testid={`story-card-${index}`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-zinc-800">
                    Story {index + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="text-sm text-zinc-600 underline hover:text-zinc-900"
                    data-testid={`story-remove-${index}`}
                  >
                    Remove
                  </button>
                </div>
                <label className="block text-xs font-medium text-zinc-500">
                  Title
                  <input
                    value={draft.title}
                    onChange={(e) => onField(index, "title", e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                    data-testid={`story-title-${index}`}
                  />
                </label>
                {(
                  [
                    ["situation", "Situation"],
                    ["task", "Task"],
                    ["action", "Action"],
                    ["result", "Result"],
                  ] as const
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="mt-3 block text-xs font-medium text-zinc-500"
                  >
                    {label}
                    <textarea
                      value={draft[field]}
                      onChange={(e) => onField(index, field, e.target.value)}
                      rows={field === "action" ? 4 : 3}
                      className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                      data-testid={`story-${field}-${index}`}
                    />
                  </label>
                ))}
              </article>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={drafts.length >= MAX_STORIES}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              data-testid="story-add"
            >
              Add story
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              data-testid="story-save"
            >
              {saving ? "Saving…" : "Save stories"}
            </button>
          </div>
          {saving ? (
            <p className="text-sm text-zinc-500" role="status" aria-live="polite">
              Saving stories…
            </p>
          ) : null}
          {saveError ? (
            <p className="text-sm text-amber-800" role="alert">
              {saveError}
            </p>
          ) : null}

          {mapping && mapping.requirements.some((r) => r.candidates.length > 0) ? (
            <div className="text-sm text-zinc-700" data-testid="story-bank-matches">
              <p className="font-medium">Linked behavioural requirements</p>
              <ul className="mt-2 space-y-1">
                {mapping.requirements
                  .filter((r) => r.candidates.length > 0)
                  .map((r) => (
                    <li key={r.requirementId}>
                      {r.text} → {r.candidates.map((c) => c.storyId).join(", ")}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
