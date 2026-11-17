// Bron van de producten voor de server (Netlify-functies).
//
// - Supabase (tabel `producten`) = de echte bron, gelezen met de publieke sleutel.
//   Omgevingsvariabelen: SUPABASE_URL en SUPABASE_ANON_KEY.
// - data/products.json           = reserve als Supabase niet bereikbaar is of
//   de omgevingsvariabelen ontbreken.
//
// De producten komen terug in de "oude vorm" van products.json (name, price
// als tekst "34,95", stock, condition, ...) PLUS `id`. Zie database/CONTRACT.md.

import data from '../../data/products.json' with { type: 'json' };

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Reserve: products.json heeft geen `id`, daar is het ID slugify(name).
export const reserveProducten = (data.products || []).map((p) => ({ ...p, id: p.id || slugify(p.name) }));

const CACHE_MS = 60 * 1000;      // zo lang is een geslaagd antwoord van Supabase geldig
const FOUT_CACHE_MS = 15 * 1000; // na een fout: zo lang niet opnieuw proberen (anders wacht elke aanroep op de time-out)
const TIMEOUT_MS = 4000;

// Cache op module-niveau: Netlify kan dezelfde functie-instantie hergebruiken
// voor meerdere aanvragen, dan blijft deze cache tussen de aanvragen bestaan.
// Een prijswijziging in het beheer is dus pas na maximaal 60 s zichtbaar voor de server.
let cache = null;        // { producten, tot, bron: 'supabase' | 'vorige' | 'reserve' }
let laatsteGoed = null;  // laatste geslaagde lijst uit Supabase (ook als de cache verlopen is)
let bezig = null;        // lopende aanvraag, zodat gelijktijdige aanroepen samen wachten

const tekst = (v) => (v === null || v === undefined ? '' : String(v));

function fotoUrl(basis, pad) {
  if (!pad) return '';
  if (/^(https?:)?\//i.test(pad) || /^http/i.test(pad)) return pad;
  return `${basis}/storage/v1/object/public/productfotos/${pad}`;
}

// Rij uit de database -> product in de oude vorm. null = rij overslaan.
function naarOudeVorm(rij, basis) {
  if (!rij || typeof rij.id !== 'string' || !rij.id || rij.actief === false) return null;
  const prijs = typeof rij.prijs === 'number' ? rij.prijs : parseFloat(rij.prijs);
  if (!Number.isFinite(prijs) || prijs < 0) {
    console.warn(`Product ${rij.id} overgeslagen: ongeldige prijs.`);
    return null;
  }
  const cat = rij.categorie || {};
  const p = {
    id: rij.id,
    name: tekst(rij.naam),
    name_fr: tekst(rij.naam_fr),
    name_de: tekst(rij.naam_de),
    subtitle: tekst(rij.subtitel),
    subtitle_fr: tekst(rij.subtitel_fr),
    subtitle_de: tekst(rij.subtitel_de),
    price: prijs.toFixed(2).replace('.', ','),
    category: tekst(cat.naam),
    category_fr: tekst(cat.naam_fr),
    category_de: tekst(cat.naam_de),
    condition: tekst(rij.staat),
    image: fotoUrl(basis, rij.foto_pad),
    beschrijving: tekst(rij.beschrijving),
    beschrijving_fr: tekst(rij.beschrijving_fr),
    beschrijving_de: tekst(rij.beschrijving_de),
  };
  // start_voorraad null = geen "stock"-veld = onbeperkt.
  if (rij.start_voorraad !== null && rij.start_voorraad !== undefined) p.stock = rij.start_voorraad;
  return p;
}

async function haalUitSupabase(url, sleutel) {
  const basis = url.replace(/\/+$/, '');
  // Enkel actieve producten: een inactief product kan dus niet gekocht worden.
  const res = await fetch(
    `${basis}/rest/v1/producten?select=*,categorie:categorieen(naam,naam_fr,naam_de)&actief=eq.true&order=volgorde.asc,naam.asc`,
    { headers: { apikey: sleutel }, signal: AbortSignal.timeout(TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`Supabase antwoordde met status ${res.status}`);
  const rijen = await res.json();
  if (!Array.isArray(rijen)) throw new Error('Onverwacht antwoord van Supabase');
  return rijen.map((r) => naarOudeVorm(r, basis)).filter(Boolean);
}

// Alle (actieve) producten. Gooit nooit: bij een probleem komt de reserve terug.
export async function haalProducten() {
  const nu = Date.now();
  if (cache && cache.tot > nu) return cache.producten;
  if (bezig) return bezig;

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('SUPABASE_URL of SUPABASE_ANON_KEY ontbreekt: producten komen uit data/products.json.');
    cache = { producten: reserveProducten, tot: nu + CACHE_MS, bron: 'reserve' };
    return cache.producten;
  }

  bezig = (async () => {
    try {
      const producten = await haalUitSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
      laatsteGoed = producten;
      cache = { producten, tot: Date.now() + CACHE_MS, bron: 'supabase' };
    } catch (err) {
      // Eerst de laatste geslaagde lijst uit Supabase (juistere prijzen dan het
      // reservebestand), anders data/products.json.
      const producten = laatsteGoed || reserveProducten;
      console.warn(
        `Producten ophalen uit Supabase mislukt (${err && err.message}): ` +
        (laatsteGoed ? 'de vorige lijst wordt verder gebruikt.' : 'producten komen uit data/products.json.')
      );
      cache = { producten, tot: Date.now() + FOUT_CACHE_MS, bron: laatsteGoed ? 'vorige' : 'reserve' };
    } finally {
      bezig = null;
    }
    return cache.producten;
  })();
  return bezig;
}

// true als de prijzen uit Supabase komen (nu of bij de vorige geslaagde
// aanvraag). false = ze komen uit data/products.json, dat het beheer NIET
// bijwerkt: dan mag er niet afgerekend worden (verkeerde prijs, of een product
// dat intussen uit de winkel is). Roep eerst haalProducten() aan.
export function prijzenBetrouwbaar() {
  return !!cache && cache.bron !== 'reserve';
}

// Enkel voor tests: cache leegmaken.
export function wisProductenCache() {
  cache = null;
  laatsteGoed = null;
  bezig = null;
}
