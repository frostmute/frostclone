import { runCloneEngine } from "@/lib/cloner/engine";
import type { CloneRequest, CloneProgressEvent } from "@/lib/cloner/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: CloneRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.url || !body.destPath) {
    return new Response(
      JSON.stringify({ error: "Both 'url' and 'destPath' are required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: CloneProgressEvent) => {
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {}
      };

      try {
        await runCloneEngine(body, sendEvent);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendEvent({
          stage: "error",
          percent: 0,
          error: message,
          log: {
            level: "error",
            message: `Engine fault: ${message}`,
            timestamp: Date.now(),
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
