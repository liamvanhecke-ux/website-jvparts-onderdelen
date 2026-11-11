const placeholderSVG = `<svg fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;

let huidigProduct = null;
let alleProducten = [];
let aantal = 1;

/* Geeft het vertaalde veld terug voor de huidige taal, met terugval op
   het Nederlandse veld als er geen vertaling is ingevuld. */
function veldVoorTaal(obj, veld) {
    return (obj[veld + '_' + huidigeTaal] && obj[veld + '_' + huidigeTaal].trim())
        || obj[veld]
        || '';
}

function vertaalCategorie(catNaam, producten) {
    if (huidigeTaal === 'nl' || !catNaam) return catNaam;
    const veld = 'category_' + huidigeTaal;
    const match = producten.find(p => p.category === catNaam && p[veld] && p[veld].trim());
    return match ? match[veld] : catNaam;
}

function fmtPrijs(n) {
    return n.toFixed(2).replace('.', ',');
}

function renderDetail() {
    const p = huidigProduct;
    if (!p) return;

    const pid = slugify(p.name);
    const naam = veldVoorTaal(p, 'name');
    const subtitel = veldVoorTaal(p, 'subtitle');
    const categorie = vertaalCategorie(p.category, alleProducten);
    const beschrijving = veldVoorTaal(p, 'beschrijving');
    const voorraad = voorraadInfo(p);

    document.getElementById('page-title').textContent = 'JV-Parts ' + naam;
    document.getElementById('breadcrumb-naam').textContent = naam;

    // Productdata komt uit de admin-CMS; niet blindweg vertrouwen in innerHTML
    // (stored-XSS-bescherming), zie ook de uitleg in js/index.js.
    document.getElementById('detail-image').innerHTML = p.image
        ? `<img src="${esc(p.image)}" alt="${esc(naam)}">`
        : placeholderSVG;

    document.getElementById('detail-category').textContent = categorie || '';
    document.getElementById('detail-naam').textContent = naam;
    document.getElementById('detail-sub').textContent = subtitel;

    const conditieBadge = p.condition === 'Tweedehands'
        ? `<div class="product-badge used">${t('index.badgeUsed')}</div>`
        : `<div class="product-badge in">${t('index.badgeNew')}</div>`;
    document.getElementById('detail-badges').innerHTML =
        conditieBadge + `<div class="product-badge ${voorraad.cls}">${voorraad.label}</div>`;

    const prijs = parsePrice(p.price);
    document.getElementById('detail-price').textContent = '€ ' + p.price;
    document.getElementById('detail-btw').textContent = t('cart.btwNote') + ': € ' + fmtPrijs(berekenBtw(prijs));

    const uitverkocht = voorraad.aantal <= 0;
    const addBtn = document.getElementById('detail-add-btn');
    addBtn.disabled = uitverkocht;
    const melding = document.getElementById('detail-outofstock');
    melding.style.display = uitverkocht ? '' : 'none';
    melding.textContent = voorraad.gereserveerd ? t('product.reservedNotice') : t('product.outOfStockNotice');

    renderInfoTabs(p, beschrijving, categorie);

    addBtn.dataset.id = pid;
    addBtn.dataset.name = naam;
    addBtn.dataset.subtitle = subtitel;
    addBtn.dataset.price = p.price;
    addBtn.dataset.image = p.image || '';
    addBtn.dataset.max = isFinite(voorraad.aantal) ? voorraad.aantal : '';

    renderRelated();
}

/* ===== Beschrijving/Kenmerken als tabbladen ===== */
let actieveTab = 'beschrijving';

function renderInfoTabs(p, beschrijving, categorie) {
    const wrap = document.getElementById('info-tabs');
    const nav = document.getElementById('info-tabs-nav');
    const paneelBeschrijving = document.getElementById('info-panel-beschrijving');
    const paneelKenmerken = document.getElementById('info-panel-kenmerken');

    paneelBeschrijving.innerHTML = '';
    const heeftBeschrijving = !!beschrijving.trim();
    if (heeftBeschrijving) {
        beschrijving.split(/\n\s*\n/).forEach(alinea => {
            if (!alinea.trim()) return;
            const el = document.createElement('p');
            el.textContent = alinea.trim();
            paneelBeschrijving.appendChild(el);
        });
    }

    /* Kenmerken komen uit velden die altijd gekend zijn (merk/subtitel,
       categorie, staat) - geen extra admin-werk nodig. */
    const staat = p.condition === 'Tweedehands' ? t('index.badgeUsed') : t('index.badgeNew');
    const rijen = [
        [t('product.brand'), veldVoorTaal(p, 'subtitle')],
        [t('product.category'), categorie],
        [t('product.condition'), staat],
    ].filter(([, waarde]) => waarde && String(waarde).trim());

    paneelKenmerken.innerHTML = rijen.length
        ? `<table class="specs-table">${rijen.map(([label, waarde]) =>
            `<tr><td>${esc(label)}</td><td>${esc(waarde)}</td></tr>`).join('')}</table>`
        : '';

    const tabs = [heeftBeschrijving ? 'beschrijving' : null, rijen.length ? 'kenmerken' : null].filter(Boolean);

    if (tabs.length === 0) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = '';

    /* Geen tabbalk tonen als er maar 1 tabblad iets te laten zien heeft. */
    nav.style.display = tabs.length > 1 ? '' : 'none';
    nav.querySelectorAll('.info-tab').forEach(btn => {
        btn.style.display = tabs.includes(btn.dataset.tab) ? '' : 'none';
    });

    if (!tabs.includes(actieveTab)) actieveTab = tabs[0];
    toonTab(actieveTab);
}

function toonTab(naam) {
    actieveTab = naam;
    document.querySelectorAll('#info-tabs-nav .info-tab').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === naam));
    document.getElementById('info-panel-beschrijving').classList.toggle('active', naam === 'beschrijving');
    document.getElementById('info-panel-kenmerken').classList.toggle('active', naam === 'kenmerken');
}

document.getElementById('info-tabs-nav').addEventListener('click', e => {
    const btn = e.target.closest('.info-tab');
    if (btn) toonTab(btn.dataset.tab);
});

/* ===== Gerelateerde producten (zelfde categorie) ===== */
function renderRelated() {
    const container = document.getElementById('related-products');
    const grid = document.getElementById('related-grid');
    if (!huidigProduct) { container.style.display = 'none'; return; }

    // Eerst proberen we producten uit dezelfde categorie te tonen. Is die
    // categorie (bijna) leeg -bv. enkel dit ene testproduct- dan vallen we
    // terug op andere producten uit de winkel, zodat de sectie niet gewoon
    // leeg/verborgen blijft zoals voorheen.
    const andereProducten = alleProducten.filter(p => p !== huidigProduct);
    let verwant = andereProducten
        .filter(p => p.category && p.category === huidigProduct.category)
        .slice(0, 4);

    if (verwant.length === 0) {
        verwant = andereProducten.slice(0, 4);
    }

    if (verwant.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';

    /* Zelfde opbouw/escaping als de productkaarten op de homepage
       (js/index.js): CMS-data nooit ongefilterd in innerHTML. */
    grid.innerHTML = verwant.map(p => {
        const naam = veldVoorTaal(p, 'name');
        const subtitel = veldVoorTaal(p, 'subtitle');
        const pid = slugify(p.name);
        const imgContent = p.image
            ? `<img src="${esc(p.image)}" alt="${esc(naam)}" style="width:100%;height:100%;object-fit:cover;">`
            : placeholderSVG;
        const badge = p.condition === 'Tweedehands'
            ? `<div class="product-badge used">${t('index.badgeUsed')}</div>`
            : '';
        const voorraad = voorraadInfo(p);
        const uitverkocht = voorraad.aantal <= 0;
        return `
        <div class="product-card" onclick="location.href='product.html?id=${pid}'">
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
                        data-image="${esc(p.image||'')}"
                        data-max="${isFinite(voorraad.aantal) ? voorraad.aantal : ''}"
                        ${uitverkocht ? 'disabled' : ''}
                        onclick="event.stopPropagation(); addProductFromCard(this)">${uitverkocht ? t('product.stockOut') : t('index.addToCart')}</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function addProductFromCard(btn) {
    const product = {
        id: btn.dataset.id, name: btn.dataset.name, subtitle: btn.dataset.subtitle,
        price: btn.dataset.price, image: btn.dataset.image, max: btn.dataset.max,
    };
    if (voegToeAanWinkelmand(product) === 0) {
        showToast(t('product.maxStock'));
        return;
    }
    showToast('✓ ' + product.name + ' ' + t('index.toastAdded'));
    const origineel = btn.textContent;
    btn.textContent = t('index.added');
    btn.disabled = true;
    setTimeout(() => { btn.textContent = origineel; btn.disabled = false; }, 1200);
}

