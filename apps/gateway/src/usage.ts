/**
 * Read usage out of a Messages API SSE stream as it passes through:
 * message_start carries the input side (and the message id), message_delta
 * carries the cumulative output_tokens. The stream itself is forwarded
 * untouched; only these events are parsed.
 */
import type { Usage } from "./pricing";

export class StreamUsage {
  usage: Usage = {};
  messageId: string | null = null;
  /** Characters of streamed text/thinking/tool input, for an estimate when the stream ends early. */
  streamedChars = 0;
  sawFinalUsage = false;
  private buf = "";

  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = event.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      let e: { type?: string; message?: { id?: string; usage?: Usage }; usage?: Usage };
      try { e = JSON.parse(data); } catch { continue; }
      if (e.type === "message_start" && e.message) {
        this.messageId = e.message.id ?? null;
        this.usage = { ...this.usage, ...(e.message.usage ?? {}) };
      } else if (e.type === "message_delta" && e.usage) {
        // Cumulative counts: the last delta wins.
        this.usage = { ...this.usage, ...e.usage };
        this.sawFinalUsage = true;
      } else if (e.type === "content_block_delta") {
        const d = (e as { delta?: { text?: string; thinking?: string; partial_json?: string } }).delta;
        this.streamedChars += (d?.text?.length ?? 0) + (d?.thinking?.length ?? 0) + (d?.partial_json?.length ?? 0);
      }
    }
  }
}

/** Usage to charge: if the stream ended before its final usage, estimate output from what was streamed (≈3 chars/token, generous). */
export function chargeableUsage(m: StreamUsage): Usage {
  if (m.sawFinalUsage) return m.usage;
  return { ...m.usage, output_tokens: Math.max(m.usage.output_tokens ?? 0, Math.ceil(m.streamedChars / 3)) };
}
