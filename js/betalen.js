(function () {
    renderSamenvatting({ itemsId: 'bt-summary-items', subtotaalId: 'bt-subtotaal', verzendingId: 'bt-verzending', totaalId: 'bt-totaal' });
    const cart = getCart();
    const sub = cart.reduce((s, i) => s + parsePrice(i.price) * i.qty, 0);
    const totaal = sub + getVerzendingPrijs();
    document.getElementById('betaal-tekst').textContent = 'Nu betalen € ' + totaal.toFixed(2).replace('.', ',');
})();

(function () {
    const opgeslagen = localStorage.getItem('jvparts_checkout');
    if (!opgeslagen) return;
    const d = JSON.parse(opgeslagen);

    const naam = [d.voornaam, d.achternaam].filter(Boolean).join(' ');
    const adres = [
        [d.straat, d.huisnr].filter(Boolean).join(' '),
        [d.postcode, d.gemeente].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');

    if (naam) document.getElementById('check-naam').textContent = naam;
    if (d.email) document.getElementById('check-email').textContent = d.email;
    if (adres) document.getElementById('check-adres').textContent = adres;
})();

let huidigeMethode = 'bancontact';

function selecteer(label, methode) {
    document.querySelectorAll('.betaal-methode').forEach(el => el.classList.remove('geselecteerd'));
    label.classList.add('geselecteerd');
    label.querySelector('input').checked = true;
    huidigeMethode = methode;

    const cardFields = document.getElementById('card-fields');
    if (methode === 'creditcard') {
        cardFields.classList.add('zichtbaar');

        label.after(cardFields);
    } else {
        cardFields.classList.remove('zichtbaar');
    }
}

function formatKaart(input) {
    let val = input.value.replace(/\D/g, '').substring(0, 16);
    input.value = val.replace(/(.{4})/g, '$1 ').trim();
}

function formatDatum(input) {
    let val = input.value.replace(/\D/g, '').substring(0, 4);
    if (val.length >= 3) val = val.substring(0, 2) + '/' + val.substring(2);
    input.value = val;
}

function startBetaling() {

    if (huidigeMethode === 'creditcard') {
        const nr = document.getElementById('kaart-nummer').value.replace(/\s/g, '');
        const naam = document.getElementById('kaart-naam').value.trim();
        const dat = document.getElementById('kaart-datum').value;
        const cvv = document.getElementById('kaart-cvv').value.trim();

        if (nr.length < 16) { showToast('Vul een geldig kaartnummer in.'); return; }
        if (!naam) { showToast('Vul de naam op de kaart in.'); return; }
        if (dat.length < 5) { showToast('Vul een geldige vervaldatum in.'); return; }
        if (cvv.length < 3) { showToast('Vul een geldige CVV in.'); return; }
    }

    const knop = document.getElementById('betaal-knop');
    const tekst = document.getElementById('betaal-tekst');
    const spinner = document.getElementById('betaal-spinner');

    knop.disabled = true;
    tekst.style.display = 'none';
    spinner.style.display = 'block';

    /*
     * MOLLIE INTEGRATIE
     * Hier stuur je een POST naar jouw backend, bv:
     *   POST /api/betaling/aanmaken
     *   body: { methode: huidigeMethode, bedrag: 57.90 }
     *
     * De backend maakt via de Mollie API een betaling aan en
     * geeft een checkoutUrl terug waarnaar je de gebruiker
     * doorstuurt:
     *   window.location.href = data.checkoutUrl;
     *
     * Na betaling stuurt Mollie de gebruiker terug naar de
     * redirectUrl die je instelde (bv. /klaar.html).
     */

    /* tijdelijk: simuleer redirect na 1,5s */
    setTimeout(() => {
        window.location.href = 'klaar.html';
    }, 1500);
}
