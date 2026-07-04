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
