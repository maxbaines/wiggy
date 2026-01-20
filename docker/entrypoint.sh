#!/bin/bash
# Entrypoint script for loop container

echo "================================================"
echo "  Loop - Autonomous AI Coding Agent"
echo "================================================"
echo ""
echo "Available commands:"
echo "  loop              - Run the AI coding agent"
echo ""
echo "Container is ready!"
echo "================================================"

# Run ttyd in foreground with proper options
TTYD_PORT=${TTYD_PORT:-7681}
TTYD_USER=${TTYD_USER:-admin}
TTYD_PASSWORD=${TTYD_PASSWORD:-loop}

echo ""
echo "Starting web terminal on port $TTYD_PORT..."
echo "  Username: $TTYD_USER"
echo ""

# Disable origin check to allow WebSocket connections through Coolify proxy
exec ttyd \
    --port $TTYD_PORT \
    --credential "$TTYD_USER:$TTYD_PASSWORD" \
    --writable \
    bash --login
