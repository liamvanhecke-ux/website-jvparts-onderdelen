

const CART_KEY = 'jvparts_cart';

function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadges();
}

function cartItemCount() {
    return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function updateCartBadges() {
    const count = cartItemCount();
    document.querySelectorAll('#cart-count-top, #cart-count-sidebar').forEach(el => {
        el.textContent = count;
    });
}

function parsePrice(str) {
    return parseFloat(String(str).replace(',', '.')) || 0;
}

const BTW_PERCENTAGE = 21;

/* Onze prijzen zijn btw-inclusief (verplicht voor consumentenprijzen),
   dus dit haalt het reeds inbegrepen btw-bedrag uit een totaal. */
function berekenBtw(totaalInclBtw) {
    return totaalInclBtw - (totaalInclBtw / (1 + BTW_PERCENTAGE / 100));
}

function slugify(str) {
    return String(str).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function voegToeAanWinkelmand(product) {
    const cart = getCart();
    const bestaand = cart.find(i => i.id === product.id);
    if (bestaand) {
        bestaand.qty++;
    } else {
        cart.push({ id: product.id, name: product.name, subtitle: product.subtitle || '', price: product.price, image: product.image || '', qty: 1 });
    }
    saveCart(cart);
}


const VERZENDING_KEY = 'jvparts_verzending';

function getVerzendingPrijs() {
    const saved = localStorage.getItem(VERZENDING_KEY);
    return saved !== null ? parseFloat(saved) : 4.95;
}

function saveVerzendingPrijs(prijs) {
    localStorage.setItem(VERZENDING_KEY, prijs);
}


function renderSamenvatting(opts) {
    
    const cart    = getCart();
    const itemsEl = document.getElementById(opts.itemsId);
    if (!itemsEl) return;

    const ph = `<svg width="22" height="22" fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;

    itemsEl.innerHTML = cart.length === 0
        ? '<p style="color:var(--muted);font-size:.85rem;text-align:center;padding:8px 0;">Winkelmand is leeg</p>'
        : cart.map(item => {
            const prijs = parsePrice(item.price) * item.qty;
            return `
            <div class="summary-item">
                <div class="summary-item-img">
                    ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;">` : ph}
                </div>
                <div style="flex:1;min-width:0;">
                    <div class="summary-item-name">${item.name}</div>
                    <div class="summary-item-sub">&times;${item.qty}${item.subtitle ? ' ' + item.subtitle : ''}</div>
                </div>
                <div class="summary-item-price">&euro;&nbsp;${prijs.toFixed(2).replace('.', ',')}</div>
            </div>`;
        }).join('');

    const subtotaal  = cart.reduce((s, i) => s + parsePrice(i.price) * i.qty, 0);
    const verzending = getVerzendingPrijs();
    const totaal     = subtotaal + verzending;
    const btw        = berekenBtw(totaal);
    const fmt = n => n.toFixed(2).replace('.', ',');

    const subEl  = document.getElementById(opts.subtotaalId);
    const verzEl = document.getElementById(opts.verzendingId);
    const totEl  = document.getElementById(opts.totaalId);
    const btwEl  = opts.btwId && document.getElementById(opts.btwId);

    if (subEl) subEl.textContent = '€ ' + fmt(subtotaal);
    if (verzEl) {
        if (verzending === 0) {
            verzEl.textContent    = t('cart.free');
            verzEl.style.color    = 'var(--success)';
            verzEl.style.fontWeight = '600';
        } else {
            verzEl.textContent    = '€ ' + fmt(verzending);
            verzEl.style.color    = '';
            verzEl.style.fontWeight = '';
        }
    }
    if (btwEl) btwEl.textContent = '€ ' + fmt(btw);
    if (totEl) totEl.textContent = '€ ' + fmt(totaal);
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', updateCartBadges);
