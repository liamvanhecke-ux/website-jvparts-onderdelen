// Herroeping van een bestelling (formulier op herroepen.html).
// POST { naam, email, adres, bestelling, ontvangen_op, artikelen, taal, botcheck }
//
// Stuurt twee mails via netlify/lib/mail.mjs:
//   1. naar de winkel (MAIL_ADMIN) met alle gegevens; "Beantwoorden" gaat naar de klant
//   2. naar de klant: de wettelijk verplichte ontvangstbevestiging, in zijn taal
//
// Lukt mail 1 niet (of is de mail nog niet ingesteld), dan antwoordt de functie
// met een fout en valt js/herroepen.js terug op Web3Forms: een herroeping mag
// nooit verloren gaan.

import { json } from '../lib/voorraad.mjs';
import { magDoor } from '../lib/ratelimit.mjs';
import { mailGeconfigureerd, stuurMail, mailOpmaak, gegevensTabel, esc } from '../lib/mail.mjs';

const TEKST = {
  nl: {
    onderwerp: 'We hebben je herroeping ontvangen',
    titel: 'We hebben je herroeping ontvangen',
    aanhef: 'Dag',
    intro: 'We bevestigen dat we je herroeping goed ontvangen hebben op',
    gegevens: 'Dit heb je ons doorgegeven:',
    stappenTitel: 'Hoe gaat het nu verder?',
    stappen: [
      'Stuur het product binnen 14 dagen terug naar: JV-Parts, Nederzwalmsesteenweg 94, 9750 Zingem, België.',
      'Verpak het goed, bij voorkeur in de originele verpakking en met alle toebehoren. De kosten van het terugsturen zijn voor jou.',
      'We betalen het aankoopbedrag terug binnen 14 dagen na je herroeping, via hetzelfde betaalmiddel. We mogen daarmee wachten tot we het product ontvangen hebben of tot je ons het verzendbewijs bezorgt.',
    ],
    vragen: 'Vragen? Antwoord gewoon op deze mail.',
    voet: 'Je krijgt deze mail omdat je een herroeping hebt ingediend op onze website.',
    labels: { naam: 'Naam', email: 'E-mail', adres: 'Adres', bestelling: 'Bestelnummer of besteldatum', ontvangen: 'Ontvangen op', artikelen: 'Artikelen' },
  },
  fr: {
    onderwerp: 'Nous avons bien reçu votre rétractation',
    titel: 'Nous avons bien reçu votre rétractation',
    aanhef: 'Bonjour',
    intro: 'Nous confirmons avoir bien reçu votre rétractation le',
    gegevens: 'Voici ce que vous nous avez communiqué :',
    stappenTitel: 'Et maintenant ?',
    stappen: [
      'Renvoyez le produit dans les 14 jours à : JV-Parts, Nederzwalmsesteenweg 94, 9750 Zingem, Belgique.',
      "Emballez-le soigneusement, de préférence dans l'emballage d'origine et avec tous les accessoires. Les frais de renvoi sont à votre charge.",
      "Nous remboursons le montant de l'achat dans les 14 jours suivant votre rétractation, par le même moyen de paiement. Nous pouvons attendre d'avoir reçu le produit ou la preuve d'expédition.",
    ],
    vragen: 'Des questions ? Répondez simplement à cet e-mail.',
    voet: 'Vous recevez cet e-mail parce que vous avez introduit une rétractation sur notre site.',
    labels: { naam: 'Nom', email: 'E-mail', adres: 'Adresse', bestelling: 'Numéro ou date de commande', ontvangen: 'Reçu le', artikelen: 'Articles' },
  },
  de: {
    onderwerp: 'Wir haben deinen Widerruf erhalten',
    titel: 'Wir haben deinen Widerruf erhalten',
    aanhef: 'Hallo',
    intro: 'Wir bestätigen den Eingang deines Widerrufs am',
    gegevens: 'Das hast du uns mitgeteilt:',
    stappenTitel: 'Wie geht es weiter?',
    stappen: [
      'Sende das Produkt innerhalb von 14 Tagen zurück an: JV-Parts, Nederzwalmsesteenweg 94, 9750 Zingem, Belgien.',
      'Verpacke es gut, am besten in der Originalverpackung und mit allem Zubehör. Die Rücksendekosten trägst du.',
      'Wir erstatten den Kaufbetrag innerhalb von 14 Tagen nach deinem Widerruf über dasselbe Zahlungsmittel. Wir dürfen damit warten, bis wir das Produkt erhalten haben oder du uns den Versandnachweis schickst.',
    ],
    vragen: 'Fragen? Antworte einfach auf diese E-Mail.',
    voet: 'Du erhältst diese E-Mail, weil du auf unserer Website einen Widerruf eingereicht hast.',
    labels: { naam: 'Name', email: 'E-Mail', adres: 'Adresse', bestelling: 'Bestellnummer oder Bestelldatum', ontvangen: 'Erhalten am', artikelen: 'Artikel' },
  },
};

const LOCALE = { nl: 'nl-BE', fr: 'fr-BE', de: 'de-DE' };

