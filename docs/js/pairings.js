import { createRequest, waitForResponse } from './pairing-bus.js';

// Pair with food. Cabinet expanded the single 'pairing' request_type into
// three: pair_food / pair_cigar / pair_occasion (food/cigar/occasion).
export async function requestFoodPairing({ dish, guests, occasion, constraints }) {
  const req = await createRequest({
    requestType: 'pair_food',
    context: { dish, guests, occasion, constraints },
  });
  return { request: req, response: await waitForResponse(req.id) };
}

export async function requestCigarPairing({ cigar, guests, occasion, constraints }) {
  const req = await createRequest({
    requestType: 'pair_cigar',
    context: { cigar, guests, occasion, constraints },
  });
  return { request: req, response: await waitForResponse(req.id) };
}

export async function requestOccasionPairing({ occasion, guests, constraints }) {
  const req = await createRequest({
    requestType: 'pair_occasion',
    context: { occasion, guests, constraints },
  });
  return { request: req, response: await waitForResponse(req.id) };
}

export async function requestFlight({ theme, guests, length, food, notes }) {
  const req = await createRequest({
    requestType: 'flight',
    context: {
      theme,
      guests,
      length,
      food:  food  || null,
      notes: notes || null,
    },
  });
  return { request: req, response: await waitForResponse(req.id) };
}

// Ask the Master of Spirits for 1–2 bottles NOT in the cabinet that would
// expand flight-building potential. Recommendations array stays empty (those
// picks aren't owned); the actual suggestions live in the narrative.
export async function requestFlightExtras({ themeHint }) {
  const req = await createRequest({
    requestType: 'flight',
    context: { kind: 'extras', theme_hint: themeHint || null },
  });
  return { request: req, response: await waitForResponse(req.id) };
}

export async function requestPourTonight({ notes }) {
  const req = await createRequest({
    requestType: 'pour_tonight',
    context: { notes: notes || null },
  });
  return { request: req, response: await waitForResponse(req.id) };
}
