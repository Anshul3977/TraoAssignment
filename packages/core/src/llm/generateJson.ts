import { z } from "zod";
import type { LlmClient } from "./client.js";
import type { EnvLike } from "./config.js";
import { LlmError } from "./errors.js";
import {
  llmCacheKey,
  readLlmCache,
  resolveLlmCacheDir,
  writeLlmCache,
} from "./cache.js";

export type GenerateJsonArgs<S extends z.ZodType> = {
  system: string;
  /** User-message fragments (typically wrapUntrusted outputs + instructions). */
  parts: readonly string[];
  schema: S;
  /** Step label for errors and repair prompts. */
  label: string;
};

export type GenerateJsonOptions = {
  signal?: AbortSignal;
  /** Override env for cache resolution (tests). */
  env?: EnvLike;
  /** Override cache dir; `false` disables. */
  cacheDir?: string | false;
};

function composeUser(parts: readonly string[]): string {
  return parts.filter((p) => p.length > 0).join("\n\n");
}

/** Strip optional markdown fences then JSON.parse. */
export function parseJsonText(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(body);
  if (fenced?.[1] !== undefined) {
    body = fenced[1].trim();
  }
  return JSON.parse(body) as unknown;
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `${path}: ${i.message}`;
    })
    .join("\n");
}

function tryValidate<S extends z.ZodType>(
  text: string,
  schema: S,
):
  | { ok: true; data: z.infer<S> }
  | { ok: false; parseError?: string; zodIssues?: z.ZodIssue[]; raw: unknown } {
  let raw: unknown;
  try {
    raw = parseJsonText(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, parseError: message, raw: text };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, zodIssues: parsed.error.issues, raw };
}

function repairUserMessage(
  label: string,
  previousText: string,
  failure: { parseError?: string; zodIssues?: z.ZodIssue[] },
): string {
  const lines = [
    `The previous JSON response for step "${label}" was invalid.`,
    "Return corrected JSON only (no markdown fences, no commentary).",
  ];
  if (failure.parseError) {
    lines.push(`JSON parse error: ${failure.parseError}`);
  }
  if (failure.zodIssues?.length) {
    lines.push("Schema validation errors:");
    lines.push(formatZodIssues(failure.zodIssues));
  }
  lines.push("Previous response:");
  lines.push(previousText);
  return lines.join("\n");
}

/**
 * Call the LLM for JSON, parse + zod-validate; on failure one repair call with
 * the errors, then typed `LlmError`. Optional disk cache when LLM_CACHE_DIR set (dev).
 */
export async function generateJson<S extends z.ZodType>(
  client: LlmClient,
  args: GenerateJsonArgs<S>,
  opts?: GenerateJsonOptions,
): Promise<z.infer<S>> {
  const { system, parts, schema, label } = args;
  const user = composeUser(parts);
  const promptForCache = `${system}\n\n${user}`;
  const cacheDir = resolveLlmCacheDir(opts?.env ?? process.env, opts?.cacheDir);
  const cacheProvider = client.primary.id;
  const cacheModel = client.primary.model;
  const cacheKey = cacheDir
    ? llmCacheKey(cacheProvider, cacheModel, promptForCache)
    : undefined;

  if (cacheDir && cacheKey) {
    const hit = await readLlmCache(cacheDir, cacheKey);
    if (hit) {
      const validated = tryValidate(hit.text, schema);
      if (validated.ok) return validated.data;
    }
  }

  let firstText: string;
  try {
    const result = await client.complete(
      { system, user, json: true },
      { signal: opts?.signal },
    );
    firstText = result.text;
  } catch (err) {
    throw new LlmError(`LLM call failed for ${label}`, { label, cause: err });
  }

  const first = tryValidate(firstText, schema);
  if (first.ok) {
    if (cacheDir && cacheKey) {
      await writeLlmCache(cacheDir, cacheKey, firstText);
    }
    return first.data;
  }

  let repairText: string;
  try {
    const repair = await client.complete(
      {
        system: `${system}\n\nYou must return valid JSON matching the schema. Fix the previous response.`,
        user: repairUserMessage(label, firstText, first),
        json: true,
      },
      { signal: opts?.signal },
    );
    repairText = repair.text;
  } catch (err) {
    throw new LlmError(`LLM repair call failed for ${label}`, {
      label,
      cause: err,
      rawText: firstText,
      zodIssues: first.zodIssues,
      parseError: first.parseError,
    });
  }

  const second = tryValidate(repairText, schema);
  if (second.ok) {
    if (cacheDir && cacheKey) {
      await writeLlmCache(cacheDir, cacheKey, repairText);
    }
    return second.data;
  }

  throw new LlmError(`Invalid JSON after repair for ${label}`, {
    label,
    rawText: repairText,
    zodIssues: second.zodIssues,
    parseError: second.parseError,
    cause: {
      first: { zodIssues: first.zodIssues, parseError: first.parseError, rawText: firstText },
      second: { zodIssues: second.zodIssues, parseError: second.parseError },
    },
  });
}