// Maakt van onbekende invoer een nette, begrensde tekst.
function schoon(waarde, max) {
  return String(waarde ?? '').trim().slice(0, max);
}

// "2026-11-10" -> "10 november 2026" in de taal van de lezer
function mooieDatum(iso, locale) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { timeZone: 'Europe/Brussels', dateStyle: 'long' });
}

function rijen(labels, d, locale) {
  return [
    [labels.naam, d.naam],
    [labels.email, d.email],
    [labels.adres, d.adres],
    [labels.bestelling, d.bestelling],
    [labels.ontvangen, mooieDatum(d.ontvangen_op, locale)],
    [labels.artikelen, d.artikelen],
  ];
}

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!mailGeconfigureerd()) return json(503, { error: 'Mail is nog niet ingesteld.' });

  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || '';
  if (!(await magDoor(ip))) {
    return json(429, { error: 'Te veel aanvragen kort na elkaar. Wacht even en probeer opnieuw.' });
  }

  let invoer;
  try { invoer = await req.json(); } catch { return json(400, { error: 'Ongeldige aanvraag.' }); }
  if (!invoer || typeof invoer !== 'object') return json(400, { error: 'Ongeldige aanvraag.' });

  // Onzichtbaar veld dat enkel bots invullen: doen alsof het gelukt is, niets versturen.
  if (invoer.botcheck) return json(200, { ok: true });

  const d = {
    naam: schoon(invoer.naam, 100),
    email: schoon(invoer.email, 200),
    adres: schoon(invoer.adres, 200),
    bestelling: schoon(invoer.bestelling, 100),
    ontvangen_op: schoon(invoer.ontvangen_op, 10),
    artikelen: schoon(invoer.artikelen, 1000),
  };
  const taal = TEKST[invoer.taal] ? invoer.taal : 'nl';

  if (!d.naam || !d.adres || !d.bestelling || !d.artikelen) return json(400, { error: 'Niet alle velden zijn ingevuld.' });
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(d.email)) return json(400, { error: 'Ongeldig e-mailadres.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.ontvangen_op)) return json(400, { error: 'Ongeldige datum.' });

  const nu = new Date();
  const tijdstip = loc => nu.toLocaleString(loc, { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' });

  // 1. Mail naar de winkel. Mislukt die, dan melden we een fout (de website
  //    valt dan terug op Web3Forms).
  try {
    await stuurMail({
      to: process.env.MAIL_ADMIN,
      replyTo: d.email,
      subject: `Herroeping van ${d.naam} (${d.bestelling})`,
      html: mailOpmaak({
        titel: 'Nieuwe herroeping',
        inhoudHtml: `
          <p style="margin:0 0 8px;color:#222;font-size:15px;line-height:1.6;">Ontvangen op ${esc(tijdstip('nl-BE'))}. Taal van de klant: ${esc(taal.toUpperCase())}.</p>
          ${gegevensTabel(rijen(TEKST.nl.labels, d, 'nl-BE'))}
          <p style="margin:0;color:#222;font-size:15px;line-height:1.6;">De klant kreeg automatisch een ontvangstbevestiging. Antwoord op deze mail om hem rechtstreeks te bereiken.</p>`,
        voettekst: 'Automatische melding van het herroepingsformulier op de website.',
      }),
    });
  } catch (err) {
    console.error('Herroeping: mail naar winkel mislukt:', err.message);
    return json(502, { error: 'Versturen mislukt.' });
  }

  // 2. Ontvangstbevestiging naar de klant. De winkel heeft de herroeping al,
  //    dus een fout hier mag de aanvraag niet meer doen mislukken.
  const tk = TEKST[taal];
  let klantMail = true;
  try {
    await stuurMail({
      to: d.email,
      replyTo: process.env.MAIL_ADMIN,
      subject: tk.onderwerp,
      html: mailOpmaak({
        titel: tk.titel,
        inhoudHtml: `
          <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6;">${esc(tk.aanhef)} ${esc(d.naam)},</p>
          <p style="margin:0 0 12px;color:#222;font-size:15px;line-height:1.6;">${esc(tk.intro)} ${esc(tijdstip(LOCALE[taal]))}.</p>
          <p style="margin:0;color:#222;font-size:15px;line-height:1.6;">${esc(tk.gegevens)}</p>
          ${gegevensTabel(rijen(tk.labels, d, LOCALE[taal]))}
          <h2 style="margin:8px 0 8px;font-size:16px;color:#15243d;">${esc(tk.stappenTitel)}</h2>
          <ol style="margin:0 0 16px;padding-left:20px;color:#222;font-size:15px;line-height:1.6;">
            ${tk.stappen.map(s => `<li style="margin-bottom:6px;">${esc(s)}</li>`).join('')}
          </ol>
          <p style="margin:0;color:#222;font-size:15px;line-height:1.6;">${esc(tk.vragen)}</p>`,
        voettekst: tk.voet,
      }),
    });
  } catch (err) {
    klantMail = false;
    console.error('Herroeping: bevestiging naar klant mislukt:', err.message);
  }

  return json(200, { ok: true, klantMail });
};
