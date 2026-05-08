# cabinet-watcher

Node service that bridges Supabase Realtime ↔ direct Gemini API calls (with OpenRouter free-tier fallback). The phone inserts a `pairing_request` or `scan_request`; the watcher claims it, renders a markdown prompt, runs LLM inference over HTTPS, parses the response, and writes it back into Postgres for the phone to pick up via Realtime.

## Where it runs

A detached background `node.exe` process on Windows — no PM2, no Windows service, no Scheduled Task. Started via PowerShell `Start-Process` so it survives any terminal closing. Logs go to `watcher/watcher.out.log` and `watcher/watcher.err.log` (gitignored).

Bridge dir defaults to `~/cabinet-bridge/` (override with `BRIDGE_DIR` in `.env`). The default lives next to the legacy `~/cellar27-bridge/` so a Cabinet watcher can run alongside a wine-cellar watcher without colliding.

### Find / restart it

```powershell
# Find the running watcher
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/index.js*' } |
  Select-Object ProcessId, CommandLine

# Restart in place (kill + start detached)
$watcherDir = "$PWD\watcher"   # adjust if cwd isn't repo root
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Process -FilePath "node.exe" -ArgumentList "src/index.js" `
  -WorkingDirectory $watcherDir -WindowStyle Hidden `
  -RedirectStandardOutput "$watcherDir\watcher.out.log" `
  -RedirectStandardError  "$watcherDir\watcher.err.log"

# Tail logs
Get-Content "$watcherDir\watcher.out.log" -Tail 40 -Wait
```

See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the request-flow diagram.

## What it does

- Subscribes to `pairing_requests` and `scan_requests` rows where `status='pending'`
- Atomically claims each row (`status='picked_up'`), then renders a markdown file into `~/cabinet-bridge/requests/`
- For scan requests, downloads the label image from Supabase Storage to `~/cabinet-bridge/images/<uuid>.<ext>` and references that local path in the markdown
- Reads the request markdown, calls Gemini directly via [`src/llm.js`](src/llm.js) (vision images go inline as base64 `inline_data` parts), writes the response file into `~/cabinet-bridge/responses/`
- `chokidar` notices the response file; the watcher parses it, inserts into `pairing_responses` / `scan_responses`, marks the request `completed`, archives both files into `~/cabinet-bridge/processed/`
- Every 2 min calls the Postgres function `cabinet_sweep_stale_claims` to recover rows stuck in `picked_up` (resets to `pending` for up to 2 retries, then `error`)
- Before each LLM round-trip, calls `cabinet_try_record_spawn(MAX_LLM_CALLS_PER_DAY)` — atomic global daily ceiling; refuses to dispatch at cap and marks the request `error`
- On startup, sweeps any rows left `pending` while the watcher was down, and runs the stale-claim sweep once

## Setup

```bash
cd watcher
npm install

cp .env.example .env
# fill in:
#   SUPABASE_URL                  — Cabinet Supabase project URL
#   SUPABASE_SERVICE_ROLE_KEY     — Settings → API → service_role
#   GEMINI_API_KEY                — https://aistudio.google.com/app/apikey
#   OPENROUTER_API_KEY (optional) — https://openrouter.ai/keys (fallback chain)

# Optional override; defaults to ~/cabinet-bridge
# On Windows: BRIDGE_DIR=C:/Users/<your-username>/cabinet-bridge

