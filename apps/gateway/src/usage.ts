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
      }
    }
  }
}
