#!/bin/bash

echo "🧹 Starting comprehensive cleanup..."

# Kill any existing Node.js processes for this project
echo "Killing Node.js processes..."
pkill -f "ts-node src/index.ts" 2>/dev/null || true
pkill -f "node dist/index.js" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

# Kill processes on common development ports
echo "Killing processes on development ports..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:9222 | xargs kill -9 2>/dev/null || true  # Chrome debug port

# Only remove lock files, NOT the session data
echo "Removing lock files only (preserving session data)..."
rm -rf .wwebjs_auth/session/SingletonLock 2>/dev/null || true
rm -rf .wwebjs_auth/session/*.lock 2>/dev/null || true
rm -rf .wwebjs_auth/session/Singleton* 2>/dev/null || true

# Remove temporary Chromium files but NOT the session
echo "Removing temporary Chromium files..."
rm -rf /tmp/.org.chromium.Chromium.* 2>/dev/null || true
rm -rf /tmp/.com.google.Chrome.* 2>/dev/null || true

# Remove Chrome user data directory lock files
echo "Removing Chrome user data locks..."
find /tmp -name "SingletonLock" -delete 2>/dev/null || true
find /tmp -name "chrome_*" -type d -exec rm -rf {} + 2>/dev/null || true

# Wait a moment for processes to fully terminate
echo "Waiting for processes to terminate..."
sleep 2

echo "✅ Cleanup completed! (Session data preserved)" 