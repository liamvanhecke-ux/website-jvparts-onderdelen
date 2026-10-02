// Stripe roept deze functie aan na een betaling:
// - betaald             -> reservering wordt een verkoop (voorraad −)
// - verlopen/mislukt    -> gereserveerde stuks komen terug vrij
//
// Instellen in Stripe (Developers → Webhooks → Add endpoint):
//   URL:     https://<jouw-site>/.netlify/functions/stripe-webhook
//   Events:  checkout.session.completed
//            checkout.session.async_payment_succeeded
//            checkout.session.async_payment_failed
//            checkout.session.expired
// Zet daarna het "Signing secret" (whsec_...) als STRIPE_WEBHOOK_SECRET
// in Netlify (Site configuration → Environment variables).

import Stripe from 'stripe';
import { bevestig, bestellingen, reserveringen, annuleerReservering } from '../lib/voorraad.mjs';

const tekst = (status, body) => new Response(body, { status });

export default async (req) => {
  if (req.method !== 'POST') return tekst(405, 'Method Not Allowed');

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_SECRET_KEY of STRIPE_WEBHOOK_SECRET ontbreekt.');
    return tekst(500, 'Niet geconfigureerd');
  }
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  // Handtekening controleren: zo weten we zeker dat het echt Stripe is.
  const ruweBody = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(ruweBody, req.headers.get('stripe-signature'), STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Ongeldige webhook-handtekening:', err.message);
    return tekst(400, 'Ongeldige handtekening');
  }

  const session = event.data.object;
  const rid = session.metadata && session.metadata.reservering;

  // Niet betaald en afgesloten: stuks terug vrijgeven.
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    try {
      await annuleerReservering(rid);
      return tekst(200, 'Reservering vrijgegeven');
    } catch (err) {
      console.error('Reservering vrijgeven mislukt:', err);
      return tekst(500, 'Fout'); // Stripe probeert later opnieuw
    }
  }

  const relevant = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (!relevant.includes(event.type)) return tekst(200, 'Genegeerd');

  if (session.payment_status !== 'paid') {
    return tekst(200, 'Nog niet betaald'); // komt later terug via async_payment_succeeded
  }

  try {
    const regels = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ['data.price.product'],
    });
    const items = regels.data
      .map((r) => ({ id: r.price?.product?.metadata?.id, qty: r.quantity || 1 }))
      .filter((i) => i.id); // verzendkosten hebben geen id

    // Stripe kan een event meerdere keren sturen (of opnieuw proberen na een
    // fout). We houden per bestelling bij welke producten al afgeteld zijn,
    // zodat niets dubbel of te weinig afgeteld wordt.
    const store = bestellingen();
    let bestelling = await store.get(session.id, { type: 'json' });
    if (!bestelling) {
      bestelling = {
        datum: new Date().toISOString(),
        email: session.customer_details?.email || null,
        bedrag: session.amount_total,
        items,
        verwerkt: [],
      };
      const res = await store.setJSON(session.id, bestelling, { onlyIfNew: true });
      if (!res.modified) bestelling = await store.get(session.id, { type: 'json' });
    }

    for (const item of items) {
      if (bestelling.verwerkt.includes(item.id)) continue;
      const res = await bevestig(item.id, rid, item.qty);
      if (res.voor && res.voor.stock < item.qty) {
        console.warn(`LET OP: ${item.id} oververkocht (voorraad ${res.voor.stock}, besteld ${item.qty}).`);
      }
      bestelling.verwerkt.push(item.id);
      await store.setJSON(session.id, bestelling);
    }
    if (rid) await reserveringen().delete(rid);
    return tekst(200, 'OK');
  } catch (err) {
    console.error('Webhook verwerken mislukt:', err);
    return tekst(500, 'Fout'); // Stripe probeert het later opnieuw
  }
};
