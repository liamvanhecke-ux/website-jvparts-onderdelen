// Schrijft een betaalde bestelling als EXTRA kopie naar Supabase (tabellen
// `bestellingen` + `bestelregels`), voor de cijfers in het beheer.
// Netlify Blobs blijft de bron voor de voorraad; dit staat daar los van.
//
// Omgevingsvariabelen: SUPABASE_URL en SUPABASE_SERVICE_KEY (geheim, enkel in
// Netlify). Ontbreekt er een, dan wordt er niets weggeschreven.
//
// Deze functie gooit NOOIT: een fout hier mag de webhook niet laten mislukken.
// De service-sleutel wordt nooit gelogd.

const TIMEOUT_MS = 3000;

// Stripe geeft centen; de database wil euro met 2 decimalen.
const euro = (centen) => Number(((Number(centen) || 0) / 100).toFixed(2));
const ofNull = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));

// session   = de Stripe Checkout Session uit het webhook-event
// regels    = de line items van die sessie (met price.product uitgeklapt),
//             zoals de webhook ze al ophaalt voor de voorraad
// betaaldOp = tijdstip van het betaal-event (seconden sinds 1970, zoals Stripe het geeft)
export function maakBestelling(session, regels, betaaldOp) {
  const meta = session.metadata || {};
  const klant = session.customer_details || {};
  const lijst = Array.isArray(regels) ? regels : [];

  // Regels met een product-ID zijn producten; de regel zonder ID is de verzendkost.
  const productRegels = lijst.filter((r) => r?.price?.product?.metadata?.id);
  const verzendCenten = lijst
    .filter((r) => !r?.price?.product?.metadata?.id)
    .reduce((som, r) => som + (Number(r.amount_total) || 0), 0);

  const tijd = Number(betaaldOp) > 0 ? new Date(Number(betaaldOp) * 1000) : new Date();

  return {
    bestelling: {
      id: session.id,
      betaald_op: tijd.toISOString(),
      totaal: euro(session.amount_total),
      verzendkost: euro(verzendCenten),
      // De site kent enkel bpost (betalend) en afhalen (gratis).
      verzendwijze: verzendCenten > 0 ? 'bpost' : 'afhalen',
      klant_naam: ofNull(meta.naam) || ofNull(klant.name),
      klant_email: ofNull(klant.email) || ofNull(session.customer_email),
      klant_adres: ofNull(meta.adres),
      klant_land: ofNull(meta.land) || ofNull(klant.address && klant.address.country),
      taal: ofNull(meta.taal) || (session.locale && session.locale !== 'auto' ? String(session.locale) : null),
    },
    regels: productRegels.map((r) => {
      const aantal = Math.max(1, parseInt(r.quantity, 10) || 1);
      const stukCenten = typeof r.price.unit_amount === 'number'
        ? r.price.unit_amount
        : (Number(r.amount_total) || 0) / aantal;
      return {
        bestelling_id: session.id,
        product_id: r.price.product.metadata.id,
        // Naam op het moment van de aankoop (zoals hij op de Stripe-betaalpagina stond).
        product_naam: String(r.description || r.price.product.name || r.price.product.metadata.id),
        aantal,
        stukprijs: euro(stukCenten),
      };
    }),
  };
}

async function post(basis, sleutel, tabel, body, prefer) {
  const res = await fetch(`${basis}/rest/v1/${tabel}`, {
    method: 'POST',
    headers: {
      apikey: sleutel,
      Authorization: `Bearer ${sleutel}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${tabel}: status ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

// Geeft terug wat er gebeurd is (handig voor logs/tests): 'overgeslagen',
// 'bestond-al', 'geschreven' of 'fout'.
export async function schrijfBestelling(session, regels, betaaldOp) {
  const sleutel = process.env.SUPABASE_SERVICE_KEY;
  // De sleutel mag nooit in een log staan, ook niet via een foutmelding.
  const veilig = (v) => {
    const s = String(v);
    return sleutel ? s.split(sleutel).join('***') : s;
  };
  try {
    const url = process.env.SUPABASE_URL;
    if (!url || !sleutel) {
      console.warn('SUPABASE_URL of SUPABASE_SERVICE_KEY ontbreekt: bestelling niet naar Supabase geschreven.');
      return 'overgeslagen';
    }
    if (!session || !session.id) return 'overgeslagen';
    const basis = url.replace(/\/+$/, '');
    const { bestelling, regels: bestelregels } = maakBestelling(session, regels, betaaldOp);

    // 1) De bestelling. Bestaat ze al (Stripe stuurde het event opnieuw), dan
    //    komt er een lege lijst terug en stoppen we: zo is er nooit een dubbel.
    const res = await post(basis, sleutel, 'bestellingen', bestelling, 'resolution=ignore-duplicates,return=representation');
    const gemaakt = await res.json();
    if (!Array.isArray(gemaakt) || gemaakt.length === 0) return 'bestond-al';

    // 2) Alle regels in één keer.
    if (bestelregels.length > 0) {
      try {
        await post(basis, sleutel, 'bestelregels', bestelregels, 'return=minimal');
      } catch (err) {
        console.error(veilig(`Bestelling ${session.id} staat in Supabase, maar de bestelregels NIET: ${err && err.message}`));
        return 'fout';
      }
    }
    return 'geschreven';
  } catch (err) {
    console.error(veilig(`Bestelling naar Supabase schrijven mislukt: ${err && err.message}`));
    return 'fout';
  }
}
