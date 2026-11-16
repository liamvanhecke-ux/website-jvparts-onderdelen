# Plan: producten van JV Parts naar Supabase

> **Hoe starten:** zeg tegen Claude: *"lees `database/PLAN-supabase.md` en start maar"*.
> Dit bestand bevat alle beslissingen. Claude hoeft niets opnieuw te vragen, behalve de
> punten onder **Eerst bevestigen**.

Opgesteld op 16 november 2026. Status: **in opbouw sinds 16/11.**
Het project `jv-parts` (id `vuscwojadpdyzzgzsofz`, regio eu-central-1) bestaat; het oude
`liamvanhecke-ux's Project` is gepauzeerd op vraag van Liam. Schema, beveiliging en de 6 producten
staan erin. De afspraken voor de code staan in `database/CONTRACT.md`.

---

## 1. Waarom

- Elke productwijziging via het oude beheer (Decap) = een commit = een Netlify-deploy = 15 credits.
  Het gratis plan heeft er 300 per maand.
- Doel: producten aanpassen zonder deploy, en zo weinig mogelijk Netlify-credits per bezoeker.

## 2. Beslissingen (genomen door Liam)

| Onderwerp | Beslissing |
|---|---|
| Waar | Supabase (PostgreSQL). Niet lokaal, niet MySQL, niet Netlify Blobs. |
| Omvang stap 1a | Producten, categorieën en foto's. Voorraad en betaalflow blijven in Netlify Blobs. |
| Omvang stap 1b | Dashboard in het beheer: verkoopcijfers, grafieken, bestellingen, meldingen bij lage voorraad (zie 5.7). Toegevoegd door Liam op 16/11. |
| Omvang stap 2 (later) | Voorraad en reserveringen ook naar Supabase. Apart plan, pas na stap 1. |
| Inloggen beheerder | E-mail + wachtwoord via Supabase Auth. Geen registratiepagina. |
| Beheerpagina | Blijft op `/jv-werkbank/`. Geen zichtbare knop op de site. |
| Eigenaar | Bouwen en testen in het account van Liam, later overzetten naar Jelle. |
| Stijl | De bestaande stijl van de site behouden (kleuren, vormen, lettertype). |
| Git | Niets committen of pushen tenzij Liam het vraagt. Geen "Co-Authored-By" of sessieregel in commits. |

## 3. Eerst bevestigen (1 vraag aan Liam bij de start)

1. **Project:** bouwen in het bestaande Supabase-project `liamvanhecke-ux's Project`
   (id `imkseqqpilssfugpgnvq`)? Op 16/11 gaf dat project een time-out bij het opvragen van de
   tabellen: eerst controleren of het actief is en of er al tabellen in staan die niet van JV Parts zijn.
   Alternatief: een van de twee actieve projecten pauzeren en een nieuw project `jv-parts` maken
   (kost bevestigen via de Supabase-koppeling).

## 4. Hoe het nu werkt (stand van de code)

| Onderdeel | Nu |
|---|---|
| Producten | `data/products.json` in de repo, bewerkt met Decap CMS (`jv-werkbank/index.html` + `config.yml`) |
| Categorieën | `data/categorieen/*.md` (Decap) + het veld `category` per product |
| Product-ID | `slugify(name)` (zie `js/cart.js` en `netlify/lib/voorraad.mjs`). De voorraad in Blobs hangt aan dit ID. |
| Prijs | Tekst met komma, bv. `"34,95"` |
| Site leest producten | `fetch('/data/products.json')` in `js/index.js`, `js/product.js`, `js/suggesties.js`, `jv-werkbank/voorraad.html` |
| Server leest producten | `netlify/lib/voorraad.mjs` importeert `products.json` statisch: `producten`, `zoekProduct(id)`, `startVoorraad`, `leesAlles()` |
| Prijscontrole bij betalen | `netlify/functions/create-checkout-session.mjs` gebruikt `zoekProduct(item.id)` |
| Login beheer | Netlify Identity (widget op `index.html`, `jv-werkbank/index.html`, `jv-werkbank/voorraad.html`); `netlify/functions/voorraad.mjs` controleert het Identity-token |
| CSP | `netlify.toml`, per pagina een eigen blok; `/jv-werkbank` heeft geen CSP |

