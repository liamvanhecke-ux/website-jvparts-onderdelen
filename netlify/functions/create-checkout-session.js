// Maakt een Stripe Checkout Session aan op basis van de winkelmand.
// Prijzen worden NOOIT vertrouwd vanuit de browser: we zoeken ze hier
// opnieuw op in data/products.json, zodat een klant de prijs niet kan
// manipuleren via de browserconsole of een aangepaste request.

const Stripe = require('stripe');
const producten = require('../../data/products.json').products;

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Onze eigen methode-namen (zoals gebruikt in betalen.html) ->
// de payment_method_types die Stripe verwacht.
const METHODE_MAP = {
  bancontact: 'bancontact',
  ideal: 'ideal',
  creditcard: 'card',
  paypal: 'paypal',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY ontbreekt in de omgeving.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Betalen is momenteel niet beschikbaar.' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ongeldige aanvraag.' }) };
  }

  const { cart, methode, klant, verzending } = payload;

  if (!Array.isArray(cart) || cart.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Winkelmand is leeg.' }) };
  }

  const stripeMethode = METHODE_MAP[methode];
  if (!stripeMethode) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Onbekende betaalmethode.' }) };
  }

  const lineItems = [];
  for (const item of cart) {
    const product = producten.find((p) => slugify(p.name) === item.id);
    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: `Onbekend product: ${item.id}` }) };
    }
    const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
    const prijs = parseFloat(String(product.price).replace(',', '.')) || 0;

    lineItems.push({
      quantity: qty,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(prijs * 100),
        product_data: { name: product.name },
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

  const origin = event.headers.origin || `https://${event.headers.host}`;
  const klantData = klant || {};

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: [stripeMethode],
      line_items: lineItems,
      customer_email: klantData.email || undefined,
      success_url: `${origin}/klaar.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/betalen.html`,
      metadata: {
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Kon geen betaling starten. Probeer opnieuw.' }) };
  }
};
