# Cabinet — personal hard-spirits collection app

Catalog your bourbon, scotch, rye, tequila, mezcal, rum, cognac, and the rest of your hard-alcohol collection — with an AI **Master of Spirits** for pairings, tasting flights, and "what should I pour tonight" picks. Forked from [`mycellar`](https://github.com/Michael-ticmn/mycellar) (the wine-cellar version); architecture and patterns are reused, but the data model, taxonomy, AI persona, and Supabase project are independent.

This repo is a monorepo:

| Path | What | Status |
|------|------|--------|
| [`docs/`](docs/) | Static HTML/CSS/JS PWA, will serve from GitHub Pages | local-only until repo split |
| [`watcher/`](watcher/) | Node service that bridges Supabase ↔ direct Gemini API calls | provider-swapped (no Claude CLI) |
| [`supabase/migrations/`](supabase/migrations/) | SQL migrations for the Cabinet Supabase project | 0001 (consolidated, ready to apply) |

## Architecture

- [ARCHITECTURE.md](ARCHITECTURE.md) — one-page picture of how a request travels from phone → Supabase → watcher → Gemini → back
- [docs-pdf/architecture.pdf](docs-pdf/architecture.pdf) — colored, printable single-page PDF. Source: [docs-pdf/architecture.html](docs-pdf/architecture.html); regenerate with [`docs-pdf/build.sh`](docs-pdf/build.sh) once Cabinet copy is settled.

## Spirit taxonomy

Categories, sub-types, regions, and per-category maturation guidance live in [`docs/js/spirit-types.js`](docs/js/spirit-types.js). Categories: bourbon, rye, scotch, irish_whiskey, japanese_whisky, world_whisky, tequila, mezcal, agave_other, rum, cognac, armagnac, brandy_other, gin, vodka, liqueur, american_whiskey_other, other. The same module powers the Add form, filter chips, and the Pour Tonight tier groupings.

## AI provider

Cabinet calls the Google Gemini API directly (the watcher's old `claude --print` spawn is gone). On Gemini failure or empty completion, it falls back through OpenRouter free-tier models. See [`watcher/src/llm.js`](watcher/src/llm.js) and [`watcher/.env.example`](watcher/.env.example).

## Where to start

To run locally you need a Cabinet Supabase project (separate from cellar27); apply [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), drop the URL + anon key into [`docs/config.local.js`](docs/config.local.js) and the URL + service role key into [`watcher/.env`](watcher/.env.example), seed `cabinet_allowed_users` with your auth user id, and start the watcher.

## Building the frontend bundle

`docs/js/app.js` and its imports are bundled and minified into [`docs/js/dist/app.bundle.js`](docs/js/dist/app.bundle.js). Rebuild after editing any `docs/js/*.js` file:

```
npm install            # one-time, installs esbuild
npm run build:docs     # bundles + minifies into docs/js/dist/
```

Bump [`docs/version.js`](docs/version.js) so the service worker invalidates the old cache. The committed bundle is what GitHub Pages will serve — there is no CI build step.
