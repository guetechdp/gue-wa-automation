#!/bin/sh

# Startup script for WhatsApp Bot
# Handles Railway volume permissions

echo "🚀 Starting WhatsApp Bot..."

# Check if we're running on Railway with volumes
if [ "$RAILWAY_RUN_UID" = "0" ]; then
    echo "📦 Running on Railway with volumes - using root user"
    # Run as root for Railway volumes
    exec dumb-init -- node dist/index.js
else
    echo "🔧 Running in development or without volumes - using non-root user"
    # Switch to non-root user for security
    exec dumb-init -- su-exec whatsapp-bot node dist/index.js
fi
