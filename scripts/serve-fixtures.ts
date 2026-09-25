/**
 * Fixture HTTP server stub (port 8099).
 * Real sites and case HTML land in T03; this keeps `npm run fixtures` wired.
 */
import { createServer } from "node:http";

const PORT = 8099;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("fixtures server scaffold — site trees arrive in T03\n");
});

server.listen(PORT, () => {
  console.log(`fixtures listening on http://localhost:${PORT}`);
});
