// Public Supabase config — committed to the repo. Loaded before
// config.local.js (which is gitignored and may override for local dev).
//
// The anon key is designed to be public; security relies on RLS policies
// in the Supabase project. The URL is also public. NEVER put the
// service_role key here — that one bypasses RLS and belongs only in
// watcher/.env.
//
// Cabinet uses its own Supabase project (separate from mycellar). Until
// the project is provisioned, these are placeholders — fill them in
// (or copy config.local.example.js → config.local.js) before running.
window.CABINET_CONFIG = {
  SUPABASE_URL: 'https://YOUR-CABINET-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-CABINET-ANON-KEY',
};
