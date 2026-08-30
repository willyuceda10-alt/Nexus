#!/usr/bin/env node

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function accessToken() {
  const direct = process.env.BRIDATA_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const tenantId = required('BRIDATA_ENTRA_TENANT_ID');
  const clientId = required('BRIDATA_ENTRA_CLIENT_ID');
  const clientSecret = required('BRIDATA_ENTRA_CLIENT_SECRET');
  const apiClientId = required('BRIDATA_API_CLIENT_ID');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: `api://${apiClientId}/.default`,
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const json = await response.json();
  if (!response.ok || typeof json.access_token !== 'string') {
    throw new Error(`Entra token request failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

const baseUrl = required('BRIDATA_API_URL').replace(/\/$/, '');
const tenantId = required('BRIDATA_TENANT_ID');
const connectionId = required('BRIDATA_SAP_CONNECTION_ID');
const dryRun = (process.env.BRIDATA_SAP_DRY_RUN ?? 'false').toLowerCase() === 'true';
const token = await accessToken();

const response = await fetch(
  `${baseUrl}/api/v1/integrations/sap/connections/${encodeURIComponent(connectionId)}/service-orchestrate-v1f2`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-bridata-tenant-id': tenantId,
    },
    body: JSON.stringify({ dryRun }),
  },
);

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (!response.ok) {
  console.error(JSON.stringify({ ok: false, statusCode: response.status, body }));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ ok: true, statusCode: response.status, body }));
}
