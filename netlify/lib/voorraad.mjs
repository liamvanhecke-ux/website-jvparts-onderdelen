// Live voorraad in Netlify Blobs.
//
// - data/products.json  = productinfo + STARTvoorraad (voor een nieuw product)
// - Netlify Blobs       = de echte, live voorraad per product (key = product-ID)
//
// Heeft een product nog geen blob, dan geldt de "stock" uit products.json.
// Vanaf de eerste verkoop of aanpassing via de voorraadpagina staat het
// actuele aantal in Blobs. Een product zonder "stock"-veld = onbeperkt (null).

import { getStore } from '@netlify/blobs';
import data from '../../data/products.json' with { type: 'json' };

export const producten = data.products || [];

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function zoekProduct(id) {
  return producten.find((p) => slugify(p.name) === id) || null;
}

function startVoorraad(p) {
  if (!p || p.stock === undefined || p.stock === null || p.stock === '') return null;
  const n = parseInt(p.stock, 10);
  return isNaN(n) ? null : Math.max(0, n);
}

// "strong" = altijd de allernieuwste waarde lezen (belangrijk bij voorraad).
const winkel = () => getStore({ name: 'voorraad', consistency: 'strong' });
export const bestellingen = () => getStore({ name: 'bestellingen', consistency: 'strong' });
export const reserveringen = () => getStore({ name: 'reserveringen', consistency: 'strong' });

// Een blob per product ziet er zo uit:
//   { stock: 4,                                   <- fysiek in de winkel
//     reserveringen: { "<id>": { qty: 1, tot: 1790000000000 } },
//     bijgewerkt: "..." }
// Beschikbaar voor klanten = stock - actieve (niet verlopen) reserveringen.

function maakToestand(data, id) {
  const stock = data && typeof data.stock === 'number' ? data.stock : startVoorraad(zoekProduct(id));
  const nu = Date.now();
  const actief = {};
  for (const [rid, r] of Object.entries((data && data.reserveringen) || {})) {
    if (r && r.tot > nu) actief[rid] = r; // verlopen reserveringen vallen vanzelf weg
  }
  return { stock, reserveringen: actief };
}

function samenvatting(t) {
  if (t.stock === null) return { stock: null, gereserveerd: 0, beschikbaar: null };
  const gereserveerd = Object.values(t.reserveringen).reduce((s, r) => s + r.qty, 0);
  return { stock: t.stock, gereserveerd, beschikbaar: Math.max(0, t.stock - gereserveerd) };
}

// { stock, gereserveerd, beschikbaar } van 1 product (null = onbeperkt).
export async function lees(id) {
  return samenvatting(maakToestand(await winkel().get(id, { type: 'json' }), id));
}

// { id: { stock, gereserveerd, beschikbaar } } voor alle producten.
export async function leesAlles() {
  const uit = {};
  await Promise.all(producten.map(async (p) => {
    const id = slugify(p.name);
    uit[id] = await lees(id);
  }));
  return uit;
}

// Veilig aanpassen, ook als 2 klanten tegelijk bestellen: we schrijven enkel
// als niemand anders er intussen aan gezeten heeft (ETag-controle), anders
// opnieuw proberen. `wijzig(toestand)` past de toestand aan en geeft false
// terug om te weigeren (bv. niet genoeg voorraad).
async function pasAan(id, wijzig) {
  const store = winkel();
  for (let poging = 0; poging < 8; poging++) {
    const huidig = await store.getWithMetadata(id, { type: 'json' });
    const toestand = maakToestand(huidig && huidig.data, id);
    if (toestand.stock === null) return { ok: true, onbeperkt: true };

    const voor = samenvatting(toestand);
    if (wijzig(toestand) === false) return { ok: false, ...voor };

    const waarde = { ...toestand, bijgewerkt: new Date().toISOString() };
    const res = huidig
      ? await store.setJSON(id, waarde, { onlyIfMatch: huidig.etag })
      : await store.setJSON(id, waarde, { onlyIfNew: true });
    if (res.modified) return { ok: true, voor, na: samenvatting(toestand) };
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
  }
  throw new Error(`Kon voorraad van ${id} niet bijwerken (te veel gelijktijdige wijzigingen).`);
}

// Houdt `qty` stuks vast voor een klant die aan het betalen is.
export const reserveer = (id, rid, qty, tot) => pasAan(id, (t) => {
  delete t.reserveringen[rid];
  if (samenvatting(t).beschikbaar < qty) return false;
  t.reserveringen[rid] = { qty, tot };
});

// Betaling geannuleerd / verlopen: stuks terug vrijgeven.
export const geefVrij = (id, rid) => pasAan(id, (t) => {
  delete t.reserveringen[rid];
});

// Betaald: reservering wordt een echte verkoop.
export const bevestig = (id, rid, qty) => pasAan(id, (t) => {
  delete t.reserveringen[rid];
  t.stock = Math.max(0, t.stock - qty);
});

// Beheerder zet het fysieke aantal (reserveringen blijven gewoon lopen).
export const zet = (id, aantal) => pasAan(id, (t) => {
  t.stock = aantal;
});

// Alle producten van een reservering vrijgeven (en de reservering wissen).
export async function annuleerReservering(rid) {
  if (!rid) return;
  const store = reserveringen();
  const res = await store.get(rid, { type: 'json' });
  if (!res) return;
  for (const item of res.items || []) await geefVrij(item.id, rid);
  await store.delete(rid);
}

export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
