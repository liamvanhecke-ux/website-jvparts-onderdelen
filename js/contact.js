const knop = document.getElementById("landKnop");
const lijst = document.getElementById("landLijst");
const codeEl = document.getElementById("landCode");
const hidden = document.getElementById("landcode");

knop.addEventListener("click", function () {
    lijst.classList.toggle("open");
});

lijst.querySelectorAll("li").forEach(function (li) {
    li.addEventListener("click", function () {
        const code = li.dataset.code;
        codeEl.textContent = code;
        hidden.value = code;
        knop.querySelector("img").src = li.querySelector("img").src;
        lijst.classList.remove("open");
    });
});

document.addEventListener("click", function (e) {
    if (!document.getElementById("landDropdown").contains(e.target)) {
        lijst.classList.remove("open");
    }
});


/* Kaart (OpenStreetMap) pas laden nadat de bezoeker erop klikt. Zo gaat er
   geen verbinding naar een externe dienst (en dus geen IP-adres) weg zonder
   dat de bezoeker dat zelf kiest. */
const kaartKnop = document.getElementById("kaart-knop");
if (kaartKnop) {
    kaartKnop.addEventListener("click", function () {
        const iframe = document.createElement("iframe");
        iframe.title = "Locatie JV-Parts";
        iframe.loading = "lazy";
        iframe.style.cssText = "border:0;display:block;width:100%;height:340px;margin-bottom:-40px;";
        iframe.src = "https://www.openstreetmap.org/export/embed.html?bbox=3.5400%2C50.8550%2C3.6800%2C50.8950&layer=mapnik&marker=50.8730%2C3.6110";
        document.getElementById("kaart-placeholder").replaceWith(iframe);
    });
}
