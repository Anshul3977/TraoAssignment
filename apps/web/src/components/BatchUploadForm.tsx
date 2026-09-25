"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import {
  ApiClientError,
  createKitsBatch,
  type BatchJobResult,
} from "@/lib/api";
import {
  batchHasRowErrors,
  parseBatchFile,
  validBatchInputs,
  type BatchPreviewRow,
} from "@/lib/batch-parse";
import { PHONE_LAYOUT } from "@/lib/a11y";

export function BatchUploadForm() {
  const [rows, setRows] = useState<BatchPreviewRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchJobResult[] | null>(null);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setSubmitError(null);
    setResults(null);
    const file = e.target.files?.[0];
    if (!file) {
      setRows([]);
      setFileError(null);
      setFileName(null);
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseBatchFile(file.name, text);
    if (!parsed.ok) {
      setFileError(parsed.fileError);
      setRows(parsed.rows);
      return;
    }
    setFileError(null);
    setRows(parsed.rows);
  }

  async function onSubmit() {
    setSubmitError(null);
    setResults(null);
    if (rows.length === 0) {
      setSubmitError("Choose a JSON or CSV file first.");
      return;
    }
    if (batchHasRowErrors(rows)) {
      setSubmitError("Fix validation errors in the preview before uploading.");
      return;
    }
    const inputs = validBatchInputs(rows);
    setPending(true);
    try {
      const { jobs } = await createKitsBatch(inputs);
      setResults(jobs);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Batch upload failed. Try again.";
      setSubmitError(message);
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    rows.length > 0 && !batchHasRowErrors(rows) && !fileError && !pending;

  return (
    <div className={`mx-auto flex w-full max-w-4xl ${PHONE_LAYOUT.minWidth} flex-col gap-6`}>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700">Upload JSON or CSV</span>
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={(e) => void onFileChange(e)}
          className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800"
        />
        <span className="text-xs text-zinc-500">
          JSON array of {"{ jd, company_url, days }"} or CSV with those column
          headers. 1–50 rows. Extra fields (e.g. id) are ignored.
        </span>
      </label>

      {fileName ? (
        <p className="text-xs text-zinc-500">Selected: {fileName}</p>
      ) : null}

      {fileError ? (
        <p className="text-sm text-red-600" role="alert">
          {fileError}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className={`${PHONE_LAYOUT.overflowX} rounded-md border border-zinc-200 bg-white`}>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">JD preview</th>
                <th className="px-3 py-2 font-medium">Company URL</th>
                <th className="px-3 py-2 font-medium">Days</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const errParts = [
                  row.errors.jd,
                  row.errors.companyUrl,
                  row.errors.days,
                ].filter(Boolean);
                const ok = row.input !== null && errParts.length === 0;
                return (
                  <tr
                    key={row.index}
                    className="border-b border-zinc-100 align-top last:border-0"
                    data-row-valid={ok ? "true" : "false"}
                  >
                    <td className="px-3 py-2 text-zinc-500">{row.index}</td>
                    <td className="max-w-xs truncate px-3 py-2 font-mono text-xs">
                      {row.jd.trim() || "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs">
                      {row.companyUrl || "—"}
                    </td>
                    <td className="px-3 py-2">{row.days || "—"}</td>
                    <td className="px-3 py-2">
                      {ok ? (
                        <span className="text-xs text-emerald-700">OK</span>
                      ) : (
                        <span className="text-xs text-red-600" role="alert">
                          {errParts.join(" ")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {submitError ? (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      ) : null}

      {results ? (
        <div
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
          role="status"
        >
          <p className="font-medium">
            Started {results.filter((r) => r.created).length} new job
            {results.filter((r) => r.created).length === 1 ? "" : "s"};{" "}
            {results.filter((r) => !r.created).length} existing (idempotent).
          </p>
          <ul className="mt-3 space-y-1.5">
            {results.map((r) => (
              <li key={r.job.id}>
                <Link
                  href={`/jobs/${r.job.id}`}
                  className="font-medium underline hover:text-emerald-800"
                >
                  Job {r.job.id.slice(-6)} ({r.job.status}
                  {r.created ? "" : ", existing"})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void onSubmit()}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Start batch"}
        </button>
        <Link
          href="/kits/new"
          className="text-sm text-zinc-600 underline hover:text-zinc-900"
        >
          Single kit form
        </Link>
      </div>
    </div>
  );
}
