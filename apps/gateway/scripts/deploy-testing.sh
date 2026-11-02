#!/bin/zsh
# Bundle the AI gateway and run it on the TESTING VM, reachable only from the
# other Alembic containers (http://gateway:4100). Reads ~/alembic-testing.env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ~/alembic-testing.env; set +a
[[ "$SUPABASE_URL" == *whbhiqnzknxnaxlulqga* ]] || { echo "not the testing project; refusing"; exit 1; }
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || { echo "ANTHROPIC_API_KEY missing"; exit 1; }
SSH=(ssh -i ~/.ssh/alembic_testing_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes)
VM="$VM_USER@$VM_HOST"
OUT=$(mktemp -d)
../../node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=$OUT/gateway.mjs --log-level=warning \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
umask 077
printf 'NODE_ENV=production\nPORT=4100\nDATABASE_URL=%s\nANTHROPIC_API_KEY=%s\n' "$DATABASE_URL_POOLER" "$ANTHROPIC_API_KEY" > $OUT/gateway.env
COPYFILE_DISABLE=1 tar --no-xattrs -C $OUT -czf - gateway.mjs gateway.env | "${SSH[@]}" $VM 'set -e; mkdir -p ~/alembic-testing/gateway && tar -xzf - -C ~/alembic-testing/gateway && mv ~/alembic-testing/gateway/gateway.env ~/alembic-testing/gateway.env && chmod 600 ~/alembic-testing/gateway.env'
rm -rf $OUT
"${SSH[@]}" $VM 'cd ~/alembic-testing
grep -q "^  gateway:" compose.yaml || cat >> compose.yaml <<Y
  gateway:                      # AI gateway (C2): per-job keys, metering; holds the Anthropic key. Not published to the host.
    image: node:22-alpine
    command: ["node", "/app/gateway.mjs"]
    env_file: [gateway.env]
    volumes: ["./gateway:/app:ro"]
    dns: [1.1.1.1, 8.8.8.8]
    mem_limit: 256m
    restart: unless-stopped
Y
sudo docker compose up -d gateway >/dev/null 2>&1; sudo docker compose restart gateway >/dev/null 2>&1; sleep 3
sudo docker compose logs --tail 3 gateway
sudo docker compose exec -T web wget -qO- http://gateway:4100/health || echo "web cannot reach the gateway"'
