# Cabinet — frontend

Static HTML/CSS/JS PWA. Bundled by esbuild into `js/dist/app.bundle.js`. Lives in `docs/` so GitHub Pages can serve it directly with the `/docs` source folder option once Cabinet has its own GitHub repo.

## Local dev

1. **Cabinet Supabase project** — provision a new one (separate from cellar27), apply [`../supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql), and seed `cabinet_allowed_users` with your auth user id.
2. **Configure**: `config.public.js` is committed but holds placeholders. Copy `config.local.example.js` → `config.local.js` (gitignored, loads after `config.public.js` so it wins for any keys it defines) and fill in the Cabinet project URL + anon key.
3. **Serve the directory** (`file://` won't work because of ES modules):
   ```
   py -m http.server 8000
   # or: npx http-server -p 8000
   ```
4. Open <http://localhost:8000>, sign in. Email confirmation is off; new sign-ups should be disabled in Supabase Auth settings (Cabinet relies on the allowlist for compute access, but disabling sign-ups is still the right default).

## Layout

```
docs/
├── index.html              app shell, login gate, view container
├── manifest.webmanifest    PWA manifest (Cabinet brand, amber theme)
├── sw.js                   service worker (cache-first app shell)
├── icon.svg                primary PWA icon
├── icon-maskable.svg       Android maskable variant
├── config.public.js        committed: window.CABINET_CONFIG placeholders
├── config.local.js         (git-ignored) per-host override
├── config.local.example.js template
├── css/styles.css          amber/oak palette + spirits-shaped layout
├── js/
│   ├── app.js              hash router, view mounting, SW registration
│   ├── supabase-client.js  client singleton (reads window.CABINET_CONFIG)
│   ├── auth.js             email/password sign-in
│   ├── bottles.js          CRUD + tap-to-pour, peak-window auto-fill
│   ├── pairings.js         food / cigar / occasion / flight / pour_tonight
│   ├── pairing-bus.js      shared Realtime transport for pairings + planned
│   ├── planned-flights.js  saved flight plans + flight_plan enrichment
│   ├── scan.js             camera capture, Storage upload, scan submission
│   ├── share.js            owner-side share-link helpers
│   ├── guest.js            anon RPC wrappers for shared cabinets
│   ├── spirit-types.js     18 categories, sub-types, regions, MATURATION_GUIDANCE
│   └── dist/app.bundle.js  esbuild output (committed; what the browser loads)
└── views/                  per-route HTML fragments
    ├── cabinet.html        owner inventory grid + filter chips + sort
    ├── add.html            manual add (full spirits form)
    ├── manage.html         scan launcher + manage UI
    ├── pairing.html        food / cigar / occasion radio
    ├── flight.html         vertical age / mash bill / cask finish / proof…
    ├── planned.html        saved flight list + detail (built dynamically)
    ├── pour-tonight.html   tier-grouped picks (peak / plateau / young / over)
    ├── share.html          owner share-link generator + guest activity
    ├── guest.html          anon read-only view of a shared cabinet
    └── bottle.html         bottle detail page (built dynamically)
```

## GH Pages deploy

Once the Cabinet GitHub repo is created (separate from mycellar): Repo Settings → Pages → Source: deploy from branch `main`, folder `/docs` → Save. First deploy takes 1–2 minutes. URL TBD.

`config.public.js` should be replaced with the real Cabinet project's URL + anon key before the first deploy (or a CI step generates it from secrets — Cabinet doesn't have CI yet).

`config.local.js` is gitignored and won't exist on Pages. `app.js` loads it dynamically and the 404 is silent — no `onerror` handler needed (CSP-friendly).
