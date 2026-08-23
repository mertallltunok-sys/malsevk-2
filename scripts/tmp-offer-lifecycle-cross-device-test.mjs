// node scripts/tmp-offer-lifecycle-cross-device-test.mjs
//
// "localStorage Bağımlılığını Kaldır" görevinin 2B adımı — teklif oluşturma
// DIŞINDAKİ tüm teklif/operasyon yaşam döngüsü akışlarının (kabul/ret/geri
// çekme/işe başlama/tamamlama talebi-onayı-itirazı/anlaşmazlık çözümü/
// anlaşma sağlanamadı/puanlama) gerçek, farklı-cihaz kanıtı. HER adım
// GENUINELY izole bir tarayıcı context'inde çalışır. YENİ ADMİN HESABI
// OLUŞTURULMADI — bu betik, bir önceki görevde (aynı oturumda,
// tmp-cross-device-offer-creation-test.mjs tarafından) zaten oluşturulmuş
// GERÇEK, MEVCUT bir admin hesabını (ADMIN_EMAIL) yeniden kullanır.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";
// Mevcut, önceki görevde oluşturulmuş GERÇEK admin hesabı — bu betik
// tarafından OLUŞTURULMADI, yalnızca yeniden kullanılıyor.
const ADMIN_EMAIL = "malsevk-crossdev-admin-1787520260451@gmail.com";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

// Sabit bekleme yerine GERÇEK sonucu yokla — bu betiğin bir önceki denemesinde
// (approveJobAsAdmin/submitOfferAsProvider) sabit uykuların gerçek RPC/render
// gecikmesini kaçırdığı zaten kanıtlanmıştı; AYNI dersi burada da uyguluyoruz.
// `expectedStatuses` — beklenen HEDEF durum(lar) kümesi; ulaşılana ya da süre
// dolana kadar yoklar.
async function pollOfferStatus(offerId, expectedStatuses, timeoutMs = 8000) {
  const expected = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = runSql(`select status from public.offers where id = '${offerId}';`)[0];
    if (last?.status && expected.has(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-lifecycle-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output).rows ?? [];
}

const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-lifecycle-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
  }
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `Lifecycle ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Lifecycle Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email, client };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    try {
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 10000 });
      return;
    } catch {
      if (attempt === 1) throw new Error(`loginAs(${email}) failed after retry`);
      await page.waitForTimeout(500);
    }
  }
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function makeTestJpeg() {
  return sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 60, g: 90, b: 160 } } }).jpeg().toBuffer();
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "test-fixture.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg() });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function createJobViaRealForm(page, titleSuffix) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
  await page.waitForTimeout(500);
  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);
  await page.getByLabel("İlan Başlığı").first().fill(`Yasam dongusu testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu yasam dongusu testi icin gercek form uzerinden olusturulan bir ilan aciklamasidir.");
  await selectSearchable(page, "İlçe", 0, "Gebze");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill(`Test Tesisi ${titleSuffix}`);
  await page.getByLabel("Açık Adres").first().fill("Test acik adres, Gebze / Kocaeli.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 });
  const match = page.url().match(/\/ilanlar\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

async function approveJobAsAdmin(browser, jobId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
  const onaylaButton = page.getByRole("button", { name: /^Onayla/ });
  let approved = false;
  try {
    await onaylaButton.waitFor({ state: "visible", timeout: 15000 });
    await onaylaButton.click();
    // Sabit bekleme yerine GERÇEK sonucu bekle — RPC dönüşü/yerel yama
    // tamamlanana kadar veritabanını yoklamak, sabit bir uykudan çok daha
    // güvenilir (bkz. bu betiğin bir önceki denemesinde job2'nin kaçırdığı
    // zamanlama sorunu).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
      if (row?.moderation_status === "approved") {
        approved = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    console.error(`approveJobAsAdmin(${jobId}) HATA: ${error.message}`);
  }
  await ctx.close();
  const row = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
  return { approved, moderation_status: row?.moderation_status };
}

async function submitOfferAsProvider(browser, providerEmail, jobId, description) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, providerEmail);
  await page.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
  await page.locator("textarea").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator("textarea").first().fill(description);
  await page.locator('select[aria-label="Para birimi"]').selectOption("TRY").catch(() => {});
  const amountInputs = page.locator('input[inputmode="decimal"]');
  if ((await amountInputs.count()) > 0) await amountInputs.first().fill("12000");
  await page.getByRole("button", { name: /Teklif (Gönder|Ver)/ }).first().click();
  await page.waitForTimeout(2000);
  await ctx.close();
}

// --- Hassas hedefleme yardımcıları (chip/kart hedefleme hatasının düzeltmesi) ---
// "Gelen Teklifler" ekranı işleri KATEGORİ etiketiyle (ör. "Forklift") gösteren
// chip'lere gruplar — ilan başlığı chip metninde GÖRÜNMEZ, yalnızca chip
// butonunun `title` HTML özniteliğinde bulunur (bkz. incoming-offers-panel.tsx).
// Üç test ilanımızın hepsi aynı kategoride ("forklift") olduğu için chip'ler
// görsel olarak birbirinden AYIRT EDİLEMEZ — bu yüzden `title` özniteliğiyle
// hedefliyoruz, pozisyonel (.first()/.nth()) SEÇİCİ KULLANMIYORUZ.
async function selectJobChipByTitle(page, titleSubstring) {
  const chip = page.locator(`button[title*="${titleSubstring}"]`).first();
  await chip.waitFor({ state: "visible", timeout: 15000 });
  await chip.click();
}

// Her teklif kartı kendi (anonimleştirilmemiş) açıklama metnini taşır —
// (bkz. incoming-offer-card.tsx satır 392 / my-offers-panel.tsx satır 448/453)
// bu yüzden sağlayıcı kimliği kabul öncesi anonim olsa bile teklifler
// birbirinden açıklama metniyle KESİN olarak ayırt edilebilir.
function offerCardByText(page, descriptionSubstring) {
  return page.locator("div.rounded-card").filter({ hasText: descriptionSubstring }).first();
}

// Kabul Et/Reddet TEK TIKLAMADIR, onay diyaloğu YOKTUR (bkz. incoming-offer-card.tsx
// handleDecision) — eski betiğin varsaydığı "Evet/Onayla" onay adımı gerçekte hiç
// yoktu.
async function clickSingleClickAction(card, buttonName) {
  const button = card.getByRole("button", { name: buttonName, exact: true });
  const visible = (await button.count()) > 0 && (await button.isVisible().catch(() => false));
  if (visible) await button.click();
  return visible;
}

// offer-outcome-panel.tsx'teki DialogShell (İşe Başlandı/Anlaşma Sağlanamadı/
// Tamamlandığını Onayla/İtiraz Et/Tamamlandı Olarak Kapat/İşi İptal Et) `position:
// fixed` olsa da DOM'da yine de o TEKİL teklif kartının alt ağacında render edilir
// (bkz. OfferOutcomePanel'in incoming-offer-card.tsx içindeki konumu) — bu yüzden
// diyaloğu da AYNI kart locator'ı içinden ([role="dialog"]) hedefliyoruz; panel
// genelinde arama yapmıyoruz. Tetikleyici buton adı ile onay buton adı bazen aynı
// metni İÇERİR (ör. "İtiraz Et" hem tetikleyici hem onay) — bu yüzden tetikleyiciyi
// `exact: true` ile kart kapsamında, onayı ise diyalog kapsamında ayrı ayrı buluyoruz.
async function clickCardDialogAction(card, triggerName, confirmName, { fillTextarea, checkRadio } = {}) {
  const trigger = card.getByRole("button", { name: triggerName, exact: true });
  const triggerVisible = (await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false));
  if (!triggerVisible) return false;
  await trigger.click();
  const dialog = card.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  if (checkRadio) await dialog.locator('input[type="radio"]').first().check();
  if (fillTextarea) await dialog.locator("textarea").first().fill(fillTextarea);
  const confirmButton = dialog.getByRole("button", { name: confirmName, exact: true });
  await confirmButton.waitFor({ state: "visible", timeout: 5000 });
  await confirmButton.click();
  return true;
}

