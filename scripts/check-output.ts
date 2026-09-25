/**
 * Validate a batch kits JSON file against Appendix B (`BatchOutputSchema`).
 *
 * Usage:
 *   npx tsx scripts/check-output.ts --input out/kits.json
 *   npx tsx scripts/check-output.ts out/kits.json
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BatchOutputSchema } from "../packages/core/src/schema/batch.js";

function usage(): string {
  return [
    "Usage: npx tsx scripts/check-output.ts --input <kits.json>",
    "       npx tsx scripts/check-output.ts <kits.json>",
    "",
    "Validates Appendix B batch output (version, generated_at, kits[]).",
  ].join("\n");
}

function resolveInputPath(argv: string[]): string {
  let values: { input?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        input: { type: "string", short: "i" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
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

  const path = values.input ?? positionals[0];
  if (!path) {
    console.error("Missing input path.\n");
    console.error(usage());
    process.exit(2);
  }
  return resolve(path);
}

function main(): void {
  const inputPath = resolveInputPath(process.argv.slice(2));
  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(2);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Invalid JSON: ${msg}`);
    process.exit(1);
  }

  const parsed = BatchOutputSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Appendix B validation failed:");
    for (const issue of parsed.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      console.error(`  ${path}: ${issue.message}`);
    }
    process.exit(1);
  }

  const { kits } = parsed.data;
  const ok = kits.filter((k) => k.status === "ok").length;
  const failed = kits.filter((k) => k.status === "failed").length;
  console.log(
    `OK: ${inputPath} — version=${parsed.data.version} kits=${kits.length} (ok=${ok} failed=${failed})`,
  );
}

main();