/* Hoeveel stuks mag de klant nog kiezen? (voorraad min wat al in de mand zit) */
function maxKiesbaar() {
    if (!huidigProduct) return 99;
    const voorraad = voorraadAantal(huidigProduct);
    const rest = voorraad - aantalInWinkelmand(slugify(huidigProduct.name));
    return Math.max(1, Math.min(99, rest));
}

function updateQtyDisplay() {
    document.getElementById('qty-val').textContent = aantal;
}

function laadProduct() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    fetch('/data/products.json')
        .then(r => r.json())
        .then(data => laadLiveVoorraad(data.products || []))
        .then(producten => {
            alleProducten = producten;
            huidigProduct = id ? alleProducten.find(p => slugify(p.name) === id) : null;

            if (!huidigProduct) {
                document.getElementById('product-notfound').style.display = '';
                return;
            }

            document.getElementById('breadcrumb').style.display = '';
            document.getElementById('product-detail-content').style.display = '';
            renderDetail();
        })
        .catch(() => {
            document.getElementById('product-notfound').style.display = '';
        });
}

document.getElementById('qty-min').addEventListener('click', () => {
    aantal = Math.max(1, aantal - 1);
    updateQtyDisplay();
});
document.getElementById('qty-plus').addEventListener('click', () => {
    aantal = Math.min(maxKiesbaar(), aantal + 1);
    updateQtyDisplay();
});

document.getElementById('detail-add-btn').addEventListener('click', function () {
    const btn = this;
    const product = {
        id:       btn.dataset.id,
        name:     btn.dataset.name,
        subtitle: btn.dataset.subtitle,
        price:    btn.dataset.price,
        image:    btn.dataset.image,
        max:      btn.dataset.max,
    };
    if (voegToeAanWinkelmand(product, aantal) === 0) {
        showToast(t('product.maxStock'));
        return;
    }
    showToast('✓ ' + product.name + ' ' + t('index.toastAdded'));

    const origineel = btn.textContent;
    btn.textContent = t('product.added');
    btn.disabled = true;
    setTimeout(() => {
        btn.textContent = origineel;
        btn.disabled = huidigProduct && voorraadAantal(huidigProduct) <= 0;
    }, 1200);

    aantal = 1;
    updateQtyDisplay();
});

document.addEventListener('taalGewijzigd', renderDetail);

laadProduct();
