// Haalt de status van een Stripe Checkout Session op voor de "klaar"-pagina.
// Gebruikt de secret key server-side, zodat die nooit in de browser terechtkomt.

const Stripe = require('stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY ontbreekt in de omgeving.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Niet beschikbaar.' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;

  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'session_id ontbreekt.' }) };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: session.payment_status,
        email: session.customer_details ? session.customer_details.email : null,
        naam: session.customer_details ? session.customer_details.name : null,
        bedrag: session.amount_total,
        munt: session.currency,
      }),
    };
  } catch (err) {
    console.error('Stripe get-session error:', err);
    return { statusCode: 404, body: JSON.stringify({ error: 'Bestelling niet gevonden.' }) };
  }
};
