import { describe, expect, it } from "vitest";
import {
  DAYS_MAX,
  DAYS_MIN,
  JD_MAX_CHARS,
  THIN_JD_CHARS,
  hasFieldErrors,
  isHttpUrl,
  parseDays,
  thinJdWarning,
  validateCreateKit,
} from "./create-kit-validation";

const valid = {
  jd: "a".repeat(THIN_JD_CHARS),
  companyUrl: "https://example.com",
  days: "5",
};

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://example.com/careers")).toBe(true);
    expect(isHttpUrl("http://localhost:8099/acme/")).toBe(true);
  });

  it("rejects non-http schemes and garbage", () => {
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
  });
});

describe("parseDays", () => {
  it("parses integers", () => {
    expect(parseDays("1")).toBe(1);
    expect(parseDays("60")).toBe(60);
    expect(parseDays(" 14 ")).toBe(14);
  });

  it("rejects non-integers", () => {
    expect(parseDays("")).toBeNull();
    expect(parseDays("1.5")).toBeNull();
    expect(parseDays("-1")).toBeNull();
    expect(parseDays("abc")).toBeNull();
  });
});

describe("thinJdWarning", () => {
  it("is silent for empty or long enough JD", () => {
    expect(thinJdWarning("")).toBeNull();
    expect(thinJdWarning("   ")).toBeNull();
    expect(thinJdWarning("x".repeat(THIN_JD_CHARS))).toBeNull();
  });

  it("warns when trimmed length is below threshold", () => {
    const msg = thinJdWarning("short");
    expect(msg).toMatch(/short/i);
    expect(msg).toMatch(String("short".length));
  });
});

describe("validateCreateKit", () => {
  it("passes a valid payload", () => {
    expect(validateCreateKit(valid)).toEqual({});
    expect(hasFieldErrors(validateCreateKit(valid))).toBe(false);
  });

  it("rejects empty JD", () => {
    const errors = validateCreateKit({ ...valid, jd: "   " });
    expect(errors.jd).toMatch(/required/i);
  });

  it("rejects JD over max length", () => {
    const errors = validateCreateKit({
      ...valid,
      jd: "x".repeat(JD_MAX_CHARS + 1),
    });
    expect(errors.jd).toMatch(/at most/i);
  });

  it("rejects bad URL", () => {
    expect(validateCreateKit({ ...valid, companyUrl: "" }).companyUrl).toMatch(
      /required/i,
    );
    expect(
      validateCreateKit({ ...valid, companyUrl: "not-a-url" }).companyUrl,
    ).toMatch(/http/i);
  });

  it("rejects days outside 1–60", () => {
    expect(validateCreateKit({ ...valid, days: "0" }).days).toMatch(
      new RegExp(`${DAYS_MIN}.*${DAYS_MAX}`),
    );
    expect(validateCreateKit({ ...valid, days: "61" }).days).toMatch(
      new RegExp(`${DAYS_MIN}.*${DAYS_MAX}`),
    );
    expect(validateCreateKit({ ...valid, days: "3.2" }).days).toMatch(
      /whole number/i,
    );
  });
});
