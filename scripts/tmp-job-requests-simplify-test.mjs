// "Hizmet Taleplerim" sayfası buton/sekme sadeleştirmesinin testi:
// - "Tümü" sekmesi kaldırıldı, yalnızca Aktif/Devam Eden/Tamamlanan var.
// - Aktif: İlan Detayına Git + İlanı Düzenle + İlanı Sil.
// - Devam Eden ve Tamamlanan: yalnızca İlan Detayına Git.
// - "Teklif Kabul Edildi" (iş henüz başlamamış) ilanlar Devam Eden sekmesinde
//   kendi rozetiyle listelenir (bkz. job-requests-panel.tsx#matchesTab).
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
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
async function submitOffer(page, jobId, { amount, duration, description }) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill(amount);
  await page.getByLabel("Tahmini Hizmet Süresi").fill(duration);
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}
async function acceptOfferFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Kabul Et" }).click();
  await page.waitForTimeout(400);
}
async function startWorkFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "İşe Başlandı", exact: true }).click();
  await page.getByRole("button", { name: "Evet, İşe Başlandı" }).click();
  await page.waitForTimeout(400);
}
async function requestCompletionFor(page, jobTitle) {
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const card = page.locator("div.rounded-card").filter({ hasText: jobTitle });
  await card.getByRole("button", { name: "Tamamlandı Olarak İşaretle", exact: true }).click();
  await page.getByRole("button", { name: "Evet, Tamamlandı Olarak İşaretle" }).click();
  await page.waitForTimeout(400);
}
async function seedJob(page, { id, title, reqId }) {
  await page.evaluate(
    ({ id, title, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Hizmet taleplerim sadelestirme testi icin olusturulan ilan.",
        operationDetails: "Test operasyon detayi.",
        status: "yayinda",
        requesterId: reqId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, reqId },
  );
}

const J_AKTIF = { id: "simplify-job-aktif", title: "Sadeleştirme Testi - Aktif" };
const J_KABUL = { id: "simplify-job-kabul", title: "Sadeleştirme Testi - Kabul Edildi" };
const J_DEVAM = { id: "simplify-job-devam", title: "Sadeleştirme Testi - Devam Eden" };
const J_TAMAM = { id: "simplify-job-tamam", title: "Sadeleştirme Testi - Tamamlanan" };

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Kurulum: 4 ilan + gerekli teklif akışları ---
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  const zeynepId = await getUserId(page, "zeynep@test.com");
  for (const job of [J_AKTIF, J_KABUL, J_DEVAM, J_TAMAM]) {
    await seedJob(page, { ...job, reqId: zeynepId });
  }
  ok("Kurulum: 4 test ilanı oluşturuldu (Aktif, Kabul Edildi, Devam Eden, Tamamlanan)");
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await submitOffer(page, J_KABUL.id, { amount: "5000", duration: "1 gün", description: "Kabul edildi test teklifi, yirmi karakterden uzun aciklama." });
  await submitOffer(page, J_DEVAM.id, { amount: "5100", duration: "1 gün", description: "Devam eden test teklifi, yirmi karakterden uzun aciklama." });
  await submitOffer(page, J_TAMAM.id, { amount: "5200", duration: "1 gün", description: "Tamamlanan test teklifi, yirmi karakterden uzun aciklama." });
  await logout(page);

  // startWorkFor/acceptOfferFor -> /panel/gelen-teklifler (Hizmet Alan
  // sayfası, Zeynep); requestCompletionFor -> /panel/tekliflerim (Hizmet
  // Veren sayfası, Mert) — ikisi karıştırılmamalı.
  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await acceptOfferFor(page, J_KABUL.title); // kabul edildi, iş başlamadı (accepted)
  await acceptOfferFor(page, J_DEVAM.title);
  await startWorkFor(page, J_DEVAM.title); // in_progress
  await acceptOfferFor(page, J_TAMAM.title);
  await startWorkFor(page, J_TAMAM.title);
  await logout(page);

  await loginAs(page, "mert@test.com", "Mert123!");
  await requestCompletionFor(page, J_TAMAM.title);
  await logout(page);

  await loginAs(page, "zeynep@test.com", "Zeynep1!");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const tamamCard = page.locator("div.rounded-card").filter({ hasText: J_TAMAM.title });
  await tamamCard.getByRole("button", { name: "Tamamlandığını Onayla" }).click();
  await page.getByRole("button", { name: "Evet, Onaylıyorum" }).click();
  await page.waitForTimeout(400);
  // Onay sonrası otomatik açılan değerlendirme modalını bu testte "Daha
  // Sonra" ile geçiyoruz — bu senaryonun odağı buton sadeleştirmesi.
  await page.getByRole("button", { name: "Daha Sonra" }).click();
  ok("Kurulum: J_TAMAM tamamlandı (completed)");

  // ============ "Tümü" sekmesi kaldırıldı ============
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  // page.goto() sonrası ilk render anı, oturumun client tarafında henüz
  // senkronize olmadığı kısa bir "oturum yok" görünümü gösterebilir (bkz.
  // getServerSnapshot -> her zaman null, CLAUDE.md). .count() (.click/.waitFor
  // aksine) otomatik yeniden denemez, o anki DOM'u anında sayar — bu yüzden
  // sayımdan önce sekme listesinin gerçekten render olduğunu bekliyoruz.
  await assert.doesNotReject(
    page.getByRole("tab", { name: "Aktif" }).waitFor({ state: "visible", timeout: 10000 }),
  );
  const tumuTab = await page.getByRole("tab", { name: "Tümü", exact: true }).count();
  assert.equal(tumuTab, 0, "'Tümü' sekmesi artık hiç görünmemeli");
  const tabCount = await page.getByRole("tab").count();
  assert.equal(tabCount, 3, "Tam olarak 3 sekme olmalı (Aktif, Devam Eden, Tamamlanan)");
  ok("['Tümü' kaldırıldı] Sekme sayısı tam olarak 3 (Aktif/Devam Eden/Tamamlanan)");

  // ============ Varsayılan (parametresiz) sayfa -> Aktif sekmesi seçili ============
  const aktifTabSelected = await page.getByRole("tab", { name: "Aktif" }).getAttribute("aria-selected");
  assert.equal(aktifTabSelected, "true", "Parametresiz ziyarette Aktif sekmesi seçili olmalı");
  await assert.doesNotReject(
    page.getByText(J_AKTIF.title).waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Varsayılan] Parametresiz sayfa açılışında Aktif sekmesi varsayılan olarak seçili ve doğru ilanı gösteriyor");

  // ============ AKTİF: 3 buton da görünsün ============
  const aktifCard = page.locator("li").filter({ hasText: J_AKTIF.title });
  await assert.doesNotReject(aktifCard.getByText("İlan detayına git").waitFor({ state: "visible", timeout: 5000 }));
  await assert.doesNotReject(aktifCard.getByText("İlanı Düzenle").waitFor({ state: "visible", timeout: 5000 }));
  await assert.doesNotReject(aktifCard.getByText("İlanı Sil").waitFor({ state: "visible", timeout: 5000 }));
  ok("[Aktif] İlan Detayına Git + İlanı Düzenle + İlanı Sil üçü de görünüyor");

  // ============ DEVAM EDEN: yalnızca Detay, Kabul Edildi de burada ============
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=devam-eden`);
  await assert.doesNotReject(page.getByText(J_KABUL.title).waitFor({ state: "visible", timeout: 10000 }));
  await assert.doesNotReject(page.getByText(J_DEVAM.title).waitFor({ state: "visible", timeout: 5000 }));
  ok("[Devam Eden] 'Kabul Edildi' durumundaki ilan da bu sekmede listeleniyor");

  const kabulBadge = await page
    .locator("li")
    .filter({ hasText: J_KABUL.title })
    .getByText("Teklif Kabul Edildi")
    .count();
  assert.equal(kabulBadge, 1, "Kabul edilen ilan kendi rozet metnini korumalı");
  ok("[Devam Eden] 'Teklif Kabul Edildi' rozeti korunuyor (yalnızca sekme değişti)");

  for (const title of [J_KABUL.title, J_DEVAM.title]) {
    const card = page.locator("li").filter({ hasText: title });
    await assert.doesNotReject(card.getByText("İlan detayına git").waitFor({ state: "visible", timeout: 5000 }));
    const editCount = await card.getByText("İlanı Düzenle").count();
    const deleteCount = await card.getByText("İlanı Sil").count();
    assert.equal(editCount, 0, `${title}: İlanı Düzenle görünmemeli`);
    assert.equal(deleteCount, 0, `${title}: İlanı Sil görünmemeli`);
  }
  ok("[Devam Eden] Hem 'Kabul Edildi' hem 'Devam Eden' kartlarında yalnızca İlan Detayına Git var, Düzenle/Sil yok");

  // ============ TAMAMLANAN: yalnızca Detay, puan kartı korunuyor ============
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim?durum=tamamlandi`);
  const tamamCardList = page.locator("li").filter({ hasText: J_TAMAM.title });
  await assert.doesNotReject(tamamCardList.getByText("İlan detayına git").waitFor({ state: "visible", timeout: 10000 }));
  const editCountTamam = await tamamCardList.getByText("İlanı Düzenle").count();
  const deleteCountTamam = await tamamCardList.getByText("İlanı Sil").count();
  assert.equal(editCountTamam, 0, "Tamamlanan ilanda İlanı Düzenle görünmemeli");
  assert.equal(deleteCountTamam, 0, "Tamamlanan ilanda İlanı Sil görünmemeli");
  ok("[Tamamlanan] Yalnızca İlan Detayına Git var, Düzenle/Sil yok");

  await assert.doesNotReject(
    tamamCardList.getByText("Bu hizmeti henüz değerlendirmediniz.").waitFor({ state: "visible", timeout: 5000 }),
  );
  await assert.doesNotReject(
    tamamCardList.getByRole("button", { name: "Hizmeti Değerlendir" }).waitFor({ state: "visible", timeout: 5000 }),
  );
  ok("[Tamamlanan] Değerlendirme kartı (puan verme arayüzü) aynen korunuyor");

  if (consoleErrors.length > 0) {
    console.log("\n[job-requests-simplify-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[job-requests-simplify-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik
  const jobIds = [J_AKTIF.id, J_KABUL.id, J_DEVAM.id, J_TAMAM.id];
  await page.evaluate((ids) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !ids.includes(j.id));
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !ids.includes(o.jobId));
    localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
    const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !ids.includes(r.jobId));
    localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
  }, jobIds);

  await browser.close();
  console.log(`\n[job-requests-simplify-test] ${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[job-requests-simplify-test] HATA:", error);
  process.exitCode = 1;
});
