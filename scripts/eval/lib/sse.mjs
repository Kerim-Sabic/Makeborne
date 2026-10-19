// Server-sent events as the builder routes write them (src/lib/builder/
// website-run.ts, docs-run.ts, plan-run.ts): one `data: <json>` line per event,
// events separated by a blank line, `: keep-alive` comments every 15 s.
// The parser follows the SSE spec closely enough to survive chunk boundaries
// anywhere (mid-line, mid-CRLF) and multi-line data, and never throws on a bad
// event: an unparsable payload becomes {type: 'invalid', raw} so it is recorded.

/** Terminal event types of every builder stream (done/error end a stage). */
export const TERMINAL_TYPES = Object.freeze(['done', 'error']);

/** Incremental parser: push() text chunks as they arrive, end() at EOF. */
export class SseParser {
  #buffer = '';
  #data = [];
  #name = null;
  #carriageReturn = false;

  /** Feed a chunk; returns the events completed by it. */
  push(chunk) {
    let text = String(chunk);
    // A CRLF split across chunks: the LF half was already handled as a line end.
    if (this.#carriageReturn && text.startsWith('\n')) text = text.slice(1);
    this.#carriageReturn = text.endsWith('\r');
    this.#buffer += text;
    const events = [];
    let start = 0;
    for (let index = 0; index < this.#buffer.length; index++) {
      const char = this.#buffer[index];
      if (char !== '\n' && char !== '\r') continue;
      this.#line(this.#buffer.slice(start, index), events);
      if (char === '\r' && this.#buffer[index + 1] === '\n') index++;
      start = index + 1;
    }
    this.#buffer = this.#buffer.slice(start);
    return events;
  }

  /** Flush at end of stream: a final event without its blank line still counts. */
  end() {
    const events = [];
    if (this.#buffer) this.#line(this.#buffer, events);
    this.#buffer = '';
    this.#dispatch(events);
    return events;
  }

  #line(line, events) {
    if (line === '') { this.#dispatch(events); return; }
    if (line.startsWith(':')) return; // comment, e.g. ": keep-alive"
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.#data.push(value);
    else if (field === 'event') this.#name = value;
  }

  #dispatch(events) {
    if (!this.#data.length) { this.#name = null; return; }
    const raw = this.#data.join('\n');
    this.#data = [];
    let event;
    try {
      event = JSON.parse(raw);
      if (!event || typeof event !== 'object' || Array.isArray(event)) event = { type: 'invalid', raw: raw.slice(0, 2000) };
    } catch {
      event = { type: 'invalid', raw: raw.slice(0, 2000) };
    }
    if (this.#name && !event.type) event.type = this.#name;
    this.#name = null;
    events.push(event);
  }
}

/** Parse a whole SSE body (e.g. a saved events/<n>-<stage>.sse file). */
export function parseSse(text) {
  const parser = new SseParser();
  return [...parser.push(text), ...parser.end()];
}

export const isTerminal = event => TERMINAL_TYPES.includes(event?.type);

/** The last done/error event, or null when the stream closed early. */
export function terminalEvent(events) {
  for (let index = events.length - 1; index >= 0; index--) if (isTerminal(events[index])) return events[index];
  return null;
}

/** The latest operation snapshot carried by any event (operation, plan, done, error). */
export function lastOperation(events) {
  for (let index = events.length - 1; index >= 0; index--) if (events[index]?.operation) return events[index].operation;
  return null;
}

/** Credits reported by usage events (the running total; the last one wins). */
export function lastUsageCredits(events) {
  for (let index = events.length - 1; index >= 0; index--) if (events[index]?.type === 'usage') return Number(events[index].credits);
  return null;
}

/**
 * Read a fetch Response body as SSE. Keeps the exact raw text (for the .sse
 * evidence file), hands each raw chunk to onText (to append to that file as it
 * arrives) and calls onEvent for each event. A body that fails mid-stream
 * (abort, timeout, reset) resolves with what arrived plus `streamError`.
 */
export async function readSse(response, { onEvent, onText } = {}) {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const events = [];
  let text = '';
  let streamError = null;
  const take = batch => { for (const event of batch) { events.push(event); onEvent?.(event); } };
  const feed = part => { if (!part) return; text += part; onText?.(part); take(parser.push(part)); };
  try {
    if (response.body) for await (const chunk of response.body) feed(decoder.decode(chunk, { stream: true }));
  } catch (error) {
    streamError = String(error?.message ?? error);
  }
  feed(decoder.decode());
  take(parser.end());
  return { text, events, terminal: terminalEvent(events), streamError };
}
