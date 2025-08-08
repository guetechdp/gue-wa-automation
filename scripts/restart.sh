#!/bin/bash

echo "🔄 Restarting WhatsApp Bot..."

# Run cleanup to stop current processes
echo "Stopping current processes..."
./scripts/cleanup.sh

# Wait a moment
sleep 2

# Start fresh
echo "Starting fresh..."
npm run dev:clean 