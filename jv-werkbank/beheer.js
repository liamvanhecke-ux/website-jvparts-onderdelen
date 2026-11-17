/* =========================================================================
   JV Parts beheer (/jv-werkbank/)
   -------------------------------------------------------------------------
   Eén pagina voor Jelle: inloggen, producten, foto's, bestellingen,
   categorieën en instellingen. Alles praat rechtstreeks met Supabase via
   supabase-js (geladen in index.html) met de PUBLIEKE sleutel uit
   /js/config.js. De echte beveiliging zit in de database (Row Level
   Security in database/schema.sql): alleen wie in de tabel `beheerders`
   staat, mag schrijven of bestellingen lezen. Deze pagina toont alleen
   netjes wat de database toelaat.

   Veiligheid in de pagina: tekst uit de database (productnamen,
   klantnamen, ...) komt NOOIT via innerHTML op het scherm. We bouwen alles
   met el(...) en textContent, zodat "<img onerror=...>" gewoon als tekst
   verschijnt.

   Opbouw van dit bestand:
     1. Hulpjes (DOM, geld, datums, slugify, foutmeldingen)
     2. Verbinding en toestand
     3. Inloggen, wachtwoord vergeten, uitloggen
     4. Gegevens laden
     5. Navigatie en meldingen
     6. Voorraad en "Aandacht nodig"
     7. Overzicht (cijfers, grafieken, top 5)
     8. Producten (lijst, formulier, foto, verwijderen, volgorde)
     9. Bestellingen (lijst, detail, CSV)
    10. Categorieën
    11. Instellingen (drempel, export, import)
    12. Start
   ========================================================================= */

'use strict';

/* ===== 1. Hulpjes ======================================================= */

const $ = sel => document.querySelector(sel);

/* Maakt een element. Kinderen die tekst zijn worden tekstknopen, dus nooit
   HTML. Voorbeeld: el('td', { class: 'getal' }, '€ 5,00') */
function el(tag, attrs, ...kinderen) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'tekst') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kind of kinderen.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    e.append(kind instanceof Node ? kind : String(kind));
  }
  return e;
}

/* Kleine SVG-icoontjes (pijltjes), geen emoji. */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
  return e;
}
function pijl(richting) {
  const s = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svgEl('path', { d: richting === 'op' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }));
  return s;
}

/* Geld: € 1.234,50 (Belgische notatie). We rekenen in centen om
   afrondingsfouten (0,1 + 0,2) te vermijden. */
const geldFormaat = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const euro = n => geldFormaat.format(Number(n) || 0);
const centen = n => Math.round((Number(n) || 0) * 100);
const komma = n => (Number(n) || 0).toFixed(2).replace('.', ',');

/* Prijs uit een invoerveld: "12,5", "12.50" of "12" mag. Max 2 decimalen,
   niet negatief. Geeft null terug als het geen geldige prijs is. */
