/**
 * Client-side parse + validate for batch kit upload (JSON / CSV).
 * Output rows match docs/API.md POST /kits/batch: { jd, company_url, days }.
 * Array length 1–50; per-row rules reuse create-kit validation.
 */

import {
  hasFieldErrors,
  validateCreateKit,
  type CreateKitFieldErrors,
} from "./create-kit-validation";

export const BATCH_MIN_ROWS = 1;
export const BATCH_MAX_ROWS = 50;

export type BatchRowInput = {
  jd: string;
  company_url: string;
  days: number;
};

export type BatchPreviewRow = {
  index: number;
  jd: string;
  companyUrl: string;
  days: string;
  errors: CreateKitFieldErrors;
  /** Validated payload when the row has no field errors. */
  input: BatchRowInput | null;
};

export type BatchParseResult =
  | { ok: true; rows: BatchPreviewRow[]; fileError?: undefined }
  | { ok: false; rows: BatchPreviewRow[]; fileError: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickField(
  row: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    if (key in row && row[key] != null) {
      return String(row[key]);
    }
  }
  return "";
}

function previewFromRaw(
  index: number,
  jd: string,
  companyUrl: string,
  daysRaw: string,
): BatchPreviewRow {
  const errors = validateCreateKit({ jd, companyUrl, days: daysRaw });
  if (hasFieldErrors(errors)) {
    return { index, jd, companyUrl, days: daysRaw, errors, input: null };
  }
  const days = Number(daysRaw.trim());
  return {
    index,
    jd,
    companyUrl,
    days: daysRaw,
    errors: {},
    input: {
      jd: jd.trim(),
      company_url: companyUrl.trim(),
      days,
    },
  };
}

function previewFromObject(
  index: number,
  value: unknown,
): BatchPreviewRow {
  const row = asRecord(value);
  if (!row) {
    return {
      index,
      jd: "",
      companyUrl: "",
      days: "",
      errors: { jd: "Row must be an object with jd, company_url, and days." },
      input: null,
    };
  }
  const jd = pickField(row, "jd", "JD", "job_description");
  const companyUrl = pickField(row, "company_url", "companyUrl", "url");
  const daysRaw = pickField(row, "days", "Days");
  return previewFromRaw(index, jd, companyUrl, daysRaw);
}

/** Parse a CSV line respecting double-quoted fields (RFC 4180-ish). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Split CSV text into records. Handles quoted newlines.
 * Returns header + data rows as string[][].
 */
export function splitCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\r") {
      // ignore; handle \r\n with next char
    } else if (ch === "\n") {
      row.push(cur);
      records.push(row);
      row = [];
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    records.push(row);
  }
  return records.filter((r) => r.some((c) => c.trim() !== ""));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function mapCsvHeader(headers: string[]): {
  jd: number;
  companyUrl: number;
  days: number;
} | null {
  const normalized = headers.map(normalizeHeader);
  const jd = normalized.findIndex((h) =>
    ["jd", "job_description", "jobdescription"].includes(h),
  );
  const companyUrl = normalized.findIndex((h) =>
    ["company_url", "companyurl", "url", "company"].includes(h),
  );
  const days = normalized.findIndex((h) => h === "days");
  if (jd < 0 || companyUrl < 0 || days < 0) return null;
  return { jd, companyUrl, days };
}

export function parseBatchJson(text: string): BatchParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, rows: [], fileError: "Invalid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      rows: [],
      fileError: "JSON must be an array of { jd, company_url, days } objects.",
    };
  }
  if (parsed.length < BATCH_MIN_ROWS) {
    return {
      ok: false,
      rows: [],
      fileError: `Need at least ${BATCH_MIN_ROWS} row.`,
    };
  }
  if (parsed.length > BATCH_MAX_ROWS) {
    return {
      ok: false,
      rows: [],
      fileError: `At most ${BATCH_MAX_ROWS} rows per batch.`,
    };
  }
  const rows = parsed.map((item, i) => previewFromObject(i + 1, item));
  return { ok: true, rows };
}

export function parseBatchCsv(text: string): BatchParseResult {
  const records = splitCsvRecords(text);
  if (records.length < 2) {
    return {
      ok: false,
      rows: [],
      fileError: "CSV needs a header row and at least one data row.",
    };
  }
  const headerMap = mapCsvHeader(records[0]!);
  if (!headerMap) {
    return {
      ok: false,
      rows: [],
      fileError:
        "CSV header must include jd, company_url, and days columns.",
    };
  }
  const data = records.slice(1);
  if (data.length < BATCH_MIN_ROWS) {
    return {
      ok: false,
      rows: [],
      fileError: `Need at least ${BATCH_MIN_ROWS} data row.`,
    };
  }
  if (data.length > BATCH_MAX_ROWS) {
    return {
      ok: false,
      rows: [],
      fileError: `At most ${BATCH_MAX_ROWS} rows per batch.`,
    };
  }
  const rows = data.map((cells, i) =>
    previewFromRaw(
      i + 1,
      cells[headerMap.jd] ?? "",
      cells[headerMap.companyUrl] ?? "",
      cells[headerMap.days] ?? "",
    ),
  );
  return { ok: true, rows };
}

export function parseBatchFile(
  filename: string,
  text: string,
): BatchParseResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return parseBatchJson(text);
  if (lower.endsWith(".csv")) return parseBatchCsv(text);
  // Sniff when extension is missing / wrong
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseBatchJson(text);
  }
  return parseBatchCsv(text);
}

export function validBatchInputs(rows: BatchPreviewRow[]): BatchRowInput[] {
  return rows
    .map((r) => r.input)
    .filter((x): x is BatchRowInput => x !== null);
}

export function batchHasRowErrors(rows: BatchPreviewRow[]): boolean {
  return rows.some((r) => hasFieldErrors(r.errors) || r.input === null);
}
