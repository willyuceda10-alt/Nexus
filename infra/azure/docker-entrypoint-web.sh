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

# The API origin is only known at container start, so the CSP that must allow it is
# generated here and included by nginx.conf. connect-src additionally needs the Entra
# login host for the PKCE token exchange.
API_ORIGIN=""
if [ -n "${BRIDATA_API_BASE_URL:-}" ]; then
  API_ORIGIN=" ${BRIDATA_API_BASE_URL}"
fi

cat > /etc/nginx/conf.d/security-headers.conf <<CSPEOF
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'${API_ORIGIN} https://login.microsoftonline.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
CSPEOF

exec "$@"
