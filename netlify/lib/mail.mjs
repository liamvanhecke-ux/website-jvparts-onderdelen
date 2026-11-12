// E-mails versturen via Resend (https://resend.com), met een vaste
// JV-Parts-opmaak. Wordt gebruikt door netlify/functions/herroeping.mjs en
// kan later ook dienen voor bv. een bestelbevestiging.
//
// Instellen in Netlify (Site configuration > Environment variables):
//   RESEND_API_KEY  de geheime sleutel van Resend (begint met "re_")
//   MAIL_FROM       afzender, bv.  JV-Parts <info@jvparts.be>
//                   (het domein moet in Resend geverifieerd zijn)
//   MAIL_ADMIN      waar meldingen voor de winkel naartoe gaan, bv. info@jvparts.be
//
// De sleutel staat dus NOOIT in de code of in de browser.

const NAVY = '#15243d';
const GOUD = '#c9a55c';

export function mailGeconfigureerd() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.MAIL_ADMIN);
}

// Tekst van een klant mag nooit als HTML in een mail terechtkomen.
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Tabel "label: waarde". rijen = [[label, waarde], ...]; alles wordt ge-escaped.
export function gegevensTabel(rijen) {
  const tr = rijen.map(([label, waarde]) => `
      <tr>
        <td style="padding:8px 12px 8px 0;color:#8a8f98;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(label)}</td>
        <td style="padding:8px 0;color:#222;font-size:15px;font-weight:600;white-space:pre-line;">${esc(waarde)}</td>
      </tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 16px;">${tr}</table>`;
}

// De vaste opmaak rond elke mail: navy balk met het logo, witte kaart, voettekst.
// inhoudHtml is HTML die de aanroeper zelf opbouwt (met esc() voor klantdata).
export function mailOpmaak({ titel, inhoudHtml, voettekst }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e3dc;">
        <tr><td style="background:${NAVY};padding:20px 28px;">
          <span style="color:${GOUD};font-size:22px;font-weight:700;letter-spacing:.5px;">JV Parts</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:${NAVY};">${esc(titel)}</h1>
          ${inhoudHtml}
        </td></tr>
        <tr><td style="background:#f4f5f7;padding:16px 28px;color:#8a8f98;font-size:12px;line-height:1.6;">
          ${esc(voettekst || '')}<br>
          JV-Parts · Nederzwalmsesteenweg 94 · 9750 Zingem · België
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Verstuurt één mail. Gooit een fout als Resend ze weigert, zodat de
// aanroeper kan beslissen wat er dan gebeurt.
export async function stuurMail({ to, subject, html, replyTo }) {
  const body = {
    from: process.env.MAIL_FROM,
    to,
    // geen regeleinden in het onderwerp
    subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200),
    html,
  };
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}
