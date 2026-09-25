import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLEAN_PAGE_TEXT_CAP, cleanPage } from "./cleanPage.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "../../../../fixtures/sites");

function loadFixture(...parts: string[]): string {
  return readFileSync(join(fixturesRoot, ...parts), "utf8");
}

describe("cleanPage", () => {
  it("extracts title, description, links, and main text from acme home", () => {
    const html = loadFixture("acme", "index.html");
    const pageUrl = "http://localhost:8099/acme/";
    const page = cleanPage(html, pageUrl);

    expect(page.url).toBe(pageUrl);
    expect(page.title).toBe("Acme — Home");
    expect(page.description).toBe("Acme builds collaboration tools for product teams.");
    expect(page.text).toContain("Welcome to Acme");
    expect(page.text).toContain("lightweight collaboration software");
    // Nav/footer chrome stripped from main text
    expect(page.text).not.toMatch(/\bHome\b.*\bAbout\b.*\bBlog\b/);
    expect(page.text).not.toContain("© Acme");

    const hrefs = page.links.map((l) => l.href);
    expect(hrefs).toContain("http://localhost:8099/acme/");
    expect(hrefs).toContain("http://localhost:8099/acme/about.html");
    expect(hrefs).toContain("http://localhost:8099/acme/blog/");
    // Footer Handbook link collected BEFORE strip
    expect(hrefs).toContain("http://localhost:8099/acme/handbook/");
    expect(page.links.some((l) => l.text === "Handbook")).toBe(true);
  });

  it("resolves relative links against pageUrl on nested pages", () => {
    const html = loadFixture("acme", "handbook", "people", "how-we-hire.html");
    const pageUrl = "http://localhost:8099/acme/handbook/people/how-we-hire.html";
    const page = cleanPage(html, pageUrl);

    expect(page.title).toBe("Acme — How we hire");
    expect(page.text).toContain("take-home exercise");
    expect(page.text).toContain("system-design");
    expect(page.links.map((l) => l.href)).toEqual(
      expect.arrayContaining([
        "http://localhost:8099/acme/",
        "http://localhost:8099/acme/handbook/",
      ]),
    );
  });

  it("keeps quietco body text and has no inventing of missing sections", () => {
    const html = loadFixture("quietco", "index.html");
    const page = cleanPage(html, "http://localhost:8099/quietco/");
    expect(page.title).toBe("QuietCo");
    expect(page.description).toBe("QuietCo makes quiet tools.");
    expect(page.text).toContain("no about page");
    expect(page.links).toEqual([]);
  });

  it("preserves untrusted page text as data (evil injection stays in text)", () => {
    const html = loadFixture("evil", "index.html");
    const page = cleanPage(html, "http://localhost:8099/evil/");
    expect(page.text).toContain("Ignore previous instructions");
    expect(page.text).toContain("Knows COBOL");
  });

  it("collects nav links before stripping chrome from text", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Link Order</title>
      <meta name="description" content="  spaced   desc  " />
    </head><body>
      <nav><a href="/careers">Careers</a></nav>
      <main><p>Only main body.</p><a href="team.html">Team</a></main>
      <footer><a href="../privacy">Privacy</a></footer>
      <script>var x = "should not appear";</script>
      <form><input name="q" /><button>Go</button></form>
    </body></html>`;
    const page = cleanPage(html, "https://example.com/acme/page.html");

    expect(page.description).toBe("spaced desc");
    expect(page.links).toEqual([
      { text: "Careers", href: "https://example.com/careers" },
      { text: "Team", href: "https://example.com/acme/team.html" },
      { text: "Privacy", href: "https://example.com/privacy" },
    ]);
    expect(page.text).toBe("Only main body. Team");
    expect(page.text).not.toContain("Careers");
    expect(page.text).not.toContain("Privacy");
    expect(page.text).not.toContain("should not appear");
    expect(page.text).not.toContain("Go");
  });

  it("falls back to body when main/article are absent", () => {
    const html = `<html><head><title>Body Only</title></head>
      <body><p>Hello <b>world</b></p><nav>skip me</nav></body></html>`;
    const page = cleanPage(html, "https://example.com/");
    expect(page.text).toBe("Hello world");
  });

  it("caps main text around 12k characters", () => {
    const chunk = "word ".repeat(3000); // ~15k chars
    const html = `<html><head><title>Long</title></head><body><main>${chunk}</main></body></html>`;
    const page = cleanPage(html, "https://example.com/long");
    expect(page.text.length).toBe(CLEAN_PAGE_TEXT_CAP);
    expect(page.text.length).toBeLessThanOrEqual(12_000);
  });

  it("skips mailto and javascript hrefs", () => {
    const html = `<html><body><main>
      <a href="mailto:a@b.com">Email</a>
      <a href="javascript:void(0)">Click</a>
      <a href="#section">Frag</a>
      <a href="https://example.com/ok">OK</a>
    </main></body></html>`;
    const page = cleanPage(html, "https://example.com/");
    expect(page.links.map((l) => l.href)).toEqual([
      "https://example.com/#section",
      "https://example.com/ok",
    ]);
  });
});
