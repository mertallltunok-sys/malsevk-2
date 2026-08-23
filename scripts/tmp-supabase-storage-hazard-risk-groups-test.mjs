// "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" + "Nakliye ADR
// Sıra Düzeltmesi" görevlerinin GERÇEK KULLANICI testi. Development Supabase
// projesine (NEXT_PUBLIC_SUPABASE_URL) VE gerçek dev sunucusuna (localhost:3000)
// karşı çalışır — migration 0068'in TÜM istemci tarafı (form/onaylama/eşleştirme
// arayüzü) katmanını, önceden SQL seviyesinde ayrı ayrı doğrulanmış RPC/backend
// katmanının ÜZERİNE, gerçek tarayıcı etkileşimiyle kapsar.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\12aad247-0f29-4d51-b91b-ce0b220f1157\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
function envVar(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : process.env[name];
}

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Gerekli env değişkenleri .env.local'da bulunamadı.");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 400) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
let kimyasalJobId = null;
let tehlikeliJobId = null;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const WORK_DATE = todayPlus(20);

async function createUser(label, role) {
  const email = `hazardrg-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role,
    p_full_name: `HazardRiskGroupTest ${label}`,
    p_phone: "+905321119911",
    p_company_name: `HazardRiskGroupTest Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email, client };
}

async function loginAs(page, email, password) {
  await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
    if (!page.url().includes("/giris-yap")) break;
  }
  await page.waitForTimeout(1000);
}

