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

    document.getElementById('detail-image').innerHTML = p.image
        ? `<img src="${p.image}" alt="${naam}">`
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

    const beschrijvingWrap = document.getElementById('detail-description-wrap');
    const beschrijvingText = document.getElementById('detail-description-text');
    if (beschrijving.trim()) {
        beschrijvingWrap.style.display = '';
        beschrijvingText.innerHTML = '';
        beschrijving.split(/\n\s*\n/).forEach(alinea => {
            if (!alinea.trim()) return;
            const el = document.createElement('p');
            el.textContent = alinea.trim();
            beschrijvingText.appendChild(el);
        });
    } else {
        beschrijvingWrap.style.display = 'none';
    }

    addBtn.dataset.id = pid;
    addBtn.dataset.name = naam;
    addBtn.dataset.subtitle = subtitel;
    addBtn.dataset.price = p.price;
    addBtn.dataset.image = p.image || '';
    addBtn.dataset.max = isFinite(voorraad.aantal) ? voorraad.aantal : '';
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
