import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EnvLike } from "./config.js";

export type CacheLookup = {
  key: string;
  text: string;
};

/** sha256 hex of provider + model + prompt (dev disk cache key). */
export function llmCacheKey(provider: string, model: string, prompt: string): string {
  return createHash("sha256")
    .update(provider, "utf8")
    .update("\0", "utf8")
    .update(model, "utf8")
    .update("\0", "utf8")
    .update(prompt, "utf8")
    .digest("hex");
}

/**
 * Resolve cache directory: only when `LLM_CACHE_DIR` is set and not production.
 * Pass `cacheDir` to override (tests); `false` disables.
 */
export function resolveLlmCacheDir(
  env: EnvLike = process.env,
  override?: string | false,
): string | undefined {
  if (override === false) return undefined;
  if (typeof override === "string") {
    const trimmed = override.trim();
    return trimmed || undefined;
  }
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return undefined;
  const dir = env.LLM_CACHE_DIR?.trim();
  return dir || undefined;
}

function cacheFilePath(dir: string, key: string): string {
  return path.join(dir, `${key}.json`);
}

export async function readLlmCache(
  dir: string,
  key: string,
): Promise<CacheLookup | undefined> {
  try {
    const raw = await readFile(cacheFilePath(dir, key), "utf8");
    const parsed = JSON.parse(raw) as { key?: string; text?: string };
    if (typeof parsed.text !== "string") return undefined;
    return { key: typeof parsed.key === "string" ? parsed.key : key, text: parsed.text };
  } catch {
    return undefined;
  }
}

export async function writeLlmCache(
  dir: string,
  key: string,
  text: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify({ key, text, cached_at: new Date().toISOString() });
  await writeFile(cacheFilePath(dir, key), payload, "utf8");
}
