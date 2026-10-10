/** Configuration permits an attempt; it does not prove provider health,
 * remaining budget, tenant access or successful delivery.
 */
export type CapabilityInputs = {
  environment: string | undefined;
  hostname?: string;
  administrator: boolean;
  cloud: { enabled: boolean; configured: boolean; migrationsVerified: boolean; reason: string | null };
  pilotProviderConfigured: boolean;
  hostingCredentialConfigured: boolean;
  billingConfigured: boolean;
  billingEnabledByConfiguration: boolean;
  routing: { configured: number; total: number };
};

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function generationPilotStatus(input: Pick<CapabilityInputs, "administrator" | "cloud" | "pilotProviderConfigured">) {
  const configured = input.cloud.enabled && input.pilotProviderConfigured;
  // Retired direct pilot dispatch cannot bypass durable global/provider caps.
  // Configuration and administrator allowance do not activate a new worker.
  const available = false;
  return {
    available,
    configured,
    scope: "administrator_testing" as const,
    health: "unverified" as const,
    budget: "closed_pending_durable_worker" as const,
    reason: "Generation is paused while the verified worker and model routing are connected. Administrator access does not override this.",
  };
}

export function capabilitySnapshot(input: CapabilityInputs) {
  const pilot = generationPilotStatus(input);
  const hostingConfigured = input.cloud.enabled && input.hostingCredentialConfigured;
  const developmentExports = input.environment !== "production" && loopback.has(input.hostname ?? "");

  return {
    public: {
      schemaVersion: 1,
      evidenceScope: "configuration_and_implemented_boundaries" as const,
      health: "unverified" as const,
      localWorkspace: { available: true, scope: "this browser", cloudSync: false },
      aiGeneration: {
        available: false,
        scope: "public_creation",
        restrictedTesting: "closed_pending_durable_worker",
        reason: "Generation is not active while the verified worker and model routing are connected.",
      },
      cloudWorkspace: {
        available: input.cloud.enabled,
        configured: input.cloud.configured,
        migrationsVerified: input.cloud.migrationsVerified,
        migrationEvidence: "operator_acknowledgement",
        health: "unverified",
        reason: input.cloud.reason,
      },
      manualExports: {
        available: developmentExports,
        formats: ["html", "pdf", "pptx", "epub"],
        scope: "localhost development",
        reason: developmentExports ? null : "Production document exports require the cloud worker and quota path.",
      },
      publicPublishing: {
        available: false,
        implementation: "restricted_static_publisher",
        scope: "verified_workspace_owners_with_creation_access",
        health: "unverified",
        reason: "A restricted static publisher is implemented. This endpoint does not verify account eligibility, deployment, domain delivery or a published version.",
      },
      payments: {
        available: false,
        scope: "creation_memberships_and_credit_delivery",
        support: { available: true, grantsCreationAccess: false },
        reason: "Creation credit delivery and founder activation are incomplete. Coffee support is separate and does not unlock creation.",
      },
      kdp: { available: false, reason: "Print and EPUB validation profiles are pending." },
    },
    operations: {
      cloud: input.cloud,
      pilot,
      routing: input.routing,
      hosting: {
        configured: hostingConfigured,
        health: "unverified" as const,
        implementation: "static_html_css" as const,
        reason: hostingConfigured
          ? "Static publishing configuration is present. Verify an authorised publish and public visit before claiming live delivery."
          : "Static publishing routes exist; cloud and server credential configuration are incomplete.",
      },
      billing: {
        configured: input.billingConfigured,
        enabledByConfiguration: input.billingEnabledByConfiguration,
        health: "unverified" as const,
        creditFulfilmentReady: false,
        reason: "Configuration does not complete recurring credit fulfilment, founder activation or top-up delivery.",
      },
    },
  };
}
