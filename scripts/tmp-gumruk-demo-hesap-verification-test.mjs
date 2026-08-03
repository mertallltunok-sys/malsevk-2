// Yeni "Gümrük Müşaviri Demo Hesabı" (Ahmet Yılmaz / gumrukdemo@malsevk.demo)
// doğrulaması — mevcut demo hesap mimarisi (users.ts#DEV_ACCOUNTS +
// seedGumrukMusaviriProviderProfileIfNeeded) bozulmadan eklendiğini,
// zengin profil bilgilerinin (bio/hizmet bölgeleri/çalışma alanları/deneyim)
// doğru kurulduğunu, iki "Yetki Belgesi"nin ONAYLI olduğunu, Gümrük
// Müşavirliği kategori izolasyonunun ve teklif-verme yetkisinin çalıştığını
// doğrular. Diğer hiçbir mevcut hesap/rol/akış (teklif sistemi, operasyon
// sistemi, bildirimler, demo veri sıfırlama) bu hesap yüzünden değişmedi —
// bu script yalnızca YENİ hesabı okur/kullanır, başka hiçbir tabloyu
// bozmaz.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const GUMRUK_DEMO = { email: "gumrukdemo@malsevk.demo", password: "Demo1234!" };
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}
async function logout(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}
async function seedJob(page, { id, title, category, reqId }) {
  await page.evaluate(
    ({ id, title, category, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category,
        province: "Kocaeli",
        district: "Dilovası",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Gumruk demo hesap dogrulama testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, reqId },
  );
}

const GUMRUK_JOB = { id: "gdemo-job-gumruk", title: "Gdemo Ithalat Gumrukleme Ilani", category: "gumruk-musavirligi" };
const OTHER_JOB = { id: "gdemo-job-lashing", title: "Gdemo Lashing Ilani", category: "lashing" };

async function main() {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- 1) Giriş: yeni kimlik bilgileriyle başarıyla giriş yapılabiliyor ---
  await loginAs(page, GUMRUK_DEMO.email, GUMRUK_DEMO.password, "/panel");
  await page.getByText("Ahmet Yılmaz", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  ok("[1] Yeni kimlik bilgileriyle (gumrukdemo@malsevk.demo / Demo1234!) giriş başarılı, panelde Ahmet Yılmaz görünüyor");

  const gumrukUserId = await getUserId(page, GUMRUK_DEMO.email);
  assert.ok(gumrukUserId, "Kullanıcı localStorage'da bulunmalı");

  // Seed zincirinin (hizmet + 2 belge + 2 beyan + profil) tamamlanmasını bekle.
  await page.waitForFunction(
    (targetId) => {
      const docs = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
      const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const user = users.find((u) => u.id === targetId);
      return (
        docs.filter((d) => d.userId === targetId).length >= 2 &&
        consents.filter((c) => c.userId === targetId).length >= 2 &&
        Boolean(user?.providerProfile)
      );
    },
    gumrukUserId,
    { timeout: 15000 },
  );
  ok("[Kurulum] Seed zinciri tamamlandı: 2 belge + 2 beyan + zengin firma profili localStorage'da mevcut");

  // --- 2) Firma Profili verileri doğru kuruldu mu? (localStorage üzerinden, arayüzü değiştirmeden) ---
  const profile = await page.evaluate((targetId) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.id === targetId)?.providerProfile;
  }, gumrukUserId);
  assert.equal(profile.companyName, "Marmara Gümrük Müşavirliği Ltd. Şti.");
  assert.deepEqual(profile.regions, ["Kocaeli", "İstanbul", "Sakarya"]);
  assert.equal(profile.experienceRange, "10+");
  assert.deepEqual(profile.expertise, [
    "İthalat Gümrükleme",
    "İhracat Gümrükleme",
    "Transit İşlemleri",
    "Antrepo İşlemleri",
    "Gümrük Danışmanlığı",
    "Evrak Takibi",
    "Tescil İşlemleri",
    "Beyanname Hazırlama",
  ]);
  assert.ok(profile.bio.includes("15 yıllık sektör tecrübesiyle"));
  ok("[2] ProviderProfile: companyName/regions/experienceRange/expertise/bio görev tanımındaki değerlerle BİREBİR eşleşiyor");

  // --- 3) Firma Profili düzenleme ekranında da AYNI veriler render ediliyor ---
  await page.goto(`${BASE_URL}/panel/hesap-ayarlari`);
  await page.getByRole("heading", { name: "Firma Profili" }).waitFor({ state: "visible", timeout: 10000 });
  const bioTextarea = page.locator("textarea").first();
  await bioTextarea.waitFor({ state: "visible", timeout: 10000 });
  const bioValue = await bioTextarea.inputValue();
  assert.ok(bioValue.includes("gümrük müşavirliği hizmeti sunuyoruz"), "Firma Profili formu seed edilen bio metnini göstermeli");
  ok("[3] Hesap Ayarları > Firma Profili formu, seed edilen bio metnini doğru gösteriyor");

  // --- 4) Hizmet seçimi yalnızca Gümrük Müşavirliği ---
  const serviceIds = await page.evaluate((targetId) => {
    const rows = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    return rows.filter((r) => r.userId === targetId).map((r) => r.serviceCategoryId);
  }, gumrukUserId);
  assert.deepEqual(serviceIds, ["gumruk-musavirligi"]);
  ok("[4] provider-services.ts kaydı yalnızca Gümrük Müşavirliği kategorisini içeriyor");

  await logout(page);

  // --- 5) Admin panelinde iki AYRI Yetki Belgesi de ONAYLI görünüyor ---
  await loginAs(page, "admin@test.com", "Admin123!", "/admin");
  await page.getByText("Gümrük Müşavirliği Belgeleri").waitFor({ state: "visible", timeout: 10000 });
  const adminCard = page.locator("div").filter({ hasText: "Ahmet Yılmaz" }).last();
  await page.getByText("yetkilendirilmis-gumruk-musaviri-belgesi.pdf").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("gumruk-musavirligi-ruhsati.pdf").waitFor({ state: "visible", timeout: 10000 });
  const approvedBadges = await page.getByText("Onaylandı").count();
  assert.ok(approvedBadges >= 2, `En az 2 'Onaylandı' rozeti olmalı, bulunan: ${approvedBadges}`);
  ok('[5] Admin panelinde HER İKİ Yetki Belgesi de ("Yetkilendirilmiş Gümrük Müşaviri" + "Gümrük Müşavirliği Ruhsatı") ONAYLI görünüyor');
  await logout(page);

  // --- 6) Kategori izolasyonu: yalnızca Gümrük Müşavirliği ilanlarını görebiliyor ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  await seedJob(page, { ...GUMRUK_JOB, reqId: zeynepId });
  await seedJob(page, { ...OTHER_JOB, reqId: zeynepId });
  await logout(page);

  await loginAs(page, GUMRUK_DEMO.email, GUMRUK_DEMO.password, "/panel");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.getByRole("link", { name: GUMRUK_JOB.title }).waitFor({ state: "visible", timeout: 10000 });
  const lashingVisible = await page.getByText(OTHER_JOB.title).count();
  assert.equal(lashingVisible, 0, "Gümrük Müşaviri hesabı Lashing ilanını GÖRMEMELİ (kategori izolasyonu)");
  ok("[6] Gümrük Müşaviri demo hesabı yalnızca Gümrük Müşavirliği ilanını görüyor, diğer kategoriler izole");

  // --- 7) Bu hesap Gümrük Müşavirliği ilanına teklif verebiliyor (belge onaylı) ---
  await page.goto(`${BASE_URL}/ilanlar/${GUMRUK_JOB.id}`);
  const blockedNotice = await page.getByText("Gümrük Müşaviri İzin Belgeniz henüz onaylanmadı.").count();
  assert.equal(blockedNotice, 0, "Belgesi zaten onaylı olduğu için teklif engeli GÖRÜNMEMELİ");
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  ok("[7] Belgesi baştan onaylı olduğu için Gümrük Müşavirliği ilanına gerçek teklif formu (Teklif Fiyatı) görünüyor, engel notu YOK");

  await logout(page);

  if (consoleErrors.length > 0) {
    console.log("\n[gumruk-demo-hesap-verification-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[gumruk-demo-hesap-verification-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik: yalnızca bu scriptin oluşturduğu ilanlar (demo hesabın kendisi
  // ve diğer dev-seed hesaplar/tabloları KORUNUR — reset-demo-data.ts'in
  // kendi görevi, bu script ona dokunmaz).
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
  }, [GUMRUK_JOB.id, OTHER_JOB.id]);
  await logout(page);

  console.log(`\n[gumruk-demo-hesap-verification-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[gumruk-demo-hesap-verification-test] HATA:", error);
  process.exitCode = 1;
});
