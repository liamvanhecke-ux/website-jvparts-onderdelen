(async function () {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    const stateEl = document.getElementById('klaar-status');
    const detailEl = document.getElementById('klaar-details');

    updateCartBadges();

    if (!sessionId) {
        stateEl.textContent = 'Geen bestelling gevonden.';
        detailEl.innerHTML = '<p style="color:var(--muted);">Er ontbreekt een bestelreferentie in de link.</p>';
        return;
    }

    try {
        const res = await fetch('/.netlify/functions/get-session?session_id=' + encodeURIComponent(sessionId));
        const data = await res.json();

        if (!res.ok) throw new Error((data && data.error) || 'Fout bij ophalen bestelling');

        if (data.status === 'paid') {
            localStorage.removeItem('jvparts_cart');
            localStorage.removeItem('jvparts_checkout');
            updateCartBadges();

            stateEl.textContent = 'Bedankt voor je bestelling!';

            const bedrag = typeof data.bedrag === 'number' ? (data.bedrag / 100).toFixed(2).replace('.', ',') : '-';

            detailEl.innerHTML = `
                <div class="gegevens-check-row">
                    <span class="gegevens-check-label">Bedrag</span>
                    <span>&euro;&nbsp;${bedrag}</span>
                </div>
                ${data.email ? `<div class="gegevens-check-row"><span class="gegevens-check-label">E-mail</span><span>${data.email}</span></div>` : ''}
                <div class="gegevens-check-row">
                    <span class="gegevens-check-label">Referentie</span>
                    <span>${sessionId.slice(-12)}</span>
                </div>
                <p style="margin-top:14px;color:var(--muted);font-size:.85rem;">
                    Je ontvangt een bevestiging via Stripe. We nemen je bestelling zo snel mogelijk in verwerking.
                </p>`;
        } else {
            stateEl.textContent = 'Betaling niet voltooid';
            detailEl.innerHTML = `
                <p style="color:var(--muted);">
                    Je betaling is nog niet gelukt of nog in verwerking (status: ${data.status || 'onbekend'}).
                    Je winkelmand is bewaard.
                </p>
                <a href="betalen.html" class="btn-betaal" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">
                    Opnieuw proberen
                </a>`;
        }
    } catch (err) {
        console.error(err);
        stateEl.textContent = 'Er ging iets mis';
        detailEl.innerHTML = '<p style="color:var(--muted);">Kon de status van je bestelling niet ophalen. Neem contact op als er wel geld werd afgeschreven.</p>';
    }
})();
