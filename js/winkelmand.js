const placeholderSVG = `<svg fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;

function renderWinkelmand() {
    const cart = getCart();
    const container = document.getElementById('cart-items-container');
    const verzendingSection = document.getElementById('verzending-section');
    const emptyEl = document.getElementById('cart-empty');
    const checkoutBtn = document.querySelector('.cart-checkout-btn');

    container.querySelectorAll('.cart-item').forEach(el => el.remove());

    if (cart.length === 0) {
        verzendingSection.style.display = 'none';
        emptyEl.style.display = 'flex';
        checkoutBtn.classList.add('disabled');
        checkoutBtn.removeAttribute('href');
        updateTotaal([]);
        return;
    }

    verzendingSection.style.display = '';
    emptyEl.style.display = 'none';
    checkoutBtn.classList.remove('disabled');
    checkoutBtn.setAttribute('href', 'checkout.html');

    cart.forEach(item => {
        const prijs = parsePrice(item.price) * item.qty;
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.dataset.id = item.id;
        div.innerHTML = `
            <div class="cart-item-img">
                ${item.image
                ? `<img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;">`
                : placeholderSVG}
            </div>
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-sub">${item.subtitle || ''}</div>
            </div>
            <div class="cart-item-qty">
                <button class="qty-btn" onclick="changeQty('${item.id}', -1)">&#8722;</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="changeQty('${item.id}', 1)">&#43;</button>
            </div>
            <div class="cart-item-price">&#8364;&nbsp;${prijs.toFixed(2).replace('.', ',')}</div>
            <button class="cart-item-remove" aria-label="Verwijder artikel" onclick="removeItem('${item.id}')">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
            </button>`;
        container.insertBefore(div, emptyEl);
    });

    updateTotaal(cart);
}

function getVerzendPrijs() {
    const checked = document.querySelector('input[name="verzending"]:checked');
    return checked ? parseFloat(checked.dataset.prijs) : 4.95;
}

function updateTotaal(cart) {
    const subtotaal = cart.reduce((s, i) => s + parsePrice(i.price) * i.qty, 0);
    const verzending = getVerzendPrijs();
    const totaal = subtotaal + verzending;
    const btw = berekenBtw(totaal);
    const fmt = n => n.toFixed(2).replace('.', ',');

    document.getElementById('subtotaal').textContent = '€ ' + fmt(subtotaal);
    document.getElementById('totaal').textContent = '€ ' + fmt(totaal);

    const btwEl = document.getElementById('summary-btw');
    if (btwEl) btwEl.textContent = '€ ' + fmt(btw);

    const shipEl = document.getElementById('summary-shipping');
    if (verzending === 0) {
        shipEl.textContent = t('cart.free');
        shipEl.style.color = 'var(--success)';
        shipEl.style.fontWeight = '600';
    } else {
        shipEl.textContent = '€ ' + fmt(verzending);
        shipEl.style.color = '';
        shipEl.style.fontWeight = '';
    }
}

document.addEventListener('taalGewijzigd', () => renderWinkelmand());

function changeQty(id, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
    saveCart(cart);
    renderWinkelmand();
}

function removeItem(id) {
    saveCart(getCart().filter(i => i.id !== id));
    renderWinkelmand();
}

document.querySelectorAll('input[name="verzending"]').forEach(radio => {
    radio.addEventListener('change', () => {
        saveVerzendingPrijs(parseFloat(radio.dataset.prijs));
        updateTotaal(getCart());
    });
});

const defaultRadio = document.querySelector('input[name="verzending"]:checked');
if (defaultRadio && localStorage.getItem('jvparts_verzending') === null) {
    saveVerzendingPrijs(parseFloat(defaultRadio.dataset.prijs));
}

const savedVerzending = localStorage.getItem('jvparts_verzending');
if (savedVerzending !== null) {
    const match = document.querySelector(`input[name="verzending"][data-prijs="${savedVerzending}"]`);
    if (match) match.checked = true;
}

renderWinkelmand();
