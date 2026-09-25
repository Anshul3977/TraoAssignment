import { describe, expect, it } from "vitest";
import {
  BATCH_MAX_ROWS,
  batchHasRowErrors,
  parseBatchCsv,
  parseBatchFile,
  parseBatchJson,
  parseCsvLine,
  validBatchInputs,
} from "./batch-parse";

describe("parseCsvLine", () => {
  it("splits plain and quoted cells", () => {
    expect(parseCsvLine('a,b,"c,d"')).toEqual(["a", "b", "c,d"]);
    expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
  });
});

describe("parseBatchJson", () => {
  it("accepts a valid array (ignores extra id)", () => {
    const result = parseBatchJson(
      JSON.stringify([
        {
          id: "case-01",
          jd: "Senior engineer with React experience required.",
          company_url: "https://example.com",
          days: 5,
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.input).toEqual({
      jd: "Senior engineer with React experience required.",
      company_url: "https://example.com",
      days: 5,
    });
  });

  it("flags per-row validation errors", () => {
    const result = parseBatchJson(
      JSON.stringify([
        { jd: "", company_url: "not-a-url", days: 0 },
        {
          jd: "Enough text for a role description here.",
          company_url: "https://ok.example",
          days: 3,
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0]!.errors.jd).toMatch(/required/i);
    expect(result.rows[0]!.errors.companyUrl).toMatch(/http/i);
    expect(result.rows[0]!.errors.days).toMatch(/between/i);
    expect(result.rows[1]!.input).not.toBeNull();
    expect(batchHasRowErrors(result.rows)).toBe(true);
    expect(validBatchInputs(result.rows)).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(parseBatchJson("{not json").ok).toBe(false);
    expect(parseBatchJson("{not json").fileError).toMatch(/invalid json/i);
  });

  it("rejects non-array and oversized batches", () => {
    expect(parseBatchJson("{}").ok).toBe(false);
    const tooMany = Array.from({ length: BATCH_MAX_ROWS + 1 }, () => ({
      jd: "x".repeat(80),
      company_url: "https://example.com",
      days: 5,
    }));
    expect(parseBatchJson(JSON.stringify(tooMany)).fileError).toMatch(/50/);
  });
});

describe("parseBatchCsv", () => {
  it("parses header + rows with quoted JD newlines", () => {
    const csv = [
      "jd,company_url,days",
      '"Line one',
      'Line two",https://a.example,5',
      "short,https://b.example,3",
    ].join("\n");
    const result = parseBatchCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.jd).toContain("Line one");
    expect(result.rows[0]!.jd).toContain("Line two");
    expect(result.rows[0]!.input?.days).toBe(5);
    expect(result.rows[1]!.errors.jd).toBeUndefined();
  });

  it("requires known headers", () => {
    const result = parseBatchCsv("a,b,c\n1,2,3");
    expect(result.ok).toBe(false);
    expect(result.fileError).toMatch(/header/i);
  });
});

describe("parseBatchFile", () => {
  it("routes by extension", () => {
    const json = parseBatchFile(
      "cases.json",
      JSON.stringify([
        {
          jd: "Backend engineer Node Postgres.",
          company_url: "https://quiet.example",
          days: 5,
        },
      ]),
    );
    expect(json.ok).toBe(true);
    const csv = parseBatchFile(
      "rows.csv",
      "jd,company_url,days\nBackend engineer Node Postgres.,https://quiet.example,5\n",
    );
    expect(csv.ok).toBe(true);
  });
});
