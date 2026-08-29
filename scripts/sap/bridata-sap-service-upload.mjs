#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function acquireToken() {
  const existing = process.env.BRIDATA_ACCESS_TOKEN?.trim();
  if (existing) return existing;

  const tenantId = required('AZURE_TENANT_ID');
  const clientId = required('AZURE_CLIENT_ID');
  const clientSecret = required('AZURE_CLIENT_SECRET');
  const apiClientId = required('BRIDATA_API_CLIENT_ID');
  const scope = process.env.BRIDATA_TOKEN_SCOPE?.trim() || `api://${apiClientId}/.default`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope,
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Entra token request failed: ${response.status} ${await response.text()}`);
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('Entra response did not contain access_token.');
  return result.access_token;
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg || fileArg.startsWith('--')) {
    throw new Error('Usage: node scripts/sap/bridata-sap-service-upload.mjs <file.xlsx> --generated-at <ISO-8601>');
  }
  const generatedAt = argument('--generated-at') || process.env.BRIDATA_SOURCE_GENERATED_AT;
  if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) {
    throw new Error('--generated-at <ISO-8601> (or BRIDATA_SOURCE_GENERATED_AT) is required so freshness reflects SAP generation time.');
  }

  const apiUrl = required('BRIDATA_API_URL').replace(/\/$/, '');
  const tenantId = required('BRIDATA_TENANT_ID');
  const connectionId = required('BRIDATA_CONNECTION_ID');
  const path = resolve(fileArg);
  const bytes = await readFile(path);
  const token = await acquireToken();
  const response = await fetch(`${apiUrl}/api/v1/integrations/sap/connections/${connectionId}/service-imports:auto`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'x-bridata-tenant-id': tenantId,
      'x-bridata-file-name': basename(path),
      'x-bridata-source-generated-at': new Date(generatedAt).toISOString(),
      'x-bridata-original-content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: bytes,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Bridata import failed: ${response.status} ${text}`);
  const result = JSON.parse(text);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    duplicate: result.duplicate,
    sourceKey: result.detection?.sourceKey,
    batchId: result.batch?.id,
    status: result.batch?.status,
  })}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
