#!/bin/sh
set -e

# Writes window.__BRIDATA_CONFIG__ from Container App env vars before nginx starts.
# Local dev uses VITE_ build-time vars instead (runtime-config.js is absent there).
cat > /usr/share/nginx/html/runtime-config.js <<JSEOF
window.__BRIDATA_CONFIG__ = {
  dataMode: "${BRIDATA_DATA_MODE:-api}",
  authMode: "${BRIDATA_AUTH_MODE:-entra}",
  apiBaseUrl: "${BRIDATA_API_BASE_URL:-}",
  entraWebClientId: "${BRIDATA_ENTRA_WEB_CLIENT_ID:-}",
  entraTenantId: "${BRIDATA_ENTRA_TENANT_ID:-}",
  entraApiScope: "${BRIDATA_ENTRA_API_SCOPE:-}"
};
JSEOF

exec "$@"
