// Spirit taxonomy + maturation guidance.
//
// Replaces the wine-specific varietal-windows.js. Hard spirits don't
// improve in the bottle the way wine does, so "peak_window" semantics
// shift: for most categories the window opens at acquisition and stays
// open indefinitely. Where cask-age tiers exist (bourbon, scotch) we
// surface a guidance band based on the age statement.
//
// Sources: distillery technical sheets, Whisky Advocate, Difford's,
// Mezcalistas, BTAC tasting notes. Entries marked `// TODO confirm`
// are educated guesses.

// ── Categories (DB enum) ─────────────────────────────────────────
export const SPIRIT_CATEGORIES = [
  { key: 'bourbon',                  label: 'Bourbon' },
  { key: 'rye',                      label: 'Rye' },
  { key: 'american_whiskey_other',   label: 'American Whiskey (Other)' },
  { key: 'scotch',                   label: 'Scotch' },
  { key: 'irish_whiskey',            label: 'Irish Whiskey' },
  { key: 'japanese_whisky',          label: 'Japanese Whisky' },
  { key: 'world_whisky',             label: 'World Whisky' },
  { key: 'tequila',                  label: 'Tequila' },
  { key: 'mezcal',                   label: 'Mezcal' },
  { key: 'agave_other',              label: 'Agave (Other)' },
  { key: 'rum',                      label: 'Rum' },
  { key: 'cognac',                   label: 'Cognac' },
  { key: 'armagnac',                 label: 'Armagnac' },
  { key: 'brandy_other',             label: 'Brandy (Other)' },
  { key: 'gin',                      label: 'Gin' },
  { key: 'vodka',                    label: 'Vodka' },
  { key: 'liqueur',                  label: 'Liqueur' },
  { key: 'other',                    label: 'Other' },
];

export const CATEGORY_KEYS = SPIRIT_CATEGORIES.map(c => c.key);

// ── Sub-types per category ───────────────────────────────────────
export const SPIRIT_SUBTYPES = {
  bourbon: [
    'straight', 'wheated', 'high_rye', 'bottled_in_bond',
    'single_barrel', 'small_batch', 'cask_strength', 'finished',
  ],
  rye: [
    'straight', 'bottled_in_bond', 'single_barrel', 'small_batch',
    'cask_strength', 'canadian_style', 'finished',
  ],
  american_whiskey_other: [
    'tennessee', 'wheat_whiskey', 'malt_whiskey', 'light_whiskey',
    'corn_whiskey', 'blended', 'craft_other',
  ],
  scotch: [
    'single_malt', 'blended_malt', 'blended', 'single_grain', 'blended_grain',
  ],
  irish_whiskey: [
    'single_pot_still', 'single_malt', 'single_grain', 'blended',
  ],
  japanese_whisky: [
    'single_malt', 'blended_malt', 'blended', 'single_grain',
  ],
  world_whisky: [
    'canadian', 'indian', 'taiwanese', 'australian', 'european_other',
  ],
  tequila: [
    'blanco', 'reposado', 'anejo', 'extra_anejo', 'cristalino', 'joven',
  ],
  mezcal: [
    'joven', 'reposado', 'anejo', 'ancestral', 'artesanal', 'pechuga',
  ],
  agave_other: ['raicilla', 'sotol', 'bacanora', 'other'],
  rum: [
    'white', 'gold', 'aged', 'dark', 'agricole', 'navy', 'overproof',
    'spiced', 'pot_still', 'column_still', 'blended_still',
  ],
  cognac: ['vs', 'vsop', 'napoleon', 'xo', 'xxo', 'hors_d_age'],
  armagnac: ['vs', 'vsop', 'xo', 'hors_d_age', 'vintage', 'blanche'],
  brandy_other: [
    'american', 'spanish', 'pisco', 'fruit_brandy', 'eau_de_vie', 'grappa', 'calvados',
  ],
  gin: ['cask_aged', 'navy_strength', 'old_tom', 'genever', 'craft_other'],
  vodka: ['craft', 'flavored', 'other'],
  liqueur: [
    'herbal', 'amaro', 'fruit', 'cream', 'nut', 'coffee', 'chartreuse', 'other',
  ],
  other: ['other'],
};

