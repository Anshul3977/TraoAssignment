import { describe, expect, it } from "vitest";
import { createDemoLimiter, parseDemoInput } from "./demo-rate-limit";

describe("createDemoLimiter", () => {
  it("allows up to max hits per window, then reports seconds to wait", () => {
    const l = createDemoLimiter({ max: 2, windowMs: 60_000 });
    expect(l.take("ip", 0)).toBeNull();
    expect(l.take("ip", 1_000)).toBeNull();
    expect(l.take("ip", 2_000)).toBe(58);
    expect(l.take("other", 2_000)).toBeNull();
    expect(l.take("ip", 60_001)).toBeNull();
  });
});

describe("parseDemoInput", () => {
  const jd = "Backend engineer building REST APIs in Python with PostgreSQL and Docker.";
  it("accepts a valid request", () => {
    expect(parseDemoInput({ jd, company_url: "https://example.com", days: 5 })).toEqual({
      jd,
      company_url: "https://example.com",
      days: 5,
    });
  });
  it("rejects short JDs, bad URLs and out-of-range days", () => {
    expect(parseDemoInput({ jd: "short", company_url: "https://e.com", days: 3 })).toHaveProperty("error");
    expect(parseDemoInput({ jd, company_url: "ftp://e.com", days: 3 })).toHaveProperty("error");
    expect(parseDemoInput({ jd, company_url: "https://e.com", days: 30 })).toHaveProperty("error");
    expect(parseDemoInput({ jd, company_url: "https://e.com", days: 2.5 })).toHaveProperty("error");
  });
});
