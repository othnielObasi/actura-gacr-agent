#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Actura — Vultr Server Setup Script
#  Run as root on a fresh Ubuntu 24.04 LTS Vultr instance:
#    curl -sL https://raw.githubusercontent.com/othnielObasi/actura-gacr-agent/main/deploy/setup-vultr.sh | bash
# ─────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/actura"
APP_USER="actura"
REPO="https://github.com/othnielObasi/actura-gacr-agent.git"
NODE_MAJOR=22

echo "══════════════════════════════════════"
echo "  Actura — Server Setup"
echo "══════════════════════════════════════"

# ── 1. System updates & essentials ──
echo "[1/7] Updating system..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ufw software-properties-common

# ── 2. Firewall ──
echo "[2/7] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
# Do NOT expose 3000/3001 directly — cloudflared handles public access
ufw --force enable

# ── 3. Node.js ──
echo "[3/7] Installing Node.js ${NODE_MAJOR}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
apt-get install -y nodejs
npm install -g pm2

# ── 4. Create app user & clone repo ──
echo "[4/7] Setting up application..."
id -u $APP_USER &>/dev/null || useradd -m -s /bin/bash $APP_USER
mkdir -p $APP_DIR/logs
git clone $REPO $APP_DIR/repo || (cd $APP_DIR/repo && git pull origin main)
cp -r $APP_DIR/repo/. $APP_DIR/
rm -rf $APP_DIR/repo
chown -R $APP_USER:$APP_USER $APP_DIR

# ── 5. Install dependencies ──
echo "[5/7] Installing Node dependencies..."
cd $APP_DIR
sudo -u $APP_USER npm install --production

# ── 6. Cloudflared ──
echo "[6/7] Installing cloudflared..."
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# ── 7. Environment file ──
echo "[7/7] Creating .env template..."
if [ ! -f $APP_DIR/.env ]; then
  cat > $APP_DIR/.env << 'ENVEOF'
# ─── Actura Environment Variables ───
# Fill these in before starting the agent.

MODE=live

# Wallet (KEEP SECRET)
PRIVATE_KEY=

# Network
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

# IPFS
PINATA_JWT=
PINATA_GATEWAY=

# Agent identity
AGENT_NAME=Actura
AGENT_ID=

# Dashboard & MCP (cloudflared will proxy these)
PORT=3000
DASHBOARD_URL=https://your-tunnel.cfargotunnel.com
MCP_ENDPOINT=https://your-tunnel.cfargotunnel.com/mcp

# Trading
TRADING_PAIR=WETH/USDC
MAX_POSITION_PCT=10
MAX_DAILY_LOSS_PCT=2
MAX_DRAWDOWN_PCT=8
TRADING_INTERVAL_MS=60000

# ERC-8004 contracts (Base Sepolia defaults)
IDENTITY_REGISTRY=0x7177a6867296406881E20d6647232314736Dd09A
REPUTATION_REGISTRY=0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322
VALIDATION_REGISTRY=0x662b40A526cb4017d947e71eAF6753BF3eeE66d8
ENVEOF
  chown $APP_USER:$APP_USER $APP_DIR/.env
  chmod 600 $APP_DIR/.env
fi

echo ""
echo "══════════════════════════════════════"
echo "  ✅ Server setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit /opt/actura/.env with your keys"
echo "  2. Run:  bash /opt/actura/deploy/setup-tunnel.sh"
echo "  3. Start:  cd /opt/actura && pm2 start ecosystem.config.cjs"
echo "  4. Save:  pm2 save && pm2 startup"
echo "══════════════════════════════════════"
