#!/bin/zsh
# Bundle the worker's background half (committer + schedules) and run it on the
# TESTING VM next to the web app. Reads ~/alembic-testing.env; testing project only.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ~/alembic-testing.env; set +a
[[ "$SUPABASE_URL" == *whbhiqnzknxnaxlulqga* ]] || { echo "not the testing project; refusing"; exit 1; }
SSH=(ssh -i ~/.ssh/alembic_testing_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes)
VM="$VM_USER@$VM_HOST"
export OUT=$(mktemp -d)
# orz-site and the 1.x carriers read their shells from disk: installed next to the bundle, not bundled.
SITE_DEPS=(orz-site orz-mdhtml orz-slides orz-paged orz-markdown)
../../node_modules/.bin/esbuild src/background.ts --bundle --platform=node --format=esm --target=node22 \
  ${SITE_DEPS[@]/#/--external:} \
  --outfile=$OUT/worker.mjs --log-level=warning \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
umask 077
KEY=$(awk 'BEGIN{ORS="\\n"} {print}' ~/alembic-testing-app.pem)
cat > $OUT/worker.env <<E2
NODE_ENV=production
DATABASE_URL=$DATABASE_URL_POOLER
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
GITHUB_APP_ID=$GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY=$KEY
GITHUB_TEMPLATE_OWNER=$GITHUB_TEMPLATE_OWNER
GITHUB_PUBLIC_TEMPLATE=$GITHUB_PUBLIC_TEMPLATE
ACTION_LINK_SECRET=$ACTION_LINK_SECRET
APP_URL=$APP_URL
RESEND_API_KEY=$RESEND_API_KEY
EMAIL_FROM=$EMAIL_FROM
E2
node -e '
const p = require("./package.json"); const deps = {};
for (const n of process.argv.slice(1)) deps[n] = p.dependencies[n];
require("fs").writeFileSync(process.env.OUT + "/package.json", JSON.stringify({ name: "alembic-worker-testing", private: true, type: "module", dependencies: deps }, null, 2));
' ${SITE_DEPS[@]}
COPYFILE_DISABLE=1 tar --no-xattrs -C $OUT -czf - worker.mjs worker.env package.json | "${SSH[@]}" $VM 'set -e; mkdir -p ~/alembic-testing/worker && tar -xzf - -C ~/alembic-testing/worker && mv ~/alembic-testing/worker/worker.env ~/alembic-testing/worker.env && chmod 600 ~/alembic-testing/worker.env
cd ~/alembic-testing/worker && if ! cmp -s package.json .installed.json; then
  sudo docker run --rm --network host -v "$PWD:/app" -w /app node:22-alpine npm install --omit=dev --no-audit --no-fund --loglevel=error && sudo chown -R $(id -u):$(id -g) node_modules && cp package.json .installed.json; fi'
rm -rf $OUT
"${SSH[@]}" $VM 'cd ~/alembic-testing
grep -q "^  worker:" compose.yaml || cat >> compose.yaml <<Y
  worker:                       # committer + schedules, bundled off-box (apps/worker/src/background.ts)
    image: node:22-alpine
    command: ["node", "/app/worker.mjs"]
    env_file: [worker.env]
    volumes: ["./worker:/app:ro"]
    dns: [1.1.1.1, 8.8.8.8]
    mem_limit: 512m
    restart: unless-stopped
Y
sudo docker compose up -d worker >/dev/null 2>&1; sudo docker compose restart worker >/dev/null 2>&1; sleep 4; sudo docker compose logs --tail 6 worker'