## 5. Ontwerp

### 5.1 Database (`database/schema.sql`, leesbare standaard-SQL)

```
categorieen
  id          text  PK      -- slug, bv. "motor"
  naam        text  NOT NULL
  naam_fr     text
  naam_de     text
  volgorde    int   DEFAULT 0

producten
  id            text  PK    -- = slugify(naam), ZELFDE als nu (voorraadsleutel!)
  naam          text  NOT NULL
  naam_fr, naam_de                text
  subtitel, subtitel_fr, subtitel_de   text
  prijs         numeric(10,2) NOT NULL CHECK (prijs >= 0)
  categorie_id  text  FK -> categorieen(id)
  staat         text  NOT NULL CHECK (staat IN ('Nieuw','Tweedehands'))
  start_voorraad int            -- NULL = onbeperkt (zoals nu een product zonder "stock")
  foto_pad      text            -- pad in de storage-bucket, NULL = geen foto
  beschrijving, beschrijving_fr, beschrijving_de  text
  volgorde      int   DEFAULT 0
  actief        bool  DEFAULT true
  aangemaakt    timestamptz DEFAULT now()
  bijgewerkt    timestamptz DEFAULT now()

beheerders
  user_id  uuid PK FK -> auth.users(id)   -- wie mag wijzigen
```

### 5.2 Beveiliging (Row Level Security, staat ook in `schema.sql`)

| Tabel | Lezen | Schrijven |
|---|---|---|
| `producten` | iedereen, alleen rijen met `actief = true`; beheerders alles | alleen wie in `beheerders` staat |
| `categorieen` | iedereen | alleen beheerders |
| `beheerders` | alleen de eigen rij | niemand via de API (alleen via het dashboard / SQL) |
| Storage-bucket `productfotos` | publiek lezen | alleen beheerders |

- Registratie (sign-ups) UIT in Supabase Auth. Een ingelogde gebruiker die niet in `beheerders`
  staat kan dus niets wijzigen.
- In de browser komt alleen de **publieke (anon) sleutel**. De service-sleutel komt nergens in de code.
- Na het aanmaken: de security-advisors van Supabase laten lopen en alles oplossen wat ze melden.

### 5.3 Website (publiek)

- `js/config.js` (nieuw): `SUPABASE_URL` en `SUPABASE_ANON_KEY`. Dit is de ENIGE plek waar het project staat.
- `js/producten-bron.js` (nieuw): `laadProducten()`.
  - Haalt producten op via de REST-API van Supabase met gewone `fetch` (geen extra bibliotheek).
  - Zet ze om naar de OUDE vorm (`name`, `name_fr`, `subtitle`, `price` als `"34,95"`, `category`,
    `category_fr`, `condition`, `stock`, `image` als volledige URL, `beschrijving`...), zodat
    `index.js`, `product.js` en `suggesties.js` verder ongewijzigd blijven.
  - **Reserve:** lukt Supabase niet (storing, project gepauzeerd), dan `data/products.json` gebruiken.
- In `js/index.js`, `js/product.js`, `js/suggesties.js`: alleen `fetch('/data/products.json')`
  vervangen door `laadProducten()`. Script-tags toevoegen op de pagina's die het nodig hebben.
- `netlify.toml`: in de CSP van elke pagina `connect-src` en `img-src` uitbreiden met het
  Supabase-adres. `herroepen.html` niet vergeten. Geen andere hosts toevoegen.
- `index.html`: de Netlify Identity-widget weghalen zodra het nieuwe beheer werkt.

### 5.4 Server (Netlify-functies)

- `netlify/lib/producten.mjs` (nieuw): `haalProducten()` leest uit Supabase met de anon-sleutel uit
  omgevingsvariabelen `SUPABASE_URL` en `SUPABASE_ANON_KEY`, met een korte cache in het geheugen
  (bv. 60 s). Reserve: `data/products.json`.
