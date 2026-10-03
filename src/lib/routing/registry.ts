import { type Capability, type ModelRoute, RouteSchema } from "./contracts";

function planned(id: string, provider: ModelRoute["provider"], capabilities: Capability[], dataBoundary: ModelRoute["dataBoundary"] = "external"): ModelRoute {
  return RouteSchema.parse({ id, version: "planned-v1", provider, model: null, capabilities, status: "unconfigured", adapterVerified: false,
    configurationRef: null, dataBoundary, policyApproved: false, licenseApproved: false, evaluation: null, priority: 100, price: null });
}

/** Integration slots, not deployed models or proven capabilities. No slot is executable by default. */
export const PLANNED_ROUTES: readonly ModelRoute[] = [
  planned("openai-text", "openai", ["text", "website_code", "book_content", "slide_content", "clip_selection"]),
  planned("openai-image", "openai", ["image", "visual_slide"]),
  planned("claude-text", "anthropic", ["text", "website_code", "book_content", "slide_content", "clip_selection"]),
  planned("deepseek-text", "deepseek", ["text", "website_code", "book_content", "slide_content", "clip_selection"]),
  planned("qwen-hosted-text", "qwen_hosted", ["text", "website_code", "book_content", "slide_content"]),
  planned("open-weight-text", "self_hosted", ["text", "website_code", "book_content", "slide_content", "clip_selection"], "workspace_private"),
  planned("open-weight-transcription", "self_hosted", ["transcription"], "workspace_private"),
  planned("clip-render-worker", "media_worker", ["clip_render"], "workspace_private"),
];
