// MALSEVK — Tam uçtan uca regresyon: teklif akışının BAŞTAN SONA gerçek
// Supabase Auth hesaplarıyla doğrulanması (teklif ver -> kabul et -> işe
// başlandı -> tamamlandı olarak işaretle -> tamamlandığını onayla ->
// değerlendir). Bu akışın kendisi (offers.ts/ratings.ts) hâlâ tamamen
// localStorage'dır (Supabase Geçişi'nin kapsamı dışı) — burada YALNIZCA
// giriş, ÖNCEKİ (artık geçersiz) dev-seed-hesap tabanlı script'lerin (ör.
// tmp-completion-flow-test.mjs) aksine, GERÇEK Supabase Auth hesaplarıyla
// yapılıyor. UI etkileşim adımları (buton/etiket metinleri) o script'lerden
// doğrudan doğrulanarak alındı.
//
// Tek bir paylaşılan browser context/page kasıtlı olarak kullanılıyor —
// offers/ratings localStorage'da olduğu için aynı origin/context'te
// kalmak, kullanıcı değiştirmek (loginAs) için AYRI context açmaktan daha
// doğru: farklı context'ler farklı localStorage'a sahip olur, teklif
// verilerinin iki taraf arasında GERÇEKTEN paylaşıldığını doğrulamak bu
// yüzden TEK context gerektiriyor.
//
// Önkoşul: `npm run dev`, yerel Docker Supabase'e işaret ediyor olmalı.
// Çalıştırma: node scripts/tmp-e2e-regression-offer-lifecycle-test.mjs
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";
const URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Refusing to run: target Supabase URL is not local (safety guard).");
}

