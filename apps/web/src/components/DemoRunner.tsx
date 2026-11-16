"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Kit, KitEvaluation, LlmCallTrace, TraceSummary } from "@prep/core";

const SAMPLE_JD = `Backend Engineer (Python)
You will build and operate REST APIs with FastAPI and PostgreSQL, write tests with pytest, deploy with Docker on AWS, and work with our data team on ML model serving.
Must have: 2+ years of Python, SQL, REST API design, Git.
Nice to have: Kubernetes, Redis, experience shipping LLM features.`;

const STEP_LABELS: Record<string, string> = {
  extract: "Extract requirements from the JD",
  crawl: "Crawl the company site",
  search_discussion: "Search public discussion",
  brief: "Write the company brief",
  interview_process: "Find the interview process",
  questions: "Generate grounded questions",
  coverage: "Check every must-have is covered",
  flashcards: "Make flashcards",
  schedule: "Plan the days",
  validate: "Validate the kit",
};

type StepState = { step: string; status: string; detail?: string; ms?: number };
type Trace = TraceSummary & { runId: string; totalMs: number; stepMs: Record<string, number> };
type Line =
  | ({ type: "progress" } & StepState)
  | ({ type: "llm" } & LlmCallTrace)
  | { type: "kit"; kit: Kit; evaluation: KitEvaluation; trace: Trace }
  | { type: "error"; code: string; message: string; trace?: Trace }
  | { type: "ping" };

