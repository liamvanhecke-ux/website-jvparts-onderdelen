// Maakt een Stripe Checkout Session aan op basis van de winkelmand.
// Prijzen worden NOOIT vertrouwd vanuit de browser: we zoeken ze hier
// opnieuw op in data/products.json, zodat een klant de prijs niet kan
// manipuleren via de browserconsole of een aangepaste request.
//
// De prijzen in data/products.json en de verzendkosten zijn btw-inclusief
// (de eindprijs die de klant betaalt), dus hier komt er niets meer bij.
//
// RESERVERING: zodra een klant op "Nu betalen" klikt, houden we de stuks
// 30 minuten voor hem vast. Zo kunnen 2 klanten nooit samen het laatste
// stuk betalen. Betaalt hij niet (annuleert of laat verlopen), dan komen
// de stuks automatisch terug vrij.

import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { zoekProduct, reserveer, annuleerReservering, reserveringen, json } from '../lib/voorraad.mjs';

const RESERVERING_MINUTEN = 30; // minimum dat Stripe toelaat voor expires_at

// Een vorige, onafgewerkte betaling van dezelfde klant opruimen (bv. hij
// ging terug met de knop van de browser), anders blokkeert hij zichzelf.
async function ruimVorigeBetalingOp(stripe, sessionId) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  try {
    const vorige = await stripe.checkout.sessions.retrieve(sessionId);
    if (vorige.status !== 'open') return;
    await stripe.checkout.sessions.expire(sessionId);
    await annuleerReservering(vorige.metadata && vorige.metadata.reservering);
  } catch (err) {
    console.warn('Vorige betaling opruimen mislukt (niet erg):', err.message);
  }
}

// Onze eigen methode-namen (zoals gebruikt in betalen.html) ->
// de payment_method_types die Stripe verwacht.
const METHODE_MAP = {
  bancontact: 'bancontact',
  ideal: 'ideal',
  creditcard: 'card',
  paypal: 'paypal',
};

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY ontbreekt in de omgeving.');
    return json(500, { error: 'Betalen is momenteel niet beschikbaar.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Ongeldige aanvraag.' });
  }

  const { cart, methode, klant, verzending, vorigeSessie } = payload || {};

  if (!Array.isArray(cart) || cart.length === 0) {
    return json(400, { error: 'Winkelmand is leeg.' });
  }

  const stripeMethode = METHODE_MAP[methode];
  if (!stripeMethode) {
    return json(400, { error: 'Onbekende betaalmethode.' });
  }

  await ruimVorigeBetalingOp(stripe, vorigeSessie);

  // 1) Controleren + regels opbouwen
  const lineItems = [];
  const items = [];
  for (const item of cart) {
    const product = zoekProduct(item.id);
    if (!product) {
      return json(400, { error: `Onbekend product: ${item.id}` });
    }
    const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));

    if (items.some((i) => i.id === item.id)) continue; // dubbel in mand
    items.push({ id: item.id, qty, naam: product.name });
    const prijs = parseFloat(String(product.price).replace(',', '.')) || 0;

    lineItems.push({
      quantity: qty,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(prijs * 100),
        // metadata.id: zo weet de webhook welk product verkocht is.
        product_data: { name: product.name, metadata: { id: item.id } },
      },
    });
  }

  const verzendPrijs = Math.max(0, parseFloat(verzending) || 0);
  if (verzendPrijs > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(verzendPrijs * 100),
        product_data: { name: 'Verzendkosten' },
      },
    });
  }

  // 2) Stuks reserveren (alles of niets)
  const rid = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + RESERVERING_MINUTEN * 60;
  const tot = (expiresAt + 120) * 1000; // 2 min marge na het sluiten van de betaalpagina
  try {
    await reserveringen().setJSON(rid, { items, tot });
    for (const item of items) {
      const res = await reserveer(item.id, rid, item.qty, tot);
      if (!res.ok) {
        await annuleerReservering(rid);
        return json(409, {
          error: res.beschikbaar === 0
            ? `${item.naam} is net uitverkocht of wordt nu door iemand anders betaald.`
            : `Er zijn nog maar ${res.beschikbaar} stuks van ${item.naam} beschikbaar.`,
          code: 'voorraad',
          product: item.naam,
          beschikbaar: res.beschikbaar,
          gereserveerd: res.gereserveerd,
        });
      }
    }
  } catch (err) {
    console.error('Reserveren mislukt:', err);
    await annuleerReservering(rid).catch(() => {});
    return json(503, { error: 'Voorraad kon niet gecontroleerd worden. Probeer opnieuw.' });
  }

  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const klantData = klant || {};

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: expiresAt,
      payment_method_types: [stripeMethode],
      line_items: lineItems,
      customer_email: klantData.email || undefined,
      success_url: `${origin}/klaar.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/betalen.html?geannuleerd={CHECKOUT_SESSION_ID}`,
      metadata: {
        reservering: rid,
        naam: [klantData.voornaam, klantData.achternaam].filter(Boolean).join(' '),
        telefoon: klantData.telefoon || '',
        adres: [
          [klantData.straat, klantData.huisnr].filter(Boolean).join(' '),
          [klantData.postcode, klantData.gemeente].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', '),
        land: klantData.land || '',
        opmerking: klantData.opmerking || '',
      },
    });

    return json(200, { url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    await annuleerReservering(rid).catch(() => {});
    return json(500, { error: 'Kon geen betaling starten. Probeer opnieuw.' });
  }
};
