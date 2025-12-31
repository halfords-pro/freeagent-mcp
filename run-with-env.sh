#!/bin/bash

# Helper script to load .env variables and run commands
# Usage: ./run-with-env.sh npm run inspector
#        ./run-with-env.sh node build/index.js
#        ./run-with-env.sh bash

set -a  # Mark variables for export
if [ -f .env ]; then
    source .env
else
    echo "Error: .env file not found in $(pwd)"
    exit 1
fi
set +a  # Unset the mark

# Run the provided command with exported variables
# If no command provided, start an interactive shell
if [ $# -eq 0 ]; then
    echo "Environment variables loaded from .env"
    echo "Variables exported:"
    env | grep FREEAGENT || echo "  (none found)"
    echo ""
    echo "Starting interactive shell with .env loaded..."
    exec "$SHELL"
else
    exec "$@"
fi
