

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
                    <div class="summary-item-sub">&times;${item.qty}${item.subtitle ? ' &mdash; ' + item.subtitle : ''}</div>
                </div>
                <div class="summary-item-price">&euro;&nbsp;${prijs.toFixed(2).replace('.', ',')}</div>
            </div>`;
        }).join('');

    const subtotaal  = cart.reduce((s, i) => s + parsePrice(i.price) * i.qty, 0);
    const verzending = getVerzendingPrijs();
    const totaal     = subtotaal + verzending;
    const fmt = n => n.toFixed(2).replace('.', ',');

    const subEl  = document.getElementById(opts.subtotaalId);
    const verzEl = document.getElementById(opts.verzendingId);
    const totEl  = document.getElementById(opts.totaalId);

    if (subEl) subEl.textContent = '€ ' + fmt(subtotaal);
    if (verzEl) {
        if (verzending === 0) {
            verzEl.textContent    = 'Gratis';
            verzEl.style.color    = 'var(--success)';
            verzEl.style.fontWeight = '600';
        } else {
            verzEl.textContent    = '€ ' + fmt(verzending);
            verzEl.style.color    = '';
            verzEl.style.fontWeight = '';
        }
    }
    if (totEl) totEl.textContent = '€ ' + fmt(totaal);
}

document.addEventListener('DOMContentLoaded', updateCartBadges);
