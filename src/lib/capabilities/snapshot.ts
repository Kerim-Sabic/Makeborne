/** Configuration permits an attempt; it does not prove provider health,
 * remaining budget, tenant access or successful delivery.
 */
export type CapabilityInputs = {
  environment: string | undefined;
  hostname?: string;
  administrator: boolean;
  cloud: { enabled: boolean; configured: boolean; migrationsVerified: boolean; reason: string | null };
  pilotProviderConfigured: boolean;
  liveBuilderEnabledByConfiguration: boolean;
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
    reason: "Legacy operator generation jobs are retired. Their closed dispatch does not describe the live builder. Administrator access does not reopen these jobs.",
  };
}

export function capabilitySnapshot(input: CapabilityInputs) {
  const pilot = generationPilotStatus(input);
  const hostingConfigured = input.cloud.enabled && input.hostingCredentialConfigured;
  const developmentExports = input.environment !== "production" && loopback.has(input.hostname ?? "");
  const builderConfigured = input.cloud.configured && input.pilotProviderConfigured && input.hostingCredentialConfigured;
  const builderEnabled = builderConfigured && input.cloud.enabled && input.liveBuilderEnabledByConfiguration;
  const liveBuilder = {
    configured: builderConfigured,
    enabledByConfiguration: builderEnabled,
    health: "unverified" as const,
    // v2: null means configuration allows an attempt but runtime availability
    // is unknown. False means a known configuration prerequisite is missing.
    available: builderEnabled ? null : false,
    scope: "authorised_cloud_workspace" as const,
    reason: builderEnabled
      ? "Live builder configuration is enabled. Runtime delivery, database operation migrations, account access, model pricing and remaining provider budgets are not verified by this snapshot."
      : !builderConfigured ? "Live builder provider or cloud service configuration is incomplete."
        : "Live builder or cloud workspace access is disabled by configuration.",
  };
  const billingReason = input.billingEnabledByConfiguration
    ? "Membership checkout and credit fulfilment are enabled by configuration. Signed payment delivery, database migrations, reconciliation and account credit grants require runtime verification. This does not verify top-up or plan-switch readiness."
    : input.billingConfigured
      ? "Billing configuration is present; creation checkout is disabled by its activation or migration acknowledgement flags."
      : "Creation billing configuration is incomplete.";

  return {
    public: {
      schemaVersion: 2,
      evidenceScope: "configuration_and_implemented_boundaries" as const,
      health: "unverified" as const,
      localWorkspace: { available: true, scope: "this browser", cloudSync: false },
      aiGeneration: {
        ...liveBuilder,
        legacyOperatorJobs: "retired",
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
        available: hostingConfigured ? null : false,
        configured: hostingConfigured,
        configurationScope: "cloud_and_server_credential",
        implementation: "restricted_static_and_opt_in_interactive_customer_hosting",
        scope: "verified_workspace_owners_with_creation_access",
        health: "unverified",
        reason: "Restricted static publishing and opt-in interactive customer hosting are implemented. Interactive hosting requires the isolated hosting configuration and site consent. This endpoint does not verify hosting mode, account eligibility, deployment, domain configuration or delivery, or a published version.",
      },
      payments: {
        available: input.billingEnabledByConfiguration ? null : false,
        configured: input.billingConfigured,
        enabledByConfiguration: input.billingEnabledByConfiguration,
        health: "unverified",
        scope: "creation_memberships_and_credit_delivery",
        support: { available: true, grantsCreationAccess: false },
        reason: `${billingReason} Coffee support is separate and does not unlock creation.`,
      },
      kdp: { available: false, reason: "Print and EPUB validation profiles are pending." },
    },
    operations: {
      cloud: input.cloud,
      pilot,
      liveBuilder,
      routing: input.routing,
      hosting: {
        configured: hostingConfigured,
        configurationScope: "cloud_and_server_credential" as const,
        health: "unverified" as const,
        implementation: "restricted_static_and_opt_in_interactive_customer_hosting" as const,
        reason: hostingConfigured
          ? "Cloud and server credential configuration is present for restricted static publishing and opt-in interactive customer hosting. Interactive hosting additionally requires isolated hosting configuration and site consent; hosting mode and domain configuration are not verified here. Verify an authorised publish and public visit before claiming live delivery."
          : "Restricted static publishing and opt-in interactive customer hosting are implemented; cloud or server credential configuration is incomplete. Hosting mode and domain configuration are not verified here.",
      },
      billing: {
        configured: input.billingConfigured,
        enabledByConfiguration: input.billingEnabledByConfiguration,
        health: "unverified" as const,
        creditFulfilmentReady: null,
        reason: billingReason,
      },
    },
  };
}
