import { LlmNotConfiguredError } from "./errors.js";
import { createGeminiProvider } from "./gemini.js";
import { createGroqProvider } from "./groq.js";
import type { LlmProvider, ProviderId } from "./types.js";

export type EnvLike = Record<string, string | undefined>;

export type ResolvedLlmEnv = {
  primaryId: ProviderId;
  gemini?: { apiKey: string; model: string };
  groq?: { apiKey: string; model: string };
};

function readProviderId(raw: string | undefined): ProviderId {
  const v = (raw ?? "gemini").trim().toLowerCase();
  if (v === "groq") return "groq";
  return "gemini";
}

/** Read LLM_* / GEMINI_* / GROQ_* from env (no secrets written anywhere). */
export function resolveLlmEnv(env: EnvLike = process.env): ResolvedLlmEnv {
  const primaryId = readProviderId(env.LLM_PROVIDER);
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const groqKey = env.GROQ_API_KEY?.trim();
  return {
    primaryId,
    gemini: geminiKey
      ? { apiKey: geminiKey, model: (env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest") }
      : undefined,
    groq: groqKey
      ? { apiKey: groqKey, model: (env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile") }
      : undefined,
  };
}

/** True when the configured primary provider has a non-empty API key. */
export function isLlmConfigured(env: EnvLike = process.env): boolean {
  const resolved = resolveLlmEnv(env);
  if (resolved.primaryId === "gemini") return Boolean(resolved.gemini);
  return Boolean(resolved.groq);
}

/** Human-readable missing-key message for the active primary provider. */
export function missingLlmKeyMessage(env: EnvLike = process.env): string {
  const primaryId = resolveLlmEnv(env).primaryId;
  if (primaryId === "groq") {
    return "GROQ_API_KEY is not set. Add it to .env (see .env.example) before running evaluate.";
  }
  return "GEMINI_API_KEY is not set. Add it to .env (see .env.example) before running evaluate.";
}

export type ProvidersFromEnv = {
  primary: LlmProvider;
  fallback?: LlmProvider;
  primaryId: ProviderId;
};

/**
 * Build primary (+ optional other-provider fallback) from env.
 * Throws `LlmNotConfiguredError` if the configured primary has no API key.
 */
export function createProvidersFromEnv(env: EnvLike = process.env): ProvidersFromEnv {
  const resolved = resolveLlmEnv(env);
  const gemini = resolved.gemini ? createGeminiProvider(resolved.gemini) : undefined;
  const groq = resolved.groq ? createGroqProvider(resolved.groq) : undefined;

  if (resolved.primaryId === "gemini") {
    if (!gemini) {
      throw new LlmNotConfiguredError(missingLlmKeyMessage(env));
    }
    return { primary: gemini, fallback: groq, primaryId: "gemini" };
  }

  if (!groq) {
    throw new LlmNotConfiguredError(missingLlmKeyMessage(env));
  }
  return { primary: groq, fallback: gemini, primaryId: "groq" };
}
