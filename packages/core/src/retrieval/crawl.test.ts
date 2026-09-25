import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawl, pathPrefixForStart } from "./crawl.js";
import { resetHostLimiter } from "./hostLimiter.js";
import {
  classifyPage,
  CONTENT_SCORE_THRESHOLD,
  rankLinks,
  scoreLink,
  scorePageContent,
} from "./rankLinks.js";
import { resetRobotsCache } from "./robots.js";
import { readFileSync } from "node:fs";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/sites",
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(fixturesRoot, relative);
  if (candidate !== fixturesRoot && !candidate.startsWith(fixturesRoot + path.sep)) {
    return null;
  }
  try {
    const st = await stat(candidate);
    if (st.isDirectory()) {
      const indexPath = path.join(candidate, "index.html");
      const indexStat = await stat(indexPath).catch(() => null);
      return indexStat?.isFile() ? indexPath : null;
    }
    return st.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function listen(server: http.Server): Promise<{ port: number; base: string }> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ port: addr.port, base: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
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
      const body = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end("error");
    }
  });
  return listen(server).then(({ base }) => ({ server, base }));
}

describe("rankLinks / scoring", () => {
  it("scores hiring anchors and paths above generic links", () => {
    const hire = scoreLink("How we hire", "https://example.com/handbook/people/process");
    const generic = scoreLink("Blog", "https://example.com/blog/");
    expect(hire.total).toBeGreaterThan(generic.total);
    expect(hire.hiring).toBeGreaterThan(0);
  });

  it("applies penalties for privacy/login paths and fragments", () => {
    const bad = scoreLink("Privacy", "https://example.com/privacy#terms");
    const ok = scoreLink("About", "https://example.com/about");
    expect(bad.penalty).toBeGreaterThan(0);
    expect(bad.total).toBeLessThan(ok.total);
  });

  it("classifies content with hiring vs about thresholds", () => {
    const hiring = scorePageContent(
      "Our interview process includes a take-home exercise and an onsite system design round for hiring. Recruiters walk candidates through the handbook process.",
      "How we hire",
    );
    expect(hiring.hiring).toBeGreaterThanOrEqual(CONTENT_SCORE_THRESHOLD);
    expect(classifyPage(hiring)).toBe("hiring");

    const about = scorePageContent(
      "Our mission and values shape company culture. What we do is help the team ship. About our company.",
      "About the company",
    );
    expect(about.about).toBeGreaterThanOrEqual(CONTENT_SCORE_THRESHOLD);
    expect(classifyPage(about)).toBe("about");

    const denial = scorePageContent(
      "There is no about page, careers page, or hiring handbook here.",
      "QuietCo",
    );
    expect(classifyPage(denial)).toBe("other");
  });

  it("rankLinks sorts by score then URL", () => {
    const ranked = rankLinks([
      { url: "https://a.example/b", score: 2 },
      { url: "https://a.example/a", score: 5 },
      { url: "https://a.example/c", score: 5 },
    ]);
    expect(ranked.map((r) => r.url)).toEqual([
      "https://a.example/a",
      "https://a.example/c",
      "https://a.example/b",
    ]);
  });
});

describe("crawl", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    resetHostLimiter();
    resetRobotsCache();
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_PRIVATE_HOSTS;
  });

  afterEach(() => {
    process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.ALLOW_PRIVATE_HOSTS === undefined) {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    } else {
      process.env.ALLOW_PRIVATE_HOSTS = prevEnv.ALLOW_PRIVATE_HOSTS;
    }
  });

  it("pathPrefixForStart respects directory prefix", () => {
    expect(pathPrefixForStart(new URL("http://localhost:8099/acme/"))).toBe("/acme/");
    expect(pathPrefixForStart(new URL("http://localhost:8099/acme"))).toBe("/acme/");
    expect(pathPrefixForStart(new URL("http://localhost:8099/acme/about.html"))).toBe("/acme/");
  });

  it("finds the buried hiring page on acme without hard-coded paths", async () => {
    const { server, base } = await startFixtureServer();
    try {
      const bundle = await crawl(`${base}/acme/`, { allowPrivateHosts: true });
      expect(bundle.unreachable).toBe(false);
      expect(bundle.homepage).not.toBeNull();
      expect(bundle.hiringPages.length).toBeGreaterThan(0);
      const hiringUrls = bundle.hiringPages.map((p) => p.url);
      expect(hiringUrls.some((u) => u.includes("how-we-hire"))).toBe(true);
      expect(bundle.aboutPages.some((p) => /about/i.test(p.title) || /about/i.test(p.url))).toBe(
        true,
      );
      // robots-disallowed secret path must not appear as a fetched page
      const allFetched = [
        bundle.homepage,
        ...bundle.aboutPages,
        ...bundle.hiringPages,
        ...bundle.otherPages,
      ]
        .filter(Boolean)
        .map((p) => p!.url);
      expect(allFetched.every((u) => !u.includes("/secret"))).toBe(true);
    } finally {
      await close(server);
    }
  }, 60_000);

  it("quietco yields zero hiring pages and does not throw", async () => {
    const { server, base } = await startFixtureServer();
    try {
      const bundle = await crawl(`${base}/quietco/`, { allowPrivateHosts: true });
      expect(bundle.unreachable).toBe(false);
      expect(bundle.hiringPages).toEqual([]);
      expect(bundle.homepage).not.toBeNull();
    } finally {
      await close(server);
    }
  }, 30_000);

  it("marks unreachable when the company URL cannot be fetched", async () => {
    const bundle = await crawl("http://127.0.0.1:9/", { allowPrivateHosts: true, timeoutMs: 200 });
    expect(bundle.unreachable).toBe(true);
    expect(bundle.homepage).toBeNull();
    expect(bundle.hiringPages).toEqual([]);
  }, 15_000);

  it("source has no hard-coded hiring fixture paths", () => {
    const crawlSrc = readFileSync(new URL("./crawl.ts", import.meta.url), "utf8");
    const rankSrc = readFileSync(new URL("./rankLinks.ts", import.meta.url), "utf8");
    const combined = crawlSrc + rankSrc;
    expect(combined).not.toMatch(/how-we-hire/);
    expect(combined).not.toMatch(/\/careers\b/);
    expect(combined).not.toMatch(/\/jobs\b/);
    expect(combined).not.toMatch(/handbook\/people/);
  });
});
