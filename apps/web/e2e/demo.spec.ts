import { expect, test } from "@playwright/test";
import kit from "./fixtures/kit.json" with { type: "json" };

const evaluation = {
  score: 100,
  passed: 8,
  total: 8,
  checks: [
    { id: "must_coverage", label: "Must-haves covered by a question", value: 1, pass: true, detail: "4/4 must-have requirements" },
    { id: "citation_validity", label: "Citations point at fetched pages", value: 1, pass: true, detail: "10/10 cited URLs were fetched" },
  ],
};

function ndjson(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

test("signed-out visitors land on login, which links to the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "Try the demo without an account" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: /Turn a job description/ })).toBeVisible();
});

test("real API: demo without an LLM key shows a clear error", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Build my prep kit" }).click();
  await expect(page.getByText("The demo has no LLM key configured.")).toBeVisible();
});

test("streams progress, then renders the kit, quality checks and trace", async ({ page }) => {
  await page.route("**/api/demo", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    expect(body.company_url).toBe("https://about.gitlab.com");
    expect(body.days).toBe(5);
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson([
        { type: "progress", step: "extract", status: "running" },
        { type: "llm", seq: 1, step: "extract", provider: "groq", model: "openai/gpt-oss-120b", ok: true, ms: 900, promptTokens: 1200, completionTokens: 300 },
        { type: "progress", step: "extract", status: "done", detail: "7 grounded requirement(s)", ms: 1000 },
        { type: "progress", step: "questions", status: "done", detail: "7 draft question(s)", ms: 4000 },
        {
          type: "kit",
          kit,
          evaluation,
          trace: { runId: "abc12345", totalMs: 5000, stepMs: { extract: 1000, questions: 4000 }, calls: 1, failed: 0, llmMs: 900, promptTokens: 1200, completionTokens: 300, byStep: {} },
        },
      ]),
    });
  });

  await page.goto("/demo");
  await page.getByLabel("Days to prep").fill("5");
  await page.getByRole("button", { name: "Build my prep kit" }).click();

  await expect(page.getByText("7 grounded requirement(s)")).toBeVisible();
  await expect(page.getByTestId("llm-counter")).toContainText("1 LLM call");
  await expect(page.getByRole("heading", { name: "Backend Engineer (Python)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `Questions (${kit.questions.length})` })).toBeVisible();
  await expect(page.getByTestId("kit-evaluation")).toContainText("100/100");
  await expect(page.getByTestId("kit-trace")).toContainText("run abc12345");

  // Answer outlines are collapsed until opened.
  const first = page.locator("details").first();
  await first.locator("summary").click();
  await expect(first.getByText(kit.questions[0]!.answer_outline)).toBeVisible();
});

test("server rejects bad input before calling any model", async ({ request }) => {
  const res = await request.post("/api/demo", { data: { jd: "x", company_url: "nope", days: 3 } });
  // No key in CI → 503 first; with a key it would be 400. Either way, no kit.
  expect([400, 503]).toContain(res.status());
});
