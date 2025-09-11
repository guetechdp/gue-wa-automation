#!/bin/sh

# Startup script for WhatsApp Bot
# Ensures Railway volume permissions and session directory exist

set -e
echo "🚀 Starting WhatsApp Bot..."

VOLUME_PATH="${RAILWAY_VOLUME_PATH:-/data}"
SESSION_DIR="$VOLUME_PATH/.wwebjs_auth/session"

echo "📦 Ensuring volume at: $VOLUME_PATH"
mkdir -p "$SESSION_DIR" || true

# Try to relax permissions so the app can write regardless of user
if chmod -R 777 "$VOLUME_PATH" 2>/dev/null; then
  echo "✅ Set permissions on $VOLUME_PATH to 777"
else
  echo "⚠️ Could not chmod $VOLUME_PATH (may be restricted)"
fi

# Attempt chown to whatsapp-bot user/group when available, ignore failures on restricted mounts
if id whatsapp-bot >/dev/null 2>&1; then
  chown -R whatsapp-bot:nodejs "$VOLUME_PATH" 2>/dev/null || true
fi

# Always run as root to avoid volume write issues on managed mounts
echo "👤 Running Node as root to avoid volume permission issues"
echo "🌍 Environment check:"
echo "  - NODE_ENV: ${NODE_ENV:-not set}"
echo "  - PORT: ${PORT:-not set}"
echo "  - RAILWAY_VOLUME_PATH: ${RAILWAY_VOLUME_PATH:-not set}"
echo "  - FW_ENDPOINT: ${FW_ENDPOINT:-not set}"
echo "  - JWT_SECRET: ${JWT_SECRET:+SET}"
echo "🚀 Starting application..."
exec dumb-init -- node dist/index-simple.js
