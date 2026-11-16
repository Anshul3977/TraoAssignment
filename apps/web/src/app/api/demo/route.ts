import { runPipeline, isPipelineError } from "@prep/core";
import { createDemoLimiter, parseDemoInput } from "@/lib/demo-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One kit is ~1-2.5 min of crawl + LLM calls on free-tier rate limits.
export const maxDuration = 300;

const limiter = createDemoLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
let running = 0;
const MAX_CONCURRENT = 2;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Public demo: no account, nothing stored. Streams NDJSON lines:
 * {type:"progress", step, status, detail?} ... then {type:"kit", kit} or {type:"error", code, message}.
 */
export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return json(503, { code: "DEMO_DISABLED", message: "The demo has no LLM key configured." });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: "INVALID_INPUT", message: "Body must be JSON." });
  }
  const input = parseDemoInput(body);
  if ("error" in input) {
    return json(400, { code: "INVALID_INPUT", message: input.error });
  }
  if (running >= MAX_CONCURRENT) {
    return json(429, { code: "DEMO_BUSY", message: "The demo is busy with another kit. Try again in a minute." }, { "retry-after": "60" });
  }
  const wait = limiter.take(clientIp(req));
  if (wait !== null) {
    return json(429, { code: "RATE_LIMITED", message: `Demo limit is 3 kits per hour. Try again in ${Math.ceil(wait / 60)} min.` }, { "retry-after": String(wait) });
  }

  running++;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // client went away; keep running so the slot is released cleanly
        }
      };
      const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
      try {
        const { kit } = await runPipeline(input, {
          allowPrivateHosts: false,
          onProgress: (e) => send({ type: "progress", ...e }),
        });
        send({ type: "kit", kit });
      } catch (err) {
        const code = isPipelineError(err) ? err.code : "PIPELINE_FAILED";
        const message = isPipelineError(err)
          ? err.message
          : "Kit generation failed, probably a free-tier LLM rate limit. Try again in a minute.";
        console.error("demo pipeline failed", code, err instanceof Error ? err.message : err);
        send({ type: "error", code, message });
      } finally {
        clearInterval(heartbeat);
        running--;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
