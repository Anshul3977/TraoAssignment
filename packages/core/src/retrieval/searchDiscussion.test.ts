import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHostLimiter } from "./hostLimiter.js";
import { resetRobotsCache } from "./robots.js";
import {
  extractOgSiteName,
  inferCompanyName,
  searchDiscussion,
} from "./searchDiscussion.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("inferCompanyName", () => {
  it("prefers homepage title over og:site_name and domain", () => {
    expect(
      inferCompanyName({
        companyUrl: "https://www.example.com/",
        homepageTitle: "Acme Corp | Careers",
        ogSiteName: "Wrong Name",
      }),
    ).toBe("Acme Corp");
  });

  it("falls back to og:site_name then domain", () => {
    expect(
      inferCompanyName({
        companyUrl: "https://www.quietco.io/app",
        ogSiteName: "QuietCo",
      }),
    ).toBe("QuietCo");

    expect(
      inferCompanyName({
        companyUrl: "https://www.quietco.io/app",
        homepageHtml: `<html><head><meta property="og:site_name" content="From HTML" /></head></html>`,
      }),
    ).toBe("From HTML");

    expect(inferCompanyName({ companyUrl: "https://www.acme.dev/" })).toBe("acme");
  });

  it("extractOgSiteName reads the meta tag", () => {
    expect(
      extractOgSiteName(
        `<meta property="og:site_name" content="  PostHog  " />`,
      ),
    ).toBe("PostHog");
  });
});

