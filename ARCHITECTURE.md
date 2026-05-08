# Cabinet — how a request travels

```
┌──────────────┐                                                ┌────────────────┐
│  PHONE       │                                                │  HOST DESKTOP  │
│ (Safari /    │                                                │ (always-on)    │
│  PWA)        │                                                │                │
│              │       ① INSERT pairing_request                 │                │
│  Tap "Pair"  │ ─────────────────────────────────┐             │                │
│              │                                  ▼             │                │
│              │                          ┌──────────────┐      │                │
│              │                          │              │      │                │
│              │                          │   SUPABASE   │      │                │
│              │                          │  (Postgres + │      │                │
│              │   ⑤ Realtime push        │   Realtime)  │      │                │
│ Card +       │ ◀───────────────────┐    │              │      │                │
│ narrative    │                     │    │              │      │                │
│ renders      │                     │    │              │      │                │
└──────────────┘                     │    │              │      │                │
                                     │    │              │ ──── │ ② Realtime push│
                                     │    │              │      │                │
                                     │    │              │      │ ┌────────────┐ │
                                     │    │              │      │ │ cabinet-   │ │
                                     │    │              │      │ │ watcher    │ │
                                     │    │              │      │ │ (Node)     │ │
                                     │    │              │      │ └─────┬──────┘ │
                                     │    │              │      │       │ writes │
                                     │    │              │      │       ▼ md     │
                                     │    │              │      │ ~/cabinet-     │
                                     │    │              │      │   bridge/      │
                                     │    │              │      │   requests/    │
                                     │    │              │      │       │        │
                                     │    │              │      │       ▼ HTTPS  │
                                     │    │              │      │ ┌────────────┐ │
                                     │    │              │      │ │ Gemini API │ │
                                     │    │              │      │ │ (+OpenRouter│ │
                                     │    │              │      │ │  fallback) │ │
                                     │    │              │      │ └─────┬──────┘ │
                                     │    │              │      │       │ writes │
                                     │    │              │      │       ▼ md     │
                                     │    │              │      │ ~/cabinet-     │
                                     │    │              │      │   bridge/      │
                                     │    │              │      │   responses/   │
                                     │    │              │      │       │        │
                                     │    │              │      │       │ chokidar
                                     │    │              │      │       ▼        │
                                     │    │              │ ◀──── ④ INSERT        │
                                     │    │              │      │   pairing_     │
                                     │    │              │      │   response     │
                                     │    └──────────────┘      │                │
                                     │                          │                │
                                     │   Realtime fanout to     │                │
                                     └─ all subscribed clients ─┘                │
                                                                └────────────────┘
```

## What happens, step by step

| # | Where     | What                                                                     |
|---|-----------|--------------------------------------------------------------------------|
| ① | Phone     | Frontend (`docs/js/pairings.js`) inserts a `pairing_request` row, with a `cabinet_snapshot` and `context`. Anon key + RLS confines it to your `user_id`. `request_type` is one of `pair_food`, `pair_cigar`, `pair_occasion`, `flight`, `pour_tonight`, `flight_plan`, `flight_guest`. |
| ② | Supabase  | Realtime publication fires an `INSERT` event for the new row.            |
| ③ | Host      | `cabinet-watcher` (Node, `watcher/src/index.js`) is subscribed to that event. It runs the policy gate (allowlist + rate limit), atomically claims the row (`status: pending → picked_up`), renders the request to a markdown file in `requests/`, then `runBridgeAgent()` reads it back, calls Gemini directly via `watcher/src/llm.js`, and writes the response markdown file at the path the request specified (in `responses/`). |
| ④ | Host      | `chokidar` notices the new file. Watcher parses it, inserts a `pairing_response` row, marks the request `completed`, archives both files into `processed/`. |
| ⑤ | Phone     | Realtime delivers the new response row to the subscribed phone. Frontend renders the bottle cards + Master-of-Spirits narrative. |

## Data ownership

