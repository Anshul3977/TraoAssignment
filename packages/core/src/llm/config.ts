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
      ? { apiKey: geminiKey, model: (env.GEMINI_MODEL?.trim() || "gemini-2.0-flash") }
      : undefined,
    groq: groqKey
      ? { apiKey: groqKey, model: (env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile") }
      : undefined,
  };
}

export type ProvidersFromEnv = {
  primary: LlmProvider;
  fallback?: LlmProvider;
  primaryId: ProviderId;
};

/**
 * Build primary (+ optional other-provider fallback) from env.
 * Throws if the configured primary has no API key.
 */
export function createProvidersFromEnv(env: EnvLike = process.env): ProvidersFromEnv {
  const resolved = resolveLlmEnv(env);
  const gemini = resolved.gemini ? createGeminiProvider(resolved.gemini) : undefined;
  const groq = resolved.groq ? createGroqProvider(resolved.groq) : undefined;

  if (resolved.primaryId === "gemini") {
    if (!gemini) {
      throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
    }
    return { primary: gemini, fallback: groq, primaryId: "gemini" };
  }

  if (!groq) {
    throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq");
  }
  return { primary: groq, fallback: gemini, primaryId: "groq" };
}
