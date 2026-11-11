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
        grid.innerHTML = legeStaatHTML();
        return;
    }
    products.forEach(p => {
        /* Productdata komt uit de admin-CMS. We vertrouwen die inhoud niet
           blindweg in innerHTML: alles wat als tekst of attribuut terechtkomt
           gaat door esc() (zie js/cart.js), zodat een naam/beschrijving met
           HTML/script er nooit voor zorgt dat die code uitgevoerd wordt
           (stored XSS). */
        const naam = veldVoorTaal(p, 'name');
        const subtitel = veldVoorTaal(p, 'subtitle');
        const imgContent = p.image
            ? `<img src="${esc(p.image)}" alt="${esc(naam)}" style="width:100%;height:100%;object-fit:cover;">`
            : placeholderSVG;
        const pid = slugify(p.name);
        const badge = p.condition === 'Tweedehands'
            ? `<div class="product-badge used">${t('index.badgeUsed')}</div>`
            : '';
        const voorraad = voorraadInfo(p);
        const uitverkocht = voorraad.aantal <= 0;
        /* Enkel een extra label tonen als het iets zegt: bijna op of uitverkocht */
        const voorraadBadge = voorraad.cls === 'in' ? ''
            : `<div class="product-badge stock ${voorraad.cls}">${voorraad.label}</div>`;
        grid.innerHTML += `
        <div class="product-card" onclick="location.href='product.html?id=${pid}'">
            <div class="product-img">${imgContent}${badge}${voorraadBadge}</div>
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
                        onclick="event.stopPropagation(); addProduct(this)">${uitverkocht ? t('product.stockOut') : t('index.addToCart')}</button>
                </div>
            </div>
        </div>`;
    });
}

/* Wat tonen we als er geen producten overblijven? In plaats van alleen
   "Geen producten gevonden." leggen we uit waarom, en geven we een knop
   waarmee de klant met één klik weer bij producten staat.
   - zoekterm ingevuld        -> "Niets gevonden voor ..." + Wis zoekopdracht
   - enkel filter Tweedehands -> "Momenteel geen tweedehands ..." + Bekijk nieuw
   - andere filters           -> "Geen producten met deze filters." + Toon alles
   - geen enkele filter actief (lege shop) -> de gewone korte melding */
function legeStaatHTML() {
    const zoekterm = searchQuery.trim();
    const filtersActief = selectedCategories.size > 0 || selectedCondition !== 'Alles';
    if (!zoekterm && !filtersActief) {
        return `<p style="color:#888;grid-column:1/-1">${t('index.noResults')}</p>`;
    }

    let tekst, knop, actie, contact = false;
    if (zoekterm) {
        /* replace met een functie: zo wordt een "$" in de zoekterm niet als
           speciaal teken gelezen. esc() eromheen tegen HTML in de zoekterm. */
        tekst = t('index.emptySearch').replace('{term}', () => zoekterm);
        knop = t('index.emptySearchBtn');
        actie = 'wis-zoek';
        contact = true;
    } else if (selectedCondition === 'Tweedehands' && selectedCategories.size === 0) {
        tekst = t('index.emptyUsed');
        knop = t('index.emptyUsedBtn');
        actie = 'toon-nieuw';
        contact = true;
    } else {
        tekst = t('index.emptyFilters');
        knop = t('index.emptyFiltersBtn');
        actie = 'reset';
    }

    return `
    <div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p class="empty-state-text">${esc(tekst)}</p>
        <button type="button" class="btn-primary" data-leeg-actie="${actie}">${esc(knop)}</button>
        ${contact ? `<p class="empty-state-contact">${esc(t('index.emptyContact'))} <a href="contact.html">${esc(t('index.emptyContactLink'))}</a></p>` : ''}
    </div>`;
}

/* Zet de conditie-toggle (Alles / Nieuw / Tweedehands) vanuit code: we
   klikken gewoon op de juiste optie, dan lopen balk, filter en navbar mee. */
function kiesConditie(cond) {
    const opt = document.querySelector(`#condition-chips > .segmented-option[data-cond="${cond}"]`);
    if (opt) opt.click();
}

function wisZoekopdracht() {
    searchQuery = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
}

/* De knop in de lege staat. Eén listener op het rooster, want de inhoud
   wordt bij elke filterwijziging opnieuw opgebouwd. */
document.getElementById('product-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-leeg-actie]');
    if (!btn) return;
    const actie = btn.dataset.leegActie;
    if (actie === 'wis-zoek') {
        wisZoekopdracht();
        applyFilters();
    } else if (actie === 'toon-nieuw') {
        kiesConditie('Nieuw');
    } else {
        wisZoekopdracht();
        selectedCategories.clear();
        updateCategoryChipStates();
        kiesConditie('Alles'); // roept zelf applyFilters() aan
    }
});

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
            syncStaatNav();
            layoutConditionSegmented(opt);
            applyFilters();
        };
    });
    const activeOpt = document.querySelector('#condition-chips .segmented-option.active') || options[0];
    layoutConditionSegmented(activeOpt);
}

/* Houdt de menu-links (topbar + sidebar) in sync met de gekozen staat:
   "Tweedehands" is actief bij die staat, anders "Shop"/"Homepagina". */
function syncStaatNav() {
    const tweedehands = selectedCondition === 'Tweedehands';
    document.querySelectorAll('.topbar-nav a, #sidebar nav a').forEach(a => {
        const href = a.getAttribute('href');
        if (href === 'index.html?staat=Tweedehands') a.classList.toggle('active', tweedehands);
        else if (href === 'index.html') a.classList.toggle('active', !tweedehands);
    });
}

/* Opent de pagina met de staat uit ?staat=Nieuw of ?staat=Tweedehands al
   gekozen (bv. via de menu-link "Tweedehands"). Andere waarden negeren we. */
function pasStaatParamToe() {
    const staat = new URLSearchParams(location.search).get('staat');
    if (staat !== 'Nieuw' && staat !== 'Tweedehands') return;
    selectedCondition = staat;
    document.querySelectorAll('#condition-chips > .segmented-option').forEach(o => {
        o.classList.toggle('active', o.dataset.cond === staat);
    });
    syncStaatNav();
}

window.addEventListener('resize', () => {
    const activeOpt = document.querySelector('#condition-chips .segmented-option.active');
    if (activeOpt) layoutConditionSegmented(activeOpt);
});

/* De schuivende balk hangt niet af van productdata (enkel van de 3 vaste
   knoppen hierboven in de HTML), dus meteen positioneren i.p.v. te wachten
   tot /data/products.json en de live voorraad (2 netwerk-aanvragen) binnen
   zijn. Zonder die vertraging verschijnt de balk soms heel even verkeerd
   uitgelijnd ("geflitst") voor de JS kan positioneren. */
pasStaatParamToe();
bindConditionChips();

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
        chip.innerHTML = `<span class="chip-check"></span>${esc(vertaalCategorie(cat, products))}`;
        container.appendChild(chip);
    });
    bindChips();
    updateCategoryChipStates();
}