const admin = createClient(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "TestSifre2026!";
const stamp = Date.now();
const createdUserIds = [];

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

async function makeRealAccount(label, role) {
  const email = `e2e-offer-${label}-${stamp}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`${label} createUser: ${created.error.message}`);
  createdUserIds.push(created.data.user.id);
  const client = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`${label} signIn: ${signIn.error.message}`);
  const reg = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `Test ${label}`, p_phone: "+905551239900",
    p_company_name: `Test ${label} Firma`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (reg.error) throw new Error(`${label} complete_registration: ${reg.error.message}`);
  return { email, id: created.data.user.id };
}

async function loginAs(page, email, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
  // Sunucu tarafı yönlendirme bitse de istemci tarafı useSession() önbelleği
  // bir sonraki render'a kadar null dönebilir (bkz. session.ts) — header'ın
  // gerçek rol metnini göstermesini bekleriz (Faz 2 testinde bulunan AYNI
  // yarış durumu düzeltmesi).
  await page.getByRole("banner").getByText(/Hizmet Alan|Hizmet Veren/).waitFor({ state: "visible", timeout: 15000 });
}

async function uploadOnePhoto(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function selectFromSearchable(page, label, optionText, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
}

async function main() {
  console.log("=== Kurulum: gerçek Supabase Auth hesapları (requester + provider) ===");
  const requester = await makeRealAccount("requester", "hizmet-alan");
  const provider = await makeRealAccount("provider", "hizmet-veren");
  check("setup: requester + provider hesapları oluşturuldu", !!requester.id && !!provider.id);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(String(err)));

    console.log("\n=== 1) Requester GERÇEK UI ile bir Forklift ilanı oluşturuyor ===");
    const jobTitle = `E2E-OFFER-LIFECYCLE-${stamp}`;
    await loginAs(page, requester.email);
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Forklift" });
    await page.getByLabel("İlan Başlığı").fill(jobTitle);
    await page.getByLabel("Hizmete Özel Açıklama").fill("Teklif akışı uçtan uca regresyon testi için oluşturuldu.");
    await selectFromSearchable(page, "İl", "Kocaeli");
    await selectFromSearchable(page, "İlçe", "Gebze");
    await selectFromSearchable(page, "Liman / Sanayi / OSB", "Listede yok", { exact: false });
    await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Forklift Sahası");
    await page.getByLabel("Açık Adres").fill("Test Mahallesi, Test Caddesi No:1, Gebze");
    await page.getByLabel("Başlangıç Tarihi").fill("2026-12-10");
    await page.getByLabel("Bitiş Tarihi").fill("2026-12-11");
    await uploadOnePhoto(page);
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    const jobId = page.url().split("/ilanlar/")[1].split("?")[0];
    check("1a. İlan oluşturuldu", /\/ilanlar\/[0-9a-f-]+/.test(page.url()), page.url());

    console.log("\n=== 2) Provider AYNI ilana teklif veriyor ===");
    await loginAs(page, provider.email);
    await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
    await page.getByLabel("Teklif Fiyatı").fill("7500");
    // "Tamamlanması Taahhüt Edilen Gün" artık yalnızca Nakliye kategorisinde
    // gösteriliyor (bkz. offer-form.tsx#requiresEstimatedDuration) — Forklift
    // için bu alan hiç render edilmez, bu yüzden hiç doldurulmaz.
    await page.getByLabel("Teklif Açıklaması").fill("Bu teklif e2e regresyon testi tarafından oluşturulmuştur, en az yirmi karakter içerir.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
    check("2a. Teklif başarıyla gönderildi", true);

    console.log("\n=== 3) Requester teklifi görüyor ve kabul ediyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("3a. Gelen Teklifler'de ilan/teklif görünüyor", true);
    let card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Kabul Et" }).click();
    await page.waitForTimeout(600);
    check("3b. Teklif kabul edildi (sayfa hatasız devam ediyor)", jsErrors.length === 0, jsErrors.join(" | "));

    console.log("\n=== 4) Requester işe başlandığını işaretliyor ===");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
    await page.getByRole("button", { name: "Evet, İşi Başlat" }).click();
    await page.waitForTimeout(600);
    check("4a. İşe başlandı olarak işaretlendi", true);

    console.log("\n=== 5) Provider tamamlandı olarak işaretliyor (completion request) ===");
    await loginAs(page, provider.email);
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=devam-eden`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
    await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
    await page.waitForTimeout(600);
    check("5a. Provider tamamlama talebini gönderdi", true);

    console.log("\n=== 6) Requester tamamlandığını onaylıyor + değerlendirme modalı açılıyor ===");
    await loginAs(page, requester.email);
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
    await card.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
    await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
    await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 10000 });
    check("6a. Tamamlama onaylandı ve değerlendirme modalı otomatik açıldı", true);

    const stars = page.getByRole("radio", { name: /yıldız/ });
    check("6b. Tam olarak 5 yıldız seçeneği var", (await stars.count()) === 5, await stars.count());
    await stars.nth(4).click();
    await page.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
    await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    check("6c. Değerlendirme gönderildikten sonra modal kapandı", (await page.getByRole("heading", { name: "Hizmeti Değerlendir" }).count()) === 0);

    console.log("\n=== 7) Nihai durum: iş Tamamlandı sekmesinde görünüyor mu ===");
    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("7a. İş, Hizmet Taleplerim > Tamamlandı sekmesinde görünüyor", true);

    await loginAs(page, provider.email);
    await page.goto(`${BASE_URL}/panel/tekliflerim?durum=tamamlandi`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    check("7b. Teklif, Verdiğim Teklifler > Tamamlanan sekmesinde görünüyor", true);

    check("8. Tüm akış boyunca beklenmeyen JS hatası yok", jsErrors.length === 0, jsErrors.join(" | "));

    console.log("\n=== Temizlik ===");
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }

    console.log(`\n=== SONUÇ: ${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) {
      console.log("Başarısız testler:");
      for (const f of failures) console.log(` - ${f}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("BEKLENMEYEN HATA:", error?.message || error);
  process.exitCode = 1;
});
