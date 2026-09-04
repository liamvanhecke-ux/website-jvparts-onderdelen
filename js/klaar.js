(async function () {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    const stateEl = document.getElementById('klaar-status');
    const detailEl = document.getElementById('klaar-details');

    updateCartBadges();

    if (!sessionId) {
        stateEl.textContent = t('klaar.noOrder');
        detailEl.innerHTML = `<p style="color:var(--muted);">${t('klaar.noOrderDetail')}</p>`;
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

            stateEl.textContent = t('klaar.thanks');

            const bedrag = typeof data.bedrag === 'number' ? (data.bedrag / 100).toFixed(2).replace('.', ',') : '-';

            detailEl.innerHTML = `
                <div class="gegevens-check-row">
                    <span class="gegevens-check-label">${t('klaar.amount')}</span>
                    <span>&euro;&nbsp;${bedrag}</span>
                </div>
                ${data.email ? `<div class="gegevens-check-row"><span class="gegevens-check-label">${t('klaar.email')}</span><span>${data.email}</span></div>` : ''}
                <div class="gegevens-check-row">
                    <span class="gegevens-check-label">${t('klaar.reference')}</span>
                    <span>${sessionId.slice(-12)}</span>
                </div>
                <p style="margin-top:14px;color:var(--muted);font-size:.85rem;">
                    ${t('klaar.confirmationNote')}
                </p>`;
        } else {
            stateEl.textContent = t('klaar.notCompleted');
            detailEl.innerHTML = `
                <p style="color:var(--muted);">
                    ${t('klaar.notCompletedDetail', { status: data.status || 'onbekend' })}
                </p>
                <a href="betalen.html" class="btn-betaal" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">
                    ${t('klaar.retry')}
                </a>`;
        }
    } catch (err) {
        console.error(err);
        stateEl.textContent = t('klaar.errorGeneric');
        detailEl.innerHTML = `<p style="color:var(--muted);">${t('klaar.errorGenericDetail')}</p>`;
    }
})();
