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

function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    grid.innerHTML = '';
    if (products.length === 0) {
        grid.innerHTML = '<p style="color:#888;grid-column:1/-1">Geen producten gevonden.</p>';
        return;
    }
    products.forEach(p => {
        const imgContent = p.image
            ? `<img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">`
            : placeholderSVG;
        const pid = slugify(p.name);
        grid.innerHTML += `
        <div class="product-card">
            <div class="product-img">${imgContent}</div>
            <div class="product-info">
                <div class="product-name">${p.name}</div>
                <div class="product-sub">${p.subtitle}</div>
                <div class="product-footer">
                    <span class="product-price">€ ${p.price}</span>
                    <button class="btn-add"
                        data-id="${pid}"
                        data-name="${p.name.replace(/"/g,'&quot;')}"
                        data-subtitle="${(p.subtitle||'').replace(/"/g,'&quot;')}"
                        data-price="${p.price}"
                        data-image="${p.image||''}"
                        onclick="addProduct(this)">+ Voeg toe</button>
                </div>
            </div>
        </div>`;
    });
}

fetch('/data/products.json')
    .then(r => r.json())
    .then(data => {
        allProducts = data.products || [];
        renderProducts(allProducts);
        buildChips(allProducts);
    })
    .catch(() => {
        document.getElementById('product-grid').innerHTML =
            '<p style="color:#888;grid-column:1/-1">Kon producten niet laden.</p>';
    });

function addProduct(btn) {
    const product = {
        id:       btn.dataset.id,
        name:     btn.dataset.name,
        subtitle: btn.dataset.subtitle,
        price:    btn.dataset.price,
        image:    btn.dataset.image,
    };
    voegToeAanWinkelmand(product);
    showToast('✓ ' + product.name + ' toegevoegd aan winkelmand');

    /* korte visuele bevestiging op de knop */
    const origineel = btn.textContent;
    btn.textContent = '✓ Toegevoegd';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = origineel; btn.disabled = false; }, 1200);
}

function bindChips() {
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.onclick = () => {
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const cat = chip.dataset.cat || chip.textContent.trim();
            if (cat === 'Alles') {
                renderProducts(allProducts);
            } else {
                renderProducts(allProducts.filter(p => p.category === cat));
            }
        };
    });
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
        chip.textContent = cat;
        container.appendChild(chip);
    });
    bindChips();
}
