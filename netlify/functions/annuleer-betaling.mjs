// Klant klikt op "terug" op de Stripe-betaalpagina: we sluiten die betaling
// meteen af en geven de gereserveerde stuks vrij (i.p.v. 30 min te wachten).
// POST { sessionId: "cs_..." }

import Stripe from 'stripe';
import { annuleerReservering, json } from '../lib/voorraad.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Niet geconfigureerd.' });

  let sessionId;
  try { ({ sessionId } = await req.json()); } catch { return json(400, { error: 'Ongeldige aanvraag.' }); }
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json(400, { error: 'Ongeldige sessie.' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== 'open') return json(200, { ok: true, status: session.status });
    await stripe.checkout.sessions.expire(sessionId);
    await annuleerReservering(session.metadata && session.metadata.reservering);
    return json(200, { ok: true, status: 'expired' });
  } catch (err) {
    console.error('Annuleren mislukt:', err);
    return json(500, { error: 'Annuleren mislukt.' }); // reservering verloopt dan vanzelf
  }
};
