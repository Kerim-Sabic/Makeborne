import "server-only";

export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function boundedJson(
  request: Request,
  limit = 256_000,
): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new RequestError("CONTENT_TYPE", "Send JSON content.", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > limit)
    throw new RequestError(
      "REQUEST_TOO_LARGE",
      "This request exceeds the supported size.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new RequestError("EMPTY_REQUEST", "Request content is missing.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError(
          "REQUEST_TOO_LARGE",
          "This request exceeds the supported size.",
          413,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new RequestError(
        "INVALID_JSON",
        "Request content must be valid JSON.",
      );
    }
  } finally {
    reader.releaseLock();
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const target = new URL(request.url);
  let allowed = origin === target.origin;
  // Next development can normalize an incoming 127.0.0.1 URL to localhost.
  // Permit only loopback aliases on the same protocol and port in development.
  // Never trust forwarded host headers to widen the production origin boundary.
  if (!allowed && process.env.NODE_ENV === "development") {
    try {
      const source = new URL(origin);
      const loopback = ["localhost", "127.0.0.1", "[::1]"];
      allowed =
        source.origin === origin &&
        loopback.includes(source.hostname) &&
        loopback.includes(target.hostname) &&
        source.protocol === target.protocol &&
        source.port === target.port;
    } catch {
      allowed = false;
    }
  }
  if (!allowed)
    throw new RequestError(
      "ORIGIN_DENIED",
      "This request must originate from this application.",
      403,
    );
}

export function apiError(error: unknown) {
  if (error instanceof RequestError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    {
      error: {
        code: "REQUEST_FAILED",
        message:
          "Request completion could not be confirmed. Keep your current draft before retrying.",
      },
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
