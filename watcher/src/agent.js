// Inference driver. Reads the rendered request markdown, routes it through
// the LLM provider chain in llm.js, and writes the response to the path in
// the request's `respond_to` frontmatter. chokidar in index.js then ingests
// it into Postgres exactly the same way it did when this was a `claude
// --print` spawn — that side of the pipe stays unchanged.
//
// The rename from `invokeBridgeAgent` to `runBridgeAgent` is deliberate:
// the old name implied "spawn a process"; the new flow is a synchronous-
// looking HTTP round-trip you can await.

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { CONFIG } from './config.js';
import { runInference } from './llm.js';

const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), '[agent]', ...a);
const err = (...a) => console.error(ts(), '[agent]', ...a);

// Pull a single value out of a YAML-ish frontmatter block by key.
// Tolerant of optional quoting and trailing whitespace.
function frontmatterField(text, key) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(3, end);
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = fm.match(re);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '').trim();
}

// Extract local image paths the request references (only present for scan
// requests). render.js writes them as `- **<label>**: \`<absolute path>\``
// inside the ## Images section.
function imagePathsFromRequest(text) {
  const start = text.indexOf('## Images');
  if (start === -1) return [];
  const end = text.indexOf('\n## ', start + 1);
  const block = text.slice(start, end === -1 ? undefined : end);
  const out = [];
  const re = /^-\s+\*\*([^*]+)\*\*:\s+`([^`]+)`/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    out.push({ label: m[1].trim(), path: m[2].trim() });
  }
  return out;
}

export async function runBridgeAgent(requestFilePath) {
  if (!CONFIG.autoInvoke) {
    log(`auto-invoke disabled; leaving ${requestFilePath} for manual processing`);
    return;
  }

  let prompt;
  try {
    prompt = await readFile(requestFilePath, 'utf8');
  } catch (e) {
    err(`could not read request: ${e.message}`);
    throw e;
  }

  const respondTo = frontmatterField(prompt, 'respond_to');
  if (!respondTo) {
    throw new Error(`no respond_to in frontmatter of ${requestFilePath}`);
  }

  // Load image bytes for any local paths referenced in the request. Only
  // scan requests have them; pairing requests get an empty array.
  const refs = imagePathsFromRequest(prompt);
  const images = await Promise.all(refs.map(async (ref) => {
    try {
      const bytes = await readFile(ref.path);
      return { label: ref.label, path: ref.path, bytes };
    } catch (e) {
      err(`could not read image ${ref.path}: ${e.message}`);
      return null;
    }
  })).then((arr) => arr.filter(Boolean));

  log(`inferring for ${requestFilePath}${images.length ? ` (+${images.length} image${images.length === 1 ? '' : 's'})` : ''}`);

  let result;
  try {
    result = await runInference(prompt, images);
  } catch (e) {
    err(`inference failed: ${e.message}`);
    // Surface a usable response file so chokidar still ingests something
    // and the phone gets an error narrative instead of timing out. The
    // request_id on the request file matches the one in the frontmatter
    // we'd be expected to echo.
    const requestId = frontmatterField(prompt, 'request_id') || '<unknown>';
    const fallback = `---
request_id: ${requestId}
completed: ${ts()}
---

## Recommendations

## Narrative
The Master of Spirits could not generate a response. ${e.message}
`;
    await writeFile(respondTo, fallback, 'utf8');
    return;
  }

  await writeFile(respondTo, result.text, 'utf8');
  log(`wrote ${respondTo} via ${result.model}`);
}

// Back-compat alias so any caller still wired to the old name keeps working
// during the transition. (index.js will be updated to call the new name.)
export const invokeBridgeAgent = runBridgeAgent;
