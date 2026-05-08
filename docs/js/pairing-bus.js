// Shared transport for pairing_requests / pairing_responses round-trips.
// Pulled out of pairings.js so planned-flights.js can reuse it without
// duplicating the realtime subscription dance.

import { sb } from './supabase-client.js';
import { listBottles } from './bottles.js';

// Strip fields the AI doesn't need (acquired_price especially — see STRATEGY).
function snapshotForBridge(bottles) {
  return bottles.map((b) => ({
    id: b.id,
    producer: b.producer,
    expression_name: b.expression_name,
    category: b.category,
    sub_type: b.sub_type,
    spirit_type: b.spirit_type,
    age_statement: b.age_statement,
    release_year: b.release_year,
    region: b.region,
    country: b.country,
    mash_bill: b.mash_bill,
    proof: b.proof,
    cask_type: b.cask_type,
    cask_strength: b.cask_strength,
    single_barrel: b.single_barrel,
    finish: b.finish,
    sweetness: b.sweetness,
    intensity: b.intensity,
    quantity: b.quantity,
    peak_window_start: b.peak_window_start,
    peak_window_end: b.peak_window_end,
  }));
}

// Most request types want the full cabinet snapshot; flight_plan operates
// only on bottles already chosen, so we let callers pass an empty snapshot
// to avoid hauling the whole cabinet through the watcher prompt.
export async function createRequest({ requestType, context, includeCabinet = true }) {
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) throw new Error('Not signed in');

  let snapshot = [];
  if (includeCabinet) {
    const bottles = await listBottles();
    if (!bottles.length) throw new Error('Cabinet is empty — add bottles before requesting suggestions.');
    snapshot = snapshotForBridge(bottles);
  }

  const { data, error } = await sb.from('pairing_requests').insert({
    user_id: userData.user.id,
    request_type: requestType,
    context,
    cabinet_snapshot: snapshot,
  }).select().single();
  if (error) throw error;
  return data;
}

// Wait for a pairing_response row matching this request_id. Resolves with the
// response, or rejects on timeout / status='error'.
export function waitForResponse(requestId, { timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, val) => { if (done) return; done = true; clearTimeout(timer); channel.unsubscribe(); fn(val); };

    const timer = setTimeout(() => finish(reject, new Error('Timed out waiting for response (5 min).')), timeoutMs);

    const channel = sb.channel(`pairing-resp-${requestId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pairing_responses', filter: `request_id=eq.${requestId}` },
        ({ new: row }) => finish(resolve, row))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pairing_requests', filter: `id=eq.${requestId}` },
        ({ new: row }) => { if (row.status === 'error') finish(reject, new Error(row.error_message || 'Request failed.')); })
      .subscribe(async (status) => {
        // After subscribing, check if the response already arrived (race).
        if (status === 'SUBSCRIBED') {
          const { data: existing } = await sb.from('pairing_responses').select('*').eq('request_id', requestId).maybeSingle();
          if (existing) finish(resolve, existing);
        }
      });
  });
}
