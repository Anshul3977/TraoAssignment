import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendixBCloneVerdict,
  CHECK_OUTPUT_ARGS,
  CLEAN_CLONE_STEPS,
  copyDotenvIfPresent,
  envCopyLog,
  EVALUATE_FLAG_ARGS,
  EVALUATE_INPUT,
  EVALUATE_OUTPUT,
} from "./clean-clone-check.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("clean-clone-check", () => {
  it("lists clone, install, typecheck, test, fixtures, evaluate, check-output", () => {
    const joined = CLEAN_CLONE_STEPS.join(" ");
    expect(joined).toContain("git clone");
    expect(joined).toContain("npm install");
    expect(joined).toContain("npm run typecheck");
    expect(joined).toContain("npm test");
    expect(joined).toContain("npm run fixtures");
    expect(joined).toContain(
      "npm run evaluate -- --input fixtures/cases.json --output out/kits.json",
    );
    expect(joined).toContain("npm run check-output -- --input out/kits.json");
  });

  it("uses SPEC §9 evaluate flags", () => {
    expect([...EVALUATE_FLAG_ARGS]).toEqual([
      "--",
      "--input",
      EVALUATE_INPUT,
      "--output",
      EVALUATE_OUTPUT,
    ]);
    expect([...CHECK_OUTPUT_ARGS]).toEqual(["--", "--input", EVALUATE_OUTPUT]);
  });

  it("copies .env without putting secrets in the log line", () => {
    const src = mkdtempSync(join(tmpdir(), "cc-src-"));
    const dest = mkdtempSync(join(tmpdir(), "cc-dest-"));
    tmpDirs.push(src, dest);
    writeFileSync(join(src, ".env"), "GEMINI_API_KEY=super-secret-token\n", "utf8");
    expect(copyDotenvIfPresent(src, dest)).toBe(true);
    expect(readFileSync(join(dest, ".env"), "utf8")).toContain("super-secret-token");
    const log = envCopyLog(true);
    expect(log).not.toContain("super-secret-token");
    expect(log).not.toMatch(/GEMINI_API_KEY=/);
  });

  it("skips copy when source has no .env", () => {
    const src = mkdtempSync(join(tmpdir(), "cc-src-"));
    const dest = mkdtempSync(join(tmpdir(), "cc-dest-"));
    tmpDirs.push(src, dest);
    expect(copyDotenvIfPresent(src, dest)).toBe(false);
    expect(envCopyLog(false)).not.toMatch(/KEY=/);
  });

  it("rejects missing-key evaluate output", () => {
    const verdict = appendixBCloneVerdict(
      {
        version: 1,
        generated_at: "2026-09-25T00:00:00Z",
        kits: [
          {
            id: "a",
            status: "failed",
            error: { code: "LLM_NOT_CONFIGURED" },
          },
        ],
      },
      1,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("LLM_NOT_CONFIGURED");
  });

  it("accepts all-ok kits matching case count", () => {
    const verdict = appendixBCloneVerdict(
      {
        version: 1,
        kits: [
          { id: "1", status: "ok" },
          { id: "2", status: "ok" },
        ],
      },
      2,
    );
    expect(verdict.ok).toBe(true);
  });
});