- `netlify/lib/voorraad.mjs`: `zoekProduct`, `leesAlles` en `startVoorraad` gebruiken die bron.
  `zoekProduct` wordt daardoor **async**: alle aanroepen aanpassen
  (`create-checkout-session.mjs` r. 106, `voorraad.mjs` r. 42, intern `maakToestand`).
- **De prijs bij het afrekenen komt altijd van de server (database), nooit uit de browser.** Dat is nu
  al zo en moet zo blijven.
- `netlify/functions/voorraad.mjs`: `isAdmin` controleert voortaan een Supabase-token
  (`GET {SUPABASE_URL}/auth/v1/user` met het token, daarna nagaan of de gebruiker in `beheerders` staat).

### 5.5 Beheerpagina (`/jv-werkbank/`)

- `jv-werkbank/index.html` wordt een eigen pagina (zelfde stijl als `voorraad.html`), met `supabase-js`
  via `cdn.jsdelivr.net`:
  - inlogscherm (e-mail + wachtwoord), uitloggen, "wachtwoord vergeten"
  - lijst van producten met zoeken; toevoegen, bewerken, verwijderen (met bevestiging), actief/inactief
  - alle velden van nu, inclusief FR/DE en beschrijving; prijs als getal met komma of punt
  - foto opladen: in de browser verkleinen (max. ongeveer 1200 px, JPEG/WebP) vóór het opladen
  - categorieën beheren
  - volgorde aanpassen
  - **Exporteren / Importeren** van alle producten als JSON (back-up en verhuis naar Jelle)
  - waarschuwing bij het hernoemen van een product: het ID blijft hetzelfde (de voorraad hangt eraan)
- `jv-werkbank/voorraad.html`: login omzetten van Netlify Identity naar Supabase; producten uit Supabase.
- Oude Decap-bestanden (`config.yml`, de oude `index.html`) bewaren als `jv-werkbank/oud-decap/`
  tot alles getest is. Niets verwijderen zonder dat Liam het vraagt.

### 5.7 Dashboard in het beheer (stap 1b, gevraagd door Liam)

Liam wil dat de beheerder op één pagina alles ziet en kan aanpassen: producten, beschrijvingen,
foto's, grafieken van de verkoop, aantal verkocht, en meldingen als een product bijna op is.

**Schermen in `/jv-werkbank/`** (één pagina met tabs of een zijmenu, zelfde stijl als de site):

| Scherm | Inhoud |
|---|---|
| Overzicht | Omzet vandaag / deze week / deze maand, aantal bestellingen, gemiddelde bestelwaarde. Grafiek van de omzet per dag (laatste 30 dagen) en per maand. Top 5 best verkochte producten. Blok "Aandacht nodig" (zie meldingen). |
| Producten | Zie 5.5: lijst, zoeken, toevoegen, bewerken (ook beschrijvingen en FR/DE), foto's, actief/inactief, volgorde. Per product ook: aantal verkocht en huidige voorraad. |
| Bestellingen | Lijst van bestellingen (datum, klant, artikelen, bedrag, verzendwijze), zoeken en filteren op periode, detail per bestelling. Export als CSV voor de boekhouding. |
| Voorraad | De bestaande voorraadpagina, als tab. |
| Categorieën | Beheren en vertalen. |
| Instellingen | Export / import van producten, drempel voor "bijna op". |

**Meldingen ("Aandacht nodig" + een teller in het menu):**

- product bijna op (voorraad <= drempel, standaard 2) of uitverkocht
- product zonder foto, zonder beschrijving of zonder FR/DE-vertaling
- later, als de mail werkt (domein + Resend): een e-mail naar de beheerder zodra een product onder de drempel zakt

**Waar komen de cijfers vandaan?**

- Bestellingen staan nu alleen in Netlify Blobs (`bestellingen` in `netlify/lib/voorraad.mjs`, gevuld door
  `netlify/functions/stripe-webhook.mjs`). Daar kan je geen grafieken op maken.
