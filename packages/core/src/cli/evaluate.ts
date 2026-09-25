import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { formatBatchSummary, runBatch, type BatchCase } from "./runBatch.js";

/**
 * Batch CLI entry (`npm run evaluate -- --input <cases.json> --output <kits.json>`).
 * Loads `.env` when present so credentials need no extra setup step (SPEC §9).
 * Shares `runPipeline` with the API (project.mdc §9 / T16).
 */

function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int(),
});

const CasesSchema = z.array(CaseSchema);

function usage(): string {
  return [
    "Usage: npm run evaluate -- --input <cases.json> --output <kits.json>",
    "       npm run evaluate -- <cases.json> <kits.json>",
    "",
    "  --input, -i   Path to Appendix B input array (id, jd, company_url, days)",
    "  --output, -o  Path to write Appendix B kits JSON (rewritten after each case)",
    "",
    "  Note: some npm versions on Windows strip unknown --flags; the two-path",
    "  positional form is accepted as a fallback for the same SPEC §9 entry point.",
  ].join("\n");
}

function parseCliArgs(argv: string[]): { input: string; output: string } {
  let values: { input?: string; output?: string; help?: boolean };
  let positionals: string[] = [];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        input: { type: "string", short: "i" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      // npm on Windows often strips `--input`/`--output` as unknown npm configs
      // and forwards the remaining paths as positionals — accept both forms.
      allowPositionals: true,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    console.error(usage());
    process.exit(2);
  }

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const input = values.input ?? positionals[0];
  const output = values.output ?? positionals[1];

  if (!input || !output) {
    console.error("Missing required --input and/or --output.\n");
    console.error(usage());
    process.exit(2);
  }

  if (positionals.length > 2) {
    console.error(`Unexpected extra arguments: ${positionals.slice(2).join(" ")}`);
    console.error(usage());
    process.exit(2);
  }

  return { input, output };
}

function loadCases(inputPath: string): BatchCase[] {
  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    console.error(`Input file not found: ${abs}`);
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse input JSON: ${msg}`);
    process.exit(2);
  }
  const parsed = CasesSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Input does not match [{id, jd, company_url, days}, ...]:");
    console.error(parsed.error.message);
    process.exit(2);
  }
  return parsed.data;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  loadEnv();
  const { input, output } = parseCliArgs(argv);
  const cases = loadCases(input);

  console.log(
    `evaluate: ${cases.length} case(s) from ${resolve(input)} -> ${resolve(output)}`,
  );
  console.log(
    `LLM_PROVIDER=${process.env.LLM_PROVIDER ?? "(unset)"} concurrency=2 caseTimeout=4m allowPrivateHosts=true`,
  );

  const { output: batch, elapsedMs } = await runBatch({
    cases,
    outputPath: output,
    concurrency: 2,
    allowPrivateHosts: true,
  });

  console.log("");
  console.log(formatBatchSummary(batch, elapsedMs));
  // Exit 0 when the run completed — individual case failures are recorded in Appendix B.
  process.exitCode = 0;
}

const isDirect =
  typeof process.argv[1] === "string" &&
  /evaluate\.(ts|js|mjs|cjs)$/.test(process.argv[1].replace(/\\/g, "/"));

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
