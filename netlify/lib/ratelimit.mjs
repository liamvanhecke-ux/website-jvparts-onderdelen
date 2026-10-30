// Herkent geen klanten, maar scripts: een mens kan onmogelijk 5 keer op
// "Nu betalen" klikken binnen 3 seconden (elke klik laadt een pagina en
// wacht op een antwoord). Een script dat de functie rechtstreeks aanroept
// wel. We blokkeren dus enkel op snelheid, nooit op aantal-per-tijdsvenster
// op zich — zo blijft een IP dat door meerdere klanten gedeeld wordt
// (mobiel internet, bedrijfs-wifi) altijd gewoon kunnen afrekenen.
//
// Geen permanente ban: zodra er weer "normaal" (menselijk) tempo tussen de
// aanvragen zit, mag het IP meteen weer door.

import { getStore } from '@netlify/blobs';

const VENSTER_MS = 3000; // moeten binnen deze tijdspanne gebeuren om als "te snel" te tellen
const AANTAL = 5;        // hoeveel aanvragen binnen dat venster = verdacht

const store = () => getStore({ name: 'ratelimit', consistency: 'strong' });

// true = mag door, false = te snel na elkaar (waarschijnlijk geen mens).
// Bij twijfel of een fout in de limiter zelf: altijd toelaten, nooit een
// echte klant blokkeren door een bug hier.
export async function magDoor(ip) {
  if (!ip) return true;
  try {
    const s = store();
    const vorige = (await s.get(ip, { type: 'json' })) || [];
    const tijden = [...vorige, Date.now()].slice(-AANTAL);
    await s.setJSON(ip, tijden);
    if (tijden.length < AANTAL) return true;
    return tijden[tijden.length - 1] - tijden[0] >= VENSTER_MS;
  } catch (err) {
    console.warn('Rate limit check mislukt (niet blokkerend):', err.message);
    return true;
  }
}
