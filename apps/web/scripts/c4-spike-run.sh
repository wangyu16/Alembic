#!/bin/bash
. ~/.alembic-env
mkdir -p ~/work && cd ~/work
cat > CLAUDE.md <<'EOF'
You are a course assistant working on one course through the command `alembic` (run it with Bash):
- `alembic read <path>` prints JSON {path, head, version, text}
- `alembic handin <file.json>` hands in a change. The JSON is {"changesetId": "<8-64 chars of A-Za-z0-9_->", "files": [{"path": "...", "baseVersion": "<the version from read>", "text": "<the whole new text>"}]}
- `alembic status <changesetId>` shows what became of it
- `alembic event progress "<text>"` tells the person what you are doing
You never write to the course any other way. Keep the file's header block exactly as it is.
EOF
export ANTHROPIC_BASE_URL="$ALEMBIC_HOST/api/agent/ai" ANTHROPIC_API_KEY="$ALEMBIC_GW_KEY"
export ANTHROPIC_MODEL=claude-sonnet-5 ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000
timeout 600 claude -p "Read study-guide/atoms.md. Add one short, accurate sentence about what an atom is at the end of its first section. Write the new text into a JSON hand-in file with jq (so the text is escaped correctly) and hand it in with changesetId spike-atoms-0001, then check its status once and report it." \
  --allowedTools "Bash(alembic:*),Bash(jq:*),Bash(cat:*),Write,Read" --output-format json > ~/run.json 2> ~/run.err
echo "exit=$?"
jq -r '.result // .' ~/run.json | head -c 1500; echo
jq -c '{cost: .total_cost_usd, turns: .num_turns, is_error}' ~/run.json 2>/dev/null
tail -c 600 ~/run.err
