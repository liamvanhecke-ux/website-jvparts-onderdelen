# Contract: hoe de site, de server en het beheer met Supabase praten

Vastgelegd door de baas. Alle bouwers houden zich hieraan. Het schema staat in
`database/schema.sql`, het volledige plan in `database/PLAN-supabase.md`.

## Project

- URL: `https://vuscwojadpdyzzgzsofz.supabase.co`
- Publieke sleutel (mag in de browser): `sb_publishable_U_xHzuA1lU3m9jDMSJ3wvA_AWjaYYdO`
- Browser: staat in `js/config.js` als globale constanten `SUPABASE_URL` en `SUPABASE_KEY`
  (klassiek script, geen module). Laad `js/config.js` VOOR elk script dat ze gebruikt.
- Server (Netlify-functies): omgevingsvariabelen `SUPABASE_URL`, `SUPABASE_ANON_KEY` (de publieke
  sleutel) en `SUPABASE_SERVICE_KEY` (geheim, alleen om bestellingen weg te schrijven).
  Ontbreken ze, dan valt de server terug op `data/products.json` en schrijft hij geen bestellingen.
- De service-sleutel komt NOOIT in de repo, in de browser of in een bestand dat bezoekers kunnen opvragen.

## REST

- Anoniem lezen: header `apikey: <publieke sleutel>`. GEEN Authorization-header meesturen.
  (Live getest: werkt.)
- Als ingelogde beheerder: `apikey: <publieke sleutel>` + `Authorization: Bearer <access_token>`.
- Producten voor de shop:
  `GET {URL}/rest/v1/producten?select=*,categorie:categorieen(naam,naam_fr,naam_de)&actief=eq.true&order=volgorde.asc,naam.asc`
- Foto-URL: `{URL}/storage/v1/object/public/productfotos/{foto_pad}`.
  Begint `foto_pad` met `http` of `/`, dan is het al een volledig adres en gebruik je het zoals het is.

## Vorm van een product in de site (de "oude vorm", ongewijzigd + `id`)

De shop-code (`index.js`, `product.js`, `suggesties.js`, `cart.js`) blijft met deze vorm werken:

| Veld in de site | Uit de database |
|---|---|
| `id` (NIEUW) | `id` |
| `name`, `name_fr`, `name_de` | `naam`, `naam_fr`, `naam_de` |
| `subtitle`, `subtitle_fr`, `subtitle_de` | `subtitel`, `subtitel_fr`, `subtitel_de` |
| `price` (tekst met komma, bv. `"34,95"`) | `prijs` (getal) -> `toFixed(2)` met komma |
| `category`, `category_fr`, `category_de` | `categorie.naam`, `categorie.naam_fr`, `categorie.naam_de` |
| `condition` | `staat` |
| `stock` | `start_voorraad` (`null` = veld weglaten = onbeperkt) |
| `image` | volledige foto-URL, of `""` zonder foto |
| `beschrijving`, `beschrijving_fr`, `beschrijving_de` | idem |

Lege vertalingen (`null`) worden `""`.

## Product-ID

- Het ID is de kolom `id` en verandert NOOIT meer na het aanmaken (de voorraad in Netlify Blobs en
  de winkelmand hangen eraan). Bij het aanmaken = `slugify(naam)`.
- Overal waar de code nu `slugify(p.name)` gebruikt als ID, wordt dat `p.id || slugify(p.name)`
  (de reserve `products.json` heeft geen `id`). Server: `zoekProduct(id)` zoekt op `id`.

## Reserve

- Site: lukt Supabase niet (netwerkfout, geen 2xx, time-out van ongeveer 6 s, of `SUPABASE_URL` leeg),
  dan `data/products.json` gebruiken en één `console.warn` geven.
- Server: zelfde reserve.

## Beheerder herkennen

- Browser (beheer): `supabase-js` v2 via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`.
  Na het inloggen: `select user_id from beheerders` geeft door de beveiliging alleen de eigen rij.
  Leeg resultaat = geen beheerder: melding tonen en uitloggen.
- Server (`netlify/functions/voorraad.mjs`): het token van de browser komt als `Authorization: Bearer <token>`.
  Controle in twee stappen, allebei met `apikey: <publieke sleutel>` en dat token:
  1. `GET {URL}/auth/v1/user` moet 200 geven.
  2. `GET {URL}/rest/v1/beheerders?select=user_id` moet minstens één rij geven.

## Bestellingen wegschrijven (server, `stripe-webhook.mjs`)

Met `apikey: <service-sleutel>` en `Authorization: Bearer <service-sleutel>`:

1. `POST {URL}/rest/v1/bestellingen` met `Prefer: resolution=ignore-duplicates,return=representation`.
   `id` = de Stripe-sessie (`cs_...`). Is het antwoord een lege lijst, dan bestond de bestelling al: stop.
2. Anders `POST {URL}/rest/v1/bestelregels` met alle regels in één keer.

Bedragen in euro met 2 decimalen (Stripe geeft centen). Een fout hier mag de webhook NIET laten
mislukken: alleen `console.error`. De voorraad en Blobs blijven werken zoals nu.

## Dashboard (beheer)

- Views: `omzet_per_dag (dag, aantal_bestellingen, omzet)`, `verkocht_per_product (product_id, product_naam, aantal_verkocht, omzet)`.
- Drempel "bijna op": tabel `instellingen`, sleutel `lage_voorraad_drempel` (getal, standaard 2).
- Live voorraad (stap 1): `GET /.netlify/functions/voorraad` (bestaat al, geeft `{ voorraad: { id: { stock, gereserveerd, beschikbaar } } }`).
  Lukt dat niet (bv. lokaal), dan `start_voorraad` tonen met de vermelding dat het de startwaarde is.

## Eigenaars van bestanden (niemand raakt bestanden van een ander aan)

| Bouwer | Bestanden |
|---|---|
| Site | `js/producten-bron.js` (nieuw), `js/index.js`, `js/product.js`, `js/suggesties.js`, `js/cart.js`, alle `.html` in de hoofdmap, `netlify.toml`, `.github/` |
| Server | alles in `netlify/` |
| Beheer | alles in `jv-werkbank/` |
| Baas | `database/`, `js/config.js` |
| Gedeeld (enkel vertalingen/aria, na overleg) | `js/i18n.js`, `js/contact.js`, `js/minicart.js`, `js/winkelmand.js`, `js/betalen.js`, `css/style.css` |