- Nieuw: de webhook schrijft elke betaalde bestelling OOK naar Supabase. Blobs blijft de bron voor de
  voorraad; dit is een extra kopie voor de cijfers. Mislukt het schrijven naar Supabase, dan mag de
  betaling/voorraad daar NIET door mislukken (alleen loggen).
- Extra tabellen in `schema.sql`:

```
bestellingen
  id            text  PK          -- de Stripe-sessie (cs_...), voorkomt dubbels
  betaald_op    timestamptz NOT NULL
  totaal        numeric(10,2) NOT NULL
  verzendkost   numeric(10,2) NOT NULL DEFAULT 0
  verzendwijze  text
  klant_naam, klant_email, klant_adres, klant_land  text
  taal          text

bestelregels
  id            bigint identity PK
  bestelling_id text  FK -> bestellingen(id) ON DELETE CASCADE
  product_id    text              -- GEEN FK: een product kan later verwijderd worden
  product_naam  text  NOT NULL    -- naam op het moment van de aankoop
  aantal        int   NOT NULL CHECK (aantal > 0)
  stukprijs     numeric(10,2) NOT NULL
```

- De cijfers zijn gewone SQL (handig voor het vak Databases), bv. als views:
  `omzet_per_dag` (GROUP BY dag), `verkocht_per_product` (SUM(aantal) GROUP BY product_id).
- Beveiliging: `bestellingen` en `bestelregels` zijn ALLEEN leesbaar voor beheerders, voor niemand
  anders (persoonsgegevens). Schrijven gebeurt alleen door de webhook, met de **service-sleutel**
  in de omgevingsvariabele `SUPABASE_SERVICE_KEY`. Die sleutel staat alleen in Netlify, nooit in de
  browser of in de repo.
- De lage voorraad leest het dashboard in stap 1 via de bestaande voorraadfunctie (Blobs); na stap 2 uit de database.
- Grafieken: zelf tekenen met SVG of Chart.js via `cdn.jsdelivr.net` (het beheer heeft geen CSP).
- Privacybeleid aanpassen: Supabase vermelden als verwerker van bestel- en klantgegevens.
- Bestaande bestellingen uit Blobs één keer overzetten, als er al zijn.

### 5.6 Gegevens overzetten

- De 6 producten uit `data/products.json` en hun categorieën in de database zetten (`database/seed.sql`).
- ID = `slugify(name)`; controleren dat elk ID gelijk is aan het huidige (voorraadsleutel in Blobs).
- Prijs `"34,95"` wordt `34.95`.
- `data/products.json` blijft bestaan als reserve.

## 6. Uitvoering (agent-team, zie de skill `agent-team`)

| Wie | Eigen bestanden | Taak |
|---|---|---|
| Baas (Claude zelf) | `database/schema.sql`, `database/seed.sql`, Supabase via de koppeling | Schema en beveiliging aanmaken, seed, advisors, contract bewaken |
| Agent site | `js/config.js`, `js/producten-bron.js`, `js/index.js`, `js/product.js`, `js/suggesties.js`, de `.html`-pagina's (script-tags), `netlify.toml` | 5.3 |
| Agent server | `netlify/lib/producten.mjs`, `netlify/lib/voorraad.mjs`, `netlify/functions/*.mjs` | 5.4, en de webhook die bestellingen naar Supabase schrijft (5.7) |
| Agent beheer | alles in `jv-werkbank/` | 5.5 en 5.7 |
| Tester (nieuw, onafhankelijk) | niets, alleen lezen | Zie 7 |

Volgorde: eerst de baas (schema + contract over de vorm van de data), dan de drie bouwers tegelijk,
dan de tester, dan maximaal 2 herstelrondes.

## 7. Klaar wanneer (door de tester te controleren)

