"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiClientError, createKit, type GenerationJob } from "@/lib/api";
import {
  DAYS_MAX,
  DAYS_MIN,
  JD_MAX_CHARS,
  hasFieldErrors,
  parseDays,
  thinJdWarning,
  validateCreateKit,
  type CreateKitFieldErrors,
} from "@/lib/create-kit-validation";
import { PHONE_LAYOUT } from "@/lib/a11y";

type SubmitResult = {
  job: GenerationJob;
  created: boolean;
};

export function CreateKitForm() {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState("5");
  const [fieldErrors, setFieldErrors] = useState<CreateKitFieldErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const trimmedLen = jd.trim().length;
  const warning = thinJdWarning(jd);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const errors = validateCreateKit({ jd, companyUrl, days });
    setFieldErrors(errors);
    if (hasFieldErrors(errors)) return;

    const daysNum = parseDays(days);
    if (daysNum === null) return;

    setPending(true);
    try {
      const { job, created } = await createKit({
        jd: jd.trim(),
        company_url: companyUrl.trim(),
        days: daysNum,
      });
      setResult({ job, created });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Something went wrong. Try again.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`mx-auto w-full max-w-2xl ${PHONE_LAYOUT.minWidth}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Job description</span>
          <textarea
            name="jd"
            rows={12}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            maxLength={JD_MAX_CHARS}
            aria-invalid={Boolean(fieldErrors.jd)}
            aria-describedby="jd-count jd-hint"
            className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            placeholder="Paste the full job description…"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span id="jd-count" className="text-xs text-zinc-500">
              {trimmedLen.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}{" "}
              characters
            </span>
            {fieldErrors.jd ? (
              <span className="text-xs text-red-600" role="alert">
                {fieldErrors.jd}
              </span>
            ) : null}
          </div>
          {warning ? (
            <p
              id="jd-hint"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              role="status"
            >
              {warning}
            </p>
          ) : (
            <span id="jd-hint" className="sr-only">
              Paste the job description text.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Company URL</span>
          <input
            type="url"
            name="company_url"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://example.com"
            aria-invalid={Boolean(fieldErrors.companyUrl)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
          {fieldErrors.companyUrl ? (
            <span className="text-xs text-red-600" role="alert">
              {fieldErrors.companyUrl}
            </span>
          ) : (
            <span className="text-xs text-zinc-500">
              Homepage or careers site (http or https).
            </span>
          )}
        </label>

        <label className="flex max-w-xs flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Prep days</span>
          <input
            type="number"
            name="days"
            min={DAYS_MIN}
            max={DAYS_MAX}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-invalid={Boolean(fieldErrors.days)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
          {fieldErrors.days ? (
            <span className="text-xs text-red-600" role="alert">
              {fieldErrors.days}
            </span>
          ) : (
            <span className="text-xs text-zinc-500">
              Schedule length: {DAYS_MIN}–{DAYS_MAX} days.
            </span>
          )}
        </label>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {result && !result.created ? (
          <div
            className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
            role="status"
          >
            <p className="font-medium">Duplicate submit</p>
            <p className="mt-1 text-sky-900/90">
              You already started a job for this job description, company URL,
              and day count. Opening the existing job instead of starting a new
              one.
            </p>
            <p className="mt-3">
              <Link
                href={`/jobs/${result.job.id}`}
                className="font-medium underline hover:text-sky-700"
              >
                Open existing job ({result.job.status})
              </Link>
            </p>
          </div>
        ) : null}

        {result?.created ? (
          <div
            className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
            role="status"
          >
            <p className="font-medium">Generation started</p>
            <p className="mt-1">
              Job is {result.job.status}. You can leave and come back — progress
              is saved on the server.
            </p>
            <p className="mt-3">
              <Link
                href={`/jobs/${result.job.id}`}
                className="font-medium underline hover:text-emerald-800"
              >
                View job progress
              </Link>
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {pending ? "Starting…" : "Create kit"}
          </button>
          <Link
            href="/kits/batch"
            className="text-sm text-zinc-600 underline hover:text-zinc-900"
          >
            Batch upload
          </Link>
          <Link
            href="/"
            className="text-sm text-zinc-600 underline hover:text-zinc-900"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