// my-offers-panel.tsx'teki (Tekliflerim — Geri Çek/Tamamlama Talebi) diyaloglar
// AKSİNE panel SEVİYESİNDE (tek paylaşılan state, kartın kendi alt ağacı DIŞINDA)
// render edilir — bu yüzden tetikleyiciyi kart kapsamında, onayı SAYFA genelinde
// (yalnızca aynı anda tek diyalog açık olabildiği için güvenli) hedefliyoruz.
async function clickCardThenPageDialogAction(page, card, triggerName, confirmName) {
  const trigger = card.getByRole("button", { name: triggerName, exact: true });
  const triggerVisible = (await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false));
  if (!triggerVisible) return false;
  await trigger.click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const confirmButton = dialog.getByRole("button", { name: confirmName, exact: true });
  await confirmButton.waitFor({ state: "visible", timeout: 5000 });
  await confirmButton.click();
  return true;
}

// ÖNEMLİ MİMARİ GERÇEK (bkz. supabase-offer-sync.ts dosya başlığı — "KAPSAM"
// bölümü, bilinçli/belgelenmiş bir sınır, Aşama 9'da YENİ keşfedilen bir hata
// DEĞİL): create/accept/reject/withdraw/anlaşma-sağlanamadı/itiraz-iptal
// SUNUCUYA senkronlanır, ama "işe başlama"/"tamamlama talebi"/"tamamlama
// onayı"/"itiraz oluşturma" (ve itirazın "completed" çözümü) BİLEREK
// SENKRONLANMAZ — bu geçişlerin hiçbiri iş görünürlüğünü (ENGAGED_OFFER_STATUSES
// içinde kalmaya devam eder) ya da yeniden-teklif uygunluğunu değiştirmediği
// için. Bu YÜZDEN bu 4 geçiş için doğru doğrulama sinyali public.offers DEĞİL,
// AYNI izole context'in kendi localStorage'ıdır — action'ın GERÇEKTEN,
// hatasız çalıştığının kanıtı budur (temiz oturumda job lookup'ın artık
// başarılı olması sayesinde). public.offers'ın bu 4 geçişte GÜNCELLENMEMESİ
// beklenen davranıştır, başarısızlık değil — ama bu aynı zamanda GERÇEK bir
// çapraz-cihaz tutarsızlığı anlamına gelir (bkz. SONUÇ RAPORU'ndaki ayrı
// bulgu): başka bir cihazdaki TEMİZ bir oturum bu teklifi sunucudan
// (hydrateMissingOffersFromRemote) hidratladığında hâlâ "accepted" görür,
// "in_progress"/"completion_requested"/"completed" DEĞİL.
async function readLocalOfferStatus(page, offerId) {
  return page.evaluate(
    ({ key, id }) => {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const all = JSON.parse(raw);
        const found = Array.isArray(all) ? all.find((o) => o.id === id) : null;
        return found ? found.status : null;
      } catch {
        return null;
      }
    },
    { key: "malsevk.offers.v1", id: offerId },
  );
}

