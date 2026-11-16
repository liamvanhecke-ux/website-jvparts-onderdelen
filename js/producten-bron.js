/* ===== Waar de producten vandaan komen =====
   Vroeger las de site data/products.json. Nu staan de producten in de
   database (Supabase). laadProducten() haalt ze daar op en zet ze om naar
   de OUDE vorm (name, subtitle, price als "34,95", category, ...), zodat
   index.js, product.js en suggesties.js gewoon verder werken zoals vroeger.

   Dit bestand moet NA js/cart.js (voor slugify) en NA js/config.js (voor
   SUPABASE_URL en SUPABASE_KEY) geladen worden.

   Reserve: lukt de database niet (storing, te traag, project gepauzeerd),
   dan gebruiken we data/products.json, zodat de winkel blijft werken. */

const PRODUCTEN_TIMEOUT_MS = 6000; // langer dan 6 seconden wachten we niet

/* Het ID van een product. Uit de database komt het veld "id", dat nooit
   meer verandert (ook niet als de naam wijzigt). De reserve products.json
   heeft geen id: daar maken we het zoals vroeger uit de naam. */
function productId(p) {
    return p.id || slugify(p.name);
}

/* Maakt van het fotopad uit de database een volledig adres.
   Begint het al met http of /, dan is het al volledig. Geen foto = "". */
function fotoAdres(fotoPad) {
    if (!fotoPad) return '';
    if (fotoPad.startsWith('http') || fotoPad.startsWith('/')) return fotoPad;
    return SUPABASE_URL + '/storage/v1/object/public/productfotos/' + fotoPad;
}

/* Zet één rij uit de database om naar de oude vorm van products.json.
   Lege vertalingen (null) worden een lege tekst. */
function naarOudeVorm(rij) {
    const categorie = rij.categorie || {};
    const product = {
        id:              rij.id,
        name:            rij.naam || '',
        name_fr:         rij.naam_fr || '',
        name_de:         rij.naam_de || '',
        subtitle:        rij.subtitel || '',
        subtitle_fr:     rij.subtitel_fr || '',
        subtitle_de:     rij.subtitel_de || '',
        price:           Number(rij.prijs).toFixed(2).replace('.', ','),
        category:        categorie.naam || '',
        category_fr:     categorie.naam_fr || '',
        category_de:     categorie.naam_de || '',
        condition:       rij.staat || '',
        image:           fotoAdres(rij.foto_pad),
        beschrijving:    rij.beschrijving || '',
        beschrijving_fr: rij.beschrijving_fr || '',
        beschrijving_de: rij.beschrijving_de || '',
    };
    /* Geen startvoorraad ingevuld (null) = onbeperkt: dan laten we het veld
       weg, net zoals een product zonder "stock" in products.json. */
    if (rij.start_voorraad !== null && rij.start_voorraad !== undefined) {
        product.stock = rij.start_voorraad;
    }
    return product;
}

/* Haalt de actieve producten uit de database. Gooit een fout als er iets
   misloopt; laadProducten() vangt die op en neemt dan de reserve. */
async function laadProductenUitDatabase() {
    // typeof: zo crasht een pagina die js/config.js vergat te laden niet
    const url = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
    const sleutel = typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '';
    if (!url || !sleutel) throw new Error('Geen database ingesteld (js/config.js)');

    // Na 6 seconden breken we de aanvraag zelf af
    const afbreker = new AbortController();
    const timer = setTimeout(() => afbreker.abort(), PRODUCTEN_TIMEOUT_MS);
    try {
        const res = await fetch(
            url + '/rest/v1/producten?select=*,categorie:categorieen(naam,naam_fr,naam_de)&actief=eq.true&order=volgorde.asc,naam.asc',
            { headers: { apikey: sleutel }, signal: afbreker.signal }
        );
        if (!res.ok) throw new Error('Database antwoordt met ' + res.status);
        const rijen = await res.json();
        if (!Array.isArray(rijen)) throw new Error('Onverwacht antwoord van de database');
        return rijen.map(naarOudeVorm);
    } finally {
        clearTimeout(timer);
    }
}

/* Dit is de functie die de pagina's gebruiken: geeft een lijst producten
   terug in de oude vorm (+ id). Eerst de database, anders de reserve. */
async function laadProducten() {
    try {
        return await laadProductenUitDatabase();
    } catch (err) {
        console.warn('Database niet bereikbaar, data/products.json wordt gebruikt.', err);
        const res = await fetch('/data/products.json');
        const data = await res.json();
        return data.products || [];
    }
}
