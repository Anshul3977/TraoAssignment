/**
 * T30: clone this repo to a temp dir, install, typecheck, test, serve fixtures,
 * run SPEC §9 evaluate, validate Appendix B. Never prints secret values.
 *
 *   npm run clean-clone-check
 *   bash scripts/clean-clone-check.sh
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export const FIXTURE_ORIGIN = "http://127.0.0.1:8099";
export const EVALUATE_INPUT = "fixtures/cases.json";
export const EVALUATE_OUTPUT = "out/kits.json";

/** Exact SPEC §9 flags (npm may strip these on some Windows versions; retry is positional). */
export const EVALUATE_FLAG_ARGS = [
  "--",
  "--input",
  EVALUATE_INPUT,
  "--output",
  EVALUATE_OUTPUT,
] as const;

export const EVALUATE_POSITIONAL_ARGS = [
  "--",
  EVALUATE_INPUT,
  EVALUATE_OUTPUT,
] as const;

export const CHECK_OUTPUT_ARGS = ["--", "--input", EVALUATE_OUTPUT] as const;

export const CLEAN_CLONE_STEPS = [
  "git clone",
  "copy .env if present (never log values)",
  "npm install",
  "npm run typecheck",
  "npm test",
  "npm run fixtures",
  "npm run evaluate -- --input fixtures/cases.json --output out/kits.json",
  "npm run check-output -- --input out/kits.json",
] as const;

export type CloneKitEntry = { id?: string; status?: string; error?: { code?: string } };

export function envCopyLog(copied: boolean): string {
  return copied
    ? "copied .env into clone (contents not printed)"
    : "no source .env; evaluate will use process env / clone .env.example";
}

export function copyDotenvIfPresent(sourceRoot: string, cloneRoot: string): boolean {
  const from = join(sourceRoot, ".env");
  const to = join(cloneRoot, ".env");
  if (!existsSync(from)) return false;
  copyFileSync(from, to);
  return true;
}

export function appendixBCloneVerdict(
  raw: unknown,
  expectedCaseCount: number,
): { ok: boolean; reason: string } {
  if (!raw || typeof raw !== "object" || !("kits" in raw)) {
    return { ok: false, reason: "output is not Appendix B (missing kits)" };
  }
  const kits = (raw as { kits: CloneKitEntry[] }).kits;
  if (!Array.isArray(kits) || kits.length !== expectedCaseCount) {
    return {
      ok: false,
      reason: `expected ${expectedCaseCount} kit entries, got ${Array.isArray(kits) ? kits.length : "none"}`,
    };
  }
  const missingKey = kits.filter(
    (k) => k.status === "failed" && k.error?.code === "LLM_NOT_CONFIGURED",
  );
  if (missingKey.length > 0) {
    return {
      ok: false,
      reason: `${missingKey.length} case(s) failed with LLM_NOT_CONFIGURED — copy .env with GEMINI_API_KEY or GROQ_API_KEY`,
    };
  }
  const failed = kits.filter((k) => k.status !== "ok");
  if (failed.length > 0) {
    const ids = failed.map((k) => k.id ?? "?").join(", ");
    return { ok: false, reason: `kit status not ok: ${ids}` };
  }
  return { ok: true, reason: `all ${kits.length} kits status=ok` };
}

function gitRoot(cwd: string): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || "git rev-parse --show-toplevel failed");
  }
  return r.stdout.trim();
}

function runNpm(cwd: string, args: string[], timeoutMs?: number): void {
  const result = spawnSync("npm", args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    timeout: timeoutMs,
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} exited ${result.status ?? "null"}`);
  }
}

function startFixtures(cwd: string): ChildProcess {
  return spawn("npm", ["run", "fixtures"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
}

function stopChild(child: ChildProcess | undefined): void {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

async function fixturesAlreadyUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`fixtures not reachable at ${url} (${last})`);
}

function countCases(cloneRoot: string): number {
  const raw: unknown = JSON.parse(
    readFileSync(join(cloneRoot, EVALUATE_INPUT), "utf8"),
  );
  if (!Array.isArray(raw)) throw new Error("fixtures/cases.json is not an array");
  return raw.length;
}

export async function runCleanCloneCheck(invokeCwd = process.cwd()): Promise<void> {
  const sourceRoot = gitRoot(invokeCwd);
  const tmp = mkdtempSync(join(tmpdir(), "prep-kit-clean-clone-"));
  const cloneRoot = join(tmp, "repo");
  let fixtures: ChildProcess | undefined;
  console.log(`clean-clone: source=${sourceRoot}`);
  console.log(`clean-clone: dest=${cloneRoot}`);
  console.log(`clean-clone steps: ${CLEAN_CLONE_STEPS.join(" → ")}`);

  try {
    const clone = spawnSync("git", ["clone", "--local", sourceRoot, cloneRoot], {
      stdio: "inherit",
      shell: false,
    });
    if (clone.status !== 0) {
      throw new Error("git clone failed");
    }

    const copied = copyDotenvIfPresent(sourceRoot, cloneRoot);
    console.log(`clean-clone: ${envCopyLog(copied)}`);

    runNpm(cloneRoot, ["install"], 10 * 60_000);
    runNpm(cloneRoot, ["run", "typecheck"], 10 * 60_000);
    runNpm(cloneRoot, ["test"], 10 * 60_000);

    const fixtureUrl = `${FIXTURE_ORIGIN}/acme/`;
    if (await fixturesAlreadyUp(fixtureUrl)) {
      console.log("clean-clone: fixtures already listening; reusing :8099");
    } else {
      fixtures = startFixtures(cloneRoot);
      await waitForHttp(fixtureUrl, 30_000);
    }

    try {
      runNpm(cloneRoot, ["run", "evaluate", ...EVALUATE_FLAG_ARGS], 20 * 60_000);
    } catch (flagErr) {
      console.log(
        "clean-clone: flagged evaluate failed; retrying positional SPEC §9 fallback",
      );
      runNpm(
        cloneRoot,
        ["run", "evaluate", ...EVALUATE_POSITIONAL_ARGS],
        20 * 60_000,
      );
      void flagErr;
    }

    runNpm(cloneRoot, ["run", "check-output", ...CHECK_OUTPUT_ARGS], 60_000);

    const outPath = join(cloneRoot, EVALUATE_OUTPUT);
    if (!existsSync(outPath)) {
      throw new Error(`missing ${EVALUATE_OUTPUT} after evaluate`);
    }
    const verdict = appendixBCloneVerdict(
      JSON.parse(readFileSync(outPath, "utf8")) as unknown,
      countCases(cloneRoot),
    );
    console.log(`clean-clone: ${verdict.reason}`);
    if (!verdict.ok) throw new Error(verdict.reason);
    console.log("clean-clone: PASS");
  } finally {
    stopChild(fixtures);
    await new Promise((r) => setTimeout(r, 500));
    rmSync(tmp, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked.replace(/\\/g, "/").endsWith("clean-clone-check.ts")) {
  runCleanCloneCheck().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
