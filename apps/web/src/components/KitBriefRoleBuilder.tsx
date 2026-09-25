"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KitQuestionsSection,
  VersionConflictPrompt,
  type UndoDeletePayload,
} from "@/components/KitQuestionsSection";
import {
  ApiClientError,
  getKit,
  kitFromConflictError,
  patchKit,
  regenerateKitQuestions,
  type KitOp,
  type KitQuestion,
  type KitRecord,
  type QuestionCategory,
} from "@/lib/api";
import {
  SAVE_DEBOUNCE_MS,
  buildPendingTextOps,
  coverageIndicator,
  draftsFromKit,
  isNetworkError,
  itemBadges,
  moveQuestionCategory,
  saveStatusLabel,
  setQuestionPinned,
  type BriefDraft,
  type QuestionDraft,
  type RequirementDraft,
  type SaveStatus,
} from "@/lib/kit-builder";

type KitBriefRoleBuilderProps = {
  kitId: string;
  /** Optional seed; client always re-fetches. */
  initialKit?: KitRecord | null;
};

export function KitBriefRoleBuilder({
  kitId,
  initialKit = null,
}: KitBriefRoleBuilderProps) {
  const [record, setRecord] = useState<KitRecord | null>(initialKit);
  const [brief, setBrief] = useState<BriefDraft | null>(
    initialKit ? draftsFromKit(initialKit.kit).brief : null,
  );
  const [requirements, setRequirements] = useState<RequirementDraft[] | null>(
    initialKit ? draftsFromKit(initialKit.kit).requirements : null,
  );
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[] | null>(
    initialKit ? draftsFromKit(initialKit.kit).questions : null,
  );
  const [localQuestions, setLocalQuestions] = useState<KitQuestion[] | null>(
    initialKit ? initialKit.kit.questions : null,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState("");
  const [pendingConflictKit, setPendingConflictKit] =
    useState<KitRecord | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const recordRef = useRef(record);
  const briefRef = useRef(brief);
  const requirementsRef = useRef(requirements);
  const questionDraftsRef = useRef(questionDrafts);
  const localQuestionsRef = useRef(localQuestions);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingFlushRef = useRef(false);

  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);
  useEffect(() => {
    requirementsRef.current = requirements;
  }, [requirements]);
  useEffect(() => {
    questionDraftsRef.current = questionDrafts;
  }, [questionDrafts]);
  useEffect(() => {
    localQuestionsRef.current = localQuestions;
  }, [localQuestions]);

  const adoptRecord = useCallback((next: KitRecord) => {
    const drafts = draftsFromKit(next.kit);
    setRecord(next);
    setBrief(drafts.brief);
    setRequirements(drafts.requirements);
    setQuestionDrafts(drafts.questions);
    setLocalQuestions(next.kit.questions);
    recordRef.current = next;
    briefRef.current = drafts.brief;
    requirementsRef.current = drafts.requirements;
    questionDraftsRef.current = drafts.questions;
    localQuestionsRef.current = next.kit.questions;
  }, []);

  const load = useCallback(async () => {
    try {
      const { kit } = await getKit(kitId);
      adoptRecord(kit);
      setLoadError(null);
      setSaveStatus("saved");
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not load kit.";
      setLoadError(message);
    }
  }, [kitId, adoptRecord]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConflict = useCallback(
    (err: ApiClientError) => {
      const conflictKit = kitFromConflictError(err);
      setConflictMessage(
        err.message || "Kit was modified; reload and retry.",
      );
      setPendingConflictKit(conflictKit);
      setConflictOpen(true);
      setSaveStatus("saved");
      setSaveError(null);
    },
    [],
  );

  const applyOps = useCallback(
    async (ops: KitOp[]): Promise<boolean> => {
      const current = recordRef.current;
      if (!current || ops.length === 0) return true;

      if (savingRef.current) {
        pendingFlushRef.current = true;
        return false;
      }

      savingRef.current = true;
      setSaveStatus("saving");
      setSaveError(null);

      try {
        const { kit: next } = await patchKit(current.id, {
          baseVersion: current.version,
          ops,
        });
        adoptRecord(next);
        setSaveStatus("saved");
        return true;
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") {
          handleConflict(err);
          return false;
        }
        if (isNetworkError(err)) {
          setSaveError("You appear to be offline.");
          setSaveStatus("offline");
        } else {
          const message =
            err instanceof ApiClientError
              ? err.message
              : "Save failed. Try again.";
          setSaveError(message);
          setSaveStatus("offline");
        }
        return false;
      } finally {
        savingRef.current = false;
        if (pendingFlushRef.current) {
          pendingFlushRef.current = false;
          // Caller may re-schedule; do not recurse blindly with stale ops.
        }
      }
    },
    [adoptRecord, handleConflict],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    const current = recordRef.current;
    const briefDraft = briefRef.current;
    const reqDrafts = requirementsRef.current;
    const qDrafts = questionDraftsRef.current;
    if (!current || !briefDraft || !reqDrafts || !qDrafts) return true;

    const ops = buildPendingTextOps(
      current.kit,
      briefDraft,
      reqDrafts,
      qDrafts,
    );
    if (ops.length === 0) {
      setSaveStatus("saved");
      setSaveError(null);
      return true;
    }

    return applyOps(ops);
  }, [applyOps]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /** Flush any pending debounce + text ops before structural / regen calls. */
  const flushPendingEdits = useCallback(async (): Promise<boolean> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Wait briefly if a save is in flight.
    let spins = 0;
    while (savingRef.current && spins < 50) {
      await new Promise((r) => setTimeout(r, 50));
      spins += 1;
    }
    return flushSave();
  }, [flushSave]);

  function onBriefChange(field: keyof BriefDraft, value: string) {
    setBrief((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      briefRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function onRequirementTextChange(id: string, value: string) {
    setRequirements((prev) => {
      if (!prev) return prev;
      const next = prev.map((r) => (r.id === id ? { ...r, text: value } : r));
      requirementsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function onQuestionPromptChange(id: string, value: string) {
    setQuestionDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.map((q) =>
        q.id === id ? { ...q, prompt: value } : q,
      );
      questionDraftsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function onQuestionOutlineChange(id: string, value: string) {
    setQuestionDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.map((q) =>
        q.id === id ? { ...q, answer_outline: value } : q,
      );
      questionDraftsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  async function runStructuralOp(
    optimistic: (qs: KitQuestion[]) => KitQuestion[],
    op: KitOp,
  ) {
    const ok = await flushPendingEdits();
    if (!ok) return;

    const prev = localQuestionsRef.current ?? [];
    const nextQs = optimistic(prev);
    setLocalQuestions(nextQs);
    localQuestionsRef.current = nextQs;

    const patched = await applyOps([op]);
    if (!patched) {
      // Revert optimistic order on failure (conflict dialog handles reload).
      setLocalQuestions(prev);
      localQuestionsRef.current = prev;
    }
  }

  async function onReorder(category: QuestionCategory, orderedIds: string[]) {
    const prev = localQuestionsRef.current ?? [];
    // Apply ordered ids within category using reorder helper pairwise from first delta.
    let next = [...prev];
    const currentIds = next
      .filter((q) => q.category === category)
      .map((q) => q.id);
    if (
      currentIds.length === orderedIds.length &&
      orderedIds.every((id, i) => id === currentIds[i])
    ) {
      return;
    }
    // Rebuild category block from orderedIds
    const byId = new Map(next.map((q) => [q.id, q]));
    const reorderedCat = orderedIds
      .map((id) => byId.get(id))
      .filter((q): q is KitQuestion => Boolean(q));
    const result: KitQuestion[] = [];
    let inserted = false;
    for (const q of next) {
      if (q.category === category) {
        if (!inserted) {
          result.push(...reorderedCat);
          inserted = true;
        }
      } else {
        result.push(q);
      }
    }
    if (!inserted) result.push(...reorderedCat);

    await flushPendingEdits();
    setLocalQuestions(result);
    localQuestionsRef.current = result;
    const patched = await applyOps([
      {
        op: "reorder",
        target: "questions",
        category,
        ids: orderedIds,
      },
    ]);
    if (!patched) {
      setLocalQuestions(prev);
      localQuestionsRef.current = prev;
    }
  }

  async function onMove(id: string, category: QuestionCategory) {
    await runStructuralOp(
      (qs) => moveQuestionCategory(qs, id, category),
      { op: "move", target: "question", id, category },
    );
  }

  async function onPinToggle(id: string, pinned: boolean) {
    await runStructuralOp(
      (qs) => setQuestionPinned(qs, id, pinned),
      {
        op: "update",
        target: "question",
        id,
        set: { pinned },
      },
    );
  }

  async function onAdd(category: QuestionCategory) {
    await flushPendingEdits();
    await applyOps([
      {
        op: "add",
        target: "question",
        value: {
          prompt: "New question",
          answer_outline: "Outline your answer here.",
          category,
          difficulty: 2,
          requirement_ids: [],
        },
      },
    ]);
  }

  async function onDelete(id: string) {
    await runStructuralOp(
      (qs) => qs.filter((q) => q.id !== id),
      { op: "delete", target: "question", id },
    );
    setQuestionDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.filter((d) => d.id !== id);
      questionDraftsRef.current = next;
      return next;
    });
  }

  async function onUndoDelete(payload: UndoDeletePayload) {
    const q = payload.question;
    await flushPendingEdits();
    await applyOps([
      {
        op: "add",
        target: "question",
        value: {
          prompt: q.prompt,
          answer_outline: q.answer_outline,
          category: q.category as QuestionCategory,
          difficulty: ([1, 2, 3].includes(Number(q.difficulty))
            ? Number(q.difficulty)
            : 2) as 1 | 2 | 3,
          requirement_ids: q.requirement_ids,
        },
      },
    ]);
  }

  async function onRequestRegenerate(category: QuestionCategory) {
    const current = recordRef.current;
    if (!current) return;

    const flushed = await flushPendingEdits();
    if (!flushed) return;

    setRegenerating(true);
    setSaveError(null);
    try {
      const result = await regenerateKitQuestions(current.id, category);
      adoptRecord(result.kit);
      setSaveStatus("saved");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "VERSION_CONFLICT") {
        handleConflict(err);
      } else if (isNetworkError(err)) {
        setSaveError("You appear to be offline.");
        setSaveStatus("offline");
      } else {
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Regenerate failed. Try again.";
        setSaveError(message);
      }
    } finally {
      setRegenerating(false);
    }
  }

  function onRetry() {
    void flushSave();
  }

  function onConflictReload() {
    if (pendingConflictKit) {
      adoptRecord(pendingConflictKit);
    } else {
      void load();
    }
    setConflictOpen(false);
    setPendingConflictKit(null);
  }

  function onConflictDismiss() {
    // Do not silently adopt — leave local drafts; user decides.
    setConflictOpen(false);
    if (pendingConflictKit) {
      // Keep server kit as record source of truth for version, but surface alert.
      setSaveError(
        "Server has a newer version. Reload latest to continue saving, or re-apply edits after reload.",
      );
    }
  }

  if (loadError && !record) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {loadError}
      </p>
    );
  }

  if (
    !record ||
    !brief ||
    !requirements ||
    !questionDrafts ||
    !localQuestions
  ) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        Loading kit…
      </p>
    );
  }

  const uncovered = record.kit.coverage.uncovered_requirement_ids;
  const briefBadges = itemBadges(record.kit.company_brief.meta);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {record.title || record.kit.role.title}
          </h1>
          <div
            className="flex items-center gap-2 text-sm"
            data-testid="save-status"
            data-status={saveStatus}
            role="status"
            aria-live="polite"
          >
            <span
              className={
                saveStatus === "offline"
                  ? "text-amber-700"
                  : saveStatus === "saving"
                    ? "text-zinc-500"
                    : "text-emerald-700"
              }
            >
              {saveStatusLabel(saveStatus)}
            </span>
            {saveStatus === "offline" ? (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                data-testid="save-retry"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-zinc-600">
          {record.kit.source.company}
          {record.kit.role.seniority
            ? ` · ${record.kit.role.seniority}`
            : null}
          {" · "}
          version {record.version}
        </p>
        {saveError ? (
          <p className="text-sm text-amber-800" role="alert">
            {saveError}
          </p>
        ) : null}
      </header>

      <section
        aria-labelledby="brief-heading"
        className="rounded-lg border border-zinc-200 bg-white p-6"
        data-testid="brief-section"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2
            id="brief-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Brief
          </h2>
          {briefBadges.map((b) => (
            <Badge key={b.key} label={b.label} />
          ))}
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Summary</span>
          <textarea
            value={brief.summary}
            onChange={(e) => onBriefChange("summary", e.target.value)}
            rows={4}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            data-testid="brief-summary"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">What they do</span>
          <textarea
            value={brief.what_they_do}
            onChange={(e) => onBriefChange("what_they_do", e.target.value)}
            rows={3}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            data-testid="brief-what-they-do"
          />
        </label>

        {record.kit.company_brief.sources.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Sources
            </h3>
            <ul className="mt-1 space-y-1 text-xs text-zinc-600">
              {record.kit.company_brief.sources.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="role-heading"
        className="rounded-lg border border-zinc-200 bg-white p-6"
        data-testid="role-section"
      >
        <h2
          id="role-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Role
        </h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Title
            </dt>
            <dd className="mt-0.5 text-zinc-900">{record.kit.role.title}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Seniority
            </dt>
            <dd className="mt-0.5 text-zinc-900">
              {record.kit.role.seniority || "—"}
            </dd>
          </div>
        </dl>

        {record.kit.role.responsibilities.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Responsibilities
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
              {record.kit.role.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <h3 className="mt-6 text-sm font-semibold text-zinc-800">
          Requirements
        </h3>
        <ul className="mt-3 space-y-4" data-testid="requirements-list">
          {requirements.map((draft) => {
            const savedReq = record.kit.role.requirements.find(
              (r) => r.id === draft.id,
            );
            const priority = savedReq?.priority ?? "must";
            const badges = itemBadges(savedReq?.meta);
            const coverage = coverageIndicator(draft.id, uncovered);
            return (
              <li
                key={draft.id}
                className="rounded-md border border-zinc-200 bg-zinc-50/50 p-3"
                data-testid={`requirement-${draft.id}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-500">
                    {draft.id}
                  </span>
                  <PriorityBadge priority={priority} />
                  <CoverageBadge coverage={coverage} />
                  {badges.map((b) => (
                    <Badge key={b.key} label={b.label} />
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="sr-only">Requirement {draft.id} text</span>
                  <textarea
                    value={draft.text}
                    onChange={(e) =>
                      onRequirementTextChange(draft.id, e.target.value)
                    }
                    rows={2}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    data-testid={`requirement-text-${draft.id}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <KitQuestionsSection
        questions={localQuestions}
        drafts={questionDrafts}
        onPromptChange={onQuestionPromptChange}
        onOutlineChange={onQuestionOutlineChange}
        onReorder={onReorder}
        onMove={onMove}
        onPinToggle={onPinToggle}
        onAdd={onAdd}
        onDelete={onDelete}
        onUndoDelete={onUndoDelete}
        onRequestRegenerate={onRequestRegenerate}
        regenerating={regenerating}
      />

      <p className="text-sm text-zinc-600">
        <Link href="/" className="underline hover:text-zinc-900">
          Back to dashboard
        </Link>
      </p>

      {conflictOpen ? (
        <VersionConflictPrompt
          message={conflictMessage}
          onReload={onConflictReload}
          onDismiss={onConflictDismiss}
        />
      ) : null}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const isMust = priority === "must";
  return (
    <span
      className={
        isMust
          ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
          : "rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800"
      }
      data-testid="priority-badge"
    >
      {isMust ? "Must" : priority === "nice" ? "Nice" : priority}
    </span>
  );
}

function CoverageBadge({
  coverage,
}: {
  coverage: ReturnType<typeof coverageIndicator>;
}) {
  return (
    <span
      className={
        coverage.covered
          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
          : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
      }
      data-testid="coverage-badge"
      data-covered={coverage.covered ? "true" : "false"}
    >
      {coverage.label}
    </span>
  );
}
