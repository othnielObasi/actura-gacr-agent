#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Actura — Cloudflare Tunnel Setup
#  Run AFTER setup-vultr.sh and AFTER editing .env
#
#  This script:
#   1. Authenticates cloudflared with your Cloudflare account
#   2. Creates a named tunnel
#   3. Configures routing for dashboard (port 3000) and MCP (port 3001)
#   4. Installs as a systemd service
# ─────────────────────────────────────────────────────────
set -euo pipefail

TUNNEL_NAME="${1:-actura}"

echo "══════════════════════════════════════"
echo "  Actura — Cloudflare Tunnel Setup"
echo "══════════════════════════════════════"

# ── 1. Login to Cloudflare ──
echo "[1/5] Authenticating with Cloudflare..."
echo "  A browser window will open. Log in and authorize cloudflared."
cloudflared tunnel login

# ── 2. Create tunnel ──
echo "[2/5] Creating tunnel '${TUNNEL_NAME}'..."
cloudflared tunnel create "$TUNNEL_NAME"

TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')

if [ -z "$TUNNEL_ID" ]; then
  echo "❌ Could not find tunnel ID. Check: cloudflared tunnel list"
  exit 1
fi

echo "  Tunnel ID: $TUNNEL_ID"

# ── 3. Write config ──
echo "[3/5] Writing tunnel config..."
mkdir -p /etc/cloudflared

cat > /etc/cloudflared/config.yml << CFEOF
tunnel: ${TUNNEL_ID}
credentials-file: /root/.cloudflared/${TUNNEL_ID}.json

ingress:
  # Dashboard (frontend + API) — primary hostname
  - hostname: ${TUNNEL_NAME}.cfargotunnel.com
    service: http://localhost:3000

  # MCP server — subpath on same hostname
  # cloudflared routes /mcp/* to the MCP port
  - hostname: mcp-${TUNNEL_NAME}.cfargotunnel.com
    service: http://localhost:3001

  # Catch-all (required by cloudflared)
  - service: http_status:404
CFEOF

echo "  Config written to /etc/cloudflared/config.yml"

# ── 4. Create DNS routes ──
echo "[4/5] Creating DNS routes..."
echo "  NOTE: If you have a custom domain, replace the hostnames above"
echo "  with your domain and run:"
echo "    cloudflared tunnel route dns ${TUNNEL_NAME} actura.yourdomain.com"
echo "    cloudflared tunnel route dns ${TUNNEL_NAME} mcp.yourdomain.com"
echo ""
echo "  For now, using the default *.cfargotunnel.com subdomain."

# ── 5. Install as systemd service ──
echo "[5/5] Installing as system service..."
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared

echo ""
echo "══════════════════════════════════════"
echo "  ✅ Tunnel '${TUNNEL_NAME}' is live!"
echo ""
echo "  Dashboard: https://${TUNNEL_NAME}.cfargotunnel.com"
echo "  MCP:       https://mcp-${TUNNEL_NAME}.cfargotunnel.com"
echo ""
echo "  Update /opt/actura/.env:"
echo "    DASHBOARD_URL=https://${TUNNEL_NAME}.cfargotunnel.com"
echo "    MCP_ENDPOINT=https://mcp-${TUNNEL_NAME}.cfargotunnel.com/mcp"
echo ""
echo "  Then restart the agent:"
echo "    pm2 restart actura-agent"
echo ""
echo "  Tunnel status:  cloudflared tunnel info ${TUNNEL_NAME}"
echo "  Tunnel logs:    journalctl -u cloudflared -f"
echo "══════════════════════════════════════"