| Lives in              | What                                                                |
|-----------------------|---------------------------------------------------------------------|
| **Supabase**          | Bottles, pairing/scan requests + responses, label photos (Storage)  |
| **Host disk**         | Bridge folder (`~/cabinet-bridge/`) — ephemeral request/response files for audit; Storage holds the durable image copies |
| **Phone**             | Nothing persistent. Service worker caches the app shell; data is fetched fresh from Supabase on each visit |

## Liveness model

The host only needs to be awake during step ③ (the inference window — typically 5–20s with Gemini Flash; can stretch to 30s for vision-heavy scans).

- Phone goes offline mid-flight → catches the response on next reconnect (Realtime + a one-shot row check on subscribe).
- Host goes to sleep AFTER the response was written → no impact; phone reads from Supabase.
- Host is asleep when the phone submits → request sits in `pending`. When host wakes, watcher's startup sweep picks it up and processes it. Phone gets the response when it lands.

A future Phase 2 lift moves step ③ entirely off the desktop into a Supabase Edge Function. See [PLAN.md](PLAN.md) "AI provider swap" section.

## Security shape

- **Phone uses anon key.** RLS scopes every row to the signed-in `user_id`. The service-role key never leaves `watcher/.env`.
- **Sign-ups disabled** in Supabase. Only existing accounts (created from the dashboard) can sign in.
- **DB-enforced allowlist.** Only user_ids listed in `cabinet_allowed_users` can INSERT into `pairing_requests` / `scan_requests` (RLS `WITH CHECK`). Watcher's `ALLOWED_USER_IDS` env stays as a redundant backstop.
- **DB-enforced rate limit.** `cabinet_check_rate_limit(auth.uid())` in the same RLS check rejects any insert past 100 combined pairing+scan rows in the last 60 min.
- **Concurrent in-flight cap.** `enforce_pending_request_cap` / `enforce_pending_scan_cap` triggers reject a 6th in-flight (`pending` + `picked_up`) row per user.
- **Global daily LLM ceiling.** Watcher calls `cabinet_try_record_spawn(MAX_LLM_CALLS_PER_DAY)` before every Gemini round-trip; default 250/day across all users, atomic counter in `cabinet_watcher_metrics`. Resets at UTC midnight.
- **Stale-claim recovery.** `cabinet_sweep_stale_claims` resets timed-out `picked_up` rows to `pending` (up to 2 retries) before marking them `error`.
- **Size CHECK constraints** on user-supplied jsonb (`context` ≤ 4 KB, `cabinet_snapshot` ≤ 65 KB, `image_paths` ≤ 4 KB) so a runaway phone payload can't bloat a row.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full limits table, where each is enforced, and how to tune.

## What about scan?

Same flow with two extras:

- **Front and optional back** label photos uploaded to Supabase Storage from the phone before the request inserts (path stored as an array in `image_paths`).
- **Watcher downloads** the images to `~/cabinet-bridge/images/`, references those local paths in the markdown, and `agent.js` reads them as bytes and feeds them to Gemini as `inline_data` parts (base64).
- Response includes both **structured fields** (producer, expression_name, category, age_statement, mash_bill, proof, cask info, finish, intensity, sweetness…) and **enrichment** (tasting notes, food/cigar pairings, distillery background, peak-band rationale, serving recommendations), all packed into `scan_responses.extracted`.

## What about share / QR?

A short-lived `share_links` token grants a guest's anonymous Supabase client `EXECUTE` on a set of `SECURITY DEFINER` functions (`cabinet_share_resolve`, `cabinet_share_list_bottles`, `cabinet_share_create_pairing_request`, `cabinet_share_get_response`, `cabinet_share_get_planned_flight`, `cabinet_share_create_message`) that return sanitized bottle data and let the guest spawn a small budget of Master-of-Spirits requests against the host's cabinet. No mutations possible to the underlying inventory. Per-link AI quota and a per-link 2-second QPS guard cap blast radius.
