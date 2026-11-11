/* "Misschien ook interessant" onderaan de winkelmandpagina.
   Toont maximaal 4 producten die de klant er nog bij zou kunnen nemen:
   - niet wat al in de winkelmand zit
   - niet wat uitverkocht is
   - eerst producten uit dezelfde categorie als iets in de mand, daarna de rest
   - binnen elke groep de goedkoopste eerst (kleine bijkoopjes bovenaan)
   Zelfde productkaart als op de homepagina (js/index.js). */

(function () {
    const MAX_SUGGESTIES = 4;
    const sectie = document.getElementById('cart-suggesties');
    const grid = document.getElementById('cart-suggesties-grid');
    if (!sectie || !grid) return;

    const PLACEHOLDER = `<svg fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;
    let alleProducten = [];

    /* Vertaald veld (bv. name_fr) met het Nederlandse veld als terugval,
       net zoals op de home- en productpagina. */
    function vertaaldVeld(obj, veld) {
        return (obj[veld + '_' + huidigeTaal] && obj[veld + '_' + huidigeTaal].trim())
            || obj[veld]
            || '';
    }

    function kiesSuggesties() {
        const inMand = new Set(getCart().map(i => i.id));
        const categorieenInMand = new Set(
            alleProducten.filter(p => inMand.has(slugify(p.name))).map(p => p.category)
        );
        const kandidaten = alleProducten.filter(p =>
            !inMand.has(slugify(p.name)) && voorraadInfo(p).aantal > 0
        );
        /* Zelfde categorie eerst; binnen elke groep de goedkoopste eerst.
           parsePrice (js/cart.js) maakt van "34,95" het getal 34.95. */
        const opPrijs = (a, b) => parsePrice(a.price) - parsePrice(b.price);
        const zelfde = kandidaten.filter(p => categorieenInMand.has(p.category)).sort(opPrijs);
        const andere = kandidaten.filter(p => !categorieenInMand.has(p.category)).sort(opPrijs);
        return zelfde.concat(andere).slice(0, MAX_SUGGESTIES);
    }

    function render() {
        const suggesties = kiesSuggesties();
        if (suggesties.length === 0) {
            sectie.style.display = 'none';
            return;
        }
        sectie.style.display = '';

        /* CMS-data nooit ongefilterd in innerHTML: alles gaat door esc(). */
        grid.innerHTML = suggesties.map(p => {
            const naam = vertaaldVeld(p, 'name');
            const subtitel = vertaaldVeld(p, 'subtitle');
            const pid = slugify(p.name);
            const imgContent = p.image
                ? `<img src="${esc(p.image)}" alt="${esc(naam)}" style="width:100%;height:100%;object-fit:cover;">`
                : PLACEHOLDER;
            const badge = p.condition === 'Tweedehands'
                ? `<div class="product-badge used">${t('index.badgeUsed')}</div>`
                : '';
            const voorraad = voorraadInfo(p);
            return `
            <div class="product-card" data-href="product.html?id=${pid}">
                <div class="product-img">${imgContent}${badge}</div>
                <div class="product-info">
                    <div class="product-sub">${esc(subtitel)}</div>
                    <div class="product-name">${esc(naam)}</div>
                    <div class="product-footer">
                        <span class="product-price">€ ${esc(p.price)}</span>
                        <button class="btn-add"
                            data-id="${pid}"
                            data-name="${esc(naam)}"
                            data-subtitle="${esc(subtitel)}"
                            data-price="${esc(p.price)}"
                            data-image="${esc(p.image || '')}"
                            data-max="${isFinite(voorraad.aantal) ? voorraad.aantal : ''}">${t('index.addToCart')}</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    /* Eén listener op het rooster: klik op de knop = toevoegen, klik
       elders op de kaart = naar de productpagina. */
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-add');
        if (btn) {
            const product = {
                id: btn.dataset.id, name: btn.dataset.name, subtitle: btn.dataset.subtitle,
                price: btn.dataset.price, image: btn.dataset.image, max: btn.dataset.max,
            };
            if (voegToeAanWinkelmand(product) === 0) {
                showToast(t('product.maxStock'));
                return;
            }
            showToast('✓ ' + product.name + ' ' + t('index.toastAdded'));
            renderWinkelmand(); // de mand bovenaan meteen bijwerken (js/winkelmand.js)
            render();           // het toegevoegde product verdwijnt uit de suggesties
            return;
        }
        const kaart = e.target.closest('.product-card');
        if (kaart) location.href = kaart.dataset.href;
    });

    /* Artikel uit de mand verwijderd (js/winkelmand.js): het mag opnieuw
       voorgesteld worden. */
    document.addEventListener('winkelmandGewijzigd', render);
    document.addEventListener('taalGewijzigd', render);

    fetch('/data/products.json')
        .then(r => r.json())
        .then(data => laadLiveVoorraad(data.products || []))
        .then(producten => {
            alleProducten = producten;
            render();
        })
        .catch(() => { sectie.style.display = 'none'; });
})();
