/* Herroepingsformulier (herroepen.html).
   De wet vraagt een herroepingsfunctie in twee stappen:
   1. de klant vult zijn gegevens in en klikt op "Hier de overeenkomst herroepen"
   2. hij kijkt alles na en klikt op "Herroeping bevestigen"
   Pas na stap 2 wordt de herroeping echt verstuurd:
   - eerst via onze eigen Netlify-functie (netlify/functions/herroeping.mjs),
     die een mail naar de winkel stuurt en een ontvangstbevestiging naar de klant
   - lukt dat niet (bv. lokaal met Live Server, of mail nog niet ingesteld),
     dan als reserve via Web3Forms, zoals het contactformulier. De klant komt
     dan terug op deze pagina met ?verzonden=1.
   Zo gaat een herroeping nooit verloren. */

(function () {
    const form = document.getElementById('herroep-form');
    const succes = document.getElementById('herroep-succes');
    if (!form || !succes) return;

    const stap1 = document.getElementById('herroep-stap1');
    const stap2 = document.getElementById('herroep-stap2');
    const overzicht = document.getElementById('herroep-overzicht');
    const model = document.getElementById('herroep-model');

    function toonSucces() {
        form.hidden = true;
        if (model) model.hidden = true;
        succes.hidden = false;
        succes.scrollIntoView({ block: 'start' });
    }

    /* Terug van Web3Forms (reserve): bevestiging tonen in plaats van het formulier */
    if (new URLSearchParams(location.search).get('verzonden') === '1') {
        toonSucces();
        return;
    }

    /* Web3Forms stuurt de klant na het verzenden naar dit adres terug */
    document.getElementById('herroep-redirect').value =
        location.origin + location.pathname + '?verzonden=1';

    /* De velden die we in stap 2 tonen: [id van het veld, vertaalsleutel] */
    const VELDEN = [
        ['h-naam', 'withdraw.name'],
        ['h-email', 'withdraw.email'],
        ['h-adres', 'withdraw.address'],
        ['h-bestelling', 'withdraw.orderRef'],
        ['h-ontvangen', 'withdraw.received'],
        ['h-artikelen', 'withdraw.items'],
    ];

    function toonOverzicht() {
        overzicht.innerHTML = '';
        VELDEN.forEach(([id, sleutel]) => {
            const dt = document.createElement('dt');
            dt.textContent = t(sleutel);
            const dd = document.createElement('dd');
            /* textContent (geen innerHTML): wat de klant typt wordt nooit als HTML gelezen */
            dd.textContent = document.getElementById(id).value.trim();
            overzicht.appendChild(dt);
            overzicht.appendChild(dd);
        });
    }

    /* Stap 1 -> stap 2. De browser controleert eerst zelf de verplichte
       velden (required); pas als alles ingevuld is komt dit submit-event. */
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        toonOverzicht();
        stap1.hidden = true;
        stap2.hidden = false;
        stap2.scrollIntoView({ block: 'start' });
    });

    document.getElementById('herroep-terug').addEventListener('click', () => {
        stap2.hidden = true;
        stap1.hidden = false;
    });

    /* Stap 2: echt versturen. Eerst onze eigen functie; bij een fout de
       reserve via Web3Forms (form.submit() slaat het submit-event hierboven
       over, dus het formulier gaat dan rechtstreeks naar Web3Forms). */
    const bevestigKnop = document.getElementById('herroep-bevestig');
    const terugKnop = document.getElementById('herroep-terug');

    bevestigKnop.addEventListener('click', async () => {
        bevestigKnop.disabled = true;
        terugKnop.disabled = true;
        bevestigKnop.textContent = t('withdraw.sending');

        const waarde = id => document.getElementById(id).value.trim();
        try {
            const res = await fetch('/.netlify/functions/herroeping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    naam: waarde('h-naam'),
                    email: waarde('h-email'),
                    adres: waarde('h-adres'),
                    bestelling: waarde('h-bestelling'),
                    ontvangen_op: waarde('h-ontvangen'),
                    artikelen: waarde('h-artikelen'),
                    taal: huidigeTaal,
                    botcheck: form.querySelector('[name="botcheck"]').checked,
                }),
            });
            if (!res.ok) throw new Error(res.status);
            toonSucces();
        } catch (err) {
            console.warn('Herroeping via eigen functie mislukt, reserve via Web3Forms.', err);
            form.submit();
        }
    });

    document.addEventListener('taalGewijzigd', () => {
        if (!stap2.hidden) toonOverzicht();
    });
})();
