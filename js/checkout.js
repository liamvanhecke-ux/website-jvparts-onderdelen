const VELDEN = ['voornaam', 'achternaam', 'email', 'telefoon', 'straat', 'huisnr', 'postcode', 'gemeente', 'land', 'opmerking'];

function slaOp() {
    const data = {};
    VELDEN.forEach(id => { const el = document.getElementById(id); if (el) data[id] = el.value; });
    localStorage.setItem('jvparts_checkout', JSON.stringify(data));
}

function laadGegevens() {
    const opgeslagen = localStorage.getItem('jvparts_checkout');
    if (!opgeslagen) return;
    const data = JSON.parse(opgeslagen);
    VELDEN.forEach(id => { const el = document.getElementById(id); if (el && data[id] !== undefined) el.value = data[id]; });
}

laadGegevens();
renderSamenvatting({ itemsId: 'co-summary-items', subtotaalId: 'co-subtotaal', verzendingId: 'co-verzending', totaalId: 'co-totaal', btwId: 'co-btw' });
VELDEN.forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', slaOp); });

function setStatus(id, ok, bericht) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('valid', !!ok);
    el.classList.toggle('invalid', !ok);

    let fb = document.getElementById('fb-' + id);
    if (!fb) {
        fb = document.createElement('span');
        fb.id = 'fb-' + id;
        fb.className = 'veld-feedback';
        el.parentNode.appendChild(fb);
    }
    fb.textContent = bericht || '';
    fb.className = 'veld-feedback ' + (bericht ? (ok ? 'ok' : 'fout') : '');
}

function clearStatus(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('valid', 'invalid');
    const fb = document.getElementById('fb-' + id);
    if (fb) fb.textContent = '';
}

function vNaam(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    if (v.trim().length < 2) return { ok: false, msg: t('checkout.vMin2') };
    if (!/^[a-zA-ZÀ-ÖØ-öø-ÿ'\- ]+$/.test(v.trim())) return { ok: false, msg: t('checkout.vLettersOnly') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

function vEmail(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return { ok: false, msg: t('checkout.vInvalidEmail') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

function vTel(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    const c = v.replace(/[\s\-\.()]/g, '');
    if (!/^(\+32|0032|0)[1-9][0-9]{6,9}$/.test(c)) return { ok: false, msg: t('checkout.vInvalidPhone') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

function vStraat(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    if (v.trim().length < 2) return { ok: false, msg: t('checkout.vTooShort') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

function vHuisnr(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    if (!/^[0-9]+[a-zA-Z\-\/]?[0-9]*$/.test(v.trim())) return { ok: false, msg: t('checkout.vInvalidHouseNr') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

function vPostcode(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    if (!/^[0-9]{4}$/.test(v.trim())) return { ok: false, msg: t('checkout.vPostcode4') };
    const n = parseInt(v);
    if (n < 1000 || n > 9999) return { ok: false, msg: t('checkout.vInvalidPostcodeBE') };
    return { ok: true, msg: null };
}

function vGemeente(v) {
    if (!v.trim()) return { ok: false, msg: t('checkout.vRequired') };
    return { ok: true, msg: t('checkout.vCorrect') };
}

let postcodeTimer = null;
let postcodeGeldig = false;

function lookupPostcode(postcode) {
    clearTimeout(postcodeTimer);
    const landEl = document.getElementById('land');
    const landCode = (landEl ? landEl.value : 'BE').toLowerCase();
    const landCodes = { BE: 'be', NL: 'nl', LU: 'lu', FR: 'fr', DE: 'de' };
    const apiLand = landCodes[landEl ? landEl.value : 'BE'] || 'be';

    setStatus('postcode', true, t('checkout.vChecking'));
    postcodeGeldig = false;

    postcodeTimer = setTimeout(() => {
        fetch(`https://api.zippopotam.us/${apiLand}/${postcode}`)
            .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
            .then(data => {
                const gemeente = data.places[0]['place name'];
                const provincie = data.places[0].state || '';
                document.getElementById('gemeente').value = gemeente;
                slaOp();
                setStatus('postcode', true, t('checkout.vValidPostcode') + (provincie ? ' ' + provincie : ''));
                setStatus('gemeente', true, t('checkout.vAutoFilled'));
                postcodeGeldig = true;
            })
            .catch(() => {
                setStatus('postcode', false, t('checkout.vPostcodeNotFound'));
                postcodeGeldig = false;
            });
    }, 450);
}

const veldenConfig = [
    ['voornaam', vNaam],
    ['achternaam', vNaam],
    ['email', vEmail],
    ['telefoon', vTel],
    ['straat', vStraat],
    ['huisnr', vHuisnr],
    ['gemeente', vGemeente],
];

veldenConfig.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
        const r = fn(el.value);
        setStatus(id, r.ok, r.msg);
    });

    el.addEventListener('input', () => {
        if (el.classList.contains('invalid')) {
            const r = fn(el.value);
            setStatus(id, r.ok, r.msg);
        }
    });
});

const postcodeEl = document.getElementById('postcode');
postcodeEl.addEventListener('input', () => {
    const r = vPostcode(postcodeEl.value);
    if (!r.ok) { setStatus('postcode', false, r.msg); postcodeGeldig = false; return; }
    lookupPostcode(postcodeEl.value.trim());
});
postcodeEl.addEventListener('blur', () => {
    const r = vPostcode(postcodeEl.value);
    if (!r.ok) setStatus('postcode', false, r.msg);
    else if (!postcodeGeldig) lookupPostcode(postcodeEl.value.trim());
});

document.getElementById('land').addEventListener('change', () => {
    if (postcodeEl.value.length === 4) lookupPostcode(postcodeEl.value.trim());
});

function gaVooruit() {
    const checks = [
        ['voornaam', vNaam],
        ['achternaam', vNaam],
        ['email', vEmail],
        ['telefoon', vTel],
        ['straat', vStraat],
        ['huisnr', vHuisnr],
        ['postcode', vPostcode],
        ['gemeente', vGemeente],
    ];

    let eersteInvalid = null;
    let alleGeldig = true;

    for (const [id, fn] of checks) {
        const el = document.getElementById(id);
        const r = fn(el.value);
        setStatus(id, r.ok, r.msg);
        if (!r.ok && !eersteInvalid) eersteInvalid = el;
        if (!r.ok) alleGeldig = false;
    }

    if (!alleGeldig) {
        eersteInvalid.focus();
        eersteInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast(t('checkout.vCheckFields'));
        return;
    }

    slaOp();
    window.location.href = 'betalen.html';
}

document.addEventListener('taalGewijzigd', () => {
    renderSamenvatting({ itemsId: 'co-summary-items', subtotaalId: 'co-subtotaal', verzendingId: 'co-verzending', totaalId: 'co-totaal', btwId: 'co-btw' });
    veldenConfig.forEach(([id]) => clearStatus(id));
    clearStatus('postcode');
});
