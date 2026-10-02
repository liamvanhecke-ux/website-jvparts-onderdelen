/* Zoekbalk in de topbar: op de shoppagina zelf filtert index.js al live mee
   terwijl je typt. Op alle andere pagina's stuurt Enter je naar de
   shoppagina met de zoekterm, zodat de balk daar ook iets doet. */

document.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('.topbar-search input');
    if (!input) return;

    const opShopPagina = !!document.getElementById('product-grid');
    if (opShopPagina) return;

    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const term = input.value.trim();
        location.href = term ? 'index.html?zoek=' + encodeURIComponent(term) : 'index.html';
    });
});
