import { sb } from './supabase-client.js';
import { suggestPeakWindow } from './spirit-types.js';

// All queries rely on RLS to scope by user_id; we still set user_id on insert.

export async function listBottles({ orderBy = 'created_at', ascending = false } = {}) {
  const { data, error } = await sb
    .from('bottles')
    .select('*')
    .order(orderBy, { ascending });
  if (error) throw error;
  return data;
}

export async function getBottle(id) {
  const { data, error } = await sb.from('bottles').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// Auto-fills peak_window_start/end from category+age_statement if user didn't
// set them. Spirits don't typically age in bottle, so the window opens at
// acquisition and stays open — see suggestPeakWindow() for the tier band.
// Sets peak_window_overridden=false in the auto case, true if user provided either.
export async function createBottle(input) {
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) throw new Error('Not signed in');

  const userOverrode = input.peak_window_start != null || input.peak_window_end != null;
  let { peak_window_start, peak_window_end } = input;

  if (!userOverrode) {
    const { start, end } = suggestPeakWindow({
      category: input.category,
      sub_type: input.sub_type,
      age_statement: input.age_statement,
    });
    peak_window_start = start;
    peak_window_end = end;
  }

  const row = {
    ...input,
    user_id: userData.user.id,
    peak_window_start,
    peak_window_end,
    peak_window_overridden: userOverrode,
  };

  const { data, error } = await sb.from('bottles').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateBottle(id, patch) {
  // If user touches peak window fields, flip the override flag.
  const touchesWindow = 'peak_window_start' in patch || 'peak_window_end' in patch;
  const finalPatch = touchesWindow ? { ...patch, peak_window_overridden: true } : patch;
  const { data, error } = await sb.from('bottles').update(finalPatch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBottle(id) {
  const { error } = await sb.from('bottles').delete().eq('id', id);
  if (error) throw error;
}

// Find an existing bottle that's the SAME expression (so a scan-add can offer
// "increment quantity" instead of creating a duplicate row). Different
// release_year or age_statement is treated as a different bottle. Falls back
// to category-match when expression_name is missing on either side.
export async function findDuplicate({ producer, expression_name, release_year, age_statement, category }) {
  if (!producer) return null;
  const norm = (s) => (s || '').trim().toLowerCase();
  const np = norm(producer);
  const ne = norm(expression_name);
  const nc = norm(category);
  const all = await listBottles();
  return all.find((b) => {
    if (norm(b.producer) !== np) return false;
    // Different age statement OR different release year = different bottle.
    if ((b.age_statement ?? null) !== (age_statement ?? null)) return false;
    if ((b.release_year  ?? null) !== (release_year  ?? null)) return false;
    const be = norm(b.expression_name);
    if (ne && be) return ne === be;
    if (!ne && !be) return norm(b.category) === nc;
    return false; // one has expression_name, other doesn't — treat as different
  }) || null;
}

// Tap-to-pour: -1 with quantity floor of 0.
export async function pourBottle(id) {
  const b = await getBottle(id);
  if (b.quantity <= 0) throw new Error('No bottles left to pour');
  return updateBottle(id, { quantity: b.quantity - 1 });
}

export async function undoPour(id) {
  const b = await getBottle(id);
  return updateBottle(id, { quantity: b.quantity + 1 });
}