// ── Regions per category ─────────────────────────────────────────
export const SPIRIT_REGIONS = {
  bourbon: ['Kentucky', 'Tennessee', 'Indiana (MGP)', 'Texas', 'New York', 'Other US'],
  rye:     ['Kentucky', 'Indiana (MGP)', 'Pennsylvania', 'Maryland', 'Canada', 'Other US'],
  american_whiskey_other: ['Tennessee', 'Kentucky', 'Texas', 'California', 'Pacific Northwest', 'Other US'],
  scotch: ['Speyside', 'Islay', 'Highland', 'Lowland', 'Campbeltown', 'Islands'],
  irish_whiskey: ['Republic of Ireland', 'Northern Ireland'],
  japanese_whisky: ['Honshu', 'Hokkaido', 'Kyushu'],
  world_whisky: ['Canada', 'India', 'Taiwan', 'Australia', 'France', 'Sweden', 'Other'],
  tequila: ['Jalisco Highlands (Los Altos)', 'Jalisco Valley', 'Nayarit', 'Guanajuato', 'Michoacán', 'Tamaulipas'],
  mezcal:  ['Oaxaca', 'Durango', 'Michoacán', 'Guerrero', 'San Luis Potosí', 'Puebla', 'Zacatecas'],
  agave_other: ['Jalisco', 'Chihuahua', 'Sonora', 'Durango', 'Other'],
  rum: ['Jamaica', 'Barbados', 'Cuba', 'Martinique', 'Guyana', 'Venezuela', 'Trinidad', 'Puerto Rico', 'Dominican Republic', 'Nicaragua', 'Other'],
  cognac: ['Grande Champagne', 'Petite Champagne', 'Borderies', 'Fins Bois', 'Bons Bois', 'Bois Ordinaires'],
  armagnac: ['Bas-Armagnac', 'Ténarèze', 'Haut-Armagnac'],
  brandy_other: ['California', 'Spain (Jerez)', 'Peru', 'Chile', 'Italy', 'Normandy', 'Germany', 'Other'],
  gin: ['England', 'Scotland', 'Netherlands', 'United States', 'Other'],
  vodka: ['Russia', 'Poland', 'France', 'United States', 'Other'],
  liqueur: ['France', 'Italy', 'Germany', 'United States', 'Other'],
  other: [],
};

