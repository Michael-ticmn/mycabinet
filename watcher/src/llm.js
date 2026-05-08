// LLM provider chain. Replaces the old `claude --print` spawn from agent.js
// with direct HTTP calls. Tries the primary (Gemini via Google's Generative
// Language API) first; on non-2xx, empty candidates, or thrown error, walks
// through CONFIG.llmModelFallbacks (typically OpenRouter free-tier models).
//
// All providers receive the SAME prompt: a single system instruction
// (Cabinet's response-format discipline) plus the rendered request markdown
// as the user message. Vision: scan requests pass image bytes that go
// inline as base64 in the Gemini call (or as `image_url` data URLs for
// OpenRouter chat-completion-style providers).

import { CONFIG } from './config.js';

const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), '[llm]', ...a);
const err = (...a) => console.error(ts(), '[llm]', ...a);

const SYSTEM_INSTRUCTION = `You are the Master of Spirits for the Cabinet hard-spirits collection app. You read structured request markdown (with frontmatter, ## Today, ## Context, ## Available cabinet, ## Task, and ## Response format sections) and write a response file in the EXACT format described under ## Response format.

Discipline:
- Honor the Response format block verbatim. Sections, fenced code blocks, JSON shape — match it.
- Echo the request_id from the request frontmatter into the response frontmatter.
- If you cannot fulfill the request for any reason, still emit a valid response: include the request_id, explain the problem in the Narrative section, and use an empty Recommendations list (or null fields for scan).
- Never invent the user's mood, the weather, or the occasion beyond what's literally in ## Today and ## Context.

You are speaking with the voice of a Master of Spirits — collector-grade, opinionated about cask aging, mash bills, regional character, proof, and finish — not a generic sommelier. The cabinet contains hard alcohol (bourbon, scotch, rye, tequila, mezcal, rum, cognac, etc.); never refer to it as wine or a cellar.`;

// Convert a Buffer of image bytes + filename hint to a Gemini inline_data
// part: { inline_data: { mime_type, data: <base64> } }.
function inlinePartFor(image) {
  const ext = (image.path || '').toLowerCase().match(/\.(jpe?g|png|webp|heic|gif)$/);
  const mime = ext
    ? ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' })[ext[1]] || 'image/jpeg'
    : 'image/jpeg';
  return {
    inline_data: { mime_type: mime, data: image.bytes.toString('base64') },
  };
}

async function callGemini(model, prompt, images) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const parts = [{ text: prompt }];
  for (const img of images || []) parts.push(inlinePartFor(img));
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // 8k tokens is plenty for the longest scan response (extracted JSON +
      // details JSON + narrative). Prevents a runaway from burning quota.
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': CONFIG.geminiApiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gemini ${model} ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error(`gemini ${model}: empty completion`);
  return text;
}

async function callOpenRouter(model, prompt, images) {
  if (!CONFIG.openrouterApiKey) throw new Error('OPENROUTER_API_KEY not configured');
  const userContent = [{ type: 'text', text: prompt }];
  for (const img of images || []) {
    const ext = (img.path || '').toLowerCase().match(/\.(jpe?g|png|webp|heic|gif)$/);
    const mime = ext
      ? ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' })[ext[1]] || 'image/jpeg'
      : 'image/jpeg';
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${img.bytes.toString('base64')}` },
    });
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.openrouterApiKey}`,
      // OpenRouter requests a referer + title for free-tier attribution.
      'HTTP-Referer': 'https://github.com/Michael-ticmn/cabinet',
      'X-Title': 'Cabinet',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user',   content: userContent },
      ],
      max_tokens: 8192,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`openrouter ${model} ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error(`openrouter ${model}: empty completion`);
  return text;
}

// Try a single model end-to-end. Routes to the right provider based on
// model name shape (slash → OpenRouter, else Gemini).
async function callModel(model, prompt, images) {
  if (model.includes('/')) return callOpenRouter(model, prompt, images);
  return callGemini(model, prompt, images);
}

// Public entry point. Returns { text, model } so the caller can log which
// model actually answered (helpful when debugging fallback behavior).
//
// images: array of { label, path, bytes } where bytes is a Node Buffer of
// the JPEG/PNG content. Empty/missing → text-only call.
export async function runInference(prompt, images = []) {
  const chain = [CONFIG.llmModelPrimary, ...CONFIG.llmModelFallbacks];
  const errors = [];
  for (const model of chain) {
    try {
      log(`calling ${model}${images.length ? ` (+${images.length} image${images.length === 1 ? '' : 's'})` : ''}`);
      const text = await callModel(model, prompt, images);
      log(`completed via ${model} (${text.length} chars)`);
      return { text, model };
    } catch (e) {
      const msg = e?.message || String(e);
      err(`${model} failed: ${msg}`);
      errors.push(`${model}: ${msg}`);
    }
  }
  throw new Error(`all LLM providers failed:\n  - ${errors.join('\n  - ')}`);
}