describe("searchDiscussion", () => {
  beforeEach(() => {
    resetHostLimiter();
    resetRobotsCache();
    delete process.env.SEARCH_API_KEY;
  });

  afterEach(() => {
    delete process.env.SEARCH_API_KEY;
  });

  it("returns [] and a log entry when every provider finds nothing", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hn.algolia.com")) {
        return jsonResponse({ hits: [] });
      }
      if (url.includes("duckduckgo.com")) {
        return htmlResponse("<html><body>no results</body></html>");
      }
      return textResponse("unexpected", 404);
    };

    const result = await searchDiscussion("https://quietco.example/", {
      homepageTitle: "QuietCo",
      fetchImpl,
      skipRobots: true,
      allowPrivateHosts: true,
    });

    expect(result.pages).toEqual([]);
    expect(result.companyName).toBe("QuietCo");
    expect(result.log.some((e) => e.detail === "no_discussion_found")).toBe(true);
    expect(result.log.some((e) => e.provider === "brave" && e.status === "skipped")).toBe(
      true,
    );
    expect(result.log.some((e) => e.provider === "tavily" && e.status === "skipped")).toBe(
      true,
    );
  });

  it("uses HN hits that mention the company and fetches top pages via safeFetch", async () => {
    const pageHtml = `<!doctype html><html><head><title>Acme interview thread</title></head>
<body><main>People discussing the Acme interview process and take-home.</main></body></html>`;

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hn.algolia.com")) {
        return jsonResponse({
          hits: [
            {
              title: "Acme interview experience",
              url: "https://news.example/acme-interview",
              story_text: "Had an Acme onsite last week",
              objectID: "1",
            },
            {
              title: "Unrelated startup gossip",
              url: "https://news.example/other",
              story_text: "nope",
              objectID: "2",
            },
          ],
        });
      }
      if (url.includes("duckduckgo.com")) {
        return htmlResponse("<html><body></body></html>");
      }
      if (url.includes("news.example/acme-interview")) {
        return htmlResponse(pageHtml);
      }
      if (url.includes("robots.txt")) {
        return textResponse("User-agent: *\nAllow: /\n");
      }
      return textResponse("missing", 404);
    };

    const result = await searchDiscussion("https://acme.example/", {
      homepageTitle: "Acme",
      fetchImpl,
      skipRobots: true,
      allowPrivateHosts: true,
      lookup: async () => ["93.184.216.34"],
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.url).toContain("acme-interview");
    expect(result.pages[0]?.text.toLowerCase()).toContain("acme");
    expect(result.pages[0]?.provider).toBe("hn_algolia");
    expect(result.log.some((e) => e.provider === "hn_algolia" && e.status === "ok")).toBe(
      true,
    );
  });

  it("parses DuckDuckGo HTML results and caps at 3 fetched pages", async () => {
    const ddgHtml = `
      <html><body>
        <div class="result">
          <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://forum.example/p1")}">Acme interview process</a>
          <a class="result__snippet">Talking about Acme</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://forum.example/p2">Acme interview experience</a>
          <div class="result__snippet">More Acme chatter</div>
        </div>
        <div class="result">
          <a class="result__a" href="https://forum.example/p3">Acme hiring roundup</a>
          <div class="result__snippet">Acme again</div>
        </div>
        <div class="result">
          <a class="result__a" href="https://forum.example/p4">Acme glassdoor dump</a>
          <div class="result__snippet">Still Acme</div>
        </div>
      </body></html>`;

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hn.algolia.com")) {
        return jsonResponse({ hits: [] });
      }
      if (url.includes("duckduckgo.com")) {
        return htmlResponse(ddgHtml);
      }
      if (url.includes("forum.example/")) {
        const id = url.match(/p(\d)/)?.[1] ?? "?";
        return htmlResponse(
          `<html><head><title>Acme page ${id}</title></head><body><main>Acme discussion ${id}</main></body></html>`,
        );
      }
      return textResponse("missing", 404);
    };

    const result = await searchDiscussion("https://acme.example/", {
      homepageTitle: "Acme",
      fetchImpl,
      skipRobots: true,
      allowPrivateHosts: true,
      lookup: async () => ["93.184.216.34"],
    });

    expect(result.pages.length).toBe(3);
    expect(result.pages.every((p) => p.provider === "duckduckgo")).toBe(true);
  });

  it("tries Brave when SEARCH_API_KEY is set and tolerates provider failure", async () => {
    process.env.SEARCH_API_KEY = "test-key-not-secret";

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("hn.algolia.com")) {
        return jsonResponse({ hits: [] });
      }
      if (url.includes("duckduckgo.com")) {
        throw new Error("ddg_down");
      }
      if (url.includes("api.search.brave.com")) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-Subscription-Token"] ?? headers?.["x-subscription-token"]).toBe(
          "test-key-not-secret",
        );
        return jsonResponse({
          web: {
            results: [
              {
                title: "Acme interview process on Blind",
                url: "https://teamblind.example/acme",
                description: "Acme loop details",
              },
            ],
          },
        });
      }
      if (url.includes("api.tavily.com")) {
        return jsonResponse({ results: [] });
      }
      if (url.includes("teamblind.example/acme")) {
        return htmlResponse(
          `<html><head><title>Blind</title></head><body><main>Acme interview process notes</main></body></html>`,
        );
      }
      return textResponse("missing", 404);
    };

    const result = await searchDiscussion("https://acme.example/", {
      homepageTitle: "Acme",
      fetchImpl,
      skipRobots: true,
      allowPrivateHosts: true,
      lookup: async () => ["93.184.216.34"],
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.provider).toBe("brave");
    expect(result.log.some((e) => e.provider === "duckduckgo" && e.status === "error")).toBe(
      true,
    );
  });

  it("drops hits that do not mention the company name", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hn.algolia.com")) {
        return jsonResponse({
          hits: [
            {
              title: "Random FAANG thread",
              url: "https://news.example/faang",
              story_text: "google meta apple",
              objectID: "9",
            },
          ],
        });
      }
      if (url.includes("duckduckgo.com")) {
        return htmlResponse("<html><body></body></html>");
      }
      return textResponse("missing", 404);
    };

    const result = await searchDiscussion("https://acme.example/", {
      homepageTitle: "Acme",
      fetchImpl,
      skipRobots: true,
    });

    expect(result.pages).toEqual([]);
    expect(
      result.log.some(
        (e) => e.provider === "hn_algolia" && e.detail === "no_company_mention",
      ),
    ).toBe(true);
    expect(result.log.some((e) => e.detail === "no_discussion_found")).toBe(true);
  });
});