export function DemoRunner() {
  const [jd, setJd] = useState(SAMPLE_JD);
  const [url, setUrl] = useState("https://about.gitlab.com");
  const [days, setDays] = useState(5);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [kit, setKit] = useState<Kit | null>(null);
  const [evaluation, setEvaluation] = useState<KitEvaluation | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [llmCalls, setLlmCalls] = useState<LlmCallTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setKit(null);
    setEvaluation(null);
    setTrace(null);
    setLlmCalls([]);
    setSteps([]);
    setStarted(Date.now());
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jd, company_url: url, days }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          const line = JSON.parse(raw) as Line;
          if (line.type === "progress") {
            setSteps((prev) => {
              const next = prev.filter((s) => s.step !== line.step);
              return [...next, { step: line.step, status: line.status, detail: line.detail, ms: line.ms }];
            });
          } else if (line.type === "llm") {
            const { type: _t, ...call } = line;
            void _t;
            setLlmCalls((prev) => [...prev, call]);
          } else if (line.type === "kit") {
            setKit(line.kit);
            setEvaluation(line.evaluation);
            setTrace(line.trace);
            setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          } else if (line.type === "error") {
            setError(line.message);
            if (line.trace) setTrace(line.trace);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div>
          <label htmlFor="jd" className="block text-sm font-medium text-zinc-800">Job description</label>
          <textarea
            id="jd"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={7}
            maxLength={6000}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-zinc-800">Company website</label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="days" className="block text-sm font-medium text-zinc-800">Days to prep</label>
            <input
              id="days"
              type="number"
              min={1}
              max={14}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {pending ? "Building kit…" : "Build my prep kit"}
          </button>
          {pending && started && <Elapsed since={started} />}
        </div>
      </form>

      {(steps.length > 0 || error) && (
        <section aria-live="polite" className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-900">Pipeline</h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {steps.map((s) => (
              <li key={s.step} className="flex gap-3">
                <span className={s.status === "done" ? "text-emerald-600" : s.status === "failed" ? "text-red-600" : s.status === "skipped" ? "text-zinc-400" : "text-amber-600"}>
                  {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.status === "skipped" ? "–" : "…"}
                </span>
                <span className="text-zinc-800">{STEP_LABELS[s.step] ?? s.step}</span>
                {s.detail && <span className="truncate text-zinc-500">{s.detail}</span>}
                {s.ms !== undefined && (
                  <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-zinc-400">{(s.ms / 1000).toFixed(1)}s</span>
                )}
              </li>
            ))}
          </ol>
          {llmCalls.length > 0 && (
            <p className="mt-3 font-mono text-xs text-zinc-500" data-testid="llm-counter">
              {llmCalls.length} LLM call{llmCalls.length === 1 ? "" : "s"} ·{" "}
              {llmCalls.reduce((a, c) => a + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0).toLocaleString()} tokens
              {llmCalls.some((c) => !c.ok) && ` · ${llmCalls.filter((c) => !c.ok).length} retried/failed`}
            </p>
          )}
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {kit && (
        <div ref={resultRef} className="space-y-6">
          {evaluation && <EvaluationView evaluation={evaluation} />}
          <KitView kit={kit} />
          {trace && <TraceView trace={trace} calls={llmCalls} />}
        </div>
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-sm tabular-nums text-zinc-500">{Math.round((now - since) / 1000)}s</span>;
}

function KitView({ kit }: { kit: Kit }) {
  const reqById = new Map(kit.role.requirements.map((r) => [r.id, r]));
  const process = (kit.research_log?.interview_process ?? { found: false, stages: [] }) as {
    found: boolean;
    stages: { name: string }[];
  };
  return (
    <article className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{kit.source.company}</p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-900">{kit.role.title}</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-700">{kit.company_brief.summary}</p>
        {process.found && process.stages.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Interview process found</h3>
            <ol className="mt-2 flex flex-wrap gap-2">
              {process.stages.map((st, i) => (
                <li key={i} className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-700">
                  {i + 1}. {st.name}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Requirements from the JD</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {kit.role.requirements.map((r) => (
              <li
                key={r.id}
                className={`rounded-md px-2 py-1 text-xs ${r.priority === "must" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}
              >
                {r.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-zinc-900">Questions ({kit.questions.length})</h3>
        <ul className="mt-3 divide-y divide-zinc-100">
          {kit.questions.map((q) => (
            <li key={q.id} className="py-3">
              <details>
                <summary className="cursor-pointer text-sm text-zinc-900">
                  <span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] uppercase text-zinc-600">{q.category}</span>
                  {q.prompt}
                </summary>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{q.answer_outline}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Covers: {q.requirement_ids.map((id) => reqById.get(id)?.text ?? id).join(", ")}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-zinc-900">Flashcards ({kit.flashcards.length})</h3>
          <ul className="mt-3 space-y-3">
            {kit.flashcards.map((f) => (
              <li key={f.id} className="rounded-md border border-zinc-100 p-3 text-sm">
                <p className="font-medium text-zinc-900">{f.front}</p>
                <p className="mt-1 text-zinc-600">{f.back}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-zinc-900">Plan ({kit.schedule.days.length} days)</h3>
          <ol className="mt-3 space-y-2 text-sm">
            {kit.schedule.days.map((d) => (
              <li key={d.day} className="flex justify-between gap-3 border-b border-zinc-100 pb-2">
                <span className="text-zinc-800">
                  <span className="mr-2 font-mono text-zinc-500">D{d.day}</span>
                  {d.focus}
                </span>
                <span className="shrink-0 text-zinc-500">{d.minutes} min</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {(() => {
        const skipped = ((kit.research_log?.skipped ?? []) as { source?: string; reason?: string }[]).filter(
          (x) => x.source && x.source !== "crawl" && x.source !== "discussion",
        );
        return skipped.length > 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Degraded honestly: {skipped.map((x) => `${x.source} (${(x.reason ?? "").slice(0, 120)})`).join("; ")}
          </p>
        ) : null;
      })()}
      <p className="text-xs text-zinc-500">
        Sources used: {kit.company_brief.sources.length} company pages · coverage passes: {kit.coverage.passes} · uncovered
        must-haves: {kit.coverage.uncovered_requirement_ids.length}
      </p>
    </article>
  );
}

function EvaluationView({ evaluation }: { evaluation: KitEvaluation }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5" data-testid="kit-evaluation">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-zinc-900">Automatic quality checks</h3>
        <p className="font-mono text-sm text-zinc-900">
          {evaluation.score}/100 <span className="text-zinc-500">· {evaluation.passed}/{evaluation.total} passed</span>
        </p>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Recomputed in code from the kit and your JD. No LLM grades its own work.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {evaluation.checks.map((c) => (
          <li key={c.id} className="flex gap-2 rounded-md border border-zinc-100 px-3 py-2 text-sm">
            <span className={c.pass ? "text-emerald-600" : "text-amber-600"}>{c.pass ? "✓" : "!"}</span>
            <span>
              <span className="text-zinc-900">{c.label}</span>
              <span className="block text-xs text-zinc-500">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TraceView({ trace, calls }: { trace: Trace; calls: LlmCallTrace[] }) {
  const steps = Object.entries(trace.stepMs);
  const max = Math.max(1, ...steps.map(([, ms]) => ms));
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5" data-testid="kit-trace">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Run trace</h3>
        <p className="font-mono text-xs text-zinc-500">
          run {trace.runId} · {(trace.totalMs / 1000).toFixed(1)}s total · {trace.calls} LLM calls ·{" "}
          {(trace.promptTokens + trace.completionTokens).toLocaleString()} tokens
        </p>
      </div>
      <ol className="mt-3 space-y-1.5">
        {steps.map(([step, ms]) => (
          <li key={step} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-xs">
            <span className="truncate text-zinc-700">{STEP_LABELS[step] ?? step}</span>
            <span className="h-2 rounded bg-zinc-100">
              <span className="block h-2 rounded bg-zinc-800" style={{ width: `${Math.max(2, (ms / max) * 100)}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums text-zinc-500">{(ms / 1000).toFixed(1)}s</span>
          </li>
        ))}
      </ol>
      {calls.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-zinc-600">LLM calls ({calls.length})</summary>
          <table className="mt-2 w-full text-left font-mono text-xs text-zinc-600">
            <thead>
              <tr className="text-zinc-400">
                <th className="py-1 font-normal">#</th>
                <th className="font-normal">step</th>
                <th className="font-normal">model</th>
                <th className="text-right font-normal">ms</th>
                <th className="text-right font-normal">in / out tokens</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.seq} className={c.ok ? "" : "text-red-600"}>
                  <td className="py-0.5">{c.seq}</td>
                  <td>{c.step ?? "-"}</td>
                  <td>{c.ok ? c.model : c.error}</td>
                  <td className="text-right tabular-nums">{c.ms}</td>
                  <td className="text-right tabular-nums">
                    {c.promptTokens ?? "-"} / {c.completionTokens ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
