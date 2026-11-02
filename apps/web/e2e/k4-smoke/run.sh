#!/bin/sh
# K4 smoke: the real orz-mdhtml-browser editor with Alembic's hooks and sync
# scheduler, in Chrome. Not part of CI (needs Chrome). Run from this folder:
#   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core ./run.sh
# Takes the shared heavy lock (/tmp/orz-heavy.lock) while Chrome runs.
set -e
cd "$(dirname "$0")"
WEB=../..
NODE_PATH=$WEB/node_modules:$WEB/../../node_modules "$WEB/../../node_modules/.bin/esbuild" entry.ts --bundle --format=iife \
  --outfile=bundle.js --log-level=warning --conditions=import \
  --alias:@alembic/package-contract=$WEB/../../packages/package-contract/src/index.ts
until mkdir /tmp/orz-heavy.lock 2>/dev/null; do sleep 10; done
trap 'kill $SRV 2>/dev/null; rmdir /tmp/orz-heavy.lock; rm -f bundle.js' EXIT
python3 -m http.server "${PORT:-8781}" --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
sleep 1
node drive.cjs
