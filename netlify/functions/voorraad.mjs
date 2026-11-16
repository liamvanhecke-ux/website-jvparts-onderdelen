// GET  /.netlify/functions/voorraad  -> { voorraad: { id: { stock, gereserveerd, beschikbaar } } }  (publiek)
//      stock = fysiek aantal, beschikbaar = stock - lopende betalingen. null = onbeperkt.
// POST /.netlify/functions/voorraad  -> voorraad instellen                 (enkel admin)
//      body: { voorraad: { "cilinder-50cc": 4, ... } }
//      Toegang: ingelogd via Supabase Auth EN in de tabel `beheerders` (beheer in /jv-werkbank).
//      De browser stuurt het token mee als `Authorization: Bearer <access_token>`.

import { leesAlles, zet, zoekProduct, json } from '../lib/voorraad.mjs';

async function isAdmin(req) {
  // Supabase: (1) is dit token geldig? (2) staat deze gebruiker in `beheerders`?
  // Zonder omgevingsvariabelen is niemand beheerder.
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) return false;
  const basis = SUPABASE_URL.replace(/\/+$/, '');
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: auth };
  try {
    const wie = await fetch(`${basis}/auth/v1/user`, { headers, signal: AbortSignal.timeout(5000) });
    if (wie.status !== 200) return false;
    const gebruiker = await wie.json();
    if (!gebruiker || !gebruiker.id) return false;

    // De beveiliging (RLS) geeft enkel de eigen rij terug; we controleren het toch nog eens zelf.
    const res = await fetch(`${basis}/rest/v1/beheerders?select=user_id`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const rijen = await res.json();
    return Array.isArray(rijen) && rijen.some((r) => r && r.user_id === gebruiker.id);
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
    if (!(await zoekProduct(id))) fouten.push(`Onbekend product: ${id}.`);
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