const MAX_PRIJS = 99999999.99; // hoogste prijs die in numeric(10,2) past
function leesPrijs(tekst) {
  const t = String(tekst ?? '').trim().replace(/\s|€/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const prijs = Math.round(parseFloat(t.replace(',', '.')) * 100) / 100;
  return prijs <= MAX_PRIJS ? prijs : null;
}

/* Een heel getal >= 0, of null bij een leeg veld. undefined = ongeldig. */
function leesAantal(tekst) {
  const t = String(tekst ?? '').trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? parseInt(t, 10) : undefined;
}

/* Kopie van slugify() uit js/cart.js: MOET hetzelfde blijven, want het ID
   van een product (en dus de voorraad en de winkelmand) hangt eraan. */
function slugify(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* --- Datums, altijd in Belgische tijd (Europe/Brussels) ---
   Een "dagsleutel" is tekst zoals "2026-11-16". Die kan je gewoon als
   tekst vergelijken (< en >), wat het filteren eenvoudig maakt. */
const TZ = 'Europe/Brussels';
const delenFormaat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function delen(datum) {
  const p = {};
  for (const d of delenFormaat.formatToParts(new Date(datum))) p[d.type] = d.value;
  return p;
}
function dagSleutel(datum) { const p = delen(datum); return `${p.year}-${p.month}-${p.day}`; }
const vandaagSleutel = () => dagSleutel(new Date());
function plusDagen(sleutel, n) {
  const d = new Date(sleutel + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function maandagVan(sleutel) {
  const dag = (new Date(sleutel + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = maandag
  return plusDagen(sleutel, -dag);
}
function plusMaanden(maand, n) { // maand = "2026-11"
  const d = new Date(maand + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
const kortDag = new Intl.DateTimeFormat('nl-BE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const kortMaand = new Intl.DateTimeFormat('nl-BE', { timeZone: 'UTC', month: 'short', year: 'numeric' });
function datumTekst(datum) { const p = delen(datum); return `${p.day}/${p.month}/${p.year}`; }
function tijdTekst(datum) { const p = delen(datum); return `${p.hour}:${p.minute}`; }

/* Zet een fout van Supabase (of het netwerk) om in een leesbare zin. */
function foutTekst(fout) {
  const bericht = String((fout && (fout.message || fout.error_description)) || fout || '');
  const code = fout && fout.code;
  const status = fout && (fout.status || fout.statusCode);
  if (code === 'geen-rij') return 'Er werd niets gewijzigd. Misschien bestaat het item niet meer of heb je geen rechten. Klik op Vernieuwen.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(bericht)) return 'Geen verbinding met de database. Controleer je internet en probeer opnieuw.';
  if (/invalid login credentials/i.test(bericht)) return 'E-mailadres of wachtwoord klopt niet.';
  if (/email not confirmed/i.test(bericht)) return 'Je e-mailadres is nog niet bevestigd. Klik eerst op de link in de bevestigingsmail.';
  if (status === 429 || /rate limit|too many/i.test(bericht)) return 'Te veel pogingen na elkaar. Wacht een paar minuten en probeer opnieuw.';
  if (/jwt expired|invalid jwt|PGRST301/i.test(bericht) || code === 'PGRST301') return 'Je sessie is verlopen. Log opnieuw in.';
  if (code === '23505' || /duplicate key/i.test(bericht)) return 'Dit ID bestaat al. Kies een andere naam.';
  if (code === '23514' || /check constraint/i.test(bericht)) return 'Een waarde voldoet niet aan de regels van de database (bijvoorbeeld een negatieve prijs of een ongeldig ID).';
  if (code === '23503') return 'Dit verwijst naar iets dat niet (meer) bestaat, bijvoorbeeld een verwijderde categorie.';
  if (code === '42501' || /row-level security|permission denied|unauthorized/i.test(bericht)) return 'Je hebt geen rechten voor deze actie. Ben je nog ingelogd als beheerder?';
  if (/payload too large|exceeded the maximum allowed size|too large/i.test(bericht) || status === 413) return 'Het bestand is te groot (maximaal 2 MB).';
  if (/mime type|invalid_mime/i.test(bericht)) return 'Dit soort bestand wordt niet aanvaard. Gebruik een JPG-, PNG- of WebP-foto.';
  return 'Er ging iets mis: ' + (bericht || 'onbekende fout') + '.';
}

/* Voert een Supabase-query uit en gooit een fout als die mislukt, zodat
   we overal met try/catch kunnen werken. */
async function db(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/* Bij wijzigen/verwijderen: de database geeft GEEN fout als de beveiliging
   een rij tegenhoudt, maar gewoon 0 rijen. Daarom vragen we de rijen terug
   (.select()) en controleren we dat er minstens één is. */
async function dbMinstensEen(query) {
  const data = await db(query.select());
  if (!data || data.length === 0) { const f = new Error('geen rij'); f.code = 'geen-rij'; throw f; }
  return data;
}

/* Supabase geeft standaard maximaal 1000 rijen per keer: haal in stukjes. */
async function alleRijen(maakQuery) {
  const STAP = 1000;
  let rijen = [];
  for (let van = 0; ; van += STAP) {
    const deel = await db(maakQuery().range(van, van + STAP - 1));
    rijen = rijen.concat(deel || []);
    if (!deel || deel.length < STAP) return rijen;
  }
}

/* Zet een knop uit tijdens het werk, zodat je niet dubbel klikt. */
async function bezig(knop, fn) {
  const tekst = knop.textContent;
  knop.disabled = true;
  knop.textContent = 'Bezig...';
  try { return await fn(); }
  finally { knop.disabled = false; knop.textContent = tekst; }
}

/* Laat de browser een bestand downloaden. */
function download(naam, inhoud, type) {
  const url = URL.createObjectURL(new Blob([inhoud], { type }));
  const a = el('a', { href: url, download: naam });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Foto-adres volgens het contract: een pad in de bucket wordt een volledig
   adres; begint het al met http of /, dan is het al een volledig adres. */
const BUCKET = 'productfotos';
const isBucketPad = pad => !!pad && !/^https?:/i.test(pad) && !pad.startsWith('/');
function fotoUrl(pad) {
  if (!pad) return '';
  if (!isBucketPad(pad)) return pad;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${pad.split('/').map(encodeURIComponent).join('/')}`;
}

/* ===== 2. Verbinding en toestand ======================================= */

// Moeten we vóór supabase-js kijken: komt de gebruiker terug via de
// "wachtwoord vergeten"-link? (supabase-js haalt de #... daarna weg)
// herstelModus blijft waar tot het nieuwe wachtwoord bewaard is.
let herstelModus = /type=recovery/.test(location.hash);
const HERSTELLINK_FOUT = /error_code=|error=access_denied/.test(location.hash + location.search);

const sb = (window.supabase && typeof SUPABASE_URL !== 'undefined')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const toestand = {
  categorieen: [],      // rijen uit `categorieen`
  producten: [],        // rijen uit `producten`
  bestellingen: [],     // rijen uit `bestellingen`, elk met .regels
  verkocht: new Map(),  // product_id -> { aantal_verkocht, omzet, product_naam }
  drempel: 2,           // instellingen.lage_voorraad_drempel
  live: null,           // live voorraad van Netlify, of null als die niet lukte
  bewerkId: null,       // ID van het product in het formulier (null = nieuw)
  foto: null,           // { blob, ext, url } van een nieuw gekozen foto
  fotoWeg: false,       // huidige foto weghalen bij opslaan
};

/* ===== 3. Inloggen, wachtwoord vergeten, uitloggen ===================== */

const SCHERMEN = ['laden', 'login', 'nieuw-wachtwoord', 'beheer'];
function toonScherm(naam) {
  for (const s of SCHERMEN) $('#scherm-' + s).hidden = s !== naam;
}
function loginMelding(tekst, goed) {
  const m = $('#login-melding');
  m.textContent = tekst || '';
  m.className = 'formmelding' + (goed ? ' goed' : '');
}
function toonLogin() {
  toonScherm('login');
  $('#login-form').hidden = false;
  $('#vergeten-form').hidden = true;
}

/* Na het inloggen: staat deze gebruiker in `beheerders`?
   SQL: SELECT user_id FROM beheerders;  -- de beveiliging geeft enkel je eigen rij */
async function naInloggen(session) {
  if (herstelModus) { toonScherm('nieuw-wachtwoord'); return; }
  let rijen;
  try {
    rijen = await db(sb.from('beheerders').select('user_id'));
  } catch (fout) {
    await sb.auth.signOut();
    toonLogin();
    loginMelding(foutTekst(fout));
    return;
  }
  if (!rijen || rijen.length === 0) {
    await sb.auth.signOut();
    toonLogin();
    loginMelding('Dit account heeft geen toegang tot het beheer.');
    return;
  }
  $('#ingelogd-als').textContent = (session.user && session.user.email) || '';
  toonScherm('beheer');
  toonTab(tabUitAdres());
  await herlaad();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const wachtwoord = $('#login-wachtwoord').value;
  if (!email || !wachtwoord) return loginMelding('Vul je e-mailadres en je wachtwoord in.');
  loginMelding('');
  await bezig($('#login-knop'), async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: wachtwoord });
    if (error) return loginMelding(foutTekst(error));
    $('#login-wachtwoord').value = '';
    await naInloggen(data.session);
  });
});

$('#naar-vergeten').addEventListener('click', () => {
  $('#login-form').hidden = true;
  $('#vergeten-form').hidden = false;
  $('#vergeten-email').value = $('#login-email').value;
  loginMelding('');
});
$('#naar-login').addEventListener('click', () => { toonLogin(); loginMelding(''); });

$('#vergeten-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#vergeten-email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return loginMelding('Vul een geldig e-mailadres in.');
  await bezig($('#vergeten-knop'), async () => {
    // De link in de mail brengt je terug naar deze pagina (zonder #...).
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return loginMelding(foutTekst(error));
    // Altijd dezelfde melding: zo verraden we niet welke adressen bestaan.
    loginMelding('Als dit adres een beheerdersaccount heeft, krijg je zo een mail met een link. Kijk ook in je spam.', true);
  });
});

$('#nieuw-ww-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('#nieuw-ww').value, b = $('#nieuw-ww-2').value;
  const m = $('#nieuw-ww-melding');
  if (a.length < 8) { m.textContent = 'Kies een wachtwoord van minstens 8 tekens.'; return; }
  if (a !== b) { m.textContent = 'De twee wachtwoorden zijn niet hetzelfde.'; return; }
  m.textContent = '';
  await bezig($('#nieuw-ww-knop'), async () => {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { m.textContent = foutTekst(error); return; }
    herstelModus = false;
    history.replaceState(null, '', location.pathname);
    const { data } = await sb.auth.getSession();
    if (data.session) await naInloggen(data.session);
    else { toonLogin(); loginMelding('Je wachtwoord is gewijzigd. Log nu in.', true); }
  });
});

$('#uitloggen').addEventListener('click', async () => {
  await sb.auth.signOut();
  toonLogin();
  loginMelding('Je bent uitgelogd.', true);
});

/* ===== 4. Gegevens laden =============================================== */

/* Live voorraad uit Netlify (Blobs). Lukt het niet binnen 6 s, dan null:
   we tonen dan de startvoorraad uit de database, met een opmerking. */
async function laadLiveVoorraad() {
  const stop = new AbortController();
  const klok = setTimeout(() => stop.abort(), 6000);
  try {
    const res = await fetch('/.netlify/functions/voorraad', { cache: 'no-store', signal: stop.signal });
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    return (data && data.voorraad) || null;
  } catch (fout) {
    console.warn('Live voorraad niet beschikbaar, startvoorraad wordt getoond.', fout);
    return null;
  } finally {
    clearTimeout(klok);
  }
}

/* Laadt alles opnieuw en tekent alle schermen. Na elke wijziging roepen we
   dit aan: zo toont het scherm altijd wat echt in de database staat. */
async function herlaad() {
  try {
    const [cats, prods, drempelRij, bestellingen, regels, verkocht, live] = await Promise.all([
      db(sb.from('categorieen').select('*').order('volgorde').order('naam')),
      db(sb.from('producten').select('*').order('volgorde').order('naam')),
      db(sb.from('instellingen').select('waarde').eq('sleutel', 'lage_voorraad_drempel').maybeSingle()),
      alleRijen(() => sb.from('bestellingen').select('*').order('betaald_op', { ascending: false })),
      alleRijen(() => sb.from('bestelregels').select('*').order('id')),
      // View verkocht_per_product:
      //   SELECT product_id, SUM(aantal), SUM(aantal * stukprijs) FROM bestelregels GROUP BY product_id
      db(sb.from('verkocht_per_product').select('*')),
      laadLiveVoorraad(),
    ]);
    toestand.categorieen = cats || [];
    toestand.producten = prods || [];
    const d = drempelRij ? Number(drempelRij.waarde) : 2;
    toestand.drempel = Number.isInteger(d) && d >= 0 ? d : 2;
    // Regels bij hun bestelling hangen (zoals een JOIN op bestelling_id).
    const perBestelling = new Map();
    for (const r of regels) {
      if (!perBestelling.has(r.bestelling_id)) perBestelling.set(r.bestelling_id, []);
      perBestelling.get(r.bestelling_id).push(r);
    }
    toestand.bestellingen = bestellingen.map(b => ({ ...b, regels: perBestelling.get(b.id) || [] }));
    toestand.verkocht = new Map((verkocht || []).map(v => [v.product_id, v]));
    toestand.live = live;
  } catch (fout) {
    melding(foutTekst(fout), 'fout');
  }
  tekenAlles();
}

function tekenAlles() {
  tekenAandacht();
  tekenOverzicht();
  tekenProducten();
  vulCategorieKeuze();
  tekenBestellingen();
  tekenCategorieen();
  $('#drempel').value = toestand.drempel;
}

$('#vernieuwen').addEventListener('click', e => bezig(e.currentTarget, herlaad));

/* ===== 5. Navigatie en meldingen ======================================= */

const TABS = ['overzicht', 'producten', 'bestellingen', 'categorieen', 'instellingen'];
function tabUitAdres() {
  const t = location.hash.replace('#', '');
  return TABS.includes(t) ? t : 'overzicht';
}
function toonTab(naam) {
  for (const t of TABS) $('#tab-' + t).hidden = t !== naam;
  document.querySelectorAll('#menu a[data-tab]').forEach(a => {
    a.classList.toggle('actief', a.dataset.tab === naam);
    if (a.dataset.tab === naam) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Bij het wisselen van tab altijd de lijst tonen, niet een half formulier.
  toonProductLijst();
  toonBestellingLijst();
}
window.addEventListener('hashchange', () => { if (!$('#scherm-beheer').hidden) toonTab(tabUitAdres()); });
function gaNaarTab(naam) {
  if (location.hash !== '#' + naam) history.pushState(null, '', '#' + naam);
  toonTab(naam);
}

let meldingKlok;
function melding(tekst, soort) {
  const balk = $('#melding');
  $('#melding-tekst').textContent = tekst;
  balk.className = 'meldingbalk' + (soort === 'fout' ? ' fout' : '');
  balk.hidden = false;
  clearTimeout(meldingKlok);
  if (soort !== 'fout') meldingKlok = setTimeout(() => { balk.hidden = true; }, 5000);
}
$('#melding-sluit').addEventListener('click', () => { $('#melding').hidden = true; });

/* Eigen bevestigingsvenster. Geeft een Promise met de "waarde" van de
   gekozen knop, of null bij Escape. */
function vraag({ titel, tekst, knoppen }) {
  return new Promise(resolve => {
    const overlay = $('#dialoog');
    const vorige = document.activeElement;
    $('#dialoog-titel').textContent = titel;
    $('#dialoog-tekst').replaceChildren(...[].concat(tekst).map(t => (typeof t === 'string' ? el('p', { tekst: t }) : t)));
    const rij = $('#dialoog-knoppen');
    let focusKnop = null;
    const klaar = waarde => {
      overlay.hidden = true;
      document.removeEventListener('keydown', toets);
      if (vorige && vorige.focus) vorige.focus();
      resolve(waarde);
    };
    const toets = e => { if (e.key === 'Escape') klaar(null); };
    rij.replaceChildren(...knoppen.map(k => {
      const b = el('button', { type: 'button', class: 'knop ' + (k.soort || ''), tekst: k.tekst, onclick: () => klaar(k.waarde) });
      if (k.focus) focusKnop = b;
      return b;
    }));
    overlay.hidden = false;
    document.addEventListener('keydown', toets);
    (focusKnop || rij.querySelector('button')).focus();
  });
}

/* ===== 6. Voorraad en "Aandacht nodig" ================================= */

/* Hoeveel stuks kunnen klanten nog kopen? Infinity = onbeperkt.
   Eerst de live voorraad (Netlify); ontbreekt die, dan start_voorraad. */
function voorraadVan(p) {
  const v = toestand.live && toestand.live[p.id];
  if (v) return v.beschikbaar === null || v.beschikbaar === undefined ? Infinity : Number(v.beschikbaar);
  return p.start_voorraad === null || p.start_voorraad === undefined ? Infinity : Number(p.start_voorraad);
}

/* Zelfde regel als voorraadInfo() in js/cart.js: tweedehands is nooit
   "bijna op" (er is er meestal maar één van), alleen uitverkocht. */
function voorraadStatus(p) {
  const n = voorraadVan(p);
  if (n <= 0) return { cls: 'out', tekst: 'Uitverkocht', probleem: 'Uitverkocht' };
  if (p.staat !== 'Tweedehands' && n <= toestand.drempel) return { cls: 'low', tekst: `Bijna op (${n})`, probleem: `Bijna op: nog ${n}` };
  return { cls: 'in', tekst: n === Infinity ? 'Onbeperkt' : `${n} stuks`, probleem: null };
}

/* Alle meldingen voor één product (lege lijst = alles in orde). */
function problemenVan(p) {
  const lijst = [];
  const v = voorraadStatus(p);
  if (v.probleem) lijst.push({ tekst: v.probleem, cls: v.cls, voorraad: true });
  if (!p.foto_pad) lijst.push({ tekst: 'Geen foto', cls: 'grijs' });
  if (!(p.beschrijving || '').trim()) lijst.push({ tekst: 'Geen beschrijving', cls: 'grijs' });
  if (!(p.naam_fr || '').trim()) lijst.push({ tekst: 'Geen Franse naam', cls: 'grijs' });
  if (!(p.naam_de || '').trim()) lijst.push({ tekst: 'Geen Duitse naam', cls: 'grijs' });
  if ((p.beschrijving || '').trim()) {
    if (!(p.beschrijving_fr || '').trim()) lijst.push({ tekst: 'Geen Franse beschrijving', cls: 'grijs' });
    if (!(p.beschrijving_de || '').trim()) lijst.push({ tekst: 'Geen Duitse beschrijving', cls: 'grijs' });
  }
  return lijst;
}

/* Alleen actieve producten: wat niet in de winkel staat, vraagt geen actie. */
function aandachtLijst() {
  return toestand.producten.filter(p => p.actief)
    .map(p => ({ product: p, problemen: problemenVan(p) }))
    .filter(x => x.problemen.length > 0);
}

function zetTeller(id, n) {
  const t = $(id);
  t.textContent = n;
  t.hidden = n === 0;
  t.setAttribute('aria-label', `${n} meldingen`);
}

function tekenAandacht() {
  const lijst = aandachtLijst();
  zetTeller('#teller-aandacht', lijst.length);
  zetTeller('#teller-voorraad', lijst.filter(x => x.problemen.some(pr => pr.voorraad)).length);
  $('#voorraad-opmerking').hidden = toestand.live !== null;
  $('#aandacht-uitleg').textContent = lijst.length
    ? `Actieve producten die bijna op zijn (${toestand.drempel} stuks of minder), uitverkocht zijn of nog iets missen.`
    : 'Alles in orde: geen actieve producten die bijna op zijn of iets missen.';
  $('#aandacht-lijst').replaceChildren(...lijst.map(({ product, problemen }) => el('li', { 'data-id': product.id },
    el('div', {},
      el('div', { class: 'pnaam', tekst: product.naam }),
      el('div', { class: 'redenen' }, problemen.map(pr => el('span', { class: 'label ' + pr.cls, tekst: pr.tekst })))),
    el('button', { type: 'button', class: 'knop klein', tekst: 'Bewerken',
      onclick: () => { gaNaarTab('producten'); openProductFormulier(product.id); } }),
  )));
}

/* ===== 7. Overzicht ===================================================== */

function tekenOverzicht() {
  const b = toestand.bestellingen;
  const vandaag = vandaagSleutel();
  const maandag = maandagVan(vandaag);
  const dezeMaand = vandaag.slice(0, 7);

  // Omzet per dag in centen. Zelfde idee als de view omzet_per_dag:
  //   SELECT dag, COUNT(*), SUM(totaal) FROM bestellingen GROUP BY dag
  const perDag = new Map();   // "2026-11-16" -> { aantal, centen }
  const perMaand = new Map(); // "2026-11"    -> centen   (GROUP BY maand)
  for (const best of b) {
    const k = dagSleutel(best.betaald_op);
    const c = centen(best.totaal);
    const dag = perDag.get(k) || { aantal: 0, centen: 0 };
    dag.aantal += 1;
    dag.centen += c;
    perDag.set(k, dag);
    perMaand.set(k.slice(0, 7), (perMaand.get(k.slice(0, 7)) || 0) + c);
  }
  const som = filter => {
    let aantal = 0, c = 0;
    for (const [k, v] of perDag) if (filter(k)) { aantal += v.aantal; c += v.centen; }
    return { aantal, euro: c / 100 };
  };
  const vd = som(k => k === vandaag);
  const wk = som(k => k >= maandag && k <= vandaag);
  const mn = som(k => k.slice(0, 7) === dezeMaand);
  const totaal = som(() => true);
  const gemiddeld = totaal.aantal ? totaal.euro / totaal.aantal : 0;
  const bestellingTekst = n => `${n} ${n === 1 ? 'bestelling' : 'bestellingen'}`;

  const tegel = (naam, waarde, extra, sleutel) => el('div', { class: 'tegel', 'data-cijfer': sleutel },
    el('div', { class: 'naam', tekst: naam }), el('div', { class: 'waarde', tekst: waarde }), el('div', { class: 'extra', tekst: extra }));
  $('#cijfers').replaceChildren(
    tegel('Vandaag', euro(vd.euro), bestellingTekst(vd.aantal), 'vandaag'),
    tegel('Deze week', euro(wk.euro), bestellingTekst(wk.aantal), 'week'),
    tegel('Deze maand', euro(mn.euro), bestellingTekst(mn.aantal), 'maand'),
    tegel('Bestellingen', String(totaal.aantal), 'in totaal', 'aantal'),
    tegel('Gemiddelde bestelling', euro(gemiddeld), 'over alle bestellingen', 'gemiddeld'),
  );

  const leeg = b.length === 0;
  $('#overzicht-leeg').hidden = !leeg;
  $('#overzicht-verkoop').hidden = leeg;
  if (leeg) return;

  // Laatste 30 dagen; een dag zonder verkoop telt als 0.
  const dagen = [];
  for (let i = 29; i >= 0; i--) {
    const k = plusDagen(vandaag, -i);
    dagen.push({ sleutel: k, label: kortDag.format(new Date(k + 'T00:00:00Z')), waarde: ((perDag.get(k) || {}).centen || 0) / 100 });
  }
  tekenStaafgrafiek($('#grafiek-dagen'), dagen, 'Omzet per dag, laatste 30 dagen', 5);

  const maanden = [];
  for (let i = 11; i >= 0; i--) {
    const m = plusMaanden(dezeMaand, -i);
    maanden.push({ sleutel: m, label: kortMaand.format(new Date(m + '-01T00:00:00Z')), waarde: (perMaand.get(m) || 0) / 100 });
  }
  tekenStaafgrafiek($('#grafiek-maanden'), maanden, 'Omzet per maand, laatste 12 maanden', 2);

  // Top 5 uit de view verkocht_per_product (al gegroepeerd per product_id).
  const top = [...toestand.verkocht.values()]
    .sort((x, y) => (y.aantal_verkocht - x.aantal_verkocht) || (Number(y.omzet) - Number(x.omzet)))
    .slice(0, 5);
  const naamVan = v => {
    const p = toestand.producten.find(q => q.id === v.product_id);
    return p ? p.naam : (v.product_naam || v.product_id || 'Onbekend product');
  };
  $('#top-producten').replaceChildren(...(top.length
    ? top.map(v => el('li', { 'data-product': v.product_id || '' },
      el('span', { class: 'pnaam', tekst: naamVan(v) }), ' ',
      el('span', { class: 'sub', tekst: `${v.aantal_verkocht} verkocht, ${euro(v.omzet)}` })))
    : [el('li', { class: 'gedempt', tekst: 'Nog geen verkochte producten.' })]));
}

/* Rond het hoogste getal af naar een mooi getal voor de as (10, 20, 25, 50...). */
function mooiMax(max) {
  const macht = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * macht >= max) return m * macht;
  return 10 * macht;
}

/* Staafgrafiek in SVG, zonder bibliotheek. Elke staaf heeft een <title>
   (tooltip) en onder de grafiek staan dezelfde cijfers in een tabel, voor
   schermlezers en wie het exacte bedrag wil zien. */
function tekenStaafgrafiek(doos, punten, omschrijving, labelElke) {
  const B = 640, H = 220, L = 64, R = 8, T = 10, O = 30;
  const max = Math.max(0, ...punten.map(p => p.waarde));
  const asMax = max > 0 ? mooiMax(max) : 1;
  const breedte = (B - L - R) / punten.length;
  const y = w => T + (H - T - O) * (1 - w / asMax);
  const totaal = punten.reduce((s, p) => s + centen(p.waarde), 0) / 100;

  const svg = svgEl('svg', { viewBox: `0 0 ${B} ${H}`, role: 'img',
    'aria-label': `${omschrijving}. Totaal ${euro(totaal)}. De cijfers staan ook in de tabel eronder.` });
  for (const w of [0, asMax / 2, asMax]) {
    svg.append(svgEl('line', { class: 'as', x1: L, x2: B - R, y1: y(w), y2: y(w) }));
    const t = svgEl('text', { x: L - 6, y: y(w) + 4, 'text-anchor': 'end' });
    t.textContent = euro(w);
    svg.append(t);
  }
  punten.forEach((p, i) => {
    const r = svgEl('rect', { class: 'staaf', x: (L + i * breedte + breedte * 0.15).toFixed(1), y: y(p.waarde).toFixed(1),
      width: (breedte * 0.7).toFixed(1), height: (H - O - y(p.waarde)).toFixed(1), rx: 2,
      'data-sleutel': p.sleutel, 'data-waarde': p.waarde.toFixed(2) });
    const titel = svgEl('title');
    titel.textContent = `${p.label}: ${euro(p.waarde)}`;
    r.append(titel);
    svg.append(r);
    // Niet elk label past: toon er één op labelElke, altijd met de laatste erbij.
    if (i % labelElke === (punten.length - 1) % labelElke) {
      const t = svgEl('text', { x: L + i * breedte + breedte / 2, y: H - 10, 'text-anchor': 'middle' });
      t.textContent = p.label;
      svg.append(t);
    }
  });

  const tabel = el('table', {},
    el('thead', {}, el('tr', {}, el('th', { tekst: 'Periode' }), el('th', { class: 'getal', tekst: 'Omzet' }))),
    el('tbody', {}, punten.map(p => el('tr', {}, el('td', { tekst: p.label }), el('td', { class: 'getal', tekst: euro(p.waarde) })))));
  doos.className = 'grafiek';
  doos.replaceChildren(svg, el('details', {}, el('summary', { tekst: 'Toon de cijfers als tabel' }), tabel));
}

/* ===== 8. Producten ===================================================== */

const categorieNaam = id => { const c = toestand.categorieen.find(x => x.id === id); return c ? c.naam : ''; };

function tekenProducten() {
  const q = $('#product-zoek').value.trim().toLowerCase();
  const alle = toestand.producten;
  const zichtbaar = alle.filter(p => !q || [p.naam, p.subtitel, p.id, categorieNaam(p.categorie_id)].join(' ').toLowerCase().includes(q));
  $('#product-telling').textContent = q ? `${zichtbaar.length} van ${alle.length} producten` : `${alle.length} producten`;

  const rijen = zichtbaar.map(p => {
    const i = alle.indexOf(p);
    const v = voorraadStatus(p);
    const verkocht = toestand.verkocht.get(p.id);
    const foto = p.foto_pad
      ? el('img', { class: 'duimnagel', src: fotoUrl(p.foto_pad), alt: '', loading: 'lazy' })
      : el('div', { class: 'geenfoto', title: 'Geen foto' });
    const knopOp = el('button', { type: 'button', class: 'knop icoon', 'aria-label': `${p.naam} hoger zetten`, title: 'Hoger',
      onclick: e => verschuif('producten', p.id, -1, e.currentTarget) }, pijl('op'));
    const knopNeer = el('button', { type: 'button', class: 'knop icoon', 'aria-label': `${p.naam} lager zetten`, title: 'Lager',
      onclick: e => verschuif('producten', p.id, 1, e.currentTarget) }, pijl('neer'));
    // Tijdens het zoeken staan de pijltjes uit: de buur is dan onduidelijk.
    knopOp.disabled = i === 0 || !!q;
    knopNeer.disabled = i === alle.length - 1 || !!q;
    return el('tr', { class: p.actief ? '' : 'inactief', 'data-id': p.id },
      el('td', {}, foto),
      el('td', {}, el('div', { class: 'pnaam', tekst: p.naam }), el('div', { class: 'sub', tekst: p.subtitel || '' })),
      el('td', { class: 'smal-weg', tekst: categorieNaam(p.categorie_id) || '-' }),
      el('td', { class: 'getal', tekst: euro(p.prijs) }),
      el('td', { class: 'smal-weg', tekst: p.staat }),
      el('td', {}, el('span', { class: 'label ' + (p.actief ? 'in' : 'grijs'), tekst: p.actief ? 'Ja' : 'Nee' })),
      el('td', {}, el('span', { class: 'label ' + v.cls, tekst: v.tekst })),
      el('td', { class: 'smal-weg getal', tekst: String(verkocht ? verkocht.aantal_verkocht : 0) }),
      el('td', {}, el('div', { class: 'acties' }, knopOp, knopNeer,
        el('button', { type: 'button', class: 'knop klein', tekst: 'Bewerken', onclick: () => openProductFormulier(p.id) }))),
    );
  });
  $('#product-rijen').replaceChildren(...(rijen.length ? rijen
    : [el('tr', {}, el('td', { colspan: 9, class: 'gedempt', tekst: q ? 'Geen producten gevonden.' : 'Nog geen producten. Klik op Product toevoegen.' }))]));
}
$('#product-zoek').addEventListener('input', tekenProducten);

/* Volgorde (voor producten én categorieën): wissel met de buur en nummer
   daarna alles netjes 1, 2, 3... Alleen rijen waarvan het nummer echt
   verandert, worden bijgewerkt (UPDATE ... SET volgorde = n WHERE id = ...). */
async function verschuif(tabel, id, richting, knop) {
  const lijst = [...toestand[tabel]];
  const i = lijst.findIndex(x => x.id === id);
  const j = i + richting;
  if (i < 0 || j < 0 || j >= lijst.length) return;
  [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
  await bezig(knop, async () => {
    try {
      await Promise.all(lijst.map((x, n) => (x.volgorde === n + 1 ? null
        : dbMinstensEen(sb.from(tabel).update({ volgorde: n + 1 }).eq('id', x.id)))));
    } catch (fout) { melding(foutTekst(fout), 'fout'); }
  });
  await herlaad();
}

function vulCategorieKeuze() {
  const keuze = $('#p-categorie');
  const huidig = keuze.value;
  keuze.replaceChildren(el('option', { value: '', tekst: 'Geen categorie' }),
    ...toestand.categorieen.map(c => el('option', { value: c.id, tekst: c.naam })));
  keuze.value = huidig;
}

function toonProductLijst() {
  $('#producten-lijst-blok').hidden = false;
  $('#product-formulier-blok').hidden = true;
}

const VELDEN = { // invoerveld -> kolom in de database (de tekstvelden)
  'p-naam': 'naam', 'p-naam-fr': 'naam_fr', 'p-naam-de': 'naam_de',
  'p-subtitel': 'subtitel', 'p-subtitel-fr': 'subtitel_fr', 'p-subtitel-de': 'subtitel_de',
  'p-beschrijving': 'beschrijving', 'p-beschrijving-fr': 'beschrijving_fr', 'p-beschrijving-de': 'beschrijving_de',
};

function openProductFormulier(id) {
  const p = id ? toestand.producten.find(x => x.id === id) : null;
  if (id && !p) return melding('Dit product bestaat niet meer. Klik op Vernieuwen.', 'fout');
  toestand.bewerkId = p ? p.id : null;
  if (toestand.foto) URL.revokeObjectURL(toestand.foto.url);
  toestand.foto = null;
  toestand.fotoWeg = false;
  vulCategorieKeuze();
  for (const [veld, kolom] of Object.entries(VELDEN)) $('#' + veld).value = p ? (p[kolom] || '') : '';
  $('#p-prijs').value = p ? komma(p.prijs) : '';
  $('#p-categorie').value = p ? (p.categorie_id || '') : '';
  $('#p-staat').value = p ? p.staat : 'Nieuw';
  $('#p-voorraad').value = p ? (p.start_voorraad ?? '') : '1';
  $('#p-volgorde').value = p ? p.volgorde : (Math.max(0, ...toestand.producten.map(x => x.volgorde)) + 1);
  $('#p-actief').checked = p ? p.actief : true;
  $('#p-id').value = p ? p.id : '';
  $('#p-id-hint').textContent = p
    ? 'Het ID verandert nooit meer, ook niet als je de naam aanpast: de voorraad en de winkelmand hangen aan dit ID.'
    : 'Wordt automatisch gemaakt uit de naam en verandert daarna nooit meer.';
  $('#p-foto').value = '';
  $('#p-foto-info').textContent = '';
  toonFotoVoorbeeld(p ? fotoUrl(p.foto_pad) : '');
  $('#product-fouten').replaceChildren();
  $('#product-formulier-titel').textContent = p ? 'Product bewerken' : 'Product toevoegen';
  $('#product-verwijder').hidden = !p;
  $('#producten-lijst-blok').hidden = true;
  $('#product-formulier-blok').hidden = false;
  $('#p-naam').focus();
}

$('#product-nieuw').addEventListener('click', () => openProductFormulier(null));
$('#product-terug').addEventListener('click', toonProductLijst);
$('#product-annuleer').addEventListener('click', toonProductLijst);
// Bij een NIEUW product volgt het ID de naam.
$('#p-naam').addEventListener('input', () => { if (!toestand.bewerkId) $('#p-id').value = slugify($('#p-naam').value); });

/* --- Foto --- */
function toonFotoVoorbeeld(url) {
  $('#p-foto-voorbeeld').replaceChildren(...(url ? [el('img', { src: url, alt: 'Voorbeeld van de foto' })] : []));
  $('#p-foto-weg').hidden = !url;
}

const MAX_ZIJDE = 1200;
const MAX_BYTES = 2 * 1024 * 1024; // limiet van de bucket

function canvasNaarBlob(canvas, type, kwaliteit) {
  return new Promise(resolve => canvas.toBlob(resolve, type, kwaliteit));
}

/* Verkleint de foto in de browser: langste zijde max 1200 px, WebP als de
   browser dat kan (anders JPEG), kwaliteit 0,82. Is het resultaat nog
   groter dan 2 MB, dan proberen we lagere kwaliteit en kleinere maten. */
async function verkleinFoto(bestand) {
  let beeld;
  try { beeld = await createImageBitmap(bestand); }
  catch { throw new Error('Deze foto kan je browser niet openen. Probeer een JPG- of PNG-bestand.'); }
  const pogingen = [[MAX_ZIJDE, 0.82], [MAX_ZIJDE, 0.7], [1000, 0.65], [800, 0.6]];
  try {
    for (const [zijde, kwaliteit] of pogingen) {
      const schaal = Math.min(1, zijde / Math.max(beeld.width, beeld.height));
      const canvas = el('canvas');
      canvas.width = Math.round(beeld.width * schaal);
      canvas.height = Math.round(beeld.height * schaal);
      canvas.getContext('2d').drawImage(beeld, 0, 0, canvas.width, canvas.height);
      let blob = await canvasNaarBlob(canvas, 'image/webp', kwaliteit);
      // Browsers zonder WebP-export geven stilletjes een PNG terug: dan JPEG.
      if (!blob || blob.type !== 'image/webp') blob = await canvasNaarBlob(canvas, 'image/jpeg', kwaliteit);
      if (blob && blob.size <= MAX_BYTES) {
        return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'jpg', breedte: canvas.width, hoogte: canvas.height };
      }
    }
  } finally {
    if (beeld.close) beeld.close();
  }
  throw new Error('De foto blijft te groot, ook na verkleinen. Kies een kleinere foto.');
}

$('#p-foto').addEventListener('change', async e => {
  const bestand = e.target.files && e.target.files[0];
  if (!bestand) return;
  const info = $('#p-foto-info');
  if (!/^image\//.test(bestand.type)) { info.textContent = 'Dit is geen foto. Kies een JPG-, PNG- of WebP-bestand.'; e.target.value = ''; return; }
  info.textContent = 'Foto verkleinen...';
  $('#product-bewaar').disabled = true;
  try {
    const klein = await verkleinFoto(bestand);
    if (toestand.foto) URL.revokeObjectURL(toestand.foto.url);
    toestand.foto = { ...klein, url: URL.createObjectURL(klein.blob) };
    toestand.fotoWeg = false;
    toonFotoVoorbeeld(toestand.foto.url);
    info.textContent = `Klaar: ${klein.breedte} x ${klein.hoogte} px, ${Math.round(klein.blob.size / 1024)} kB. Wordt opgeladen bij Opslaan.`;
  } catch (fout) {
    info.textContent = fout.message;
    e.target.value = '';
  } finally {
    $('#product-bewaar').disabled = false;
  }
});

$('#p-foto-weg').addEventListener('click', () => {
  if (toestand.foto) URL.revokeObjectURL(toestand.foto.url);
  toestand.foto = null;
  toestand.fotoWeg = true;
  $('#p-foto').value = '';
  toonFotoVoorbeeld('');
  $('#p-foto-info').textContent = 'De foto wordt weggehaald bij Opslaan.';
});

/* Een foto uit de bucket halen. Mislukt dat, dan is dat niet erg (alleen
   wat opslagruimte): we loggen het enkel. */
async function verwijderFotoUitOpslag(pad) {
  if (!isBucketPad(pad)) return;
  try {
    const { error } = await sb.storage.from(BUCKET).remove([pad]);
    if (error) throw error;
  } catch (fout) {
    console.warn('Foto kon niet uit de opslag verwijderd worden:', pad, fout);
  }
}

/* --- Opslaan --- */
function leesProductFormulier() {
  const fouten = [];
  const rij = {};
  for (const [veld, kolom] of Object.entries(VELDEN)) {
    const w = $('#' + veld).value.trim();
    rij[kolom] = w === '' ? null : w;
  }
  if (!rij.naam) fouten.push('Vul een naam in.');
  rij.prijs = leesPrijs($('#p-prijs').value);
  if (rij.prijs === null) fouten.push('De prijs is ongeldig. Gebruik alleen cijfers met maximaal 2 cijfers na de komma, bijvoorbeeld 34,95.');
  rij.categorie_id = $('#p-categorie').value || null;
  rij.staat = $('#p-staat').value === 'Tweedehands' ? 'Tweedehands' : 'Nieuw';
  rij.start_voorraad = leesAantal($('#p-voorraad').value);
  if (rij.start_voorraad === undefined) fouten.push('De startvoorraad moet een heel getal zijn (0 of meer), of leeg voor onbeperkt.');
  const volgorde = $('#p-volgorde').value.trim();
  if (!/^-?\d+$/.test(volgorde)) fouten.push('De volgorde moet een heel getal zijn.');
  rij.volgorde = parseInt(volgorde, 10);
  rij.actief = $('#p-actief').checked;

  if (!toestand.bewerkId) {
    rij.id = slugify(rij.naam || '');
    if (rij.naam && !rij.id) fouten.push('Uit deze naam kan geen ID gemaakt worden. Gebruik minstens één letter of cijfer.');
    else if (rij.id && toestand.producten.some(p => p.id === rij.id)) fouten.push(`Er bestaat al een product met het ID "${rij.id}". Kies een andere naam.`);
  }
  return { rij, fouten };
}

$('#product-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { rij, fouten } = leesProductFormulier();
  const foutLijst = $('#product-fouten');
  foutLijst.replaceChildren(...fouten.map(f => el('li', { tekst: f })));
  if (fouten.length) return;

  const bestaand = toestand.bewerkId ? toestand.producten.find(p => p.id === toestand.bewerkId) : null;
  const id = bestaand ? bestaand.id : rij.id;
  const oudPad = bestaand ? bestaand.foto_pad : null;
  const fotoVeranderd = !!toestand.foto || toestand.fotoWeg;
  let gelukt = false;

  await bezig($('#product-bewaar'), async () => {
    let nieuwPad = null;
    try {
      // 1. Eerst de nieuwe foto opladen, zodat we het pad kunnen bewaren.
      if (toestand.foto) {
        const pad = `${id}-${Date.now()}.${toestand.foto.ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(pad, toestand.foto.blob,
          { contentType: toestand.foto.blob.type, cacheControl: '31536000', upsert: false });
        if (error) throw error;
        nieuwPad = pad;
        rij.foto_pad = pad;
      } else if (toestand.fotoWeg) {
        rij.foto_pad = null;
      }
      // 2. Dan de rij zelf. Bij bewerken sturen we het ID NOOIT mee.
      if (bestaand) await dbMinstensEen(sb.from('producten').update(rij).eq('id', id));
      else await db(sb.from('producten').insert(rij));
      gelukt = true;
    } catch (fout) {
      // Opslaan mislukt: een net opgeladen foto heeft geen nut meer.
      if (nieuwPad) await verwijderFotoUitOpslag(nieuwPad);
      foutLijst.replaceChildren(el('li', { tekst: foutTekst(fout) }));
    }
  });
  if (!gelukt) return;

  // 3. Foto vervangen of weggehaald: de oude uit de opslag halen.
  if (oudPad && fotoVeranderd) await verwijderFotoUitOpslag(oudPad);
  if (toestand.foto) URL.revokeObjectURL(toestand.foto.url);
  toestand.foto = null;
  toestand.fotoWeg = false;
  melding(bestaand ? `"${rij.naam}" is opgeslagen.` : `"${rij.naam}" is toegevoegd.`);
  toonProductLijst();
  await herlaad();
});

/* --- Verwijderen (eigen bevestiging, met inactief zetten als veiliger keuze) --- */
$('#product-verwijder').addEventListener('click', async () => {
  const p = toestand.producten.find(x => x.id === toestand.bewerkId);
  if (!p) return;
  const keuze = await vraag({
    titel: 'Product verwijderen?',
    tekst: [
      `Wil je "${p.naam}" definitief verwijderen? Dit kan je niet ongedaan maken. De foto wordt ook uit de opslag verwijderd.`,
      'Veiliger: zet het product op inactief. Dan verdwijnt het uit de winkel, maar kan je het later terug aanzetten.',
    ],
    knoppen: [
      { tekst: 'Annuleren', waarde: null, focus: true },
      { tekst: 'Inactief zetten', waarde: 'inactief', soort: 'primair' },
      { tekst: 'Definitief verwijderen', waarde: 'verwijder', soort: 'gevaar vol' },
    ],
  });
  if (!keuze) return;
  let gelukt = false;
  await bezig($('#product-verwijder'), async () => {
    try {
      if (keuze === 'inactief') {
        await dbMinstensEen(sb.from('producten').update({ actief: false }).eq('id', p.id));
      } else {
        await dbMinstensEen(sb.from('producten').delete().eq('id', p.id));
        await verwijderFotoUitOpslag(p.foto_pad);
      }
      gelukt = true;
    } catch (fout) {
      $('#product-fouten').replaceChildren(el('li', { tekst: foutTekst(fout) }));
    }
  });
  if (!gelukt) return;
  melding(keuze === 'inactief' ? `"${p.naam}" staat nu op inactief.` : `"${p.naam}" is verwijderd.`);
  toonProductLijst();
  await herlaad();
});

/* ===== 9. Bestellingen ================================================== */

function periodeFilter() {
  const vandaag = vandaagSleutel();
  const maand = vandaag.slice(0, 7);
  switch ($('#b-periode').value) {
    case 'vandaag': return k => k === vandaag;
    case 'week': { const ma = maandagVan(vandaag); return k => k >= ma && k <= vandaag; }
    case 'maand': return k => k.startsWith(maand);
    case 'vorige-maand': { const vorige = plusMaanden(maand, -1); return k => k.startsWith(vorige); }
    case 'jaar': return k => k.startsWith(vandaag.slice(0, 4));
    case 'aangepast': {
      const van = $('#b-van').value || '0000-00-00';
      const tot = $('#b-tot').value || '9999-99-99';
      return k => k >= van && k <= tot;
    }
    default: return () => true;
  }
}

function gefilterdeBestellingen() {
  const inPeriode = periodeFilter();
  const q = $('#b-zoek').value.trim().toLowerCase();
  return toestand.bestellingen.filter(b => inPeriode(dagSleutel(b.betaald_op)) && (!q ||
    [b.id, b.klant_naam, b.klant_email, b.klant_land, ...b.regels.map(r => r.product_naam)].join(' ').toLowerCase().includes(q)));
}

const aantalArtikelen = b => b.regels.reduce((s, r) => s + r.aantal, 0);

function tekenBestellingen() {
  $('#b-datums').hidden = $('#b-periode').value !== 'aangepast';
  const lijst = gefilterdeBestellingen();
  const som = lijst.reduce((s, b) => s + centen(b.totaal), 0) / 100;
  $('#b-telling').textContent = `${lijst.length} van ${toestand.bestellingen.length} bestellingen, samen ${euro(som)}. De CSV bevat wat je hier ziet.`;
  $('#b-csv').disabled = lijst.length === 0;
  const rijen = lijst.map(b => el('tr', { 'data-id': b.id },
    el('td', {}, el('div', { tekst: datumTekst(b.betaald_op) }), el('div', { class: 'sub', tekst: tijdTekst(b.betaald_op) })),
    el('td', {}, el('div', { class: 'pnaam', tekst: b.klant_naam || '(geen naam)' }), el('div', { class: 'sub', tekst: b.klant_email || '' })),
    el('td', { class: 'smal-weg' }, el('div', { tekst: `${aantalArtikelen(b)} stuks` }),
      el('div', { class: 'sub', tekst: b.regels.map(r => `${r.aantal}x ${r.product_naam}`).join(', ') })),
    el('td', { class: 'getal', tekst: euro(b.totaal) }),
    el('td', { class: 'smal-weg' }, el('div', { tekst: b.verzendwijze || '-' }), el('div', { class: 'sub', tekst: euro(b.verzendkost) })),
    el('td', {}, el('button', { type: 'button', class: 'knop klein', tekst: 'Bekijken', onclick: () => toonBestellingDetail(b.id) })),
  ));
  $('#b-rijen').replaceChildren(...(rijen.length ? rijen
    : [el('tr', {}, el('td', { colspan: 6, class: 'gedempt',
      tekst: toestand.bestellingen.length ? 'Geen bestellingen in deze periode of zoekopdracht.' : 'Nog geen bestellingen.' }))]));
}
['#b-zoek', '#b-periode', '#b-van', '#b-tot'].forEach(s => $(s).addEventListener('input', tekenBestellingen));

function toonBestellingLijst() {
  $('#bestellingen-lijst-blok').hidden = false;
  $('#bestelling-detail-blok').hidden = true;
}
$('#b-terug').addEventListener('click', toonBestellingLijst);

function toonBestellingDetail(id) {
  const b = toestand.bestellingen.find(x => x.id === id);
  if (!b) return;
  const rij = (term, waarde) => [el('dt', { tekst: term }), el('dd', { tekst: waarde || '-' })];
  const subtotaal = b.regels.reduce((s, r) => s + centen(r.stukprijs) * r.aantal, 0) / 100;
  $('#b-detail').replaceChildren(
    el('dl', { class: 'gegevens' },
      rij('Datum', `${datumTekst(b.betaald_op)} om ${tijdTekst(b.betaald_op)}`),
      rij('Klant', b.klant_naam), rij('E-mail', b.klant_email), rij('Adres', b.klant_adres), rij('Land', b.klant_land),
      rij('Taal', b.taal), rij('Verzending', `${b.verzendwijze || '-'} (${euro(b.verzendkost)})`), rij('Bestelnummer', b.id)),
    el('div', { class: 'tabelwrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', { tekst: 'Product' }), el('th', { class: 'getal', tekst: 'Aantal' }),
        el('th', { class: 'getal', tekst: 'Stukprijs' }), el('th', { class: 'getal', tekst: 'Totaal' }))),
      el('tbody', {}, b.regels.map(r => el('tr', {},
        el('td', {}, el('div', { tekst: r.product_naam }), el('div', { class: 'sub', tekst: r.product_id || '' })),
        el('td', { class: 'getal', tekst: String(r.aantal) }),
        el('td', { class: 'getal', tekst: euro(r.stukprijs) }),
        el('td', { class: 'getal', tekst: euro(centen(r.stukprijs) * r.aantal / 100) })))),
      el('tfoot', {},
        el('tr', {}, el('td', { colspan: 3, tekst: 'Producten' }), el('td', { class: 'getal', tekst: euro(subtotaal) })),
        el('tr', {}, el('td', { colspan: 3, tekst: 'Verzending' }), el('td', { class: 'getal', tekst: euro(b.verzendkost) })),
        el('tr', {}, el('th', { colspan: 3, tekst: 'Betaald' }), el('th', { class: 'getal', tekst: euro(b.totaal) }))))),
  );
  $('#bestellingen-lijst-blok').hidden = true;
  $('#bestelling-detail-blok').hidden = false;
}

/* Eén cel voor de CSV. Tekst die begint met = + - @ (of tab/enter) krijgt
   een ' ervoor, zodat Excel er geen formule van maakt (een klant die
   "=HYPERLINK(...)" als naam invult, kan zo niets uitrichten).
   Bevat de tekst ; " of een enter, dan komt hij tussen aanhalingstekens. */
function csvCel(waarde, isGetal) {
  if (waarde === null || waarde === undefined) return '';
  let t = isGetal ? komma(waarde) : String(waarde);
  if (!isGetal && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  if (/[;"\r\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
  return t;
}

/* CSV voor de boekhouder: puntkomma's (Belgische Excel), komma als
   decimaalteken, UTF-8 met BOM zodat Excel é en ü goed toont.
   Eén rij per bestelregel. */
function maakBestellingenCsv(lijst) {
  const kop = ['Bestelnummer', 'Datum', 'Tijd', 'Klant', 'E-mail', 'Adres', 'Land', 'Verzendwijze', 'Verzendkost',
    'Totaal bestelling', 'Product-ID', 'Product', 'Aantal', 'Stukprijs', 'Regeltotaal'];
  const regels = [kop.join(';')];
  for (const b of lijst) {
    const basis = [csvCel(b.id), csvCel(datumTekst(b.betaald_op)), csvCel(tijdTekst(b.betaald_op)), csvCel(b.klant_naam),
      csvCel(b.klant_email), csvCel(b.klant_adres), csvCel(b.klant_land), csvCel(b.verzendwijze),
      csvCel(b.verzendkost, true), csvCel(b.totaal, true)];
    const lijnen = b.regels.length ? b.regels : [null]; // bestelling zonder regels: toch één rij
    for (const r of lijnen) {
      regels.push(basis.concat(r
        ? [csvCel(r.product_id), csvCel(r.product_naam), String(r.aantal), csvCel(r.stukprijs, true),
          csvCel(centen(r.stukprijs) * r.aantal / 100, true)]
        : ['', '', '', '', '']).join(';'));
    }
  }
  return '﻿' + regels.join('\r\n') + '\r\n';
}

$('#b-csv').addEventListener('click', () => {
  const lijst = gefilterdeBestellingen();
  if (lijst.length) download(`bestellingen-${vandaagSleutel()}.csv`, maakBestellingenCsv(lijst), 'text/csv;charset=utf-8');
});

/* ===== 10. Categorieën ================================================== */

function tekenCategorieen() {
  const cats = toestand.categorieen;
  const rijen = cats.map((c, i) => {
    const n = toestand.producten.filter(p => p.categorie_id === c.id).length;
    const veld = (label, kolom) => {
      const vid = `cat-${kolom}-${c.id}`;
      return el('div', {}, el('label', { for: vid, tekst: label }),
        el('input', { type: 'text', id: vid, 'data-kolom': kolom, maxlength: 100, value: c[kolom] || '' }));
    };
    const op = el('button', { type: 'button', class: 'knop icoon', 'aria-label': `${c.naam} hoger zetten`, title: 'Hoger',
      onclick: e => verschuif('categorieen', c.id, -1, e.currentTarget) }, pijl('op'));
    const neer = el('button', { type: 'button', class: 'knop icoon', 'aria-label': `${c.naam} lager zetten`, title: 'Lager',
      onclick: e => verschuif('categorieen', c.id, 1, e.currentTarget) }, pijl('neer'));
    op.disabled = i === 0;
    neer.disabled = i === cats.length - 1;
    const rij = el('div', { class: 'catrij', 'data-id': c.id }, veld('Naam', 'naam'), veld('Frans', 'naam_fr'), veld('Duits', 'naam_de'));
    rij.append(el('div', { class: 'acties' }, op, neer,
      el('button', { type: 'button', class: 'knop klein', tekst: 'Opslaan', onclick: e => bewaarCategorie(c.id, rij, e.currentTarget) }),
      el('button', { type: 'button', class: 'knop klein gevaar', tekst: 'Verwijderen', onclick: e => verwijderCategorie(c, n, e.currentTarget) }),
      el('span', { class: 'sub', tekst: `${n} ${n === 1 ? 'product' : 'producten'}` })));
    return rij;
  });
  $('#categorie-rijen').replaceChildren(...(rijen.length ? rijen : [el('p', { class: 'gedempt', tekst: 'Nog geen categorieën.' })]));
}

/* Hernoemen: alleen de namen veranderen, het ID blijft (producten verwijzen ernaar). */
async function bewaarCategorie(id, rij, knop) {
  const waarde = k => rij.querySelector(`[data-kolom="${k}"]`).value.trim() || null;
  const wijziging = { naam: waarde('naam'), naam_fr: waarde('naam_fr'), naam_de: waarde('naam_de') };
  if (!wijziging.naam) return melding('Een categorie moet een naam hebben.', 'fout');
  let gelukt = false;
  await bezig(knop, async () => {
    try { await dbMinstensEen(sb.from('categorieen').update(wijziging).eq('id', id)); gelukt = true; }
    catch (fout) { melding(foutTekst(fout), 'fout'); }
  });
  if (gelukt) { melding(`Categorie "${wijziging.naam}" is opgeslagen.`); await herlaad(); }
}

async function verwijderCategorie(c, aantal, knop) {
  const keuze = await vraag({
    titel: 'Categorie verwijderen?',
    tekst: [`Wil je de categorie "${c.naam}" verwijderen?`,
      aantal
        ? `${aantal} ${aantal === 1 ? 'product blijft gewoon bestaan, maar heeft' : 'producten blijven gewoon bestaan, maar hebben'} daarna geen categorie meer.`
        : 'Er zitten geen producten in deze categorie.'],
    knoppen: [{ tekst: 'Annuleren', waarde: null, focus: true }, { tekst: 'Verwijderen', waarde: 'ja', soort: 'gevaar vol' }],
  });
  if (keuze !== 'ja') return;
  let gelukt = false;
  await bezig(knop, async () => {
    try { await dbMinstensEen(sb.from('categorieen').delete().eq('id', c.id)); gelukt = true; }
    catch (fout) { melding(foutTekst(fout), 'fout'); }
  });
  if (gelukt) { melding(`Categorie "${c.naam}" is verwijderd.`); await herlaad(); }
}

$('#categorie-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fout = $('#categorie-fout');
  const naam = $('#c-naam').value.trim();
  const id = slugify(naam);
  fout.textContent = '';
  if (!naam) { fout.textContent = 'Vul een naam in.'; return; }
  if (!id) { fout.textContent = 'Uit deze naam kan geen ID gemaakt worden. Gebruik minstens één letter of cijfer.'; return; }
  if (toestand.categorieen.some(c => c.id === id)) { fout.textContent = `Er bestaat al een categorie met het ID "${id}".`; return; }
  const rij = { id, naam, naam_fr: $('#c-naam-fr').value.trim() || null, naam_de: $('#c-naam-de').value.trim() || null,
    volgorde: Math.max(0, ...toestand.categorieen.map(c => c.volgorde)) + 1 };
  let gelukt = false;
  await bezig($('#c-toevoegen'), async () => {
    try { await db(sb.from('categorieen').insert(rij)); gelukt = true; }
    catch (f) { fout.textContent = foutTekst(f); }
  });
  if (!gelukt) return;
  e.target.reset();
  melding(`Categorie "${naam}" is toegevoegd.`);
  await herlaad();
});

/* ===== 11. Instellingen ================================================= */

$('#drempel-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fout = $('#drempel-fout');
  const n = leesAantal($('#drempel').value);
  fout.textContent = '';
  if (n === null || n === undefined || n > 999) { fout.textContent = 'Vul een heel getal in tussen 0 en 999.'; return; }
  let gelukt = false;
  await bezig($('#drempel-bewaar'), async () => {
    try {
      // INSERT ... ON CONFLICT (sleutel) DO UPDATE
      await db(sb.from('instellingen').upsert({ sleutel: 'lage_voorraad_drempel', waarde: n }, { onConflict: 'sleutel' }));
      gelukt = true;
    } catch (f) { fout.textContent = foutTekst(f); }
  });
  if (gelukt) { melding(`Opgeslagen: waarschuwen vanaf ${n} stuks of minder.`); await herlaad(); }
});

/* --- Export: één JSON-bestand met alle categorieën en producten --- */
const EXPORT_FORMAAT = 'jvparts-producten';
const TEKST_KOLOMMEN = ['naam_fr', 'naam_de', 'subtitel', 'subtitel_fr', 'subtitel_de', 'foto_pad',
  'beschrijving', 'beschrijving_fr', 'beschrijving_de'];

$('#export-knop').addEventListener('click', e => bezig(e.currentTarget, async () => {
  try {
    // Vers uit de database, niet uit het geheugen van de pagina.
    const [categorieen, producten] = await Promise.all([
      db(sb.from('categorieen').select('*').order('volgorde').order('naam')),
      db(sb.from('producten').select('*').order('volgorde').order('naam')),
    ]);
    const inhoud = { formaat: EXPORT_FORMAAT, versie: 1, geexporteerd: new Date().toISOString(), categorieen, producten };
    download(`jvparts-producten-${vandaagSleutel()}.json`, JSON.stringify(inhoud, null, 2), 'application/json');
    melding(`Export klaar: ${categorieen.length} categorieën en ${producten.length} producten.`);
  } catch (fout) { melding(foutTekst(fout), 'fout'); }
}));

/* --- Import: controleren, tonen wat er verandert, pas dan schrijven --- */
const ID_REGEL = /^[a-z0-9]+(-[a-z0-9]+)*$/; // zelfde regel als de check in schema.sql
const tekstOfNull = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));

/* Controleert een exportbestand. Geeft { categorieen, producten, fouten }
   terug, met rijen die alleen bekende kolommen bevatten. */
function controleerImport(data) {
  if (!data || data.formaat !== EXPORT_FORMAAT || !Array.isArray(data.categorieen) || !Array.isArray(data.producten)) {
    return { categorieen: [], producten: [], fouten: ['Dit is geen exportbestand van het JV Parts-beheer.'] };
  }
  const fouten = [];
  const catIds = new Set();
  const categorieen = data.categorieen.map((c, i) => {
    const waar = `Categorie ${i + 1}`;
    c = c && typeof c === 'object' ? c : {};
    if (!ID_REGEL.test(String(c.id))) fouten.push(`${waar}: ongeldig ID.`);
    if (catIds.has(c.id)) fouten.push(`${waar}: ID komt twee keer voor.`);
    catIds.add(c.id);
    if (!tekstOfNull(c.naam)) fouten.push(`${waar}: naam ontbreekt.`);
    return { id: c.id, naam: tekstOfNull(c.naam), naam_fr: tekstOfNull(c.naam_fr), naam_de: tekstOfNull(c.naam_de),
      volgorde: Number.isInteger(c.volgorde) ? c.volgorde : 0 };
  });
  const bekendeCats = new Set([...catIds, ...toestand.categorieen.map(c => c.id)]);
  const prodIds = new Set();
  const producten = data.producten.map((p, i) => {
    p = p && typeof p === 'object' ? p : {};
    const waar = `Product ${i + 1}` + (p.naam ? ` ("${p.naam}")` : '');
    if (!ID_REGEL.test(String(p.id))) fouten.push(`${waar}: ongeldig ID.`);
    if (prodIds.has(p.id)) fouten.push(`${waar}: ID komt twee keer voor.`);
    prodIds.add(p.id);
    if (typeof p.naam !== 'string' || !tekstOfNull(p.naam)) fouten.push(`${waar}: naam ontbreekt of is geen tekst.`);
    for (const k of TEKST_KOLOMMEN) {
      if (p[k] !== undefined && p[k] !== null && typeof p[k] !== 'string') fouten.push(`${waar}: ${k} moet tekst zijn.`);
    }
    const prijs = p.prijs;
    if (typeof prijs !== 'number' || !(prijs >= 0) || prijs > MAX_PRIJS || Math.abs(Math.round(prijs * 100) - prijs * 100) > 1e-6) fouten.push(`${waar}: ongeldige prijs (een getal, bv. 12.5).`);
    if (p.aangemaakt !== undefined && p.aangemaakt !== null && (typeof p.aangemaakt !== 'string' || isNaN(Date.parse(p.aangemaakt)))) fouten.push(`${waar}: ongeldige datum bij "aangemaakt".`);
    if (!['Nieuw', 'Tweedehands'].includes(p.staat)) fouten.push(`${waar}: staat moet Nieuw of Tweedehands zijn.`);
    const voorraad = p.start_voorraad ?? null;
    if (voorraad !== null && !(Number.isInteger(voorraad) && voorraad >= 0)) fouten.push(`${waar}: ongeldige startvoorraad.`);
    if (p.categorie_id && !bekendeCats.has(p.categorie_id)) fouten.push(`${waar}: onbekende categorie "${p.categorie_id}".`);
    if (p.actief !== undefined && typeof p.actief !== 'boolean') fouten.push(`${waar}: actief moet true of false zijn.`);
    const rij = { id: p.id, naam: tekstOfNull(p.naam), prijs, categorie_id: p.categorie_id || null, staat: p.staat,
      start_voorraad: voorraad, volgorde: Number.isInteger(p.volgorde) ? p.volgorde : 0, actief: p.actief !== false };
    for (const k of TEKST_KOLOMMEN) rij[k] = tekstOfNull(p[k]);
    if (p.aangemaakt) rij.aangemaakt = p.aangemaakt; // anders vult de database "nu" in
    return rij;
  });
  return { categorieen, producten, fouten };
}

function toonImportVoorbeeld(resultaat) {
  const doos = $('#import-voorbeeld');
  doos.hidden = false;
  if (resultaat.fouten.length) {
    doos.replaceChildren(el('p', { class: 'formmelding', tekst: 'Dit bestand kan niet geïmporteerd worden:' }),
      el('ul', { class: 'importlijst formmelding' }, resultaat.fouten.slice(0, 20).map(f => el('li', { tekst: f }))));
    return;
  }
  const { categorieen, producten } = resultaat;
  const bestaatCat = new Set(toestand.categorieen.map(c => c.id));
  const bestaatProd = new Set(toestand.producten.map(p => p.id));
  const namen = l => l.map(x => x.naam).join(', ') || '-';
  const deel = (lijst, bestaat) => [lijst.filter(x => !bestaat.has(x.id)), lijst.filter(x => bestaat.has(x.id))];
  const [nieuwC, bijC] = deel(categorieen, bestaatCat);
  const [nieuwP, bijP] = deel(producten, bestaatProd);
  const knop = el('button', { type: 'button', class: 'knop primair', id: 'import-bevestig', tekst: 'Importeren bevestigen' });
  knop.addEventListener('click', () => voerImportUit(resultaat, knop));
  doos.replaceChildren(
    el('h3', { tekst: 'Dit gaat er gebeuren' }),
    el('ul', { class: 'importlijst' },
      el('li', { tekst: `Nieuwe categorieën (${nieuwC.length}): ${namen(nieuwC)}` }),
      el('li', { tekst: `Bijgewerkte categorieën (${bijC.length}): ${namen(bijC)}` }),
      el('li', { tekst: `Nieuwe producten (${nieuwP.length}): ${namen(nieuwP)}` }),
      el('li', { tekst: `Bijgewerkte producten (${bijP.length}): ${namen(bijP)}` })),
    el('p', { class: 'hint', tekst: 'Er wordt niets verwijderd. De foto\'s zelf zitten niet in het bestand: komt het uit een andere database, dan moet je de foto\'s daar opnieuw opladen.' }),
    el('div', { class: 'knoppen' }, knop,
      el('button', { type: 'button', class: 'knop', tekst: 'Annuleren', onclick: () => { doos.hidden = true; $('#import-bestand').value = ''; } })),
  );
}

async function voerImportUit({ categorieen, producten }, knop) {
  let gelukt = false;
  await bezig(knop, async () => {
    try {
      // Eerst categorieën (producten verwijzen ernaar), dan producten.
      // upsert = INSERT ... ON CONFLICT (id) DO UPDATE: toevoegen of bijwerken, nooit verwijderen.
      if (categorieen.length) await db(sb.from('categorieen').upsert(categorieen, { onConflict: 'id' }));
      if (producten.length) {
        try { await db(sb.from('producten').upsert(producten, { onConflict: 'id' })); }
        catch (fout) { fout.deels = categorieen.length > 0; throw fout; }
      }
      gelukt = true;
    } catch (fout) {
      melding(foutTekst(fout) + (fout.deels ? ' Let op: de categorieën zijn wel al opgeslagen, de producten niet.' : ''), 'fout');
    }
  });
  if (!gelukt) return;
  $('#import-voorbeeld').hidden = true;
  $('#import-bestand').value = '';
  melding(`Import klaar: ${categorieen.length} categorieën en ${producten.length} producten verwerkt.`);
  await herlaad();
}

$('#import-bestand').addEventListener('change', async e => {
  const bestand = e.target.files && e.target.files[0];
  if (!bestand) return;
  let data;
  try { data = JSON.parse(await bestand.text()); }
  catch { toonImportVoorbeeld({ fouten: ['Dit bestand is geen geldige JSON.'] }); return; }
  toonImportVoorbeeld(controleerImport(data));
});

/* ===== 12. Start ======================================================== */

async function start() {
  if (!sb) {
    toonLogin();
    loginMelding('De verbinding met de database kon niet geladen worden. Controleer je internet en herlaad de pagina.');
    $('#login-knop').disabled = true;
    return;
  }
  // In deze callback geen andere Supabase-aanroepen afwachten (dat kan
  // vastlopen in supabase-js), daarom setTimeout.
  sb.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') { herstelModus = true; setTimeout(() => toonScherm('nieuw-wachtwoord'), 0); }
    if (event === 'SIGNED_OUT') setTimeout(() => { if ($('#scherm-login').hidden) toonLogin(); }, 0);
  });
  const { data, error } = await sb.auth.getSession();
  if (herstelModus && data.session) { toonScherm('nieuw-wachtwoord'); return; }
  if (error || !data.session) {
    toonLogin();
    if (HERSTELLINK_FOUT) loginMelding('Deze link is verlopen of al gebruikt. Vraag een nieuwe aan via Wachtwoord vergeten.');
    else if (error) loginMelding(foutTekst(error));
    return;
  }
  await naInloggen(data.session);
}

start();
