#!/bin/sh
set -e

echo "NODE_ENV=$NODE_ENV"

if [ "$NODE_ENV" = "production" ]; then
    echo "Running Drizzle migrations..."
    bunx drizzle-kit migrate
fi

echo "Starting application..."
exec "$@"