// ── Maturation guidance ──────────────────────────────────────────
// `cask_peak_years`: ideal cask-age band the age_statement should fall in.
// `bottle_aging`: 'none' (no benefit, default for spirits), 'mild', 'beneficial'.
// `note`: short collector-facing guidance string.
export const MATURATION_GUIDANCE = {
  bourbon: {
    cask_peak_years: [6, 12],
    cask_plateau_years: [12, 18],
    cask_over_years: 20,
    bottle_aging: 'none',
    note: 'Bourbon peaks 6–12yr in cask; 12–18yr is a plateau; >20yr risks over-oaking. No bottle aging.',
  },
  rye: {
    cask_peak_years: [4, 10],
    cask_plateau_years: [10, 15],
    cask_over_years: 18,
    bottle_aging: 'none',
    note: 'Rye peaks 4–10yr; older ryes (15+) trade vibrancy for depth. No bottle aging.',
  },
  american_whiskey_other: {
    cask_peak_years: [4, 10],
    cask_plateau_years: [10, 15],
    cask_over_years: 18,
    bottle_aging: 'none',
    note: 'American whiskey peak depends on style; most show best at 4–10yr cask age.',
  },
  scotch: {
    cask_peak_years: [10, 18],
    cask_plateau_years: [18, 25],
    cask_over_years: 35,
    bottle_aging: 'none',
    note: 'Scotch single malt typical window 10–18yr; >25yr is "trophy" tier (dramatic price/quality curve).',
  },
  irish_whiskey: {
    cask_peak_years: [8, 16],
    cask_plateau_years: [16, 22],
    cask_over_years: 28,
    bottle_aging: 'none',
    note: 'Irish whiskey peaks 8–16yr; older expressions tilt heavily toward cask character.',
  },
  japanese_whisky: {
    cask_peak_years: [10, 18],
    cask_plateau_years: [18, 25],
    cask_over_years: 30,
    bottle_aging: 'none',
    note: 'Japanese whisky peaks 10–18yr; aged stocks scarce — older bottlings often collector-grade.',
  },
  world_whisky: {
    cask_peak_years: [4, 12],
    cask_plateau_years: [12, 18],
    cask_over_years: 22,
    bottle_aging: 'none',
    note: 'World whiskies vary widely by climate; tropical-aged spirits mature 2–3× faster than Scotland.',
  },
  tequila: {
    cask_peak_years: [0, 3],
    cask_plateau_years: [3, 5],
    cask_over_years: 7,
    bottle_aging: 'none',
    note: 'Tequila is bottled at peak; no in-bottle aging. Blanco best fresh; añejo/extra-añejo trade agave for oak.',
  },
  mezcal: {
    cask_peak_years: [0, 1],
    cask_plateau_years: [1, 3],
    cask_over_years: 5,
    bottle_aging: 'none',
    note: 'Mezcal traditionally drunk joven; cask-aged mezcal masks agave/smoke character — purists prefer young.',
  },
  agave_other: {
    cask_peak_years: [0, 2],
    bottle_aging: 'none',
    note: 'Agave spirits (raicilla/sotol/bacanora) are typically unaged. Drink fresh.',
  },
  rum: {
    cask_peak_years: [5, 15],
    cask_plateau_years: [15, 25],
    cask_over_years: 30,
    bottle_aging: 'mild',
    note: 'Tropical-aged rum matures fast (1yr ≈ 3yr Scotland). Peak 5–15yr; check for solera/blended ages.',
  },
  cognac: {
    cask_peak_years: [10, 30],
    cask_plateau_years: [30, 50],
    bottle_aging: 'none',
    note: 'Cognac VSOP→XO→XXO reflect cask years (VSOP ≥4, XO ≥10, XXO ≥14). No bottle aging.',
  },
  armagnac: {
    cask_peak_years: [10, 30],
    cask_plateau_years: [30, 50],
    bottle_aging: 'none',
    note: 'Armagnac vintage-dated; can be remarkable at 30–50yr cask. No bottle aging.',
  },
  brandy_other: {
    cask_peak_years: [3, 15],
    bottle_aging: 'none',
    note: 'Brandy maturation varies by style; check producer notes.',
  },
  gin: {
    cask_peak_years: [0, 3],
    bottle_aging: 'none',
    note: 'Gin is bottled at peak; cask-aged gins sit briefly (months–years). Drink fresh.',
  },
  vodka: {
    cask_peak_years: [0, 0],
    bottle_aging: 'none',
    note: 'Vodka is bottled at peak. No aging benefit.',
  },
  liqueur: {
    cask_peak_years: [0, 5],
    bottle_aging: 'mild',
    note: 'Liqueurs mostly stable; some (Chartreuse, Bénédictine) develop in bottle over decades.',
  },
  other: {
    cask_peak_years: null,
    bottle_aging: 'none',
    note: 'No maturation guidance available.',
  },
};

// ── Helpers ──────────────────────────────────────────────────────
export function categoryLabel(key) {
  const c = SPIRIT_CATEGORIES.find(c => c.key === key);
  return c ? c.label : key;
}

export function lookupGuidance(category) {
  return MATURATION_GUIDANCE[category] || null;
}

// Suggest a peak window for the bottle. For spirits, the window is
// typically "always open" once bottled, but we surface a flag when the
// bottle's age statement falls outside the cask peak band so collectors
// know whether they're holding a young/peak/over-aged expression.
//
// Returns { start, end, tier, note } where:
//   - start/end: years from acquisition (default 0..50; spirits don't
//     change in bottle). Used to keep schema parity with mycellar.
//   - tier: 'young' | 'peak' | 'plateau' | 'over' | 'unknown'
//   - note: human-readable guidance from MATURATION_GUIDANCE.
export function suggestPeakWindow({ category, sub_type, age_statement }) {
  const g = lookupGuidance(category);
  if (!g) return { start: 0, end: 50, tier: 'unknown', note: null };

  let tier = 'unknown';
  if (typeof age_statement === 'number' && g.cask_peak_years) {
    const [pStart, pEnd] = g.cask_peak_years;
    if (age_statement < pStart) tier = 'young';
    else if (age_statement <= pEnd) tier = 'peak';
    else if (g.cask_plateau_years && age_statement <= g.cask_plateau_years[1]) tier = 'plateau';
    else if (g.cask_over_years && age_statement >= g.cask_over_years) tier = 'over';
    else tier = 'plateau';
  }

  return { start: 0, end: 50, tier, note: g.note };
}

// Convenience: list of all category keys for filter chips, sorted by
// the canonical taxonomy order (not alphabetical).
export const CATEGORY_NAMES = SPIRIT_CATEGORIES.map(c => c.label);
