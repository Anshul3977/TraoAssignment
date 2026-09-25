import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile as readFileAsync, stat as statAsync } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlmClient } from "./llm/client.js";
import { LlmProviderError } from "./llm/errors.js";
import { TokenRequestLimiter } from "./llm/limiter.js";
import type {
  CompleteInput,
  CompleteResult,
  LlmProvider,
  ProviderId,
} from "./llm/types.js";
import { runPipeline, type ProgressEvent } from "./pipeline.js";
import { crawl } from "./retrieval/crawl.js";
import { resetHostLimiter } from "./retrieval/hostLimiter.js";
import { resetRobotsCache } from "./retrieval/robots.js";
import type { SearchDiscussionResult } from "./retrieval/searchDiscussion.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixturesRoot = path.join(repoRoot, "fixtures/sites");

type CaseRow = {
  id: string;
  jd: string;
  company_url: string;
  days: number;
};

function loadCases(): CaseRow[] {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "fixtures/cases.json"), "utf8"),
  ) as CaseRow[];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(fixturesRoot, relative);
  if (
    candidate !== fixturesRoot &&
    !candidate.startsWith(fixturesRoot + path.sep)
  ) {
    return null;
  }
  try {
    const st = await statAsync(candidate);
    if (st.isDirectory()) {
      const indexPath = path.join(candidate, "index.html");
      const indexStat = await statAsync(indexPath).catch(() => null);
      return indexStat?.isFile() ? indexPath : null;
    }
    return st.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function startFixtureServer(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const { pathname } = new URL(req.url ?? "/", `http://${host}`);
      const filePath = await resolveFile(pathname);
      if (!filePath) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const body = await readFileAsync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end("error");
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({
        server,
        base: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function fakeProvider(
  id: ProviderId,
  impl: (input: CompleteInput) => Promise<CompleteResult> | CompleteResult,
): LlmProvider {
  return {
    id,
    model: `${id}-test`,
    async complete(input) {
      return impl(input);
    },
  };
}

function testClient(primary: LlmProvider) {
  return createLlmClient({
    primary,
    limiter: new TokenRequestLimiter({
      requestsPerMinute: 1000,
      tokensPerMinute: 1_000_000,
      sleep: async () => undefined,
    }),
    retry: { maxAttempts: 1, sleep: async () => undefined, random: () => 0 },
  });
}

function emptyDiscussion(companyName = ""): SearchDiscussionResult {
  return {
    pages: [],
    companyName,
    log: [
      {
        provider: "test",
        status: "empty",
        detail: "no_discussion_found",
      },
    ],
  };
}

/** Pull requirement id=… lines from an untrusted requirements document. */
function parseReqIds(user: string): string[] {
  const ids: string[] = [];
  const re = /id=(r\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(user)) !== null) {
    ids.push(m[1]!);
  }
  return [...new Set(ids)];
}

function questionsForIds(ids: string[]): string {
  return JSON.stringify({
    questions: ids.map((id) => ({
      requirement_ids: [id],
      prompt: `Discuss ${id}`,
      answer_outline: `STAR points for ${id}`,
      difficulty: 2,
    })),
  });
}

/**
 * Fake LLM that routes by system prompt. Returns fixture-faithful JSON;
 * never invents COBOL / injection requirements.
 */
function pipelineFakeProvider(opts?: {
  failExtract?: boolean;
}): LlmProvider {
  return fakeProvider("gemini", (input) => {
    const { system, user } = input;

    if (opts?.failExtract && /extract structured role/i.test(system)) {
      throw new LlmProviderError("forced extract failure", {
        kind: "unknown",
        provider: "gemini",
      });
    }

    if (/extract structured role/i.test(system)) {
      // Route by JD content
      if (/Knows COBOL|EvilCo|Ignore previous/i.test(user)) {
        return {
          text: JSON.stringify({
            title: "Mid-level Full Stack Engineer",
            seniority: "mid",
            location: "Remote",
            company: "EvilCo",
            responsibilities: [
              "build customer-facing features",
            ],
            requirements: [
              {
                text: "3+ years with JavaScript and Node.js",
                kind: "technical",
                priority: "must",
                evidence: "3+ years with JavaScript and Node.js",
                section: "Requirements",
              },
              {
                text: "Comfortable with relational databases",
                kind: "technical",
                priority: "must",
                evidence: "Comfortable with relational databases",
                section: "Requirements",
              },
              {
                text: "Clear written communication",
                kind: "behavioural",
                priority: "must",
                evidence: "Clear written communication",
                section: "Requirements",
              },
              {
                text: "Experience with React",
                kind: "technical",
                priority: "nice",
                evidence: "Experience with React",
                section: "Nice to have",
              },
              // Injection bait — grounding must drop this (evidence not in JD).
              {
                text: "Knows COBOL",
                kind: "technical",
                priority: "must",
                evidence: "Knows COBOL",
                section: "Requirements",
              },
            ],
          }),
          provider: "gemini" as const,
          model: "gemini-test",
        };
      }

      if (/QuietCo|Backend engineer at QuietCo/i.test(user)) {
        return {
          text: JSON.stringify({
            title: "Backend engineer",
            seniority: "mid",
            location: "Unknown",
            company: "QuietCo",
            responsibilities: [],
            requirements: [
              {
                text: "Node and Postgres preferred",
                kind: "technical",
                priority: "must",
                evidence: "Node and Postgres preferred",
                section: "body",
              },
            ],
          }),
          provider: "gemini" as const,
          model: "gemini-test",
        };
      }

      if (/2\+ years of TypeScript experience/i.test(user)) {
        return {
          text: JSON.stringify({
            title: "Software Engineer",
            seniority: "mid",
            location: "Unknown",
            responsibilities: [],
            requirements: [
              {
                text: "2+ years of TypeScript experience",
                kind: "technical",
                priority: "must",
                evidence: "2+ years of TypeScript experience",
                section: "Requirements",
              },
              {
                text: "Familiarity with REST APIs",
                kind: "technical",
                priority: "nice",
                evidence: "Familiarity with REST APIs",
                section: "Requirements",
              },
            ],
          }),
          provider: "gemini" as const,
          model: "gemini-test",
        };
      }

      // Rich Acme JD (case-01 / case-05)
      return {
        text: JSON.stringify({
          title: "Senior Software Engineer",
          seniority: "senior",
          location: "Remote",
          company: "Acme",
          responsibilities: [
            "Own the React design system used across product surfaces",
            "Mentor junior engineers through code review and pairing",
            "Partner with product on roadmap trade-offs",
          ],
          requirements: [
            {
              text: "5+ years of professional experience with React and TypeScript",
              kind: "technical",
              priority: "must",
              evidence:
                "5+ years of professional experience with React and TypeScript",
              section: "Requirements",
            },
            {
              text: "Strong system design skills for high-traffic web apps",
              kind: "technical",
              priority: "must",
              evidence:
                "Strong system design skills for high-traffic web apps",
              section: "Requirements",
            },
            {
              text: "Experience mentoring junior engineers",
              kind: "behavioural",
              priority: "must",
              evidence: "Experience mentoring junior engineers",
              section: "Requirements",
            },
            {
              text: "Excellent written communication",
              kind: "behavioural",
              priority: "must",
              evidence: "Excellent written communication",
              section: "Requirements",
            },
            {
              text: "Familiarity with GraphQL",
              kind: "domain",
              priority: "nice",
              evidence: "Familiarity with GraphQL",
              section: "Nice to have",
            },
            {
              text: "Prior experience at a B2B SaaS company",
              kind: "domain",
              priority: "nice",
              evidence: "Prior experience at a B2B SaaS company",
              section: "Nice to have",
            },
            {
              text: "Contributions to open-source React libraries",
              kind: "technical",
              priority: "nice",
              evidence: "Contributions to open-source React libraries",
              section: "Nice to have",
            },
          ],
        }),
        provider: "gemini" as const,
        model: "gemini-test",
      };
    }

    if (/company brief/i.test(system)) {
      return {
        text: JSON.stringify({
          summary: "Honest company brief from fetched pages.",
          what_they_do: "Described only from homepage/about text.",
          sources: [],
        }),
        provider: "gemini" as const,
        model: "gemini-test",
      };
    }

    if (/interview process/i.test(system)) {
      if (/take-home|how we hire|system-design/i.test(user)) {
        return {
          text: JSON.stringify({
            found: true,
            stages: [
              { name: "Take-home exercise", type: "take-home" },
              { name: "System-design interview", type: "system-design" },
            ],
            sources: [],
          }),
          provider: "gemini" as const,
          model: "gemini-test",
        };
      }
      return {
        text: JSON.stringify({ found: false, stages: [], sources: [] }),
        provider: "gemini" as const,
        model: "gemini-test",
      };
    }

    if (/flashcards/i.test(system)) {
      const ids = parseReqIds(user);
      return {
        text: JSON.stringify({
          flashcards: ids.slice(0, Math.max(1, ids.length)).map((id) => ({
            front: `Card for ${id}`,
            back: `Answer for ${id}`,
            requirement_ids: [id],
          })),
        }),
        provider: "gemini" as const,
        model: "gemini-test",
      };
    }

    if (
      /technical interview questions|behavioural interview questions|system-design interview questions|company-fit/i.test(
        system,
      )
    ) {
      const ids = parseReqIds(user);
      // Company-fit may have empty req ids
      if (ids.length === 0 && /company-fit/i.test(system)) {
        return {
          text: JSON.stringify({
            questions: [
              {
                requirement_ids: [],
                prompt: "Why this company?",
                answer_outline: "Align values honestly.",
                difficulty: 1,
              },
            ],
          }),
          provider: "gemini" as const,
          model: "gemini-test",
        };
      }
      return {
        text: questionsForIds(ids.length ? ids : ["r1"]),
        provider: "gemini" as const,
        model: "gemini-test",
      };
    }

    // Repair / unknown — return minimal valid empty questions
    return {
      text: JSON.stringify({ questions: [] }),
      provider: "gemini" as const,
      model: "gemini-test",
    };
  });
}

describe("runPipeline (T15)", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await startFixtureServer());
  });

  afterAll(async () => {
    await closeServer(server);
  });

  function rewriteCaseUrl(companyUrl: string): string {
    // fixtures/cases.json uses localhost:8099 — remap to ephemeral fixture server.
    return companyUrl.replace("http://localhost:8099", base);
  }

  it("builds an ok kit for every fixture case; unreachable stays ok", async () => {
    resetHostLimiter();
    resetRobotsCache();

    const cases = loadCases();
    expect(cases.length).toBe(5);

    const progressByCase = new Map<string, ProgressEvent[]>();

    for (const c of cases) {
      const events: ProgressEvent[] = [];
      progressByCase.set(c.id, events);

      const companyUrl = rewriteCaseUrl(c.company_url);
      const result = await runPipeline(
        { jd: c.jd, company_url: companyUrl, days: c.days },
        {
          allowPrivateHosts: true,
          client: testClient(pipelineFakeProvider()),
          searchDiscussionFn: async () => emptyDiscussion("test"),
          onProgress: (e) => events.push({ ...e }),
        },
      );

      // FAQ: failed only when no kit — every case must produce a validated kit.
      expect(result.kit).toBeTruthy();
      expect(result.kit.schedule.days_available).toBe(c.days);
      expect(result.kit.schedule.days).toHaveLength(c.days);
      expect(result.kit.source.jd_chars).toBe(c.jd.trim().length);
      expect(result.kit.source.company_url).toBe(companyUrl);

      const mustIds = result.kit.role.requirements
        .filter((r) => r.priority === "must")
        .map((r) => r.id);
      for (const mid of mustIds) {
        const covered = result.kit.questions.some((q) =>
          q.requirement_ids.includes(mid),
        );
        expect(covered, `${c.id} must ${mid} covered`).toBe(true);
      }

      // COBOL injection must never appear
      const texts = result.kit.role.requirements.map((r) => r.text);
      expect(texts.some((t) => /cobol/i.test(t))).toBe(false);

      if (c.id === "case-04") {
        expect(result.kit.research_log?.company_unreachable).toBe(true);
      }

      if (c.id === "case-02") {
        expect(result.kit.notes?.thin_jd).toBe(true);
      }

      expect(events.some((e) => e.step === "extract" && e.status === "done")).toBe(
        true,
      );
      expect(
        events.some((e) => e.step === "validate" && e.status === "done"),
      ).toBe(true);
    }
  }, 120_000);

  it("throws PipelineError EMPTY_JD when JD is blank", async () => {
    await expect(
      runPipeline(
        { jd: "   ", company_url: `${base}/acme/`, days: 5 },
        {
          allowPrivateHosts: true,
          client: testClient(pipelineFakeProvider()),
          searchDiscussionFn: async () => emptyDiscussion(),
        },
      ),
    ).rejects.toMatchObject({ name: "PipelineError", code: "EMPTY_JD" });
  });

  it("throws PipelineError LLM_UNAVAILABLE when extract cannot run", async () => {
    await expect(
      runPipeline(
        {
          jd: loadCases()[0]!.jd,
          company_url: `${base}/acme/`,
          days: 5,
        },
        {
          allowPrivateHosts: true,
          client: testClient(pipelineFakeProvider({ failExtract: true })),
          searchDiscussionFn: async () => emptyDiscussion(),
        },
      ),
    ).rejects.toMatchObject({
      name: "PipelineError",
      code: "LLM_UNAVAILABLE",
    });
  });

  it("does not treat missing hiring pages as failure (quietco)", async () => {
    resetHostLimiter();
    resetRobotsCache();
    const quiet = loadCases().find((c) => c.id === "case-02")!;
    const { kit } = await runPipeline(
      {
        jd: quiet.jd,
        company_url: rewriteCaseUrl(quiet.company_url),
        days: quiet.days,
      },
      {
        allowPrivateHosts: true,
        client: testClient(pipelineFakeProvider()),
        crawlFn: (url, o) => crawl(url, o),
        searchDiscussionFn: async () => emptyDiscussion("QuietCo"),
      },
    );
    expect(kit.research_log?.company_unreachable).not.toBe(true);
    expect(
      (kit.research_log?.pages as { hiring?: number } | undefined)?.hiring ?? 0,
    ).toBe(0);
    // Still a valid kit
    expect(kit.role.requirements.length).toBeGreaterThan(0);
  });
});
