/** CRM write protocol. Version 2 = sales stages (Conversation) with delivery
 * tracked per project. This app sends it on every API call and every database
 * request; the server refuses CRM writes from older browser bundles, and the
 * database refuses them from older servers once the transition is contracted
 * (docs/CRM_STAGE_TRANSITION.md). Bump it only together with the database cutoff. */
export const CRM_PROTOCOL = 2;
export const CRM_PROTOCOL_HEADER = "x-makeborne-crm-protocol";
export const crmProtocolHeaders = { [CRM_PROTOCOL_HEADER]: String(CRM_PROTOCOL) } as const;

/** Whether a request comes from an app bundle that speaks the current CRM protocol. */
export function speaksCurrentCrmProtocol(headers: Headers) {
  const value = Number(headers.get(CRM_PROTOCOL_HEADER));
  return Number.isInteger(value) && value >= CRM_PROTOCOL;
}
