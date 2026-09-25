/**
 * Static fixture site server on :8099.
 * Serves files under fixtures/sites so /acme/ → fixtures/sites/acme/.
 * No deps beyond node:http / node:fs / node:path / node:url.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8099;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "sites",
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function contentType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve URL pathname to a file under ROOT; null if outside root or missing. */
async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(ROOT, relative);

  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) {
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

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const { pathname } = new URL(req.url ?? "/", `http://${host}`);
    const filePath = await resolveFile(pathname);

    if (!filePath) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal server error\n");
  }
});

server.listen(PORT, () => {
  console.log(`fixtures listening on http://localhost:${PORT}`);
  console.log(`serving ${ROOT}`);
});