npm start
```

Folders under `BRIDGE_DIR` (`requests/`, `responses/`, `processed/`, `images/`) are auto-created at startup.

## LLM provider chain

The watcher tries `LLM_MODEL_PRIMARY` first (default `gemini-flash-latest`). On any failure — non-2xx, empty completion, thrown error — it walks `LLM_MODEL_FALLBACKS` (default OpenRouter free-tier: `google/gemini-2.0-flash-exp:free`, `meta-llama/llama-3.3-70b-instruct:free`).

Provider routing is implicit: a model name with a `/` (e.g. `google/gemini-2.0-flash-exp:free`) goes to OpenRouter; a bare name goes to Gemini directly. The system instruction is identical across providers — Cabinet's response-format discipline plus the Master-of-Spirits voice. Vision is handled the same way semantically (base64 inline) but with provider-specific request shapes (`inline_data` for Gemini, `image_url` data-URLs for OpenRouter chat completions).

To override, set in `.env`:

```ini
LLM_MODEL_PRIMARY=gemini-2.5-flash
LLM_MODEL_FALLBACKS=google/gemini-2.5-pro:free,anthropic/claude-3.5-sonnet
```

The model that actually answered each request appears in the watcher logs (`completed via <model>`).

## Bridge contract

See [`src/render.js`](src/render.js) for the markdown shape produced; [`src/parse.js`](src/parse.js) for the parser. Frontmatter carries `request_id`, `type`, `intent` (scan), and `respond_to` — the absolute path the LLM must write the response to. The parser tolerates minor formatting drift (extra whitespace, optional fields).

## Layout

```
watcher/
├── package.json
├── .env.example
├── .env             (gitignored)
└── src/
    ├── index.js     main loop: subscribe, watch, timeout, lifecycle
    ├── config.js    loads env, derives bridge dir layout
    ├── render.js    Supabase row → markdown request file
    ├── parse.js     markdown response file → Supabase row
    ├── agent.js     reads request, runs inference, writes response
    ├── llm.js       Gemini + OpenRouter HTTP wrapper
    ├── policy.js    allowlist + per-user rate-limit gate
    ├── notify.js    SMTP limit-hit notifier
    └── weather.js   Open-Meteo current weather (cached)
```

## Troubleshooting

- **"Missing required env var"** at startup → fill in `.env` (especially `GEMINI_API_KEY` — it's required, not optional).
- **Realtime channel stuck on "CONNECTING"** → confirm Realtime is enabled on the relevant tables in Supabase (Database → Replication → enable `pairing_requests`, `scan_requests`, `pairing_responses`, `scan_responses` for the `supabase_realtime` publication).
- **Storage download fails** → the service role key bypasses RLS, but the bucket must exist (`bottle-labels`, created by `supabase/migrations/0001_init.sql`).
- **Response files aren't being picked up** → check filename prefix. `req-<uuid>.md` for pairing, `scan-<uuid>.md` for scan. Anything else is ignored.
- **Request stuck in `picked_up`** → `cabinet_sweep_stale_claims` (called every 2 min) resets it to `pending` for up to 2 retries, then sets `error`. Check `error_message` and `retry_count`. `claimed_by` should be the host's hostname.
- **Insert from phone fails with "row violates row-level security policy"** → user_id isn't in `cabinet_allowed_users`, or `cabinet_check_rate_limit` returned false (default 100 requests/hour). Seed the allowlist via service_role.
- **Request errors with "Daily AI capacity reached"** → `MAX_LLM_CALLS_PER_DAY` ceiling hit (default 250). See `cabinet_watcher_metrics` for today's count; bump the env var and restart if needed.
- **Request errors with "all LLM providers failed"** → both Gemini and every OpenRouter fallback rejected the request. Check the watcher log for per-provider error messages — usually a missing/expired API key, an overloaded free tier, or a model rename.
- **Request errors with "policy: rate limit: N/100 requests in last hour"** → watcher-side in-memory rate limit (cleared on restart, tunable via `WATCHER_RATE_LIMIT_PER_HOUR`).

## Email notifications

When a watcher-side limit fires (policy denial or daily ceiling), the watcher can send an email so you know without checking logs. Set the SMTP env vars in `.env`:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char Gmail App Password>
NOTIFY_FROM=you@gmail.com
NOTIFY_TO=you@gmail.com
```

Leave any one blank to disable silently. `NOTIFY_COOLDOWN_MS` (default 30 min) suppresses repeated sends of the same limit-key so a runaway loop can't flood your inbox.

The emails are informational — no inline approval. They tell you which limit fired and the SQL/env tweaks to grant more.