// job1/job2/job3 kabul-öncesi teklifleri için tekrarlanan "Gelen Teklifler'e
// git → doğru ilan chip'ini seç → doğru teklif kartını bul → Kabul Et" adımı.
// GERÇEK sonucu (sabit uyku yerine) public.offers'tan YOKLAYARAK doğrular —
// bu betiğin daha önce yakaladığı zamanlama dersiyle (approveJobAsAdmin)
// tutarlı; kabul senkronu ZATEN sunucuya gittiği için bu güvenilir bir sinyal.
async function acceptOfferCleanSession(browser, requesterEmail, jobTitleSubstring, offerDescriptionSubstring, offerId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, requesterEmail);
  await page.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
  await selectJobChipByTitle(page, jobTitleSubstring);
  const card = offerCardByText(page, offerDescriptionSubstring);
  await card.waitFor({ state: "visible", timeout: 10000 });
  const clicked = await clickSingleClickAction(card, "Kabul Et");
  const verified = clicked ? await pollOfferStatus(offerId, "accepted", 8000) : undefined;
  await ctx.close();
  return { clicked, verified: verified?.status === "accepted" };
}

async function run() {
  const browser = await chromium.launch();
  try {
    console.log("--- Test kullanicilari olusturuluyor (mevcut admin YENIDEN kullaniliyor, yeni admin YOK) ---");
    const requesterA = await createUser("reqA", "hizmet-alan");
    const providerB = await createUser("provB", "hizmet-veren"); // accept path
    const providerC = await createUser("provC", "hizmet-veren"); // reject path
    const providerD = await createUser("provD", "hizmet-veren"); // withdraw path
    const providerE = await createUser("provE", "hizmet-veren"); // agreement-failed path
    const providerF = await createUser("provF", "hizmet-veren"); // dispute path
    console.log(`requesterA=${requesterA.email}`);
    console.log(`providers: B(accept)=${providerB.email} C(reject)=${providerC.email} D(withdraw)=${providerD.email} E(agreement-fail)=${providerE.email} F(dispute)=${providerF.email}`);
    console.log(`admin (MEVCUT, yeniden kullanılıyor)=${ADMIN_EMAIL}`);

    for (const p of [providerB, providerC, providerD, providerE, providerF]) {
      runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${p.id}', 'forklift', now()) on conflict do nothing;`);
    }

    // ============ İLAN OLUŞTURMA (3 ayrı ilan, izole context'lerde) ============
    const ctxJob1 = await browser.newContext();
    const pageJob1 = await ctxJob1.newPage();
    await loginAs(pageJob1, requesterA.email);
    const job1 = await createJobViaRealForm(pageJob1, "J1-accept-reject-withdraw");
    await ctxJob1.close();

    const ctxJob2 = await browser.newContext();
    const pageJob2 = await ctxJob2.newPage();
    await loginAs(pageJob2, requesterA.email);
    const job2 = await createJobViaRealForm(pageJob2, "J2-agreement-failed");
    await ctxJob2.close();

    const ctxJob3 = await browser.newContext();
    const pageJob3 = await ctxJob3.newPage();
    await loginAs(pageJob3, requesterA.email);
    const job3 = await createJobViaRealForm(pageJob3, "J3-dispute");
    await ctxJob3.close();

    record("0) 3 ilan gerçek formla oluşturuldu", Boolean(job1 && job2 && job3), `${job1}, ${job2}, ${job3}`);

    // MEVCUT admin hesabıyla, İZOLE context'te üç ilanı da onayla.
    const approve1 = await approveJobAsAdmin(browser, job1);
    const approve2 = await approveJobAsAdmin(browser, job2);
    const approve3 = await approveJobAsAdmin(browser, job3);
    record(
      "0b) MEVCUT admin hesabı (yeni admin oluşturulmadan) üç ilanı da onayladı",
      approve1.moderation_status === "approved" && approve2.moderation_status === "approved" && approve3.moderation_status === "approved",
      JSON.stringify({ approve1, approve2, approve3 }),
    );

    // ============ TEKLİFLER (izole context'lerde) ============
    await submitOfferAsProvider(browser, providerB.email, job1, "Kabul edilecek teklif icin aciklama yaziyorum simdi burada yeterli uzunlukta.");
    await submitOfferAsProvider(browser, providerC.email, job1, "Reddedilecek teklif icin aciklama yaziyorum simdi burada yeterli uzunlukta.");
    await submitOfferAsProvider(browser, providerD.email, job2, "Geri cekilecek teklif icin aciklama yaziyorum simdi burada yeterli uzunlukta.");
    await submitOfferAsProvider(browser, providerE.email, job2, "Anlasma saglanamayacak teklif icin aciklama yaziyorum simdi burada.");
    await submitOfferAsProvider(browser, providerF.email, job3, "Itiraz sureci test edilecek teklif icin aciklama yaziyorum simdi burada.");

    function offerIdFor(jobId, providerId) {
      const row = runSql(`select id, status from public.offers where job_id = '${jobId}' and provider_id = '${providerId}' order by created_at desc limit 1;`)[0];
      return row;
    }
    const offerAccept = offerIdFor(job1, providerB.id);
    const offerReject = offerIdFor(job1, providerC.id);
    const offerWithdraw = offerIdFor(job2, providerD.id);
    const offerAgreementFail = offerIdFor(job2, providerE.id);
    const offerDispute = offerIdFor(job3, providerF.id);
    record(
      "0c) Tüm teklifler gerçek formla oluşturuldu ve public.offers'ta 'pending'",
      [offerAccept, offerReject, offerWithdraw, offerAgreementFail, offerDispute].every((o) => o?.status === "pending"),
      JSON.stringify({ offerAccept, offerReject, offerWithdraw, offerAgreementFail, offerDispute }),
    );

    // ============ SENARYO 2 — Farklı cihazda teklif reddi (ÖNCE çalıştırılır) ============
    // ÖNEMLİ SIRALAMA NOTU: offerReject ve offerAccept AYNI ilana (job1) ait
    // kardeş tekliflerdir. job-requests.ts#isOfferPendingActionBlocked ürün
    // kuralı gereği, job1'de HERHANGİ bir teklif kabul edildiği an diğer
    // "pending" kardeş teklifin Kabul Et/Reddet butonları kalıcı olarak
    // "Bu ilan için başka bir teklifin anlaşma süreci devam ediyor." notuyla
    // DEĞİŞTİRİLİR (bu doğru, kasıtlı ürün davranışıdır — bkz. CLAUDE.md "Single
    // active acceptance per job"). Bu yüzden RET, KABUL'DEN ÖNCE çalıştırılmalı;
    // aksi halde bu senaryo hiçbir zaman geçemez (hedefleme hatasından bağımsız,
    // gerçek bir iş kuralı sonucu — ürün hatası DEĞİL, betik sıralaması hatasıydı).
    const ctxReject = await browser.newContext();
    const pageReject = await ctxReject.newPage();
    await loginAs(pageReject, requesterA.email);
    await pageReject.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageReject, "J1-accept-reject-withdraw");
    const rejectCard = offerCardByText(pageReject, "Reddedilecek teklif");
    await rejectCard.waitFor({ state: "visible", timeout: 10000 });
    const reddetVisible = await clickSingleClickAction(rejectCard, "Reddet");
    if (reddetVisible) await pageReject.waitForTimeout(1200);
    await ctxReject.close();
    const rejectedRow = runSql(`select status from public.offers where id = '${offerReject.id}';`)[0];
    record("2) SENARYO 2 — Temiz/izole context'te teklif reddedildi, backend'e yansıdı", rejectedRow?.status === "rejected", `reddet_butonu_gorundu=${reddetVisible}, status=${rejectedRow?.status}`);

    // ============ SENARYO 1 — Farklı cihazda teklif kabulü ============
    // Hizmet Alan (job1'i oluşturan) TAMAMEN İZOLE, temiz bir context'te giriş yapıp kabul ediyor.
    const acceptResult1 = await acceptOfferCleanSession(browser, requesterA.email, "J1-accept-reject-withdraw", "Kabul edilecek teklif", offerAccept.id);
    record(
      "1) SENARYO 1 — Temiz/izole context'te teklif kabul edildi, backend'e yansıdı",
      acceptResult1.verified,
      `kabul_butonu_gorundu=${acceptResult1.clicked}, dogrulandi=${acceptResult1.verified}`,
    );

    // Regresyon: yetkisiz kullanıcı (providerC, kendi teklifi olmayan bir teklifi) reddedemesin — doğrudan RPC.
    const providerCClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await providerCClient.auth.signInWithPassword({ email: providerC.email, password: PASSWORD });
    // (providerC zaten hizmet-veren, updateOfferStatus zaten role kontrolüyle reddeder — ayrı RPC yok, client tarafı fonksiyon; bu yüzden burada RLS/rol testini offers tablosuna dogrudan UPDATE denemesiyle yapıyoruz.)
    const { error: unauthorizedUpdateError, count: unauthorizedUpdateCount } = await providerCClient
      .from("offers")
      .update({ status: "rejected" })
      .eq("id", offerAccept.id)
      .select("id", { count: "exact" });
    record(
      "2b) Yetkisiz kullanıcı (teklifin tarafı olmayan) başkasının teklifini RLS ile değiştiremiyor",
      !unauthorizedUpdateError ? (unauthorizedUpdateCount ?? 0) === 0 : true,
      unauthorizedUpdateError ? unauthorizedUpdateError.message : `etkilenen_satir=${unauthorizedUpdateCount}`,
    );

    // ============ SENARYO 3 — Farklı cihazda teklif geri çekme ============
    // GERÇEK buton metni "Tekliften Vazgeç"tir (eski betik yanlışlıkla "Geri
    // Çek" arıyordu — bu metin YALNIZCA onay diyaloğunun içindeki "Evet, Teklifi
    // Geri Çek" butonunda geçiyor, tetikleyicide değil; bkz. my-offers-panel.tsx).
    const ctxWithdraw = await browser.newContext();
    const pageWithdraw = await ctxWithdraw.newPage();
    await loginAs(pageWithdraw, providerD.email);
    await pageWithdraw.goto(`${APP_ORIGIN}/panel/tekliflerim`);
    const withdrawCard = offerCardByText(pageWithdraw, "Geri cekilecek teklif");
    await withdrawCard.waitFor({ state: "visible", timeout: 10000 });
    const geriCekVisible = await clickCardThenPageDialogAction(pageWithdraw, withdrawCard, "Tekliften Vazgeç", "Evet, Teklifi Geri Çek");
    const withdrawnRow = geriCekVisible ? await pollOfferStatus(offerWithdraw.id, "withdrawn") : undefined;
    await ctxWithdraw.close();
    record("3) SENARYO 3 — Temiz/izole context'te teklif geri çekildi, backend'e yansıdı", withdrawnRow?.status === "withdrawn", `geri_cek_butonu_gorundu=${geriCekVisible}, status=${withdrawnRow?.status}`);

    // ============ SENARYO 4/5/6 — Kabul sonrası: iş başlatma, tamamlama talebi, tamamlama onayı ============
    const ctxStartWork = await browser.newContext();
    const pageStartWork = await ctxStartWork.newPage();
    await loginAs(pageStartWork, requesterA.email);
    await pageStartWork.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageStartWork, "J1-accept-reject-withdraw");
    const startWorkCard = offerCardByText(pageStartWork, "Kabul edilecek teklif");
    await startWorkCard.waitFor({ state: "visible", timeout: 10000 });
    const startVisible = await clickCardDialogAction(startWorkCard, "İşe Başlandı", "Evet, İşi Başlat");
    // DÜZELTME (Aşama 9, bu betiğin ÜÇÜNCÜ çalıştırılışı): start_work artık
    // gerçekten sunucuya senkronlanıyor (bkz. supabase-offer-sync.ts#startWorkOnSupabase
    // ve offers.ts#startWorkForOffer'a eklenen senkron bloğu) — bu yüzden GERÇEK
    // doğrulama sinyali public.offers'tır; sabit uyku yerine YOKLANIR.
    const inProgressRow = startVisible ? await pollOfferStatus(offerAccept.id, "in_progress") : undefined;
    const localStatusAfterStart = await readLocalOfferStatus(pageStartWork, offerAccept.id);
    await ctxStartWork.close();
    record(
      "4) SENARYO 4 — Kabul edilmiş operasyon aktif ilan listesinden kalksa bile taraf işi başlatabildi, backend'e yansıdı",
      inProgressRow?.status === "in_progress",
      `buton_gorundu=${startVisible}, local_status=${localStatusAfterStart}, public.offers_status=${inProgressRow?.status}`,
    );

    const ctxReqCompletion = await browser.newContext();
    const pageReqCompletion = await ctxReqCompletion.newPage();
    await loginAs(pageReqCompletion, providerB.email);
    await pageReqCompletion.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
    const reqCompletionCard = offerCardByText(pageReqCompletion, "Kabul edilecek teklif");
    await reqCompletionCard.waitFor({ state: "visible", timeout: 10000 });
    const completionRequestVisible = await clickCardThenPageDialogAction(
      pageReqCompletion,
      reqCompletionCard,
      "Tamamlandı Olarak İşaretle",
      "Evet, Tamamlandı Olarak İşaretle",
    );
    const completionRequestedRow = completionRequestVisible ? await pollOfferStatus(offerAccept.id, "completion_requested") : undefined;
    await ctxReqCompletion.close();
    record("5) SENARYO 5 — Hizmet Veren temiz oturumda tamamlama talebi oluşturdu", completionRequestedRow?.status === "completion_requested", `buton_gorundu=${completionRequestVisible}, status=${completionRequestedRow?.status}`);

    const ctxConfirmCompletion = await browser.newContext();
    const pageConfirmCompletion = await ctxConfirmCompletion.newPage();
    await loginAs(pageConfirmCompletion, requesterA.email);
    await pageConfirmCompletion.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await selectJobChipByTitle(pageConfirmCompletion, "J1-accept-reject-withdraw");
    const confirmCompletionCard = offerCardByText(pageConfirmCompletion, "Kabul edilecek teklif");
    await confirmCompletionCard.waitFor({ state: "visible", timeout: 10000 });
    const confirmCompletionVisible = await clickCardDialogAction(confirmCompletionCard, "Tamamlandığını Onayla", "Evet, Onaylıyorum");
    // Puanlama modalı (job-rating-modal.tsx) PANEL seviyesinde (kartın alt
    // ağacı DIŞINDA, bkz. incoming-offers-panel.tsx) açılır — bu yüzden
    // sayfa genelinde aranır. confirmCompletion'ın kendi RPC'si dönene kadar
    // (onClose(true) tetiklenene kadar) modal render edilmez, bu yüzden burada
    // da sabit uyku yerine görünürlük beklenir.
    const ratingDialog = pageConfirmCompletion.locator('[role="dialog"]').filter({ hasText: "Hizmeti Değerlendir" });
    let ratingSubmitted = false;
    if (confirmCompletionVisible) {
      try {
        await ratingDialog.waitFor({ state: "visible", timeout: 8000 });
        await ratingDialog.getByRole("radio", { name: "5 yıldız" }).click();
        await ratingDialog.getByRole("button", { name: "Değerlendirmeyi Gönder" }).click();
        await ratingDialog.waitFor({ state: "hidden", timeout: 8000 });
        ratingSubmitted = true;
      } catch {
        ratingSubmitted = false;
      }
    }
    const completedRow = confirmCompletionVisible ? await pollOfferStatus(offerAccept.id, "completed") : undefined;
    await ctxConfirmCompletion.close();
    record("6) SENARYO 6 — Hizmet Alan farklı/temiz oturumda tamamlamayı onayladı, operasyon gerçekten tamamlandı", completedRow?.status === "completed", `buton_gorundu=${confirmCompletionVisible}, status=${completedRow?.status}`);
    const ratingRow = runSql(`select id, stars from public.ratings where offer_id = '${offerAccept.id}';`)[0];
    record(
      "6b) Puanlama akışı (varsa) gerçek veritabanına yazıldı",
      Boolean(ratingRow),
      ratingRow
        ? JSON.stringify(ratingRow)
        : `puanlama YALNIZCA yerelde kaydedildi, sunucuya senkronlanmıyor (bkz. ratings.ts — submit_rating RPC'si mevcut ama ÇAĞRILMIYOR; bu Aşama 9'un ele aldığı offer-lifecycle sync boşluğuyla AYNI sınıf, uygulanan düzeltme kapsamı dışında bırakıldı) (modal_gorundu=${ratingSubmitted})`,
    );

    // ============ SENARYO 8 — Anlaşma sağlanamadı (job2/offerAgreementFail) ============
    const acceptResultAgreementFail = await acceptOfferCleanSession(
      browser,
      requesterA.email,
      "J2-agreement-failed",
      "Anlasma saglanamayacak teklif",
      offerAgreementFail.id,
    );

    let agreementFailVisible = false;
    let agreementFailedRow;
    if (acceptResultAgreementFail.verified) {
      const ctxAgreementFail = await browser.newContext();
      const pageAgreementFail = await ctxAgreementFail.newPage();
      await loginAs(pageAgreementFail, requesterA.email);
      await pageAgreementFail.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
      await selectJobChipByTitle(pageAgreementFail, "J2-agreement-failed");
      const agreementFailCard = offerCardByText(pageAgreementFail, "Anlasma saglanamayacak teklif");
      await agreementFailCard.waitFor({ state: "visible", timeout: 10000 });
      agreementFailVisible = await clickCardDialogAction(
        agreementFailCard,
        "Anlaşma Sağlanamadı",
        "Anlaşma Sağlanamadı Olarak İşaretle",
        { checkRadio: true },
      );
      agreementFailedRow = agreementFailVisible ? await pollOfferStatus(offerAgreementFail.id, "agreement_failed") : undefined;
      await ctxAgreementFail.close();
    }
    record(
      "7) SENARYO 8 — Anlaşma sağlanamadı kaydı temiz/izole oturumda oluşturulabildi",
      agreementFailedRow?.status === "agreement_failed",
      `on_kosul_kabul_dogrulandi=${acceptResultAgreementFail.verified}, buton_gorundu=${agreementFailVisible}, status=${agreementFailedRow?.status}`,
    );

    // ============ SENARYO 7 — İtiraz / uyuşmazlık (job3/offerDispute) ============
    const acceptResultDispute = await acceptOfferCleanSession(
      browser,
      requesterA.email,
      "J3-dispute",
      "Itiraz sureci test edilecek teklif",
      offerDispute.id,
    );

    let disputeVisible = false;
    let disputedRow;
    if (acceptResultDispute.verified) {
      const ctxStartWork2 = await browser.newContext();
      const pageStartWork2 = await ctxStartWork2.newPage();
      await loginAs(pageStartWork2, requesterA.email);
      await pageStartWork2.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
      await selectJobChipByTitle(pageStartWork2, "J3-dispute");
      const startWork2Card = offerCardByText(pageStartWork2, "Itiraz sureci test edilecek teklif");
      await startWork2Card.waitFor({ state: "visible", timeout: 10000 });
      const startWork2Visible = await clickCardDialogAction(startWork2Card, "İşe Başlandı", "Evet, İşi Başlat");
      if (startWork2Visible) await pollOfferStatus(offerDispute.id, "in_progress");
      await ctxStartWork2.close();

      const ctxReqCompletion2 = await browser.newContext();
      const pageReqCompletion2 = await ctxReqCompletion2.newPage();
      await loginAs(pageReqCompletion2, providerF.email);
      await pageReqCompletion2.goto(`${APP_ORIGIN}/panel/tekliflerim?durum=devam-eden`);
      const reqCompletion2Card = offerCardByText(pageReqCompletion2, "Itiraz sureci test edilecek teklif");
      await reqCompletion2Card.waitFor({ state: "visible", timeout: 10000 });
      const reqCompletion2Visible = await clickCardThenPageDialogAction(
        pageReqCompletion2,
        reqCompletion2Card,
        "Tamamlandı Olarak İşaretle",
        "Evet, Tamamlandı Olarak İşaretle",
      );
      if (reqCompletion2Visible) await pollOfferStatus(offerDispute.id, "completion_requested");
      await ctxReqCompletion2.close();

      const ctxDispute = await browser.newContext();
      const pageDispute = await ctxDispute.newPage();
      await loginAs(pageDispute, requesterA.email);
      await pageDispute.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
      await selectJobChipByTitle(pageDispute, "J3-dispute");
      const disputeCard = offerCardByText(pageDispute, "Itiraz sureci test edilecek teklif");
      await disputeCard.waitFor({ state: "visible", timeout: 10000 });
      disputeVisible = await clickCardDialogAction(disputeCard, "İtiraz Et", "İtiraz Et", {
        fillTextarea: "Bu itiraz icin gercek bir aciklama yaziyorum simdi burada yeterli uzunlukta.",
      });
      disputedRow = disputeVisible ? await pollOfferStatus(offerDispute.id, "completion_disputed") : undefined;
      await ctxDispute.close();
    }
    record(
      "8) SENARYO 7 — İtiraz temiz/izole oturumda oluşturulabildi",
      disputedRow?.status === "completion_disputed",
      `on_kosul_kabul_dogrulandi=${acceptResultDispute.verified}, buton_gorundu=${disputeVisible}, status=${disputedRow?.status}`,
    );

    if (disputedRow?.status === "completion_disputed") {
      const ctxResolve = await browser.newContext();
      const pageResolve = await ctxResolve.newPage();
      await loginAs(pageResolve, requesterA.email);
      await pageResolve.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
      await selectJobChipByTitle(pageResolve, "J3-dispute");
      const resolveCard = offerCardByText(pageResolve, "Itiraz sureci test edilecek teklif");
      await resolveCard.waitFor({ state: "visible", timeout: 10000 });
      const resolveVisible = await clickCardDialogAction(resolveCard, "Tamamlandı Olarak Kapat", "Evet, Tamamlandı Olarak Kapat");
      const resolvedRow = resolveVisible ? await pollOfferStatus(offerDispute.id, ["completed", "cancelled"]) : undefined;
      await ctxResolve.close();
      record("8b) İtiraz çözümü temiz/izole oturumda tamamlandı", resolvedRow?.status === "completed" || resolvedRow?.status === "cancelled", `buton_gorundu=${resolveVisible}, status=${resolvedRow?.status}`);
    } else {
      record("8b) İtiraz çözümü temiz/izole oturumda tamamlandı", false, "itiraz oluşmadığı için çözüm denenemedi");
    }

    // ============ SENARYO 9 — Güvenlik regresyonu (doğrudan RPC) ============
    const providerBClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await providerBClient.auth.signInWithPassword({ email: providerB.email, password: PASSWORD });

    const unauthorizedCategoryJob = randomUUID();
    const wd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${unauthorizedCategoryJob}', '${requesterA.id}', 'kimyasal-depolama', 'Regresyon yetkisiz kategori', 'Bu regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wd}', 'approved');`,
    );
    const { error: regressUnauthCatError } = await providerBClient.rpc("create_offer", { p_job_id: unauthorizedCategoryJob, p_amount: 1000, p_currency: "TRY", p_description: "Regresyon testi icin gercek bir teklif aciklamasidir yeterli uzunlukta." });
    record("9a) SENARYO 9 — Yetkisiz kategoriye teklif hâlâ reddediliyor", !!regressUnauthCatError, regressUnauthCatError?.message);

    const unapprovedJob = randomUUID();
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${unapprovedJob}', '${requesterA.id}', 'forklift', 'Regresyon onaysiz ilan', 'Bu regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wd}', 'pending_review');`,
    );
    const { error: regressUnapprovedError } = await providerBClient.rpc("create_offer", { p_job_id: unapprovedJob, p_amount: 1000, p_currency: "TRY", p_description: "Regresyon testi icin gercek bir teklif aciklamasidir yeterli uzunlukta." });
    record("9b) SENARYO 9 — Onaysız ilana teklif hâlâ reddediliyor", !!regressUnapprovedError, regressUnapprovedError?.message);

    // Askıya alınmış hesap.
    const providerSuspended = await createUser("provSusp", "hizmet-veren");
    runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${providerSuspended.id}', 'forklift', now()) on conflict do nothing;`);
    runSql(`update public.profiles set account_status = 'suspended' where id = '${providerSuspended.id}';`);
    const suspendedClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await suspendedClient.auth.signInWithPassword({ email: providerSuspended.email, password: PASSWORD });
    const { error: suspendedError } = await suspendedClient.rpc("create_offer", { p_job_id: job1, p_amount: 1000, p_currency: "TRY", p_description: "Askiya alinmis hesaptan teklif deneme aciklamasi yeterli uzunlukta." });
    record("9c) SENARYO 9 — Askıya alınmış hesap teklif oluşturamıyor", !!suspendedError, suspendedError?.message);
    runSql(`update public.profiles set account_status = 'active' where id = '${providerSuspended.id}';`);

    // Başkasının ilanını/teklifini yönetememe — providerC (offerReject'in sahibi DEĞİL requesterA) reject deneyemez zaten role kontrolüyle engellenir (hizmet-veren rolü); bunun yerine BAŞKA bir hizmet-alan'ın teklifi kabul edemediğini test edelim.
    const otherRequester = await createUser("otherReq", "hizmet-alan");
    const otherRequesterClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await otherRequesterClient.auth.signInWithPassword({ email: otherRequester.email, password: PASSWORD });
    const { error: crossTenantError, count: crossTenantCount } = await otherRequesterClient
      .from("offers")
      .update({ status: "accepted" })
      .eq("id", offerAgreementFail.id)
      .select("id", { count: "exact" });
    record(
      "9d) SENARYO 9 — Başka bir Hizmet Alan, kendisine ait olmayan ilanın teklifini yönetemiyor",
      !crossTenantError ? (crossTenantCount ?? 0) === 0 : true,
      crossTenantError ? crossTenantError.message : `etkilenen_satir=${crossTenantCount}`,
    );

    // ============ SENARYO 10 — İş Makinesi/Operatör ortak görünürlük yeniden doğrulama ============
    const groupProvider = await createUser("groupProv", "hizmet-veren");
    runSql(`insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${groupProvider.id}', 'forklift', now()) on conflict do nothing;`);
    const groupJob = randomUUID();
    runSql(
      `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
       values ('${groupJob}', '${requesterA.id}', 'vinc-operatoru', 'Regresyon ortak gorunurluk', 'Bu regresyon testi icin olusturulan bir ilan aciklamasidir yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${wd}', 'approved');`,
    );
    const [{ can_view: groupCanView }] = runSql(`select public.provider_can_view_job_for_listing('${groupProvider.id}', 'vinc-operatoru', null, null, null, null, null, null) as can_view;`);
    const groupProviderClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await groupProviderClient.auth.signInWithPassword({ email: groupProvider.email, password: PASSWORD });
    const { error: groupOfferError } = await groupProviderClient.rpc("create_offer", { p_job_id: groupJob, p_amount: 1000, p_currency: "TRY", p_description: "Ortak gorunurluk regresyon testi icin gercek bir teklif aciklamasi." });
    record(
      "10) SENARYO 10 — Görünürlük hâlâ ortak (görüyor), teklif yetkisi hâlâ ayrı (veremiyor) — migration 0076/0077 bozulmadı",
      groupCanView === true && !!groupOfferError,
      `can_view=${groupCanView}, offer_error=${groupOfferError?.message}`,
    );

    console.log("");
    console.log(`=== SONUÇ: ${results.filter((r) => r.pass).length}/${results.length} PASS ===`);
    if (results.some((r) => !r.pass)) {
      console.log("Başarısız: " + results.filter((r) => !r.pass).map((r) => r.name).join(", "));
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("HATA:", error);
  process.exit(1);
});
