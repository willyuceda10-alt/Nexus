import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2 = 'x-bridata-internal-sap-orchestration';
export const SAP_INTERNAL_OWNER_HEADER_V1F2 = 'x-bridata-internal-owner-user-id';

const secret = randomBytes(32).toString('hex');

const allowedPaths = [
  /\/api\/v1\/integrations\/sap\/connections\/[^/]+\/canonical-sync-v1d1(?:\?|$)/,
  /\/api\/v1\/integrations\/sap\/connections\/[^/]+\/inventory-sync-v1d2(?:\?|$)/,
  /\/api\/v1\/integrations\/sap\/connections\/[^/]+\/financial-guard-v1d3(?:\?|$)/,
  /\/api\/v1\/integrations\/sap\/connections\/[^/]+\/actual-cost-sync-v1d4(?:\?|$)/,
];

export function sapInternalOrchestrationSecretV1f2(): string {
  return secret;
}

export function isAllowedSapInternalOrchestrationPathV1f2(method: string, rawUrl: string | undefined): boolean {
  if (method.toUpperCase() !== 'POST' || !rawUrl) return false;
  return allowedPaths.some((pattern) => pattern.test(rawUrl));
}

export function matchesSapInternalOrchestrationSecretV1f2(candidate: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
