/* Mini-winkelmand (op elk scherm: telefoon, tablet en desktop).
   Klik op het winkelmandje in de topbar: er schuift een paneel open met de
   artikelen in je mand. Je kan er het aantal aanpassen of een artikel
   verwijderen, en onderaan ga je met "Naar winkelmand" naar de volledige
   winkelmandpagina (met de stappen bovenaan).

   Dit bestand wordt enkel geladen op de shop- en infopagina's, niet op
   winkelmand/checkout/betalen/klaar: daar staat de mand al op de pagina. */

(function () {
    const cartLink = document.querySelector('.topbar-cart');
    if (!cartLink) return;

    const PLACEHOLDER = `<svg width="22" height="22" fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;
    const fmt = n => n.toFixed(2).replace('.', ',');

    /* Het paneel en de donkere achtergrond worden hier één keer aangemaakt,
       zodat de HTML van de pagina's zelf niet moet veranderen. */
    const overlayEl = document.createElement('div');
    overlayEl.id = 'mini-cart-overlay';

    const panel = document.createElement('aside');
    panel.id = 'mini-cart';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
        <div class="mini-cart-header">
            <h3 id="mini-cart-title"></h3>
            <button type="button" id="mini-cart-close">✕</button>
        </div>
        <div class="mini-cart-items" id="mini-cart-items"></div>
        <div class="mini-cart-footer">
            <div class="mini-cart-subtotal">
                <span id="mini-cart-subtotal-label"></span>
                <strong id="mini-cart-subtotal"></strong>
            </div>
            <a href="winkelmand.html" class="mini-cart-go" id="mini-cart-go"></a>
            <button type="button" class="mini-cart-continue" id="mini-cart-continue"></button>
        </div>`;
    panel.setAttribute('aria-labelledby', 'mini-cart-title');

    document.body.appendChild(overlayEl);
    document.body.appendChild(panel);

    const itemsEl = panel.querySelector('#mini-cart-items');
    const closeBtn = panel.querySelector('#mini-cart-close');
    const goBtn = panel.querySelector('#mini-cart-go');
    const continueBtn = panel.querySelector('#mini-cart-continue');

    function render() {
        const cart = getCart();

        panel.querySelector('#mini-cart-title').textContent = t('cart.title');
        panel.querySelector('#mini-cart-subtotal-label').textContent = t('cart.subtotal');
        closeBtn.setAttribute('aria-label', t('nav.closeMenu'));
        goBtn.textContent = t('product.goToCart');
        continueBtn.textContent = t('cart.continueShopping');

        if (cart.length === 0) {
            itemsEl.innerHTML = `<p class="mini-cart-empty">${esc(t('cart.empty'))}</p>`;
        } else {
            /* Alles uit de winkelmand gaat door esc() (zie js/cart.js), zodat
               een productnaam nooit als HTML uitgevoerd kan worden. */
            itemsEl.innerHTML = cart.map(item => {
                const prijs = parsePrice(item.price) * item.qty;
                return `
                <div class="mini-cart-item" data-id="${esc(item.id)}">
                    <div class="mini-cart-img">
                        ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}">` : PLACEHOLDER}
                    </div>
                    <div class="mini-cart-info">
                        <div class="mini-cart-name">${esc(item.name)}</div>
                        <div class="mini-cart-sub">${esc(item.subtitle || '')}</div>
                        <div class="mini-cart-row">
                            <div class="mini-cart-qty">
                                <button type="button" class="qty-btn" data-delta="-1" aria-label="−">&#8722;</button>
                                <span class="qty-val">${item.qty}</span>
                                <button type="button" class="qty-btn" data-delta="1" aria-label="+">&#43;</button>
                            </div>
                            <div class="mini-cart-price">&#8364;&nbsp;${fmt(prijs)}</div>
                        </div>
                    </div>
                    <button type="button" class="mini-cart-remove" aria-label="Verwijder artikel">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                </div>`;
            }).join('');
        }

        const subtotaal = cart.reduce((s, i) => s + parsePrice(i.price) * i.qty, 0);
        panel.querySelector('#mini-cart-subtotal').textContent = '€ ' + fmt(subtotaal);

        /* Lege mand: geen subtotaal en geen knop naar de winkelmand tonen */
        panel.querySelector('.mini-cart-subtotal').hidden = cart.length === 0;
        goBtn.hidden = cart.length === 0;
    }

    /* Zelfde regels als op de winkelmandpagina: minimaal 1, maximaal de
       voorraad die bij het toevoegen is onthouden (item.max). */
    function wijzigAantal(id, delta) {
        const cart = getCart();
        const item = cart.find(i => i.id === id);
        if (!item) return;
        const max = item.max !== undefined ? Number(item.max) : 99;
        if (delta > 0 && item.qty >= max) {
            showToast(t('product.maxStock'));
            return;
        }
        item.qty = Math.max(1, Math.min(max, item.qty + delta));
        saveCart(cart);
        render();
    }

    function verwijder(id) {
        saveCart(getCart().filter(i => i.id !== id));
        render();
    }

    /* Eén listener op de lijst (event delegation) in plaats van een onclick
       per knop: de lijst wordt bij elke wijziging opnieuw opgebouwd. */
    itemsEl.addEventListener('click', (e) => {
        const rij = e.target.closest('.mini-cart-item');
        if (!rij) return;
        const id = rij.dataset.id;
        const qtyBtn = e.target.closest('.qty-btn');
        if (qtyBtn) {
            wijzigAantal(id, Number(qtyBtn.dataset.delta));
            return;
        }
        if (e.target.closest('.mini-cart-remove')) verwijder(id);
    });

    function isOpen() {
        return panel.classList.contains('open');
    }

    function open() {
        render();
        panel.classList.add('open');
        overlayEl.classList.add('active');
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
    }

    function close() {
        if (!isOpen()) return;
        panel.classList.remove('open');
        overlayEl.classList.remove('active');
        document.body.style.overflow = '';
        cartLink.focus();
    }

    cartLink.addEventListener('click', (e) => {
        e.preventDefault();
        open();
    });

    closeBtn.addEventListener('click', close);
    continueBtn.addEventListener('click', close);
    overlayEl.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    document.addEventListener('taalGewijzigd', () => {
        if (isOpen()) render();
    });
})();
