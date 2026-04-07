#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Actura — Deploy to VPS
#
#  Syncs code to the VPS, preserving runtime state (.actura/),
#  then restarts the agent via PM2.
#
#  Usage:  ./deploy/deploy.sh
#          ./deploy/deploy.sh --skip-restart
# ─────────────────────────────────────────────────────────
set -euo pipefail

VPS_HOST="root@api.actura.nov-tia.com"
VPS_PATH="/opt/actura"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/vultr_actura}"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no"

echo "══════════════════════════════════════"
echo "  Actura — Deploy"
echo "══════════════════════════════════════"

# ── 1. Build ──
echo "[1/3] Building..."
npm run build

# ── 2. Sync code (preserve runtime state) ──
echo "[2/3] Syncing to $VPS_HOST:$VPS_PATH ..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude '.actura/'  \
  --exclude 'logs/'     \
  -e "ssh $SSH_OPTS" \
  ./ "$VPS_HOST:$VPS_PATH/"

# ── 3. Restart agent ──
if [[ "${1:-}" != "--skip-restart" ]]; then
  echo "[3/3] Restarting agent..."
  ssh $SSH_OPTS "$VPS_HOST" "cd $VPS_PATH && pm2 restart actura-agent || pm2 start ecosystem.config.cjs"
  echo ""
  echo "✅ Deployed and restarted. Tailing logs..."
  ssh $SSH_OPTS "$VPS_HOST" "pm2 logs actura-agent --lines 15 --nostream"
else
  echo "[3/3] Skipping restart (--skip-restart)"
fi

echo ""
echo "✅ Deploy complete"