/** offers.ts/job-store.ts TEK PAYLAŞILAN localStorage anahtarı kullanır (kullanıcı bazlı DEĞİL) — bu yüzden "Hizmet Veren teklif verir, Hizmet Alan görür" akışını GERÇEKTEN test etmek için AYNI browser context/localStorage İÇİNDE gerçek çıkış+giriş yapılır (iki AYRI context/profil kullanılırsa iki AYRI localStorage'a düşer, offer hiç görünmez — bu app'in bilinen mimarisi, bkz. CLAUDE.md "No real backend"). */
async function logout(page) {
  // NotificationBell de aria-haspopup="menu" taşıyor (header-auth-actions.tsx'te
  // ProfileMenu'den ÖNCE render edilir) — düz `[aria-haspopup="menu"]` seçici
  // YANLIŞ dropdown'ı (bildirim zili) açıyordu (gerçek çalıştırmada bulunan
  // bir test hatası). ProfileMenu'nün kendi tetikleyicisi, RoleLabel'ın
  // içerdiği "Hizmet Veren"/"Hizmet Alan" metniyle BENZERSİZ hedeflenir.
  await page.getByRole("button", { name: /Hizmet Veren|Hizmet Alan|Admin/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).or(page.getByRole("menu").getByText("Çıkış Yap")).first().click({ timeout: 10000 });
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function newActorPage(browser, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : undefined);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return { context, page };
}

/** Depo Hizmetleri grubundaki HER kategori (Kimyasal/Tehlikeli Madde Depolama dahil) için ZORUNLU "Depolanacak Ürün Bilgileri" bloğu — test yazarken gözden kaçırılan, gerçek çalıştırmada bulunan zorunlu alanlar. */
async function fillStorageProductFields(page) {
  await page.locator('[id$="-storageProductType"]').first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByText("Listede Yok, Kendim Gireceğim", { exact: false }).first().click();
  await page.waitForTimeout(200);
  await page.locator('[id$="-storageProductTypeCustomText"]').first().fill("Test Kimyasal Ürün");
  await page.locator('[id$="-storageProductQuantity"]').first().fill("120");
  await page.locator('[id$="-storageProductUnit"]').first().click({ timeout: 10000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: "kg", exact: true }).first().click();
  await page.waitForTimeout(200);
}

async function fillPhotos(page) {
  const tmp = os.tmpdir();
  const photoFiles = [1, 2, 3, 4].map((i) => path.join(tmp, `fixture-valid-${i}.jpg`));
  for (const f of photoFiles) readFileSync(f);
  await page.locator('input[type="file"]').setInputFiles(photoFiles);
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      const m = t.match(/(\d+)\s*\/\s*\d+\s*fotoğraf yüklendi/);
      return m && Number(m[1]) === 4;
    },
    { timeout: 60000 },
  );
}

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const provider = await createUser("prov", "hizmet-veren");
  const adminUser = await createUser("adm", "hizmet-alan");
  const promoteRows = runSql(
    `update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}' returning id, role;`,
  );
  record("Kurulum: 3 test hesabı oluşturuldu, biri admin'e yükseltildi", promoteRows[0]?.role === "admin", JSON.stringify(promoteRows));

  const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  const browser = await chromium.launch();
  try {
    await runFlow(browser, { requester, provider, adminUser, adminClient });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runFlow(browser, { requester, provider, adminUser, adminClient }) {
  // =========================================================================
  // A) NAKLIYE ADR SIRALAMASI — REGRESYON: 1→9 sırasında, 3/7/8/9 EN BAŞTA
  //    DEĞİL, alt sınıflar kendi grubunun İÇİNDE.
  // =========================================================================
  {
    const { context, page } = await newActorPage(browser);
    await loginAs(page, requester.email, PASSWORD);
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
    await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Nakliye" });
    await page.waitForTimeout(400);
    await page.locator('[id*="product-type"], [id*="urun-cinsi"]').first().click().catch(() => {});
    // Ürün/Yük Cinsi combobox — ADR alanını açmak için "Tehlikeli" bir ürün
    // cinsi seçmek yerine doğrudan HazmatFields'ı DOM'da arıyoruz: ADR
    // Sınıfı select'i her yük grubunda vardır, hazmat "Evet" seçilince açılır.
    await page.getByText("Tehlikeli Madde", { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const hazmatToggle = page.locator('button:has-text("Evet")').first();
    await hazmatToggle.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);

    const adrSelect = page.locator('[id$="-adr-class"], [id*="adrClass"], select').filter({ has: page.locator('option:has-text("Sınıf")') }).first();
    const optionTexts = await adrSelect.locator("option, optgroup").evaluateAll((nodes) =>
      nodes.map((n) => ({ tag: n.tagName.toLowerCase(), label: n.tagName.toLowerCase() === "optgroup" ? n.getAttribute("label") : n.textContent, value: n.getAttribute("value") })),
    ).catch(() => []);
    record("A1. ADR Sınıfı dropdown'ı bulunabildi (en az 10 seçenek/grup)", optionTexts.length >= 10, JSON.stringify(optionTexts).slice(0, 200));

    // İlk gerçek (boş olmayan) seçeneğin/grubun Sınıf 1 ile başladığını, 3/7/8/9'un EN BAŞTA olmadığını doğrula.
    const firstReal = optionTexts.find((o) => o.value !== "" && o.value !== null);
    const startsWithClass1 = firstReal && /^(Sınıf\s*1|1\.\d)/i.test(String(firstReal.label ?? ""));
    record("A2. ADR listesindeki İLK gerçek öğe Sınıf 1 ile başlıyor (3/7/8/9 en başta DEĞİL)", Boolean(startsWithClass1), JSON.stringify(firstReal));

    const labels = optionTexts.map((o) => String(o.label ?? "")).filter(Boolean);
    const idxClass3 = labels.findIndex((l) => /^(Sınıf\s*3\b|^3\s*[-–])/i.test(l) || l.trim() === "3");
    const idxClass1Group = labels.findIndex((l) => /^Sınıf\s*1\b/i.test(l));
    record(
      "A3. Sınıf 1 (grup başlığı) listede Sınıf 3'ten (varsa) ÖNCE geliyor — sıra 1→9 korunuyor",
      idxClass1Group !== -1 && (idxClass3 === -1 || idxClass1Group < idxClass3),
      JSON.stringify({ idxClass1Group, idxClass3, labels }),
    );
    await context.close();
  }

  // =========================================================================
  // B) HİZMET ALAN — Kimyasal Depolama: Hayır/Evet sorusu, varsayılan Hayır,
  //    Evet iken risk grubu ZORUNLU (en az 1), çoklu seçim.
  // =========================================================================
  const { context: reqContext, page } = await newActorPage(browser);
  await loginAs(page, requester.email, PASSWORD);
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("select", { timeout: 60000 }).catch(() => {});
  await page.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Kimyasal Depolama" });
  await page.waitForTimeout(400);

  const bodyTextAfterKimyasal = await page.locator("body").innerText();
  record(
    "B1. Kimyasal Depolama seçilince 'Depolanacak ürün tehlikeli madde kapsamında mı?' sorusu görünüyor",
    bodyTextAfterKimyasal.includes("tehlikeli madde kapsamında mı"),
  );
  record("B2. 'Emin Değilim' seçeneği YOK (yalnızca Hayır/Evet)", !bodyTextAfterKimyasal.includes("Emin Değilim"));
  record(
    "B3. Risk grubu alanı VARSAYILAN olarak (Hayır seçiliyken) görünmüyor",
    !bodyTextAfterKimyasal.includes("Depolama Tehlike / Risk Grubu"),
  );

  await page.getByLabel("İlan Başlığı").nth(0).fill("HazardRiskGroupTest — Kimyasal Depolama Çoklu Risk");
  await page.locator("textarea").first().fill("Kimyasal depolama risk grubu testi, en az yirmi karakter.");
  await page.locator('input[type="date"]').nth(0).fill(WORK_DATE);
  await page.locator('input[type="date"]').nth(1).fill(todayPlus(25));
  await page.locator('[id^="service-province-"]').first().click();
  await page.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('[id^="service-district-"]').first().click();
  await page.getByRole("option", { name: "Gebze", exact: true }).click();
  await page.waitForTimeout(300);

  // "Evet"e geçince risk grubu alanı açılmalı. CompactConditionToggle role="radio" kullanır, "button" DEĞİL.
  await page.getByRole("radio", { name: "Evet", exact: true }).first().click();
  await page.waitForTimeout(300);
  const bodyAfterEvet = await page.locator("body").innerText();
  record("B4. Hayır->Evet geçince 'Depolama Tehlike / Risk Grubu' alanı AÇILIYOR", bodyAfterEvet.includes("Depolama Tehlike / Risk Grubu"));

  // Çoklu seçim: iki farklı risk grubu.
  const riskGroupTrigger = page.locator('[id$="-risk-groups"], button:has-text("Risk grubu seçiniz")').first();
  await riskGroupTrigger.click({ timeout: 5000 });
  await page.waitForTimeout(200);
  await page.getByText("Yanıcı / Parlayıcı Sıvılar", { exact: false }).first().click();
  await page.waitForTimeout(150);
  await page.getByText("Aşındırıcı Asitler", { exact: false }).first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape").catch(() => {});
  const bodyAfterRiskPick = await page.locator("body").innerText();
  record(
    "B5. İki risk grubu ('Yanıcı / Parlayıcı Sıvılar', 'Aşındırıcı Asitler') seçili görünüyor",
    bodyAfterRiskPick.includes("Yanıcı") && bodyAfterRiskPick.includes("Aşındırıcı"),
  );

  await fillStorageProductFields(page);
  await fillPhotos(page);
  // İki aşamalı akış: form gönderimi YALNIZCA doğrular ve "Operasyon Özeti"
  // önizlemesine geçer (handleSubmit) — GERÇEK createJob çağrısı önizlemenin
  // KENDİ (AYNI metinli) Yayınla butonundan (handlePublish) yapılır.
  const submitBtn = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await submitBtn.click();
  await page.waitForFunction(() => document.body.innerText.includes("Operasyon Özeti"), { timeout: 15000 }).catch(() => {});
  if (!(await page.locator("body").innerText()).includes("Operasyon Özeti")) {
    console.error("DEBUG B6 — önizlemeye geçemedi, form hataları:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  const publishBtn = page.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishBtn.click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  kimyasalJobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1] ?? null;
  if (!kimyasalJobId) {
    console.error("DEBUG B6 — yayınlanamadı:", JSON.stringify(await page.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  record("B6. Kimyasal Depolama ilanı GERÇEKTEN yayınlandı (detay sayfasına yönlendirildi)", Boolean(kimyasalJobId), page.url());

  await new Promise((r) => setTimeout(r, 1500));
  const kimyasalDbJob = kimyasalJobId
    ? (
        await requester.client
          .from("jobs")
          .select("id, storage_hazardous, storage_risk_groups, moderation_status")
          .eq("id", kimyasalJobId)
          .limit(1)
      ).data?.[0]
    : null;
  record(
    "B7. Supabase'de storage_hazardous=true, iki risk grubu kaydedildi",
    kimyasalDbJob?.storage_hazardous === true &&
      Array.isArray(kimyasalDbJob?.storage_risk_groups) &&
      kimyasalDbJob.storage_risk_groups.includes("yanici-parlayici-sivilar") &&
      kimyasalDbJob.storage_risk_groups.includes("asindirici-asitler"),
    JSON.stringify(kimyasalDbJob),
  );

  const detailText = await page.locator("body").innerText().catch(() => "");
  record("B8. İlan detayında 'Tehlikeli Madde: Evet' ve risk grupları görünüyor", detailText.includes("Evet") && detailText.includes("Aşındırıcı"));

  await reqContext.close();

  // =========================================================================
  // C) HİZMET ALAN — Tehlikeli Madde Depolama: soru HİÇ gösterilmiyor, risk
  //    grubu alanı DOĞRUDAN zorunlu/açık; boş bırakılırsa gönderim engellenir.
  // =========================================================================
  const { context: reqContext2, page: page2 } = await newActorPage(browser);
  await loginAs(page2, requester.email, PASSWORD);
  await page2.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.waitForSelector("select", { timeout: 60000 }).catch(() => {});
  await page2.getByLabel("Hizmet Kategorisi").nth(0).selectOption({ label: "Tehlikeli Madde Depolama" });
  await page2.waitForTimeout(400);
  const bodyAfterTehlikeli = await page2.locator("body").innerText();
  record("C1. Tehlikeli Madde Depolama'da Hayır/Evet sorusu HİÇ gösterilmiyor", !bodyAfterTehlikeli.includes("tehlikeli madde kapsamında mı"));
  record("C2. Risk grubu alanı DOĞRUDAN (soru olmadan) açık", bodyAfterTehlikeli.includes("Depolama Tehlike / Risk Grubu"));

  await page2.getByLabel("İlan Başlığı").nth(0).fill("HazardRiskGroupTest — Tehlikeli Madde Deposu");
  await page2.locator("textarea").first().fill("Tehlikeli madde depolama risk grubu testi, yirmi karakter.");
  await page2.locator('input[type="date"]').nth(0).fill(WORK_DATE);
  await page2.locator('input[type="date"]').nth(1).fill(todayPlus(25));
  await page2.locator('[id^="service-province-"]').first().click();
  await page2.getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page2.waitForTimeout(400);
  await page2.locator('[id^="service-district-"]').first().click();
  await page2.getByRole("option", { name: "Gebze", exact: true }).click();
  await page2.waitForTimeout(300);
  await fillStorageProductFields(page2);
  await fillPhotos(page2);

  const submitBtn2 = page2.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await submitBtn2.click();
  await page2.waitForTimeout(1000);
  const afterEmptySubmitText = await page2.locator("body").innerText();
  const stillOnForm = !/\/ilanlar\/[0-9a-f-]{36}/.test(page2.url());
  record(
    "C3. Risk grubu SEÇİLMEDEN gönderim ENGELLENDİ (formda kaldı, hata gösterdi)",
    stillOnForm && /en az bir/i.test(afterEmptySubmitText),
    stillOnForm ? "formda kaldı" : "yanlışlıkla yayınlandı: " + page2.url(),
  );

  const riskGroupTrigger2 = page2.locator('[id$="-risk-groups"], button:has-text("Risk grubu seçiniz")').first();
  await riskGroupTrigger2.click({ timeout: 5000 });
  await page2.waitForTimeout(200);
  await page2.getByText("Zehirli / Akut Toksik Maddeler", { exact: false }).first().click();
  await page2.waitForTimeout(150);
  await page2.keyboard.press("Escape").catch(() => {});

  await submitBtn2.click();
  await page2.waitForFunction(() => document.body.innerText.includes("Operasyon Özeti"), { timeout: 15000 }).catch(() => {});
  if (!(await page2.locator("body").innerText()).includes("Operasyon Özeti")) {
    console.error("DEBUG C4 — önizlemeye geçemedi, form hataları:", JSON.stringify(await page2.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  const publishBtn2 = page2.getByRole("button", { name: /İlanı Onaya Gönder|İlanı Yayınla/ }).first();
  await publishBtn2.click();
  await page2.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 }).catch(() => {});
  await page2.waitForTimeout(1500);
  tehlikeliJobId = /\/ilanlar\/([0-9a-f-]{36})/.exec(new URL(page2.url()).pathname)?.[1] ?? null;
  if (!tehlikeliJobId) {
    console.error("DEBUG C4 — yayınlanamadı:", JSON.stringify(await page2.locator(".text-danger").allInnerTexts().catch(() => [])));
  }
  record("C4. Risk grubu seçildikten SONRA Tehlikeli Madde Depolama ilanı yayınlandı", Boolean(tehlikeliJobId), page2.url());

  await new Promise((r) => setTimeout(r, 1500));
  const tehlikeliDbJob = tehlikeliJobId
    ? (
        await requester.client
          .from("jobs")
          .select("id, storage_hazardous, storage_risk_groups")
          .eq("id", tehlikeliJobId)
          .limit(1)
      ).data?.[0]
    : null;
  record(
    "C5. Supabase'de storage_hazardous=true (kategori zorunlu) ve risk grubu kaydedildi",
    tehlikeliDbJob?.storage_hazardous === true && (tehlikeliDbJob?.storage_risk_groups ?? []).includes("zehirli-akut-toksik"),
    JSON.stringify(tehlikeliDbJob),
  );

  // reqContext2/page2 KASITLI OLARAK AÇIK bırakılır — job-store.ts (localStorage,
  // kullanıcı bazlı DEĞİL, TEK paylaşılan anahtar) tehlikeliJobId'yi yalnızca
  // BU context'in kendi tarayıcı deposunda tutuyor; offers.ts#createOffer'ın
  // findJobById'si (jobs-lookup.ts, SENKRON/yalnızca-yerel — Supabase'ten
  // gelen "uzak ilan" birleşimini KULLANMAZ, bu app'in ÖNCEDEN VAR OLAN,
  // bu görevin kapsamı DIŞINDAKİ bir mimari sınırı) bu yüzden BAŞKA bir
  // context'ten (job'u hiç YEREL olarak görmemiş) çağrılırsa "İlan
  // bulunamadı" ile başarısız olurdu (gerçek çalıştırmada bulunan bir
  // durum) — bölüm I) bu AYNI context'i (page2), gerçek çıkış+giriş ile
  // Hizmet Veren'e geçirerek yeniden kullanır.

  // =========================================================================
  // D) ADMIN — her iki ilanı onaylıyor; onay SONRASI veriler bozulmuyor.
  // =========================================================================
  // NOT: yalnızca kimyasalJobId burada DOĞRUDAN RPC ile onaylanır (E1/F1/F2/H1'in
  // kendi yetkilendirme-engelleme testleri için yeterli — create_offer'ın
  // MLK60 kapısı yalnızca Supabase'teki moderation_status'a bakar, YEREL
  // kopyaya değil). tehlikeliJobId'nin onayı BİLEREK bölüm I)'e ertelenir —
  // GERÇEK teklif GÖNDERİMİ offers.ts#createOffer'ın SENKRON/yalnızca-yerel
  // findJobById+isJobModerationApproved kontrolünü kullanır (app'in ÖNCEDEN
  // VAR OLAN, bu görevin kapsamı DIŞINDaki bir mimari sınırı — Supabase'ten
  // "uzak onay" bilgisi bu yerel kontrole hiç YANSIMAZ) — bu yüzden onay
  // GERÇEK admin panelinden, teklifi verecek TARAYICI/context'in KENDİSİNDE
  // yapılmalı (admin-jobs.ts#approveJobAsAdmin'in "best-effort yerel yama"sı
  // yalnızca AYNI origin'in localStorage'ında çalışır).
  const { error: approveErr1 } = await adminClient.rpc("approve_job_as_admin", { p_job_id: kimyasalJobId });
  record("D1. Admin Kimyasal Depolama ilanını onaylıyor", !approveErr1, approveErr1?.message);

  {
    const { context: adminCtx, page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminUser.email, PASSWORD);
    await adminPage.goto(`${APP_ORIGIN}/admin/ilanlar/${kimyasalJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await adminPage.waitForFunction((t) => document.body.innerText.includes(t), "HazardRiskGroupTest — Kimyasal Depolama Çoklu Risk", { timeout: 45000 }).catch(() => {});
    const adminDetailText = await adminPage.locator("body").innerText().catch(() => "");
    record("D2. Admin ilan detayında 'Tehlikeli Madde' ve risk grupları görünüyor", adminDetailText.includes("Tehlikeli Madde") && adminDetailText.includes("Aşındırıcı"));

    // Admin düzenleme formunu açıp hiç dokunmadan kaydet — hiçbir alan sıfırlanmamalı.
    await adminPage.getByRole("button", { name: /Düzenle/ }).first().click();
    await adminPage.waitForTimeout(800);
    const editFormText = await adminPage.locator("body").innerText().catch(() => "");
    record("D3. Admin düzenleme formunda risk grubu seçimi ÖNCEDEN dolu geliyor", editFormText.includes("Yanıcı") || editFormText.includes("Aşındırıcı"));
    await adminPage.getByRole("button", { name: "Değişiklikleri Kaydet" }).first().click();
    await adminPage.waitForTimeout(1200);

    const { data: afterAdminEditRow } = await requester.client
      .from("jobs")
      .select("storage_hazardous, storage_risk_groups")
      .eq("id", kimyasalJobId)
      .maybeSingle();
    record(
      "D4. Admin düzenleme SONRASI risk grupları KAYIPSIZ (2 grup hâlâ duruyor)",
      afterAdminEditRow?.storage_hazardous === true && (afterAdminEditRow?.storage_risk_groups ?? []).length === 2,
      JSON.stringify(afterAdminEditRow),
    );
    await adminCtx.close();
  }

  // =========================================================================
  // E) YETKİSİZ DEPOCU — kategori dahi seçilmemiş bir provider ilanı GÖREMEZ,
  //    teklif VEREMEZ (hem UI hem backend/RPC doğrudan çağrı).
  // =========================================================================
  {
    const { error: directOfferError } = await provider.client.rpc("create_offer", {
      p_job_id: kimyasalJobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Yetkisiz doğrudan RPC çağrısı — reddedilmeli.",
    });
    record(
      "E1. Yetkisiz depocunun DOĞRUDAN backend/RPC çağrısı (arayüz atlanarak) REDDEDİLDİ (MLK60)",
      directOfferError?.code === "MLK60" || /MLK60/.test(directOfferError?.message ?? ""),
      directOfferError?.message,
    );

    const { context: provCtx, page: provPage } = await newActorPage(browser);
    await loginAs(provPage, provider.email, PASSWORD);
    await provPage.goto(`${APP_ORIGIN}/ilanlar`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await provPage.waitForTimeout(1500);
    const listingText = await provPage.locator("body").innerText().catch(() => "");
    record("E2. Yetkisiz depocu Aktif İlanlar'da Kimyasal Depolama ilanını GÖRMÜYOR", !listingText.includes("Kimyasal Depolama Çoklu Risk"));
    await provCtx.close();
  }

  // =========================================================================
  // F) KATEGORİ YETKİSİ VERİLDİ AMA RİSK GRUBU YOK — hâlâ teklif veremiyor.
  // =========================================================================
  {
    const { error: catAuthErr } = await adminClient.rpc("authorize_provider_service", {
      p_provider_id: provider.id,
      p_service_category_id: "kimyasal-depolama",
      p_reason: "HazardRiskGroupTest — yalnızca kategori",
    });
    record("F1. Admin depocuyu YALNIZ Kimyasal Depolama kategorisi için yetkilendirdi", !catAuthErr, catAuthErr?.message);

    const { error: stillBlockedErr } = await provider.client.rpc("create_offer", {
      p_job_id: kimyasalJobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Yalnızca kategori yetkisiyle teklif — reddedilmeli.",
    });
    record(
      "F2. Yalnızca kategori yetkisi olan (risk grubu YOK) depocu HÂLÂ teklif VEREMİYOR (MLK60)",
      stillBlockedErr?.code === "MLK60" || /MLK60/.test(stillBlockedErr?.message ?? ""),
      stillBlockedErr?.message,
    );
  }

  // =========================================================================
  // G) BELGE YÜKLEME + ADMIN'İN AYRI AYRI ONAYI — provider iki risk grubu
  //    talep eder, admin yalnızca BİRİNİ onaylar; yalnız onaylanan aktif olur.
  // =========================================================================
  {
    const { context: provCtx, page: provPage } = await newActorPage(browser);
    await loginAs(provPage, provider.email, PASSWORD);
    await provPage.goto(`${APP_ORIGIN}/panel/belge-yukleme`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await provPage.waitForTimeout(1500);
    await provPage.getByText("Depo Hizmetleri Veriyorum", { exact: false }).first().click({ timeout: 15000 }).catch(() => {});
    await provPage.waitForTimeout(800);
    const uploadFormText = await provPage.locator("body").innerText().catch(() => "");
    record("G1. 'Depo Hizmetleri Veriyorum' belge yükleme formunda risk grubu seçici (opsiyonel) görünüyor", uploadFormText.includes("Depolama Risk Grupları"));

    // "Depo Hizmetleri Veriyorum" grubu konteyner-depolama'yı DA kapsadığı
    // için (getStorageGroupCategoryIds'in 12 kategorisinden biri) form ayrıca
    // "Depocu Faaliyet Alanları" seçimini de ZORUNLU kılıyor (Task A'nın
    // önceki, bu görevden bağımsız gereksinimi) — test bunu atlarsa "Belgeyi
    // Gönder" DISABLED kalır (gerçek çalıştırmada bulunan bir test boşluğu,
    // uygulama davranışı DOĞRU). "Boş Konteyner Depolama" seçilir (IMO sınıfı
    // gerektirmeyen, en basit kapsam).
    await provPage.getByRole("button", { name: "Boş Konteyner Depolama", exact: false }).first().click({ timeout: 5000 });
    await provPage.waitForTimeout(150);
    // MultiSelectChips (searchable-select.tsx#CompactMultiSelect'ten FARKLI)
    // HER ZAMAN AÇIK render edilir — ayrı bir "tetikleyici" butonu YOK, chip'ler
    // doğrudan tıklanabilir.
    await provPage.getByRole("button", { name: "Yanıcı / Parlayıcı Sıvılar", exact: false }).first().click({ timeout: 5000 });
    await provPage.waitForTimeout(150);
    await provPage.getByRole("button", { name: "Zehirli / Akut Toksik Maddeler", exact: false }).first().click({ timeout: 5000 });
    await provPage.waitForTimeout(150);
    const afterRiskPickText = await provPage.locator("body").innerText().catch(() => "");
    console.log("DEBUG G — risk seçimi sonrası '2 seçildi' görünüyor mu:", afterRiskPickText.includes("2 seçildi"));

    const tmp = os.tmpdir();
    const docFile = path.join(tmp, `fixture-valid-1.jpg`);
    readFileSync(docFile);
    await provPage.locator('input[type="file"]').setInputFiles([docFile]);
    await provPage.waitForTimeout(2500);
    const beforeSendText = await provPage.locator("body").innerText().catch(() => "");
    console.log("DEBUG G — dosya seçiminden sonra body (son 400 karakter):", beforeSendText.slice(-400));
    const sendButton = provPage.getByRole("button", { name: "Belgeyi Gönder" });
    const sendButtonDisabled = await sendButton.isDisabled().catch(() => "n/a");
    console.log("DEBUG G — 'Belgeyi Gönder' butonu disabled mı:", sendButtonDisabled);
    await sendButton.click({ timeout: 15000 });
    await provPage.waitForTimeout(3000);
    const afterUploadText = await provPage.locator("body").innerText().catch(() => "");
    console.log("DEBUG G — gönderim sonrası body (son 500 karakter):", afterUploadText.slice(-500));
    record("G2. Belge yükleme tamamlandı (yükleniyor/eklendiği görünüyor)", afterUploadText.includes("belgeniz yüklendi") || afterUploadText.includes("Admin onayı bekliyor"));
    await provCtx.close();
  }

  await new Promise((r) => setTimeout(r, 1500));
  const { data: docRows } = await runSqlAsRows(
    `select id, requested_storage_risk_groups from public.provider_documents where provider_id = '${provider.id}' and document_type = 'depo-hizmetleri-belgesi' order by uploaded_at desc limit 1;`,
  );
  const docRow = docRows?.[0];
  record(
    "G3. Yüklenen belgede iki talep edilen risk grubu kaydedildi",
    Array.isArray(docRow?.requested_storage_risk_groups) && docRow.requested_storage_risk_groups.length === 2,
    JSON.stringify(docRow),
  );

  if (docRow) {
    const { context: adminCtx, page: adminPage } = await newActorPage(browser);
    await loginAs(adminPage, adminUser.email, PASSWORD);
    await adminPage.goto(`${APP_ORIGIN}/admin/firma-belgeleri/${docRow.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await adminPage.waitForTimeout(1500);
    const reviewText = await adminPage.locator("body").innerText().catch(() => "");
    record("G4. Admin belge inceleme ekranında iki talep edilen risk grubu görünüyor", reviewText.includes("Yanıcı") && reviewText.includes("Zehirli"));

    // Yalnızca "Zehirli / Akut Toksik Maddeler"i işaretli bırak — "Yanıcı / Parlayıcı Sıvılar"ı işaretten çıkar.
    // "Talep Edilen Depolama Risk Grupları" (üstte, salt-okunur <li> rozetleri)
    // İLE "Onaylanacak Risk Grupları" (altta, TIKLANABİLİR MultiSelectChips)
    // AYNI metni taşıyor — role="group" ile doğru (interaktif) checklist'e
    // KAPSAM daraltılır, yoksa .first() salt-okunur rozete tıklar (hiçbir
    // şey değişmez, gerçek çalıştırmada bulunan bir test hatası).
    const flammableChip = adminPage.getByRole("group", { name: "Onaylanacak Risk Grupları" }).getByRole("button", { name: "Yanıcı / Parlayıcı Sıvılar", exact: false });
    await flammableChip.click({ timeout: 10000 });
    await adminPage.waitForTimeout(300);

    await adminPage.getByRole("button", { name: "Onayla" }).first().click({ timeout: 10000 });
    await adminPage.waitForTimeout(1500);
    await adminCtx.close();
  }

  const { data: afterReviewRows } = await runSqlAsRows(
    `select risk_group_id, revoked_at from public.provider_storage_risk_authorizations where provider_id = '${provider.id}' order by risk_group_id;`,
  );
  const activeGroups = (afterReviewRows ?? []).filter((r) => !r.revoked_at).map((r) => r.risk_group_id);
  record(
    "G5. Admin'in AYRI ONAYI SONUCU: yalnız 'zehirli-akut-toksik' aktif, 'yanici-parlayici-sivilar' aktif DEĞİL",
    activeGroups.includes("zehirli-akut-toksik") && !activeGroups.includes("yanici-parlayici-sivilar"),
    JSON.stringify(afterReviewRows),
  );

  // =========================================================================
  // H) ARTIK KATEGORİ + KISMEN eşleşen risk grubu yetkisi var — Kimyasal
  //    Depolama ilanı (yanici-parlayici-sivilar + asindirici-asitler
  //    gerektirir) İÇİN HÂLÂ teklif VEREMEZ (yalnız zehirli-akut-toksik
  //    onaylı, ilanın gerektirdiği ikisi de DEĞİL).
  // =========================================================================
  {
    const { error: stillBlockedErr2 } = await provider.client.rpc("create_offer", {
      p_job_id: kimyasalJobId,
      p_amount: 5000,
      p_currency: "TRY",
      p_description: "Yanlış risk grubu onaylı — reddedilmeli.",
    });
    record(
      "H1. Yanlış (eşleşmeyen) risk grubu onaylı depocu Kimyasal Depolama ilanına HÂLÂ teklif VEREMİYOR",
      stillBlockedErr2?.code === "MLK60" || /MLK60/.test(stillBlockedErr2?.message ?? ""),
      stillBlockedErr2?.message,
    );
  }

  // =========================================================================
  // I) DOĞRU EŞLEŞEN (Tehlikeli Madde Depolama, zehirli-akut-toksik) İLANA
  //    ARTIK TEKLİF VEREBİLİYOR — GERÇEK TARAYICI teklif formu ÜZERİNDEN
  //    (offers.ts localStorage yazımını, dolayısıyla job-visibility.ts'in
  //    istemci tarafı risk-grubu kapısını da GERÇEKTEN egzersiz eder — RPC'yi
  //    doğrudan çağırmak yalnızca backend'i test eder, offer-panel.tsx'in
  //    kendi görünürlük/gönderim yolunu DEĞİL). KASITLI OLARAK page2'nin
  //    (C bölümünde tehlikeliJobId'yi YARATAN, hâlâ açık) AYNI context'i
  //    yeniden kullanılır — offers.ts#createOffer'ın findJobById'si
  //    (jobs-lookup.ts) SENKRON/yalnızca-yereldir, Supabase'ten gelen "uzak
  //    ilan" birleşimini (useAllJobs()'un REAKTİF tarafı) KULLANMAZ; bu
  //    ilanı hiç yerel olarak görmemiş TAZE bir context'ten teklif vermeye
  //    çalışmak "İlan bulunamadı" ile başarısız olurdu — app'in ÖNCEDEN VAR
  //    OLAN, bu görevin kapsamı DIŞINDAKİ bir mimari sınırı (gerçek
  //    çalıştırmada bulunan bir durum, ayrıca not edilecek).
  // =========================================================================
  {
    // tehlikeliJobId'nin onayı GERÇEK admin panelinden, page2'nin KENDİ
    // context'inde yapılır (bkz. yukarıdaki not) — admin-jobs.ts#approveJobAsAdmin'in
    // best-effort yerel yaması, bu ilanı YARATMIŞ olan AYNI tarayıcı deposunda
    // çalışır ve bu YETERLİDİR.
    await logout(page2);
    await loginAs(page2, adminUser.email, PASSWORD);
    await page2.goto(`${APP_ORIGIN}/admin/ilanlar/${tehlikeliJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction((t) => document.body.innerText.includes(t), "HazardRiskGroupTest — Tehlikeli Madde Deposu", { timeout: 45000 }).catch(() => {});
    await page2.getByRole("button", { name: "Onayla ve Yayınla" }).click({ timeout: 15000 });
    await page2.waitForTimeout(1500);
    const adminApprovalText = await page2.locator("body").innerText().catch(() => "");
    record("D5. Tehlikeli Madde Depolama ilanı GERÇEK admin panelinden onaylandı (aynı context, yerel yama için)", !adminApprovalText.includes("Onayla ve Yayınla"));

    await logout(page2);
    await loginAs(page2, provider.email, PASSWORD);
    await page2.goto(`${APP_ORIGIN}/ilanlar/${tehlikeliJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction((t) => document.body.innerText.includes(t), "HazardRiskGroupTest — Tehlikeli Madde Deposu", { timeout: 45000 }).catch(() => {});
    const jobPageText = await page2.locator("body").innerText().catch(() => "");
    record("I1a. Doğru eşleşen risk grubu onaylı depocu ilanı GÖREBİLİYOR (Teklif Ver formu render edildi)", jobPageText.includes("Teklif Tutarı") || jobPageText.includes("Teklif Ver"));

    await page2.locator('input[placeholder="0,00"]').first().fill("7000");
    await page2.locator("textarea").first().fill("Doğru eşleşen risk grubu ile GERÇEK tarayıcı teklifi, yeterli uzunlukta bir açıklama metni.");
    await page2.getByRole("button", { name: "Teklif Gönder" }).click({ timeout: 15000 });
    await page2.waitForFunction(() => document.body.innerText.includes("Teklifiniz başarıyla gönderildi"), { timeout: 15000 }).catch(() => {});
    const afterOfferText = await page2.locator("body").innerText().catch(() => "");
    if (!afterOfferText.includes("Teklifiniz başarıyla gönderildi")) {
      console.error("DEBUG I1b — teklif gönderilemedi:", JSON.stringify(await page2.locator(".text-danger").allInnerTexts().catch(() => [])));
    }
    record(
      "I1b. GERÇEK teklif formu üzerinden teklif GÖNDERİLDİ (offer-panel.tsx, localStorage'a yazıldı)",
      afterOfferText.includes("Teklifiniz başarıyla gönderildi"),
      afterOfferText.slice(0, 400),
    );

    await logout(page2);
    await loginAs(page2, requester.email, PASSWORD);
    await page2.goto(`${APP_ORIGIN}/panel/gelen-teklifler`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // StorageEligibilityBadge, provider_can_view_job RPC'sini ASENKRON olarak
    // kart mount olduktan SONRA çağırır (useStorageJobEligibility) — sabit
    // bir bekleme yerine rozet metninin KENDİSİ (ya da en azından yükleme
    // biter bitmez) beklenir.
    await page2.waitForFunction(() => document.body.innerText.includes("Depolama Risk Kapsamı Uygun"), { timeout: 20000 }).catch(() => {});
    const incomingText = await page2.locator("body").innerText().catch(() => "");
    record(
      "I2. Hizmet Alan'ın Gelen Teklifler ekranında uygunluk rozeti ('Depolama Risk Kapsamı Uygun') görünüyor",
      incomingText.includes("Depolama Risk Kapsamı Uygun") || incomingText.includes("Zehirli / Akut Toksik"),
      incomingText.slice(0, 1200),
    );
    record("I3. Diskalimer metni ('ayrıca teyit edilmelidir') gösteriliyor", incomingText.includes("ayrıca teyit edilmelidir"));
    await reqContext2.close();
  }

  // =========================================================================
  // J) REGRESYON — Konteyner Depolama'nın kendi faaliyet-alanı/IMO kontrolü
  //    ve genel ilan akışı bu görevden ETKİLENMEDİ.
  // =========================================================================
  {
    const { error } = await requester.client.rpc("create_job", {
      p_category_id: "genel-depolama",
      p_title: "HazardRiskGroupTest — Regresyon Genel Depolama",
      p_description: "Regresyon kontrolü, yirmi karakterden uzun açıklama.",
      p_operation_details: "",
      p_province: "Kocaeli",
      p_district: "Gebze",
      p_work_location_type: "Test Depo",
      p_work_date: WORK_DATE,
      p_photos: [{ storage_path: `job-photos/test/${crypto.randomUUID()}.jpg`, original_file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 100, height: 100 }],
    });
    record("J1. Genel Depolama create_job (storage_hazardous/risk_groups olmadan) HÂLÂ hatasız çalışıyor (regresyon yok)", !error, error?.message);
  }
}

async function runSqlAsRows(sql) {
  return { data: runSql(sql) };
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  try {
    if (idList) {
      // FK sırası: provider_service_authorizations/provider_storage_risk_
      // authorizations.source_document_id -> provider_documents.id, bu
      // yüzden ikisi provider_documents'tan ÖNCE silinmeli (gerçek
      // çalıştırmada bulunan bir FK ihlali hatası).
      runSql(`delete from public.provider_storage_risk_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_service_authorizations where provider_id in (${idList});`);
      runSql(`delete from public.provider_document_reviews where provider_id in (${idList});`);
      runSql(`delete from public.provider_documents where provider_id in (${idList});`);
      runSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      // notifications.offer_id -> offers.id FK'si var, offers'tan ÖNCE silinmeli.
      runSql(`delete from public.notifications where recipient_id in (${idList}) or offer_id in (select id from public.offers where job_id in (select id from public.jobs where requester_id in (${idList})));`);
      runSql(`delete from public.offer_status_history where offer_id in (select o.id from public.offers o join public.jobs j on j.id = o.job_id where j.requester_id in (${idList}));`);
      runSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
      runSql(`delete from public.jobs where requester_id in (${idList});`);
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
    }
  } catch (error) {
    console.error("cleanup sql failed (continuing):", error?.message || error);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error("BEKLENMEYEN HATA:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ÖZET === Toplam: ${results.length}, Başarılı: ${results.length - failed.length}, Başarısız: ${failed.length}`);
    if (failed.length > 0) {
      console.log("Başarısız:", failed.map((r) => r.name).join("; "));
      process.exitCode = 1;
    }
  });
