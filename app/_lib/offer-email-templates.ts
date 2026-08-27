import { formatMoney, isValidCurrency } from "./money";
import type { Currency } from "./types";

/**
 * "Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-postalarının saf HTML/metin
 * üretim katmanı — hiçbir I/O yapmaz, yalnızca girdi verisinden `{subject,
 * html, text}` üretir (app/api/offer-notifications/route.ts tarafından
 * çağrılır). Kullanıcı tarafından girilen her değer (ilan başlığı, firma/ad)
 * `escapeHtml` ile geçirilir — HTML injection'a asla izin verilmez.
 */

export type OfferEmailContext = {
  recipientDisplayName: string | null;
  jobTitle: string;
  jobId: string;
  offerAmount: number;
  offerCurrency: string;
  /** "atik-satin-alma" ise tutar "Teklif Ettiğiniz Bedel" olarak etiketlenir — offer-form.tsx:157 ile AYNI kural. */
  offerCommercialDirection: string | null;
  appBaseUrl: string;
};

export type OfferAcceptedEmailContext = OfferEmailContext & {
  /** Yalnızca "teklif kabul edildi" e-postasında kullanılır — kabul-öncesi anonimleştirme kuralı gereği "yeni teklif" e-postasında ASLA kullanılmaz (bkz. migration 0085'in kendi yorumu). */
  actorDisplayName: string | null;
};

export type BuiltEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function amountLabel(offerCommercialDirection: string | null): string {
  return offerCommercialDirection === "atik-satin-alma" ? "Teklif Ettiğiniz Bedel" : "Teklif Tutarı";
}

function formattedAmount(amount: number, currency: string): string {
  return isValidCurrency(currency) ? formatMoney(amount, currency as Currency) : `${amount} ${currency}`;
}

function emailShell(params: { preheader: string; bodyHtml: string; ctaLabel: string; ctaUrl: string }): string {
  const { preheader, bodyHtml, ctaLabel, ctaUrl } = params;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MALSEVK</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#10233f;padding:20px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.5px;">MALSEVK</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#10233f;font-size:15px;line-height:1.6;">
                ${bodyHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:8px;background-color:#10233f;">
                      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background-color:#f4f5f7;color:#6b7280;font-size:12px;line-height:1.5;">
                Bu e-posta MALSEVK üzerindeki gerçek bir işlem nedeniyle otomatik olarak gönderilmiştir. Bu e-postayı beklemiyorsanız güvenle yok sayabilirsiniz.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildNewOfferEmail(ctx: OfferEmailContext): BuiltEmail {
  const greeting = ctx.recipientDisplayName ? `Sayın ${escapeHtml(ctx.recipientDisplayName)},` : "Merhaba,";
  const jobTitle = escapeHtml(ctx.jobTitle);
  const amount = escapeHtml(formattedAmount(ctx.offerAmount, ctx.offerCurrency));
  const label = escapeHtml(amountLabel(ctx.offerCommercialDirection));
  const url = `${ctx.appBaseUrl}/panel/gelen-teklifler?ilanId=${encodeURIComponent(ctx.jobId)}`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 16px;"><strong>${jobTitle}</strong> başlıklı ilanınıza yeni bir teklif geldi.</p>
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">${label}</p>
    <p style="margin:0 0 16px;font-size:20px;font-weight:bold;">${amount}</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Teklif veren bilgileri, teklifi kabul ettiğinizde paylaşılır.</p>
  `;

  return {
    subject: "MALSEVK | İlanınıza Yeni Teklif Geldi",
    html: emailShell({
      preheader: `${ctx.jobTitle} ilanınıza yeni bir teklif geldi.`,
      bodyHtml,
      ctaLabel: "Teklifi Görüntüle",
      ctaUrl: url,
    }),
    text: [
      ctx.recipientDisplayName ? `Sayın ${ctx.recipientDisplayName},` : "Merhaba,",
      "",
      `"${ctx.jobTitle}" başlıklı ilanınıza yeni bir teklif geldi.`,
      `${amountLabel(ctx.offerCommercialDirection)}: ${formattedAmount(ctx.offerAmount, ctx.offerCurrency)}`,
      "",
      "Teklif veren bilgileri, teklifi kabul ettiğinizde paylaşılır.",
      "",
      `Teklifi görüntülemek için: ${url}`,
    ].join("\n"),
  };
}

export function buildOfferAcceptedEmail(ctx: OfferAcceptedEmailContext): BuiltEmail {
  const greeting = ctx.recipientDisplayName ? `Sayın ${escapeHtml(ctx.recipientDisplayName)},` : "Merhaba,";
  const jobTitle = escapeHtml(ctx.jobTitle);
  const amount = escapeHtml(formattedAmount(ctx.offerAmount, ctx.offerCurrency));
  const label = escapeHtml(amountLabel(ctx.offerCommercialDirection));
  const actorLine = ctx.actorDisplayName
    ? `<p style="margin:0 0 16px;"><strong>${escapeHtml(ctx.actorDisplayName)}</strong> tarafından yayınlanan <strong>${jobTitle}</strong> başlıklı ilana verdiğiniz teklif kabul edildi.</p>`
    : `<p style="margin:0 0 16px;"><strong>${jobTitle}</strong> başlıklı ilana verdiğiniz teklif kabul edildi.</p>`;
  const url = `${ctx.appBaseUrl}/panel/tekliflerim`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    ${actorLine}
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">${label}</p>
    <p style="margin:0 0 16px;font-size:20px;font-weight:bold;">${amount}</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">İlan sahibinin iletişim bilgilerine, operasyon sayfanızdan ulaşabilirsiniz.</p>
  `;

  return {
    subject: "MALSEVK | Teklifiniz Kabul Edildi",
    html: emailShell({
      preheader: `${ctx.jobTitle} ilanına verdiğiniz teklif kabul edildi.`,
      bodyHtml,
      ctaLabel: "Operasyonu Görüntüle",
      ctaUrl: url,
    }),
    text: [
      ctx.recipientDisplayName ? `Sayın ${ctx.recipientDisplayName},` : "Merhaba,",
      "",
      ctx.actorDisplayName
        ? `${ctx.actorDisplayName} tarafından yayınlanan "${ctx.jobTitle}" başlıklı ilana verdiğiniz teklif kabul edildi.`
        : `"${ctx.jobTitle}" başlıklı ilana verdiğiniz teklif kabul edildi.`,
      `${amountLabel(ctx.offerCommercialDirection)}: ${formattedAmount(ctx.offerAmount, ctx.offerCurrency)}`,
      "",
      "İlan sahibinin iletişim bilgilerine, operasyon sayfanızdan ulaşabilirsiniz.",
      "",
      `Operasyonu görüntülemek için: ${url}`,
    ].join("\n"),
  };
}