- [ ] De shop toont dezelfde 6 producten als nu, met dezelfde ID's, prijzen en vertalingen.
- [ ] Zonder Supabase (adres onbereikbaar) toont de shop de producten uit `data/products.json`.
- [ ] Anoniem schrijven naar `producten`, `categorieen` en de bucket wordt geweigerd (echt proberen).
- [ ] Een ingelogde gebruiker die niet in `beheerders` staat kan niets wijzigen.
- [ ] De prijs bij het afrekenen komt uit de database; een gemanipuleerde prijs uit de browser wordt genegeerd.
- [ ] De voorraadfunctie werkt met een Supabase-token en weigert zonder.
- [ ] Geen JavaScript-fouten op alle pagina's (de scan uit de vorige sessie opnieuw draaien), in NL, FR en DE.
- [ ] De CSP blokkeert niets wat nodig is en laat geen nieuwe hosts toe behalve Supabase.
- [ ] Een product toevoegen, bewerken, een foto opladen en verwijderen werkt in het beheer, zonder deploy.
- [ ] Export gevolgd door import geeft dezelfde producten.
- [ ] Een (test)bestelling verschijnt in het dashboard: in de lijst, in de omzet, in "aantal verkocht" en in de grafiek.
- [ ] Dezelfde Stripe-sessie twee keer verwerken geeft maar één bestelling.
- [ ] Anoniem en als niet-beheerder zijn `bestellingen` en `bestelregels` niet leesbaar (echt proberen).
- [ ] De service-sleutel staat nergens in de repo of in bestanden die bezoekers kunnen opvragen.
- [ ] Een product met voorraad <= drempel verschijnt bij "Aandacht nodig".

Lokaal testen kan maar deels: Netlify-functies draaien niet op Live Server. Wat alleen op Netlify
getest kan worden (betalen, voorraad, CSP-headers) duidelijk melden.

## 8. Wat Liam zelf moet doen (kan Claude niet)

1. In Supabase een gebruiker aanmaken voor Jelle (e-mail + wachtwoord) en registratie uitzetten.
   Claude voegt die gebruiker daarna toe aan `beheerders`.
2. In Netlify de omgevingsvariabelen `SUPABASE_URL`, `SUPABASE_ANON_KEY` en `SUPABASE_SERVICE_KEY` zetten.
   De service-sleutel is geheim: nooit in de chat, de code of de repo plakken.
3. Committen, pushen en op de live site testen: een testbetaling in de testmodus van Stripe en een voorraadwijziging.

## 9. Risico's

| Risico | Opvang |
|---|---|
| Gratis Supabase-project pauzeert na 7 dagen zonder verzoeken | Reserve op `data/products.json`; eventueel later een dagelijks verzoekje |
| Maximaal 2 actieve projecten in het gratis plan | Liam heeft er al 2 actief; daarom eerst in een bestaand project bouwen |
| Geen automatische back-ups in het gratis plan | Export-knop in het beheer |
| Product-ID verandert en de voorraad raakt los | ID vast houden; waarschuwing in het beheer |
| Betaalflow breekt door de async `zoekProduct` | Aparte agent, aparte test, niets anders in die functies wijzigen |

## 10. Verhuizen naar het account van Jelle (later)

1. Jelle maakt een Supabase-project.
2. `database/schema.sql` uitvoeren in zijn SQL-editor.
3. In het beheer van het oude project: Exporteren. In het nieuwe: Importeren. Foto's opnieuw opladen.
4. `js/config.js` en de twee omgevingsvariabelen in Netlify aanpassen.
5. Jelle een nieuwe login geven en hem aan `beheerders` toevoegen.

(Of: het project overdragen via de projectinstellingen van Supabase, als dat voor beide accounts toegelaten is. Niet nagekeken.)

## 11. Nog open, los van dit plan

- De officiële Europese garantiemelding (verplicht sinds 27/09/2026): wacht op toestemming om de bestanden te downloaden.
- Domein `jvparts.be` + Resend voor de bevestigingsmails.
- Ondernemingsnummer, echt telefoonnummer, werkend e-mailadres.
- Voorwaarden en privacy in FR en DE.
