import { describe, expect, it } from "vitest";
import type { Kit } from "../schema/index.js";
import { evaluateKit } from "./evaluateKit.js";

const JD = "Backend engineer. Must have: Python, SQL, REST API design. Nice to have: Redis caching.";

function kit(overrides: Partial<Kit> = {}): Kit {
  const base: Kit = {
    source: {
      company: "Acme",
      company_url: "https://acme.test/",
      role: "Backend engineer",
      location: "",
      jd_chars: JD.length,
      researched_at: "2026-11-17T00:00:00Z",
      pages_used: ["https://acme.test/", "https://acme.test/careers"],
    },
    company_brief: { summary: "Acme builds payment APIs for small online shops in India.", what_they_do: "w", sources: ["https://acme.test/"] },
    role: {
      title: "Backend engineer",
      seniority: "",
      responsibilities: [],
      requirements: [
        { id: "r1", text: "Python", kind: "technical", priority: "must" },
        { id: "r2", text: "REST API design", kind: "technical", priority: "must" },
        { id: "r3", text: "Redis caching", kind: "technical", priority: "nice" },
      ],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "How do Python generators save memory?", answer_outline: "x".repeat(90), difficulty: 2 },
      { id: "q2", requirement_ids: ["r2", "r3"], category: "technical", prompt: "Design a cached REST endpoint for orders.", answer_outline: "y".repeat(90), difficulty: 2 },
    ],
    flashcards: [{ id: "f1", front: "a", back: "b", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Python", question_ids: ["q1"], minutes: 40 },
        { day: 2, focus: "APIs", question_ids: ["q2"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  } as Kit;
  return { ...base, ...overrides };
}

describe("evaluateKit", () => {
  it("scores a clean kit 100 with every check passing", () => {
    const e = evaluateKit(kit(), JD);
    expect(e.score).toBe(100);
    expect(e.passed).toBe(e.total);
  });

  it("flags invented requirements, uncovered musts, bad citations and dangling ids", () => {
    const k = kit();
    k.role.requirements.push({ id: "r4", text: "Kubernetes operators", kind: "technical", priority: "must" });
    k.company_brief.sources.push("https://elsewhere.test/");
    k.schedule.days[0]!.question_ids.push("q9");
    const e = evaluateKit(k, JD);
    const byId = Object.fromEntries(e.checks.map((c) => [c.id, c]));
    expect(byId.must_coverage!.pass).toBe(false);
    expect(byId.requirement_grounding!.detail).toBe("3/4 requirements share most words with the JD");
    expect(byId.citation_validity!.value).toBe(0.5);
    expect(byId.id_integrity!.pass).toBe(false);
    expect(e.score).toBeLessThan(100);
  });

  it("flags an empty company brief", () => {
    const k = kit();
    k.company_brief = { summary: "", what_they_do: "", sources: [] };
    const c = evaluateKit(k, JD).checks.find((x) => x.id === "brief_present")!;
    expect(c.pass).toBe(false);
    expect(c.value).toBe(0);
  });

  it("detects near-duplicate questions", () => {
    const k = kit();
    k.questions[1]!.prompt = "How do Python generators save memory?";
    expect(evaluateKit(k, JD).checks.find((c) => c.id === "question_diversity")!.pass).toBe(false);
  });
});
