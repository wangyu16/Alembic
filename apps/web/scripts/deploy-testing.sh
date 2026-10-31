#!/bin/zsh
# Build the web app as a standalone server with the TESTING settings and run it
# on the testing VM (alembic-test.orz.how). Never production: it reads
# ~/alembic-testing.env and refuses anything that isn't the testing project.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=~/alembic-testing.env
set -a; . $ENV_FILE; set +a
[[ "$NEXT_PUBLIC_SUPABASE_URL" == *whbhiqnzknxnaxlulqga* ]] || { echo "not the testing project; refusing"; exit 1; }
SSH=(ssh -i ~/.ssh/alembic_testing_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes)
VM="$VM_USER@$VM_HOST"

ALEMBIC_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 npx next build >/tmp/next-build.log 2>&1 || { tail -20 /tmp/next-build.log; exit 1; }
OUT=$(mktemp -d)
cp -a .next/standalone/. $OUT/
cp -a .next/static $OUT/apps/web/.next/static
[[ -d public ]] && cp -a public $OUT/apps/web/public
find $OUT -path "*sharp*darwin*" -prune -exec rm -rf {} +   # macOS-only image binaries
mkdir -p $OUT/apps/web/.next/cache   # mount point for the writable cache (tmpfs on the VM)

BUILD=$(cat .next/BUILD_ID)
# A tar stream into a fresh folder, then a swap: the VM never runs a half-copied app.
# (macOS's openrsync silently skipped files in this tree.)
COPYFILE_DISABLE=1 tar --no-xattrs -C $OUT -czf - . | "${SSH[@]}" $VM 'rm -rf ~/alembic-testing/web.new && mkdir -p ~/alembic-testing/web.new && tar -xzf - -C ~/alembic-testing/web.new'
rm -rf $OUT
"${SSH[@]}" $VM "set -e; cd ~/alembic-testing
  [ \"\$(cat web.new/apps/web/.next/BUILD_ID)\" = \"$BUILD\" ] || { echo 'copy incomplete; keeping the running version'; exit 1; }
  rm -rf web.old; [ -d web ] && mv web web.old; mv web.new web
  sudo docker compose up -d web >/dev/null && sudo docker compose restart web >/dev/null
  for i in \$(seq 1 20); do c=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true); [ \"\$c\" = 200 ] && break; sleep 1; done
  echo \"web on VM: \$c (build \$(cat web/apps/web/.next/BUILD_ID))\""
echo "deployed $(git rev-parse --short HEAD)$(git diff --quiet || echo '+local changes') to https://alembic-test.orz.how"
