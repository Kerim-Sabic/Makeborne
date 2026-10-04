import {
  apiError,
  boundedJson,
  RequestError,
  sameOrigin,
} from "@/lib/server/http";
import {
  ExportRequestSchema,
  htmlDocument,
  pdfDocument,
  presentationDocument,
  prepareExport,
} from "@/lib/server/export";
import { epubDocument } from "@/lib/server/epub";
import { requireCreationAccess } from "@/lib/billing/access";

export const runtime = "nodejs";
export const maxDuration = 30;
let activeExports = 0;

export async function POST(request: Request) {
  let reserved = false;
  try {
    sameOrigin(request);
    await requireCreationAccess();
    // Server rendering has not yet been connected to cloud quotas and tenant jobs.
    // Keep it local-only even if the application is deployed from this repo.
    if (process.env.NODE_ENV === "production")
      throw new RequestError(
        "EXPORT_NOT_CONFIGURED",
        "Server exports need the cloud worker configuration. Your saved content remains available.",
        503,
      );
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      throw new RequestError(
        "LOCAL_EXPORT_ONLY",
        "Development exports are available only on this computer.",
        403,
      );
    if (activeExports >= 2)
      throw new RequestError(
        "EXPORT_BUSY",
        "Two exports are already running. Please try again shortly.",
        429,
      );
    activeExports++;
    reserved = true;
    const parsed = ExportRequestSchema.safeParse(
      await boundedJson(request, 18_000_000),
    );
    if (!parsed.success)
      throw new RequestError(
        "INVALID_EXPORT",
        "This content exceeds supported export limits or has an unsupported structure.",
      );
    const input = await prepareExport(parsed.data);
    const filename =
      input.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "makeborne";
    const headers = {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}.${input.format}"`,
      "X-Content-Type-Options": "nosniff",
    };
    if (input.format === "html")
      return new Response(htmlDocument(input), {
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      });
    const bytes =
      input.format === "epub"
        ? await epubDocument(input)
        : input.format === "pdf"
          ? await pdfDocument(input)
          : await presentationDocument(input);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type":
          input.format === "epub"
            ? "application/epub+zip"
            : input.format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
    });
  } catch (error) {
    return apiError(error);
  } finally {
    if (reserved) activeExports--;
  }
}
