// Render Supabase request rows into markdown files for the LLM to read.

const ISO = (d) => new Date(d).toISOString();

// "Friday, May 1, 2026 — 11:14 AM CDT (America/Chicago)"
// Spelled out so the model can reason about day-of-week without parsing ISO.
// The watcher runs on the owner's machine so Date / Intl reflect the
// local timezone the user actually lives in.
function nowContext() {
  const d = new Date();
  const dayDate = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  let tzName = '';
  try { tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  return `${dayDate} — ${time}${tzName ? ` (${tzName})` : ''}`;
}

// Build the "## Today" body. Includes weather if the caller fetched any
// (null when LOCATION_LAT/LON aren't configured or the API call failed —
// graceful degradation, never blocks the recommendation).
function todaySection(weather) {
  const lines = [nowContext()];
  if (weather) lines.push(`Weather: ${weather}`);
  return lines.join('\n');
}

// Cabinet snapshot row. Shaped for spirits: producer, expression name,
// category, age statement, proof, peak window — instead of varietal/vintage.
function bottleRow(b) {
  const peak = (b.peak_window_start != null && b.peak_window_end != null)
    ? `${b.peak_window_start}–${b.peak_window_end}` : '';
  const bits = [
    b.id,
    b.producer || '',
    b.expression_name || '',
    b.category || '',
    b.spirit_type || '',
    b.age_statement ?? '',
    b.proof ?? '',
    b.quantity ?? '',
    peak,
  ];
  return `| ${bits.join(' | ')} |`;
}

function bottlesTable(snapshot, includeQty = true) {
  const head = includeQty
    ? '| id | producer | expression | category | spirit_type | age | proof | qty | peak window |'
    : '| id | producer | expression | category | spirit_type | age | proof | qty |';
  const sep = includeQty
    ? '|----|----------|------------|----------|-------------|-----|-------|-----|-------------|'
    : '|----|----------|------------|----------|-------------|-----|-------|-----|';
  const rows = (snapshot || [])
    .map(includeQty
      ? bottleRow
      : (b) => `| ${b.id} | ${b.producer || ''} | ${b.expression_name || ''} | ${b.category || ''} | ${b.spirit_type || ''} | ${b.age_statement ?? ''} | ${b.proof ?? ''} | ${b.quantity ?? ''} |`)
    .join('\n');
  return `${head}\n${sep}\n${rows || '_(empty)_'}`;
}

function expectedCount(type) {
  if (type === 'pair_food' || type === 'pair_cigar' || type === 'pair_occasion') return '1-2';
  if (type === 'flight')       return '3-5';
  if (type === 'flight_plan')  return '0';
  if (type === 'flight_guest') return '0';
  return '1-3';
}

// Shared instruction appended to every task. The model has a habit of
// inventing atmosphere about the user's evening based on no actual signal.
// That invented mood then drives the framing of the recommendation, which
// is wrong: the user only gave us the data in ## Today and ## Context.
const NO_INVENTED_CONTEXT = `\n\nIMPORTANT — narrative discipline:
- Only describe today using the actual day, date, and weather from the ## Today section above. Don't use day-name colloquialisms (no "a Tuesday", "Tuesday-feeling Friday", "save it for a Saturday", etc.). If you mean "weeknight" say "weeknight"; if you mean "special occasion" say "special occasion."
- Don't invent the user's mood, vibe, or occasion. If the ## Context section doesn't say it's casual / special / a date / low-key / celebratory, don't project any of those onto their evening. Recommend the bottle for the data given, not for an atmosphere you imagined.
- Don't invent weather, season, or location specifics beyond what ## Today literally states.
- The cabinet contains hard spirits — bourbon, rye, scotch, tequila, mezcal, rum, cognac, etc. Never call it wine or a cellar. Never use sommelier framing; speak as a Master of Spirits.`;

function taskFor(type, ctx = {}) {
  let body;
  switch (type) {
    case 'pair_food':
      body = `Pick 1–2 bottles from the cabinet that pair best with the dish/context above. Consider proof, sweetness, smoke, oak, finish, and overall intensity in relation to the food. Prefer bottles in or entering their peak band (per the maturation guidance — bourbon 6–12yr, scotch 10–18yr, etc.). Avoid past-peak or over-oaked unless the user asked specifically. If quantity is 1 of a hard-to-replace bottle, weigh whether opening it now is worth it.

ALSO always end the Narrative with a short "buy suggestion" section recommending exactly 1 specific bottle (producer + expression name + age/release if applicable, NOT from the cabinet above) that would pair well with this dish, with an approximate retail price range. Frame it three ways depending on how strong your in-cabinet pick was:

  - Cabinet pick is **high confidence** → start with a level-3 heading "### Optional buy" framed as "if you want to expand your range for dishes like this, also worth picking up…"
  - Cabinet pick is **medium confidence** → "### Worth buying" framed as a meaningful upgrade for next time you cook this.
  - Cabinet pick is **low confidence**, OR your best pick required a real stretch → "### Better option" framed as "the bottle that would actually nail this dish, if you're shopping" — make it clear the cabinet pick is a compromise.

Keep the buy suggestion to 2–3 sentences plus the price range. Don't pad. The buy suggestion does NOT go in the Recommendations array — only the in-cabinet picks do.`;
      break;
    case 'pair_cigar':
      body = `Pick 1–2 bottles from the cabinet that pair best with the cigar described in ## Context. Consider wrapper character (Maduro vs Connecticut vs Habano), strength, length of smoke, and the cigar's flavor arc. Match smoke and oak to the spirit's profile — peated scotch can stand up to a Maduro; a delicate cognac wants a milder cigar. Prefer bottles in their peak band. Avoid past-peak unless asked.

End the Narrative with a "### Optional buy" / "### Worth buying" / "### Better option" buy suggestion (same rules as food pairings — one specific bottle outside the cabinet that would nail this pairing, with retail price range, framed by your confidence in the cabinet pick).`;
      break;
    case 'pair_occasion':
      body = `Pick 1–2 bottles from the cabinet for the occasion described in ## Context (a fireside evening, a milestone birthday, a quiet nightcap, a celebration toast — whatever the user named). Consider quantity (don't blow the last bottle of an irreplaceable expression unless the occasion warrants it), peak band, and how the occasion's mood maps to the bottle's character. Prefer in-peak; avoid past-peak unless asked.

End the Narrative with a "### Optional buy" / "### Worth buying" / "### Better option" buy suggestion (same rules — one specific outside-cabinet bottle worth picking up, with retail price range).`;
      break;
    case 'flight':
      if (ctx.kind === 'extras') {
        body = `Suggest 1–2 specific bottles (producer + expression + age/release, NOT from the user's cabinet above) that would meaningfully round out their flight-building potential. ${ctx.theme_hint ? `Constraint or theme they're aiming for: ${ctx.theme_hint}.` : 'Look at gaps in their current cabinet — categories, regions, sub-types, mash bills, cask finishes missing.'} For each suggestion include: producer + expression + age, what flight it would unlock (with which existing bottles), why it fills a gap, and an approximate retail price range. Recommendations array stays EMPTY (these aren't owned); put the picks in the Narrative as a clearly formatted list.`;
      } else {
        const foodLine  = ctx.food  ? `\nFood / cigar / occasion alongside: ${ctx.food}.` : '';
        const notesLine = ctx.notes ? `\nHost notes: ${ctx.notes}.` : '';
        const themeBlurb = themeBlurbFor(ctx.theme);
        body = `Build a tasting flight of 3–5 bottles in a deliberate order. Theme: ${ctx.theme || 'unspecified'}${themeBlurb ? ` (${themeBlurb})` : ''}. Length: ${ctx.length || 3}.${foodLine}${notesLine} Each pick should teach the palate something in relation to the others; explain the progression in the narrative.${ctx.food ? ` If a food/cigar/occasion is named above, weight pick choice and ordering toward bottles that flatter it (or contrast it deliberately) — call out which pour pairs in the narrative.` : ''}${ctx.notes ? ` Honor the host notes — they constrain the picks.` : ''}`;
      }
      break;
    case 'pour_tonight':
      body = `Pick 1–3 bottles to pour tonight. Prioritize bottles in their peak maturation band over young or over-oaked ones. Consider quantity (don't recommend the last bottle of a hard-to-replace expression unless asked). Speak with the voice of a Master of Spirits — opinions about cask, mash bill, finish, proof.`;
      break;
    case 'flight_plan': {
      const foodHint  = (ctx.food_hint  || '').trim();
      const notesHint = (ctx.notes_hint || '').trim();
      const hintBlock = (foodHint || notesHint) ? `

ORIGINAL ASK — honor these explicitly:${foodHint ? `
- The host has already named pairings they're serving: **${foodHint}**. Include it as the FIRST item in your pairings array, marked with the appropriate kind (food / cigar / occasion), with a short description grounded in how it fits the picks. Build your other 2–4 suggestions AROUND it. Do NOT replace it or omit it.` : ''}${notesHint ? `
- Honor these constraints from the host: **${notesHint}**. They constrain both pairings and prep choices.` : ''}` : '';

      body = `The user has saved a tasting flight (see ## Saved flight) and wants you to plan the evening around it. Produce two things:

1) **Pairings** — 3–5 specific suggestions presented as a menu of OPTIONS the user can choose from. Each item is independent — the user will keep what fits and delete the rest. Mark each as either "food", "cigar", or "occasion" so the UI can group them. For food items, distinguish meal vs snack in the description if it's relevant. For each give a short name and a one-sentence description that makes the trade-off clear (heavier vs lighter, leans into which bottle, etc.).

2) **Prep** — concrete serving instructions per bottle (spirits-aware, not wine-aware):
   - chill_min: minutes in the freezer/fridge before pour (0 if it's served at room temp; omit the line if no chill needed). Most aged whiskey wants room temp; tequila/mezcal/some rum can take a chill.
   - open_early_min: minutes ahead to pour into the glass so the spirit can open up. Replaces "decant" — there's no sediment in spirits, but a heavy cask-strength scotch genuinely benefits from 10–15 minutes in glass.
   - water_drops: an integer count of drops of cool water that would soften the proof and unlock aroma. 0 for low-proof bottles; 2–5 for cask-strength.
   - glassware: type per bottle — Glencairn, Copita, rocks, snifter, NEAT, etc.
   Plus a "notes" field with anything else (order of service if non-obvious, palate cleansers, when to pour the cigar/snack, etc.).

Use the picks from ## Saved flight — do NOT recommend other bottles. The Recommendations array in the response stays empty.${hintBlock}`;
      break;
    }
    case 'flight_guest':
      body = `The host has finalized a tasting flight and wants you to write the GUEST-FACING walkthrough — copy the guests will read on a shared link tonight. The host has already settled on the bottles and the pairings (both shown in ## Saved flight). Produce:

1) **guest_intro** — 2–3 sentences welcoming the guest and framing the evening. Tell them what's coming (a vertical age, a regional tour, a mash-bill comparison, etc.) and what to pay attention to. Warm but specific. Skip "tonight on this special evening" filler — just say what the flight is.

2) **pour_walkthrough** — one entry per bottle from ## Saved flight, IN THE EXACT ORDER GIVEN. Each entry:
   - bottle_id: the uuid from the picks table.
   - what_to_look_for: 1–2 sentences on color, nose, and palate cues a guest should notice. Plain language, not jargon-stacked. If a comparison to the previous pour is the point, name it.
   - food_cue: which kept pairing item to enjoy with this pour (use the name from ## Kept pairings). Use "none" only if no pairing fits — don't invent one.
   - food_when: literally "before", "during", or "after" — when in the pour the pairing works best.
   - transition: 1 sentence on how to move to the next pour — palate cleanse, what shifts, what to listen for in the next glass. For the LAST pour, write a brief closing line instead.

Voice: speak directly to the guest ("you'll notice…", "try a pull from the…"). Don't address the host. Don't talk about chill times, water drops, or glassware — that's host-side prep. The Recommendations array stays empty; everything goes in the ## Plan JSON.`;
      break;
    default:
      return `Unrecognized request_type: ${type}.`;
  }
  return body + NO_INVENTED_CONTEXT;
}

// Friendly one-liner for each flight theme so the model gets the
// pedagogical intent rather than just the slug.
function themeBlurbFor(theme) {
  switch (theme) {
    case 'vertical_age':         return 'same expression at different ages — show how cask years change the spirit';
    case 'horizontal_producer':  return 'same category, different producers — show house style';
    case 'mash_bill_comparison': return 'compare grain bills (high-rye vs wheated bourbon, peated vs unpeated, agave varieties)';
    case 'regional_tour':        return 'walk through a region (Speyside, Islay, Jalisco Highlands, Oaxaca…)';
    case 'cask_finish':          return 'show what different cask finishes (sherry, port, rum, Madeira) bring to a base spirit';
    case 'proof_progression':    return 'low-proof to cask-strength so the palate ramps up';
    case 'surprise_me':          return '';
    default: return '';
  }
}

export function renderPairingRequest(row, respondToPath, weather = null) {
  const fm = `---
request_id: ${row.id}
type: ${row.request_type}
created: ${ISO(row.created_at)}
expected_count: "${expectedCount(row.request_type)}"
respond_to: ${respondToPath}
---`;

  const contextStr = JSON.stringify(row.context || {}, null, 2);

  // flight_plan operates on bottles already chosen — render the saved
  // flight as its own section and skip the wider cabinet (the user isn't
  // asking us to repick).
  if (row.request_type === 'flight_plan') {
    const savedFlightSection = renderSavedFlightSection(row.context || {});
    return `${fm}

# Cabinet request

## Today
${todaySection(weather)}

## Context
\`\`\`json
${contextStr}
\`\`\`

${savedFlightSection}

## Task
${taskFor(row.request_type, row.context)}

## Response format
Write the response file at the path in \`respond_to\` with this structure:

\`\`\`markdown
---
request_id: ${row.id}
completed: <ISO timestamp>
---

## Recommendations
_(empty for flight_plan — the picks were already saved)_

## Plan
\`\`\`json
{
  "pairings": [
    { "kind": "food",     "name": "...", "description": "..." },
    { "kind": "cigar",    "name": "...", "description": "..." },
    { "kind": "occasion", "name": "...", "description": "..." }
  ],
  "prep": {
    "chill_min":      [{ "bottle_id": "<uuid from Saved flight>", "minutes": 0 }],
    "open_early_min": [{ "bottle_id": "<uuid>", "minutes": 10 }],
    "water_drops":    [{ "bottle_id": "<uuid>", "drops": 3 }],
    "glassware":      [{ "bottle_id": "<uuid>", "type": "Glencairn" }],
    "notes": "..."
  }
}
\`\`\`

## Narrative
_(optional — short paragraph framing the night, or omit entirely)_
\`\`\`
`;
  }

  // flight_guest is also picks-already-chosen, but additionally has the
  // host's kept pairings list as input. The response is just the guest-
  // facing walkthrough JSON — no recommendations, no narrative.
  if (row.request_type === 'flight_guest') {
    const savedFlightSection = renderSavedFlightSection(row.context || {});
    const keptPairingsSection = renderKeptPairingsSection(row.context || {});
    return `${fm}

# Cabinet request

## Today
${todaySection(weather)}

## Context
\`\`\`json
${contextStr}
\`\`\`

${savedFlightSection}

${keptPairingsSection}

## Task
${taskFor(row.request_type, row.context)}

## Response format
Write the response file at the path in \`respond_to\` with this structure:

\`\`\`markdown
---
request_id: ${row.id}
completed: <ISO timestamp>
---

## Recommendations
_(empty for flight_guest)_

## Plan
\`\`\`json
{
  "guest_intro": "Welcome — tonight you'll taste …",
  "pour_walkthrough": [
    {
      "bottle_id": "<uuid from Saved flight, in serve order>",
      "what_to_look_for": "Color, nose, palate cues …",
      "food_cue": "<pairing name from Kept pairings, or \\"none\\">",
      "food_when": "before|during|after",
      "transition": "How to move to the next pour …"
    }
  ]
}
\`\`\`

## Narrative
_(omit — the guest_intro field above carries the welcome)_
\`\`\`
`;
  }

  return `${fm}

# Cabinet request

## Today
${todaySection(weather)}

## Context
\`\`\`json
${contextStr}
\`\`\`

## Available cabinet
${bottlesTable(row.cabinet_snapshot, true)}

## Task
${taskFor(row.request_type, row.context)}

## Response format
Write the response file at the path in \`respond_to\` with this structure:

\`\`\`markdown
---
request_id: ${row.id}
completed: <ISO timestamp>
---

## Recommendations
- bottle_id: <uuid from cabinet table above>
  confidence: high | medium | low
  reasoning: <1–2 sentences>
  alternatives: [<bottle_id>, ...]   # optional

## Narrative
<markdown — 2-4 paragraphs, the Master of Spirits' considered take. This is what the user actually reads.>
\`\`\`
`;
}

// Render the picks + narrative from a saved planned flight as a markdown
// section the agent can reason about. The id column is critical — the
// pairings/prep response must reference the same bottle_ids.
function renderSavedFlightSection(ctx) {
  const picks = Array.isArray(ctx.picks) ? ctx.picks : [];
  const head = '| bottle_id | confidence | reasoning |';
  const sep  = '|-----------|------------|-----------|';
  const rows = picks.map((p) => {
    const reasoning = (p.reasoning || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    return `| ${p.bottle_id} | ${p.confidence || ''} | ${reasoning} |`;
  }).join('\n') || '_(no picks)_';
  const meta = [
    ctx.title         ? `**Title:** ${ctx.title}` : null,
    ctx.occasion_date ? `**Occasion date:** ${ctx.occasion_date}` : null,
    ctx.theme         ? `**Theme:** ${ctx.theme}` : null,
    ctx.guests        ? `**Guests:** ${ctx.guests}` : null,
  ].filter(Boolean).join(' · ');
  const narrative = ctx.narrative
    ? `\n### Original Master-of-Spirits narrative\n${ctx.narrative}\n`
    : '';
  return `## Saved flight
${meta || '_(no metadata)_'}

### Picks
${head}
${sep}
${rows}
${narrative}`;
}

// Render the host's curated pairings list for flight_guest. The walkthrough's
// food_cue must reference one of these names verbatim (or "none") so the
// guest UI can match it back to a saved item.
function renderKeptPairingsSection(ctx) {
  // Accept both the new `pairings` shape and the legacy `food` array shape
  // for forward-compat during the rebrand transition.
  const items = Array.isArray(ctx.pairings) ? ctx.pairings
              : Array.isArray(ctx.food)     ? ctx.food
              : [];
  if (!items.length) {
    return `## Kept pairings
_(none — the host hasn't kept any pairing items. Use "none" for every food_cue.)_`;
  }
  const head = '| kind | name | description |';
  const sep  = '|------|------|-------------|';
  const rows = items.map((f) => {
    const name = (f.name || '').replace(/\|/g, '\\|');
    const desc = (f.description || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    return `| ${f.kind || ''} | ${name} | ${desc} |`;
  }).join('\n');
  return `## Kept pairings
${head}
${sep}
${rows}`;
}

// images: array of { label: 'front'|'back'|..., path: '<absolute local path>' }
// existingBottle: only set for intent='enrich' (DB row, AI uses for context)
export function renderScanRequest(row, images, respondToPath, existingBottle = null, weather = null) {
  const fm = `---
request_id: ${row.id}
type: scan
intent: ${row.intent}
created: ${ISO(row.created_at)}
respond_to: ${respondToPath}
---`;

  const imagesSection = (images || []).length
    ? '## Images\n' + images.map((img) => `- **${img.label}**: \`${img.path}\``).join('\n')
    : '## Images\n_(none — enrichment-only)_';

  const contextStr = row.context ? JSON.stringify(row.context, null, 2) : null;
  const contextSection = contextStr
    ? `## Context\n\`\`\`json\n${contextStr}\n\`\`\``
    : '## Context\n_(none)_';

  const cabinetSection = row.intent === 'pour'
    ? `## Cabinet\n${bottlesTable(row.cabinet_snapshot, false)}\n`
    : '';

  const bottleSection = (row.intent === 'enrich' && existingBottle)
    ? `## Bottle to enrich\n\`\`\`json\n${JSON.stringify(existingBottle, null, 2)}\n\`\`\`\n`
    : '';

  let task;
  if (row.intent === 'add') {
    task = `Extract structured spirits metadata from the label image(s) AND produce rich enrichment (tasting notes, food/cigar pairings, distillery background, region context, peak-band rationale, serving recommendations). Use the back label if provided — it usually has tech sheet info (proof, mash bill, cask details, age statement, distillation/bottling dates). Be honest about extraction confidence: if a field isn't visible, return null. Enrichment may draw on your knowledge of the producer/region but should align with what the labels actually show.`;
  } else if (row.intent === 'pour') {
    task = `Identify the bottle in the image(s) and match it to a row in the cabinet table above. If multiple cabinet rows could match, return all candidates with confidences. Use both front and back labels if provided.`;
  } else if (row.intent === 'enrich') {
    task = `Produce rich enrichment for the bottle described in "Bottle to enrich". Include tasting notes, food/cigar pairings, distillery background, region context, peak-band rationale, and serving recommendations. Use your knowledge of the producer/region/category.`;
  } else {
    task = `Unknown intent: ${row.intent}`;
  }

  return `${fm}

# Cabinet scan request

## Today
${todaySection(weather)}

${imagesSection}

${contextSection}

${cabinetSection}${bottleSection}## Task
${task}

## Response format

Write the response file at the path in \`respond_to\` with the following structure. Each block is JSON inside a fenced code block; use \`null\` for sections that don't apply to this intent.

\`\`\`markdown
---
request_id: ${row.id}
completed: <ISO timestamp>
---

## Extracted
(intent=add only — null otherwise)
\`\`\`json
{
  "producer": "...",
  "expression_name": "...",
  "category": "bourbon|rye|american_whiskey_other|scotch|irish_whiskey|japanese_whisky|world_whisky|tequila|mezcal|agave_other|rum|cognac|armagnac|brandy_other|gin|vodka|liqueur|other",
  "sub_type": "...",
  "spirit_type": "...",
  "age_statement": 12,
  "release_year": 2024,
  "region": "...",
  "country": "...",
  "mash_bill": { "grain": { "corn": 70, "rye": 21, "malt": 9 } },
  "proof": 90.4,
  "cask_type": "...",
  "cask_strength": false,
  "single_barrel": false,
  "finish": "Madeira finish, 18mo",
  "sweetness": "dry|off_dry|sweet",
  "intensity": 4,
  "confidence": "high|medium|low"
}
\`\`\`

## Match
(intent=pour only — null otherwise)
\`\`\`json
{
  "matched_bottle_id": "<uuid or null>",
  "match_candidates": [
    { "bottle_id": "<uuid>", "confidence": "high|medium|low", "reasoning": "..." }
  ]
}
\`\`\`

## Details
(intent=add or enrich — null for pour)
\`\`\`json
{
  "tasting_notes": { "nose": "...", "palate": "...", "finish": "..." },
  "food_pairings": ["...", "..."],
  "cigar_pairings": ["...", "..."],
  "producer_background": "...",
  "region_context": "...",
  "peak_band_rationale": "...",
  "serving": { "glassware": "Glencairn", "water_drops": 2, "open_early_min": 10 }
}
\`\`\`

## Narrative
<markdown — what you see on the label(s), what was hard to read, the Master-of-Spirits summary>
\`\`\`
`;
}
