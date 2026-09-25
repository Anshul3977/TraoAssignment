/**
 * Client-side validation for the create-kit form.
 * Field rules mirror docs/API.md `POST /kits` (jd, company_url, days).
 * Thin-JD threshold matches core `groundRequirements` (THIN_JD_CHARS = 80).
 */

export const JD_MAX_CHARS = 100_000;
/** Warn when trimmed JD is shorter than this (pipeline marks thin_jd). */
export const THIN_JD_CHARS = 80;
export const URL_MAX_CHARS = 2048;
export const DAYS_MIN = 1;
export const DAYS_MAX = 60;

export type CreateKitFormValues = {
  jd: string;
  companyUrl: string;
  days: string;
};

export type CreateKitFieldErrors = {
  jd?: string;
  companyUrl?: string;
  days?: string;
};

export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function parseDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  return n;
}

/** Non-blocking hint when the JD is likely too short for a rich kit. */
export function thinJdWarning(jd: string): string | null {
  const len = jd.trim().length;
  if (len === 0) return null;
  if (len < THIN_JD_CHARS) {
    return `This JD is short (${len} characters). The kit will stay thin — only what the text literally supports.`;
  }
  return null;
}

export function validateCreateKit(
  values: CreateKitFormValues,
): CreateKitFieldErrors {
  const errors: CreateKitFieldErrors = {};
  const jd = values.jd.trim();
  if (!jd) {
    errors.jd = "Job description is required.";
  } else if (jd.length > JD_MAX_CHARS) {
    errors.jd = `Job description must be at most ${JD_MAX_CHARS.toLocaleString()} characters.`;
  }

  const url = values.companyUrl.trim();
  if (!url) {
    errors.companyUrl = "Company URL is required.";
  } else if (url.length > URL_MAX_CHARS) {
    errors.companyUrl = `URL must be at most ${URL_MAX_CHARS.toLocaleString()} characters.`;
  } else if (!isHttpUrl(url)) {
    errors.companyUrl = "Enter a valid http:// or https:// URL.";
  }

  const days = parseDays(values.days);
  if (days === null) {
    errors.days = "Days must be a whole number.";
  } else if (days < DAYS_MIN || days > DAYS_MAX) {
    errors.days = `Days must be between ${DAYS_MIN} and ${DAYS_MAX}.`;
  }

  return errors;
}

export function hasFieldErrors(errors: CreateKitFieldErrors): boolean {
  return Boolean(errors.jd || errors.companyUrl || errors.days);
}
