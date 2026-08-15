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
}

async function startBetaling() {
    const knop = document.getElementById('betaal-knop');
    const tekst = document.getElementById('betaal-tekst');
    const spinner = document.getElementById('betaal-spinner');

    const cart = getCart();
    if (cart.length === 0) {
        showToast('Je winkelmand is leeg.');
        return;
    }

    const klantRaw = localStorage.getItem('jvparts_checkout');
    const klant = klantRaw ? JSON.parse(klantRaw) : {};

    knop.disabled = true;
    tekst.style.display = 'none';
    spinner.style.display = 'block';

    try {
        const res = await fetch('/.netlify/functions/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cart: cart.map(i => ({ id: i.id, qty: i.qty })),
                methode: huidigeMethode,
                verzending: getVerzendingPrijs(),
                klant,
            }),
        });

        const data = await res.json();

        if (!res.ok || !data.url) {
            throw new Error((data && data.error) || 'Onbekende fout');
        }

        /* Doorsturen naar de beveiligde Stripe-betaalpagina */
        window.location.href = data.url;
    } catch (err) {
        console.error(err);
        showToast('Betaling starten is mislukt. Probeer opnieuw.');
        knop.disabled = false;
        tekst.style.display = '';
        spinner.style.display = 'none';
    }
}
