// MALSEVK — Kayıt formu -> user_metadata -> /kayit-tamamla ön-doldurma
// Playwright doğrulaması. Gerçek "farklı sekme" senaryosunu simüle eder:
// AYNI browser context (çerezler/localStorage paylaşılır, PKCE code_verifier
// çerezi bu yüzden çalışır) ama YENİ bir page/tab (sessionStorage PAYLAŞILMAZ,
// tam olarak bir e-posta istemcisinin linki yeni sekmede açması gibi).
//
// İzole dizin kopyasında (node_modules junction, ayrı .next/next.config.ts)
// çalışan bir dev server'a karşı — canlı localhost:3000 oturumuna HİÇ
// dokunmaz. Önkoşul: local Docker Supabase (enable_confirmations=true) +
// izole dev server ayakta.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3055";
const MAILPIT_URL = "http://127.0.0.1:54324";
const PASSWORD = "Guclu1!Sifre2026";
const ts = Date.now();

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` -- ${extra}` : ""));
    console.log(`FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

console.log("=== 1) Kayıt formunu doldur (tab A) ===");
const email = `metaprefill-${ts}@example.com`;
const pageA = await context.newPage();
await pageA.goto(`${BASE_URL}/giris-yap?mode=kayit`);
await pageA.getByRole("radio", { name: "Hizmet Alan" }).click();

await pageA.getByLabel("Ad", { exact: true }).fill("Metadata");
await pageA.getByLabel("Soyad", { exact: true }).fill("Testçi");
await pageA.getByLabel("E-posta").fill(email);
await pageA.getByLabel("Telefon Numarası").fill("0532 111 22 33");
await pageA.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
await pageA.getByLabel("Şifre Tekrar").fill(PASSWORD);
await pageA.getByLabel("Firma Adı").fill("Metadata Test Ltd");
await pageA.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });

const provinceId = await pageA.getByLabel("İl", { exact: true }).getAttribute("id");
await selectSearchable(pageA, provinceId, "Kocaeli");
await pageA.waitForTimeout(150);
const districtId = await pageA.getByLabel("İlçe", { exact: true }).getAttribute("id");
await selectSearchable(pageA, districtId, "Gebze");

await pageA.locator('label:has-text("okudum, anladım ve kabul ediyorum")').locator('input[type="checkbox"]').check();

await pageA.getByRole("button", { name: "Hesap Oluştur" }).click();
await pageA.getByText("E-postanızı Kontrol Edin").waitFor({ state: "visible", timeout: 10000 });
check("Kayıt formu gönderildi, 'E-postanızı Kontrol Edin' ekranı göründü", true);

console.log("\n=== 2) Gerçek doğrulama e-postasını Mailpit'ten al ===");
let messageId = null;
for (let i = 0; i < 20 && !messageId; i++) {
  const list = await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json();
  const found = list.messages.find((m) => m.To.some((to) => to.Address === email));
  if (found) messageId = found.ID;
  else await new Promise((resolve) => setTimeout(resolve, 500));
}
check("Doğrulama e-postası Mailpit'te bulundu", messageId !== null);
const msg = await (await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`)).json();
const body = msg.HTML || msg.Text || "";
const match = body.match(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/);
const verifyUrl = match ? match[0].replace(/&amp;/g, "&") : null;
check("E-posta içinde doğrulama linki bulundu", verifyUrl !== null);

console.log("\n=== 3) Linke YENİ bir sekmede (aynı context, farklı page) tıkla — gerçek e-posta istemcisi davranışı ===");
const pageB = await context.newPage();
await pageB.goto(verifyUrl);
await pageB.waitForURL(/\/kayit-tamamla/, { timeout: 15000 }).catch(() => {});
check("Yeni sekme /kayit-tamamla'ya ulaştı (PKCE code exchange çerez üzerinden başarılı)", pageB.url().includes("/kayit-tamamla"), pageB.url());

console.log("\n=== 4) sessionStorage BOŞ olduğunu doğrula (gerçek çapraz-sekme kanıtı) ===");
const sessionDraft = await pageB.evaluate(() => window.sessionStorage.getItem("malsevk.pending-registration-draft.v1"));
check("Yeni sekmenin sessionStorage'ında taslak YOK (gerçekten farklı sekme, prefill sessionStorage'a bağımlı DEĞİL)", sessionDraft === null);

console.log("\n=== 5) Form user_metadata'dan ÖN-DOLDURULMUŞ, OTOMATİK GÖNDERİLMEMİŞ ===");
await pageB.waitForTimeout(500);
check("Hâlâ /kayit-tamamla'da (otomatik yönlendirme/gönderim YOK)", pageB.url().includes("/kayit-tamamla"));
check("'Kaydı Tamamla' butonu görünüyor (form gösteriliyor, auto-complete değil)", await pageB.getByRole("button", { name: "Kaydı Tamamla" }).isVisible());

const roleChecked = await pageB.getByRole("radio", { name: "Hizmet Alan" }).isChecked();
check("Hesap Türü ön-dolu: Hizmet Alan seçili", roleChecked);

const firstNameValue = await pageB.getByLabel("Ad", { exact: true }).inputValue();
check("Ad ön-dolu: 'Metadata'", firstNameValue === "Metadata", firstNameValue);

const lastNameValue = await pageB.getByLabel("Soyad", { exact: true }).inputValue();
check("Soyad ön-dolu: 'Testçi'", lastNameValue === "Testçi", lastNameValue);

const phoneValue = await pageB.getByLabel("Telefon Numarası").inputValue();
check("Telefon ön-dolu (normalize edilmiş +90 formatı)", phoneValue.includes("532") || phoneValue.includes("90532"), phoneValue);

const companyNameValue = await pageB.getByLabel("Firma Adı").inputValue();
check("Firma adı ön-dolu: 'Metadata Test Ltd'", companyNameValue === "Metadata Test Ltd", companyNameValue);

const companyTypeValue = await pageB.getByLabel("Kullanıcı Tipi").inputValue();
check("Kullanıcı Tipi ön-dolu: 'sahis-isletmesi'", companyTypeValue === "sahis-isletmesi", companyTypeValue);

const provinceTriggerText = await pageB.getByLabel("İl", { exact: true }).innerText();
check("İl ön-dolu: 'Kocaeli' içeriyor", provinceTriggerText.includes("Kocaeli"), provinceTriggerText);

const districtTriggerText = await pageB.getByLabel("İlçe", { exact: true }).innerText();
check("İlçe ön-dolu: 'Gebze' içeriyor", districtTriggerText.includes("Gebze"), districtTriggerText);

const legalConsentChecked = await pageB
  .locator('label:has-text("okudum, anladım ve kabul ediyorum")')
  .locator('input[type="checkbox"]')
  .isChecked();
check("Yasal onay kutusu ön-dolu (işaretli)", legalConsentChecked);

console.log("\n=== 6) Kullanıcı 'Kaydı Tamamla' der, kayıt tamamlanır ===");
await pageB.getByRole("button", { name: "Kaydı Tamamla" }).click();
await pageB.waitForURL(`${BASE_URL}/panel`, { timeout: 15000 }).catch(() => {});
check("'Kaydı Tamamla' sonrası /panel'e yönlendirildi", pageB.url() === `${BASE_URL}/panel`, pageB.url());

await context.close();
await browser.close();

console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log("Başarısız testler:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
