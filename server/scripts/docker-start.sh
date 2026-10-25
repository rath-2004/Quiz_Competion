#!/bin/sh
# Container entrypoint: apply migrations (and create the admin from ADMIN_* env vars), optionally load demo data,
# then start the server.
set -e
node server/scripts/migrate.js
if [ "$SEED_DEMO" = "true" ]; then
  node server/scripts/seed.js
fi
exec node server/src/index.js
