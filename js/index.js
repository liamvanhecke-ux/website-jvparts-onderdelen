if (window.netlifyIdentity) {
    window.netlifyIdentity.on('init', user => {
        if (!user) {
            window.netlifyIdentity.on('login', () => {
                document.location.href = '/admin/';
            });
        }
    });
}

const placeholderSVG = `<svg fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>`;

let allProducts = [];
let selectedCategories = new Set(); // leeg = "Alles"
let selectedCondition = 'Alles';
let searchQuery = '';

/* Geeft het vertaalde veld terug voor de huidige taal (bv. name_fr),
   en valt terug op het Nederlandse veld als er geen vertaling is ingevuld. */
function veldVoorTaal(obj, veld) {
    return (obj[veld + '_' + huidigeTaal] && obj[veld + '_' + huidigeTaal].trim())
        || obj[veld]
        || '';
}

function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    grid.innerHTML = '';
    if (products.length === 0) {
        grid.innerHTML = `<p style="color:#888;grid-column:1/-1">${t('index.noResults')}</p>`;
        return;
    }
    products.forEach(p => {
        const naam = veldVoorTaal(p, 'name');
        const subtitel = veldVoorTaal(p, 'subtitle');
        const imgContent = p.image
            ? `<img src="${p.image}" alt="${naam}" style="width:100%;height:100%;object-fit:cover;">`
            : placeholderSVG;
        const pid = slugify(p.name);
        const badge = p.condition === 'Tweedehands'
            ? `<div class="product-badge used">${t('index.badgeUsed')}</div>`
            : `<div class="product-badge in">${t('index.badgeNew')}</div>`;
        const voorraad = voorraadInfo(p);
        const uitverkocht = voorraad.aantal <= 0;
        /* Enkel een extra label tonen als het iets zegt: bijna op of uitverkocht */
        const voorraadBadge = voorraad.cls === 'in' ? ''
            : `<div class="product-badge stock ${voorraad.cls}">${voorraad.label}</div>`;
        grid.innerHTML += `
        <div class="product-card" onclick="location.href='product.html?id=${pid}'">
            <div class="product-img">${imgContent}${badge}${voorraadBadge}</div>
            <div class="product-info">
                <div class="product-name">${naam}</div>
                <div class="product-sub">${subtitel}</div>
                <div class="product-footer">
                    <span class="product-price">€ ${p.price}</span>
                    <button class="btn-add"
                        data-id="${pid}"
                        data-name="${naam.replace(/"/g,'&quot;')}"
                        data-subtitle="${subtitel.replace(/"/g,'&quot;')}"
                        data-price="${p.price}"
                        data-image="${p.image||''}"
                        data-max="${isFinite(voorraad.aantal) ? voorraad.aantal : ''}"
                        ${uitverkocht ? 'disabled' : ''}
                        onclick="event.stopPropagation(); addProduct(this)">${uitverkocht ? t('product.stockOut') : t('index.addToCart')}</button>
                </div>
            </div>
        </div>`;
    });
}

/* Vult de zoekbalk en de filtering in op basis van ?zoek=... in de URL,
   zodat een zoekopdracht vanaf een andere pagina hier meteen resultaat toont. */
function pasZoekParamToe() {
    const term = new URLSearchParams(location.search).get('zoek');
    if (!term) return;
    searchQuery = term;
    const input = document.getElementById('search-input');
    if (input) input.value = term;
}

fetch('/data/products.json')
    .then(r => r.json())
    .then(data => laadLiveVoorraad(data.products || []))
    .then(producten => {
        allProducts = producten;
        buildChips(allProducts);
        buildFilterPanel(allProducts);
        bindConditionChips();
        bindSearch();
        pasZoekParamToe();
        applyFilters();
    })
    .catch(() => {
        document.getElementById('product-grid').innerHTML =
            `<p style="color:#888;grid-column:1/-1">${t('index.loadError')}</p>`;
    });

function addProduct(btn) {
    const product = {
        id:       btn.dataset.id,
        name:     btn.dataset.name,
        subtitle: btn.dataset.subtitle,
        price:    btn.dataset.price,
        image:    btn.dataset.image,
        max:      btn.dataset.max,
    };
    if (voegToeAanWinkelmand(product) === 0) {
        showToast(t('product.maxStock'));
        return;
    }
    showToast('✓ ' + product.name + ' ' + t('index.toastAdded'));

    /* korte visuele bevestiging op de knop */
    const origineel = btn.textContent;
    btn.textContent = t('index.added');
    btn.disabled = true;
    setTimeout(() => { btn.textContent = origineel; btn.disabled = false; }, 1200);
}

document.addEventListener('taalGewijzigd', () => {
    buildChips(allProducts);
    buildFilterPanel(allProducts);
    applyFilters();
    const activeOpt = document.querySelector('#condition-chips .segmented-option.active');
    if (activeOpt) layoutConditionSegmented(activeOpt);
});

function applyFilters() {
    let filtered = allProducts;
    if (selectedCategories.size > 0) {
        filtered = filtered.filter(p => selectedCategories.has(p.category));
    }
    if (selectedCondition !== 'Alles') {
        filtered = filtered.filter(p => (p.condition || 'Nieuw') === selectedCondition);
    }
    if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(p =>
            veldVoorTaal(p, 'name').toLowerCase().includes(q) ||
            veldVoorTaal(p, 'subtitle').toLowerCase().includes(q)
        );
    }
    renderProducts(filtered);
}

function bindSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    input.addEventListener('input', () => {
        searchQuery = input.value;
        applyFilters();
    });
}

/* Gedeelde toggle-logica voor zowel de chips (desktop) als de checklist in
   het filterpaneel (mobiel) — houdt selectedCategories in beide UI's sync. */
function toggleCategory(cat) {
    if (cat === 'Alles') {
        selectedCategories.clear();
    } else if (selectedCategories.has(cat)) {
        selectedCategories.delete(cat);
    } else {
        selectedCategories.add(cat);
    }
    updateCategoryChipStates();
    applyFilters();
}

function updateCategoryChipStates() {
    const isAlles = selectedCategories.size === 0;
    document.querySelectorAll('#category-chips .category-chip').forEach(chip => {
        const cat = chip.dataset.cat;
        chip.classList.toggle('active', cat === 'Alles' ? isAlles : selectedCategories.has(cat));
    });
    document.querySelectorAll('#filter-panel-list input[type="checkbox"]').forEach(cb => {
        cb.checked = cb.value === 'Alles' ? isAlles : selectedCategories.has(cb.value);
    });
    const countEl = document.getElementById('filter-count');
    if (countEl) {
        countEl.textContent = selectedCategories.size;
        countEl.hidden = selectedCategories.size === 0;
    }
}

function bindChips() {
    document.querySelectorAll('#category-chips .category-chip').forEach(chip => {
        chip.onclick = () => toggleCategory(chip.dataset.cat);
    });
}

/* Bouwt de mobiele "Filters"-checklist op, als alternatief voor de chips-rij
   die op een telefoon oneindig zou kunnen doorgroeien naarmate er in admin
   meer categorieën bijkomen. */
function buildFilterPanel(products) {
    const list = document.getElementById('filter-panel-list');
    if (!list) return;
    list.innerHTML = '';

    function maakItem(cat, label) {
        const item = document.createElement('label');
        item.className = 'filter-panel-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = cat;
        input.addEventListener('change', () => toggleCategory(cat));
        const span = document.createElement('span');
        span.textContent = label;
        item.appendChild(input);
        item.appendChild(span);
        return item;
    }

    list.appendChild(maakItem('Alles', t('index.catAll')));
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'nl'));
    cats.forEach(cat => list.appendChild(maakItem(cat, vertaalCategorie(cat, products))));

    updateCategoryChipStates();
}

function bindFilterPanel() {
    const trigger = document.getElementById('filter-trigger');
    const panel = document.getElementById('filter-panel');
    const overlay = document.getElementById('filter-overlay');
    const closeBtn = document.getElementById('filter-panel-close');
    const applyBtn = document.getElementById('filter-panel-apply');
    if (!trigger || !panel || !overlay) return;

    function openPanel() {
        panel.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closePanel() {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        if (!sidebar.classList.contains('open')) {
            document.body.style.overflow = '';
        }
    }

    trigger.addEventListener('click', openPanel);
    overlay.addEventListener('click', closePanel);
    closeBtn.addEventListener('click', closePanel);
    applyBtn.addEventListener('click', closePanel);
}
bindFilterPanel();

function layoutConditionSegmented(optionEl) {
    const container = document.getElementById('condition-chips');
    const indicator = document.getElementById('condition-indicator');
    const mask = document.getElementById('condition-mask');
    const goldRow = document.getElementById('condition-gold-row');
    const firstOption = container.querySelector(':scope > .segmented-option');

    const containerRect = container.getBoundingClientRect();
    const activeRect = optionEl.getBoundingClientRect();
    const rowLeft = firstOption.getBoundingClientRect().left - containerRect.left;

    const left = activeRect.left - containerRect.left;
    const width = activeRect.width;

    indicator.style.left = left + 'px';
    indicator.style.width = width + 'px';
    mask.style.left = left + 'px';
    mask.style.width = width + 'px';

    /* De gouden rij schuift precies tegengesteld aan het venster, zodat
       ze elkaar op elk moment van de overgang opheffen en de gouden
       tekst altijd exact onder de balk blijft staan (nooit "los"). */
    goldRow.style.width = (containerRect.width - 2 * rowLeft) + 'px';
    goldRow.style.left = (rowLeft - left) + 'px';
}

function bindConditionChips() {
    const options = document.querySelectorAll('#condition-chips .segmented-option');
    options.forEach(opt => {
        opt.onclick = () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            selectedCondition = opt.dataset.cond;
            layoutConditionSegmented(opt);
            applyFilters();
        };
    });
    const activeOpt = document.querySelector('#condition-chips .segmented-option.active') || options[0];
    layoutConditionSegmented(activeOpt);
}

window.addEventListener('resize', () => {
    const activeOpt = document.querySelector('#condition-chips .segmented-option.active');
    if (activeOpt) layoutConditionSegmented(activeOpt);
});

function vertaalCategorie(catNaam, products) {
    if (huidigeTaal === 'nl') return catNaam;
    const veld = 'category_' + huidigeTaal;
    const match = products.find(p => p.category === catNaam && p[veld] && p[veld].trim());
    return match ? match[veld] : catNaam;
}

function buildChips(products) {
    const container = document.getElementById('category-chips');
    container.querySelectorAll('.category-chip:not([data-cat="Alles"])').forEach(c => c.remove());
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'nl'));
    cats.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = 'category-chip';
        chip.dataset.cat = cat;
        chip.innerHTML = `<span class="chip-check"></span>${vertaalCategorie(cat, products)}`;
        container.appendChild(chip);
    });
    bindChips();
    updateCategoryChipStates();
}
