import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Batch CLI entry (`npm run evaluate`).
 * Loads `.env` when present so credentials need no extra setup step (SPEC §9).
 * Full argument parsing and pipeline wiring arrive in T16.
 */
function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

function main(): void {
  loadEnv();
  console.log(
    "evaluate CLI scaffold — pass --input/--output once T16 lands. LLM_PROVIDER=",
    process.env.LLM_PROVIDER ?? "(unset)",
  );
}

main();
