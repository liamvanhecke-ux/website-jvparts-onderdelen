// GET  /.netlify/functions/voorraad  -> { voorraad: { id: { stock, gereserveerd, beschikbaar } } }  (publiek)
//      stock = fysiek aantal, beschikbaar = stock - lopende betalingen. null = onbeperkt.
// POST /.netlify/functions/voorraad  -> voorraad instellen                 (enkel admin)
//      body: { voorraad: { "cilinder-50cc": 4, ... } }
//      Toegang: ingelogd via Netlify Identity (voorraadpagina in /admin)

import { leesAlles, zet, zoekProduct, json } from '../lib/voorraad.mjs';

async function isAdmin(req) {
  // Netlify Identity: vraag aan Identity zelf of dit token geldig is.
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const res = await fetch(new URL(req.url).origin + '/.netlify/identity/user', {
      headers: { Authorization: auth },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method === 'GET') {
    try {
      return json(200, { voorraad: await leesAlles() });
    } catch (err) {
      console.error('Voorraad lezen mislukt:', err);
      return json(500, { error: 'Voorraad niet beschikbaar.' });
    }
  }

  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!(await isAdmin(req))) return json(401, { error: 'Niet ingelogd als beheerder.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON.' }); }
  const wijzigingen = (body && body.voorraad) || {};

  const fouten = [];
  for (const [id, aantal] of Object.entries(wijzigingen)) {
    if (!zoekProduct(id)) fouten.push(`Onbekend product: ${id}.`);
    if (!Number.isInteger(aantal) || aantal < 0) fouten.push(`${id}: aantal moet een heel getal ≥ 0 zijn.`);
  }
  if (fouten.length) return json(400, { error: fouten.join(' ') });

  try {
    const resultaat = {};
    for (const [id, aantal] of Object.entries(wijzigingen)) {
      resultaat[id] = (await zet(id, aantal)).na || null;
    }
    return json(200, { ok: true, resultaat, voorraad: await leesAlles() });
  } catch (err) {
    console.error('Voorraad instellen mislukt:', err);
    return json(500, { error: 'Opslaan mislukt, probeer opnieuw.' });
  }
};
