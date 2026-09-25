import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostLimiter } from "./hostLimiter.js";
import { resetRobotsCache } from "./robots.js";
import { safeFetch } from "./safeFetch.js";

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

describe("safeFetch", () => {
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
    vi.useRealTimers();
  });

  it("returns http_error for 404", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("missing");
    });
    const { base } = await listen(server);
    try {
      const result = await safeFetch(`${base}/nope`, { allowPrivateHosts: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.reason).toBe("http_error");
      }
    } finally {
      await close(server);
    }
  });

  it("returns timeout when the server never responds", async () => {
    const server = http.createServer(() => {
      // intentionally hang
    });
    const { base } = await listen(server);
    try {
      const result = await safeFetch(`${base}/slow`, {
        allowPrivateHosts: true,
        timeoutMs: 80,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("timeout");
    } finally {
      await close(server);
    }
  });

  it("rejects responses over the byte cap", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("x".repeat(2000));
    });
    const { base } = await listen(server);
    try {
      const result = await safeFetch(`${base}/big`, {
        allowPrivateHosts: true,
        maxBytes: 500,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("response_too_large");
    } finally {
      await close(server);
    }
  });

  it("rejects disallowed content types", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end("%PDF-fake");
    });
    const { base } = await listen(server);
    try {
      const result = await safeFetch(`${base}/doc.pdf`, { allowPrivateHosts: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("unsupported_content_type");
    } finally {
      await close(server);
    }
  });

  it("blocks redirect to 127.0.0.1 in production mode", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_PRIVATE_HOSTS;

    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href.includes("public.example/start")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    const result = await safeFetch("http://public.example/start", {
      fetchImpl,
      skipRobots: true,
      lookup: async () => ["93.184.216.34"], // example.com-ish public
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("private_address_blocked");
      expect(result.url).toContain("127.0.0.1");
    }
  });

  it("respects robots.txt Disallow", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("User-agent: *\nDisallow: /secret/\n");
        return;
      }
      if (req.url?.startsWith("/secret/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>secret</html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>ok</html>");
    });
    const { base } = await listen(server);
    try {
      const blocked = await safeFetch(`${base}/secret/page`, { allowPrivateHosts: true });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.reason).toBe("robots_disallowed");

      const allowed = await safeFetch(`${base}/open`, { allowPrivateHosts: true });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.body).toContain("ok");
    } finally {
      await close(server);
    }
  });

  it("rejects non-http(s) URLs without throwing", async () => {
    const result = await safeFetch("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_protocol");
  });
});
