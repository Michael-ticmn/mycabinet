import 'dotenv/config';
import { homedir } from 'node:os';
import { join } from 'node:path';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing required env var: ${k}. See .env.example.`);
    process.exit(1);
  }
}

// Default the bridge dir to ~/cabinet-bridge so a Cabinet watcher can run
// alongside the legacy cellar27 watcher without colliding on the same
// folders. Override with BRIDGE_DIR if you want them shared (you don't).
const bridgeDir = process.env.BRIDGE_DIR || join(homedir(), 'cabinet-bridge');

// Comma-separated chain of fallback model names (OpenRouter free tier first,
// then any vision-capable free model worth keeping). Tried in order if the
// primary provider returns an error or empty completion.
const fallbackModels = (process.env.LLM_MODEL_FALLBACKS
  || 'google/gemini-2.0-flash-exp:free,meta-llama/llama-3.3-70b-instruct:free'
).split(',').map((s) => s.trim()).filter(Boolean);

export const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bridgeDir,
  dirs: {
    requests:  join(bridgeDir, 'requests'),
    responses: join(bridgeDir, 'responses'),
    processed: join(bridgeDir, 'processed'),
    images:    join(bridgeDir, 'images'),
  },
  timeoutMinutes: parseInt(process.env.TIMEOUT_MINUTES || '10', 10),
  // Global daily ceiling. Postgres tracks this in cabinet_watcher_metrics
  // via cabinet_try_record_spawn — same RPC regardless of LLM provider.
  // Env var renamed from MAX_CLAUDE_CALLS_PER_DAY for provider neutrality;
  // we still read the legacy name for backwards compat with old .env files.
  maxLlmCallsPerDay: parseInt(
    process.env.MAX_LLM_CALLS_PER_DAY
      ?? process.env.MAX_CLAUDE_CALLS_PER_DAY
      ?? '250',
    10
  ),
  notify: {
    // SMTP (Gmail with an App Password works fine; Resend SMTP also fine).
    // Leave any one of these unset to disable notifications silently.
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.NOTIFY_FROM || process.env.SMTP_USER,
    to:   process.env.NOTIFY_TO,
    cooldownMs: parseInt(process.env.NOTIFY_COOLDOWN_MS || `${30 * 60_000}`, 10),
  },
  storageBucket: 'bottle-labels',
  autoInvoke: (process.env.AUTO_INVOKE || 'true').toLowerCase() !== 'false',
  // LLM provider config (replaces the old `claude --print` spawn).
  geminiApiKey:        process.env.GEMINI_API_KEY,
  openrouterApiKey:    process.env.OPENROUTER_API_KEY || null,
  llmModelPrimary:     process.env.LLM_MODEL_PRIMARY || 'gemini-flash-latest',
  llmModelFallbacks:   fallbackModels,
  // Comma-separated user UUIDs allowed to consume bridge compute.
  // Empty/unset = open mode (every signed-in user allowed) — only safe
  // if Supabase "Allow new users to sign up" is OFF.
  allowedUserIds: new Set(
    (process.env.ALLOWED_USER_IDS || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
  ),
};
