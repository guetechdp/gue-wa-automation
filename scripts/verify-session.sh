#!/bin/bash

echo "🔍 Verifying WhatsApp session persistence setup..."

# Check if session directory exists
if [ -d "/data/.wwebjs_auth" ]; then
    echo "✅ Session directory exists: /data/.wwebjs_auth"
    
    # List session files
    echo "📁 Session files:"
    ls -la /data/.wwebjs_auth/
    
    # Check session subdirectory
    if [ -d "/data/.wwebjs_auth/session" ]; then
        echo "✅ Session subdirectory exists"
        echo "📁 Session subdirectory files:"
        ls -la /data/.wwebjs_auth/session/
    else
        echo "📝 Session subdirectory will be created on first run"
    fi
else
    echo "📝 Session directory will be created on first run"
fi

# Check permissions
echo "🔐 Checking permissions..."
ls -ld /data 2>/dev/null || echo "⚠️ Could not check /data permissions"

# Check if we're in production
if [ "$NODE_ENV" = "production" ]; then
    echo "🚀 Running in production mode"
    echo "💾 Session path: /data/.wwebjs_auth"
else
    echo "🔧 Running in development mode"
    echo "💾 Session path: ./.wwebjs_auth"
fi

echo "✅ Session persistence verification complete!"
