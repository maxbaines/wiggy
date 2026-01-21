#!/bin/bash
# Entrypoint script for loop container

echo "================================================"
echo "  Loop - Autonomous AI Coding Agent"
echo "================================================"
echo ""

# Start web terminal by default
echo "Starting web terminal..."
/usr/local/bin/terminal.sh start

echo ""
echo "Available commands:"
echo "  loop              - Run the AI coding agent"
echo "  terminal.sh start - Start web terminal"
echo "  terminal.sh stop  - Stop web terminal"
echo ""
echo "GitHub / Git:"
echo "  git clone https://github.com/owner/repo.git"
echo "  (For private repos, use a Personal Access Token as password)"
echo "  (Credentials are cached for 1 hour after first entry)"
echo ""
echo "Container is ready!"
echo "================================================"

# Keep container running
exec tail -f /dev/null
