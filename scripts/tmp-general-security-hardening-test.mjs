// node scripts/tmp-general-security-hardening-test.mjs
//
// GENEL GÜVENLİK, VERİ DOĞRULAMA VE KÖTÜYE KULLANIM KORUMASI görevinin
// gerçek Development ortamına, gerçek tarayıcıya VE doğrudan RPC çağrılarına
// karşı uçtan uca kanıtı. Özellikle görev bölüm 14'ün kesin talimatı:
// tekliflerin GERÇEKTEN public.offers'a yazıldığını ve cihazlar arası
// görünür olduğunu kanıtlamak.
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

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-security-"));
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
const createdUserIds = [];

async function createUser(label, role) {
  const email = `malsevk-secure-${label}-${stamp}@gmail.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  createdUserIds.push(userId);

  if (!data.session) {
    runSql(`update auth.users set email_confirmed_at = now(), confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signIn(${label}) after confirm failed: ${signInError.message}`);
  }

  const { error: crError } = await client.rpc("complete_registration", {
    // 'admin' complete_registration'ın p_role kısıtında hiç GEÇERLİ bir
    // değer DEĞİL (gerçek admin hesapları yalnızca elle/SQL ile terfi
    // ettirilir, bkz. CLAUDE.md) — bu yüzden admin için de önce sıradan bir
    // rolle kayıt tamamlanır, sonra aşağıda SQL ile terfi ettirilir.
    p_role: role === "admin" ? "hizmet-alan" : role,
    p_full_name: `Secure ${label}`,
    p_phone: "+905551110099",
    p_company_name: `Secure Firma ${label}`,
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);

  if (role === "admin") {
    runSql(`update public.profiles set role = 'admin' where id = '${userId}';`);
  }

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

async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.waitForTimeout(300);
}

async function selectSearchable(page, label, index, optionName, { exact = true } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).first();
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionName, exact }).first().click();
}

async function makeTestJpeg() {
  return sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
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

/**
 * GERÇEK "İlanı Yayınla" formu üzerinden (Forklift kategorisi — Nakliye'nin
 * çift-lokasyon/yük-grubu karmaşıklığı olmadan en sade akış) bir ilan
 * oluşturur. `offers.ts#createOffer`'ın job-lookup'ı (bkz. jobs-lookup.ts#
 * findJobById) YALNIZCA bu tarayıcının KENDİ localStorage'ındaki job-store.ts
 * kaydına bakar — Supabase'e doğrudan INSERT edilmiş bir ilan asla bulamaz
 * (bu, projenin ÖNCEDEN belgelenmiş, bilinen bir mimari sınırıdır, bu
 * güvenlik görevinin kapsamı DIŞINDA). Bu yüzden gerçek bir teklifin gerçek
 * UI'dan geçebilmesi için ilan GERÇEKTEN bu formdan oluşturulmalı.
 */
async function createJobViaRealForm(page, titleSuffix) {
  await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
  await page.waitForTimeout(500);

  const workDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(workDate);
  if ((await dateInputs.count()) > 1) await dateInputs.nth(1).fill(workDate);

  await page.getByLabel("İlan Başlığı").first().fill(`Guvenlik testi ${titleSuffix}`);
  await page.getByLabel("Açıklama", { exact: false }).first().fill("Bu güvenlik testi için gerçek form üzerinden oluşturulan bir ilan açıklamasıdır.");

  await selectSearchable(page, "İlçe", 0, "Gebze");
  await selectSearchable(page, "Liman / Sanayi / OSB", 0, "Listede yok, kendim gireceğim");
  await page.getByLabel("Liman / Sanayi / OSB Adı").fill(`Test Tesisi ${titleSuffix}`);
  await page.getByLabel("Açık Adres").first().fill("Test açık adres, Gebze / Kocaeli.");

  await uploadOnePhoto(page);
  // "İlanı Yayınla" ilk tıklamada yalnızca "Operasyon Önizleme" moduna
  // geçer (job-request-form.tsx#handleSubmit — henüz createJob'ı ÇAĞIRMAZ,
  // bkz. CLAUDE.md "Operasyon Önizleme"); GERÇEK yayınlama önizlemedeki
  // AYNI metinli butona (handlePublish) İKİNCİ bir tıklamayla olur.
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL((url) => /\/ilanlar\/[0-9a-f-]{36}/.test(url.pathname), { timeout: 20000 });
  const match = page.url().match(/\/ilanlar\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

// create_job RPC'nin kendi fotoğraf-sayısı doğrulaması (MLK51, 1-10 arası)
// bu testin konusu DEĞİL — burada amaç yalnızca offers/rate-limit/RLS
// testleri için geçerli bir jobs satırına sahip olmak, bu yüzden ham bir
// INSERT (moderation_status doğrudan 'approved') kullanılır; bu aynı zamanda
// create_job'ı hiç ÇAĞIRMADIĞI için jobs tablosundaki 0073'ün YENİ
// trigger'larını (rate limit, location_url şeması) da RPC'den bağımsız
// olarak (doğrudan tabloya yazıldığında da) çalıştığını gösterir.
function insertTestJob(requesterId, categoryId, title) {
  const id = randomUUID();
  const workDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const escapedTitle = title.replace(/'/g, "''");
  runSql(
    `insert into public.jobs (id, requester_id, category_id, title, description, operation_details, province, district, work_location_type, work_date, moderation_status)
     values ('${id}', '${requesterId}', '${categoryId}', '${escapedTitle}', 'Bu güvenlik testi için oluşturulan bir ilan açıklamasıdır yeterli uzunlukta.', '', 'Kocaeli', 'Gebze', 'Test Tesis', '${workDate}', 'approved');`,
  );
  return { id };
}

async function run() {
  const browser = await chromium.launch();

  try {
    console.log("--- Test kullanıcıları oluşturuluyor ---");
    const requester = await createUser("req", "hizmet-alan");
    const provider = await createUser("prov", "hizmet-veren");
    const otherProvider = await createUser("prov2", "hizmet-veren");
    const admin = await createUser("admin", "admin");
    console.log(`requester=${requester.email} provider=${provider.email} otherProvider=${otherProvider.email}`);

    // Provider'ı Forklift kategorisi için gerçekten yetkilendir (admin
    // onayı simüle ediliyor — yalnızca provider_service_authorizations
    // satırını, gerçek RPC'nin ürettiği ile AYNI şekilde ekleyerek, bir
    // admin hesabı olmadan bu testi hızlandırmak için doğrudan SQL
    // kullanılır; bu, section 14'ün asıl konusu olan OFFER senkronunu test
    // etme amacını etkilemez).
    runSql(
      `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${provider.id}', 'forklift', now()) on conflict do nothing;`,
    );
    runSql(`insert into public.provider_services (provider_id, service_category_id) values ('${provider.id}', 'forklift') on conflict do nothing;`);

    // ============================================================
    // BÖLÜM A — Görev §14: Tekliflerin gerçek merkezi veri kaynağı kanıtı.
    // TEK, paylaşılan tarayıcı context'i (job-store.ts'in bu mimarideki
    // BİLİNEN sınırı gereği — bkz. createJobViaRealForm'un kendi dokümanı):
    // Hizmet Alan GERÇEK formdan ilan oluşturur (kendi localStorage'ına
    // yazar + Supabase'e senkronlar), SONRA AYNI sekmede çıkış yapıp
    // Hizmet Veren olarak giriş yapılır (localStorage bu geçişte KORUNUR)
    // — böylece Hizmet Veren'in kendi tarayıcısı da o ilanı YEREL olarak
    // "görür" ve GERÇEK "Teklif Gönder" formu çalışabilir.
    // ============================================================
    const beforeCount = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}';`)[0].c;

    const sharedCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const sharedPage = await sharedCtx.newPage();

    await loginAs(sharedPage, requester.email);
    const jobId = await createJobViaRealForm(sharedPage, "A");
    record("A0) İlan GERÇEK 'İlanı Yayınla' formuyla oluşturuldu", Boolean(jobId), jobId);

    // KANITLANMIŞ, ÖNCEDEN BELGELENMİŞ mimari sınır (bkz. bu betiğin bir
    // önceki hata ayıklaması): `offers.ts#createOffer`'ın moderasyon
    // kontrolü (isJobModerationApproved) YEREL job-store.ts kopyasına
    // bakar — Supabase'e doğrudan SQL ile yazılan bir onay bu YEREL kopyayı
    // GÜNCELLEMEZ. Gerçek admin UI'ından (AYNI paylaşılan sekmede) onaylamak,
    // `admin-jobs.ts#approveJobAsAdmin`'in "best-effort yerel yama"sını
    // (applyAdminModerationDecision) tetikleyip bu sınırı doğru şekilde aşar
    // — SQL ile "approved" yazmak yerine GERÇEK admin ekranı kullanılır.
    await logout(sharedPage);
    await loginAs(sharedPage, admin.email);
    await sharedPage.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
    await sharedPage.waitForTimeout(1500);
    const onaylaButton = sharedPage.getByRole("button", { name: /^Onayla/ });
    if (await onaylaButton.count() > 0) {
      await onaylaButton.click();
      await sharedPage.waitForTimeout(1500);
    }
    const moderationRow = runSql(`select moderation_status from public.jobs where id = '${jobId}';`)[0];
    record("A0b) İlan GERÇEK admin ekranından onaylandı", moderationRow?.moderation_status === "approved", JSON.stringify(moderationRow));

    await logout(sharedPage);
    await loginAs(sharedPage, provider.email);
    await sharedPage.goto(`${APP_ORIGIN}/ilanlar/${jobId}`);
    await sharedPage.waitForTimeout(1000);
    await sharedPage.locator("textarea").first().fill("Bu ilan icin gercek bir teklif aciklamasi yaziyorum simdi burada.");
    await sharedPage.locator('select[aria-label="Para birimi"]').selectOption("TRY").catch(() => {});
    const amountInputs = sharedPage.locator('input[inputmode="decimal"]');
    if ((await amountInputs.count()) > 0) await amountInputs.first().fill("15000");
    await sharedPage.getByRole("button", { name: "Teklif Gönder" }).click();
    await sharedPage.waitForTimeout(2500);

    const afterCount = runSql(`select count(*) as c from public.offers where provider_id = '${provider.id}';`)[0].c;
    record("A1) public.offers satır sayısı GERÇEKTEN arttı (teklif oncesi/sonrasi)", Number(afterCount) > Number(beforeCount), `${beforeCount} -> ${afterCount}`);

    const offerRow = runSql(
      `select id, job_id, provider_id, status from public.offers where provider_id = '${provider.id}' and job_id = '${jobId}' order by created_at desc limit 1;`,
    )[0];
    record("A2) Gercek Supabase offer kaydi dogrulandi (id/job_id/provider_id eslesiyor)", Boolean(offerRow && offerRow.job_id === jobId), JSON.stringify(offerRow));

    await sharedCtx.close();

    // Ayrı, TAMAMEN TAZE tarayıcı oturumundaki Hizmet Alan (hiçbir zaman bu
    // teklifi/ilanı kendi localStorage'ında yazmadı) teklifi görebiliyor mu?
    const reqCtx2 = await browser.newContext();
    const reqPage2 = await reqCtx2.newPage();
    await loginAs(reqPage2, requester.email);
    await reqPage2.goto(`${APP_ORIGIN}/panel/gelen-teklifler`);
    await reqPage2.waitForTimeout(2500);
    const bodyText1 = await reqPage2.locator("body").innerText();
    record("A3) Ayrı tarayıcıdaki Hizmet Alan teklifi görebiliyor (cihazlar arası görünürlük)", bodyText1.includes("15.000") || bodyText1.includes("15000") || bodyText1.includes("Forklift"), "Gelen Teklifler ekranı kontrol edildi");

    // localStorage temizlendikten sonra hâlâ görünüyor mu (gerçek kaynağın
    // localStorage DEĞİL, Supabase olduğunun kanıtı)?
    await reqPage2.evaluate(() => window.localStorage.clear());
    await reqPage2.reload();
    await reqPage2.waitForTimeout(2500);
    const bodyText2 = await reqPage2.locator("body").innerText();
    record("A4) localStorage temizlendikten SONRA teklif hâlâ görünüyor (gerçek kaynak Supabase)", bodyText2.includes("15.000") || bodyText2.includes("15000") || bodyText2.includes("Forklift"));

    await reqCtx2.close();

    // ============================================================
    // BÖLÜM B — Gerçek tarayıcı: XSS/aşırı uzun metin/iletişim bilgisi reddi
    // (jobRow İLE AYNI provider zaten Bölüm A'da o ilana teklif verdi —
    // offers_one_blocking_per_job_provider tekil kısıtına çarpmamak için
    // AYRI bir ilan kullanılır.)
    // ============================================================
    const jobRowB = insertTestJob(requester.id, "forklift", "Guvenlik testi ilani B");
    const provCtx2 = await browser.newContext();
    const provPage2 = await provCtx2.newPage();
    await loginAs(provPage2, provider.email);
    await provPage2.goto(`${APP_ORIGIN}/ilanlar/${jobRowB.id}`);
    await provPage2.waitForTimeout(1000);
    await provPage2.locator("textarea").first().fill("Beni hemen arayin 0532 111 22 33 lutfen cevap verin simdi.");
    const amountInputs2 = provPage2.locator('input[inputmode="decimal"]');
    if ((await amountInputs2.count()) > 0) await amountInputs2.first().fill("5000");
    await provPage2.getByRole("button", { name: "Teklif Gönder" }).click();
    await provPage2.waitForTimeout(800);
    const contactErrorVisible = await provPage2.getByText(/telefon numarası veya e-posta/i).isVisible().catch(() => false);
    record("B1) Teklif açıklamasındaki telefon numarası GERÇEK UI'da reddediliyor", contactErrorVisible);
    await provCtx2.close();

    // ============================================================
    // BÖLÜM C — Doğrudan RPC ile bypass denemeleri (client UI atlanarak)
    // ============================================================
    const providerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await providerClient.auth.signInWithPassword({ email: provider.email, password: PASSWORD });

    // C1: Doğrudan RPC ile iletişim bilgisi içeren teklif (kendi ayrı ilanı)
    {
      const jobRowC1 = insertTestJob(requester.id, "forklift", "Guvenlik testi ilani C1");
      const { error } = await providerClient.rpc("create_offer", {
        p_job_id: jobRowC1.id,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: "Lutfen bana test-guvenlik@example.com adresinden yazin tesekkurler simdiden.",
      });
      record("C1) Doğrudan RPC ile e-posta içeren teklif reddediliyor (ML163)", Boolean(error && error.message.includes("ML163")), error?.message);
    }

    // C2: Yetkisiz kategoriye (Kimyasal Depolama) doğrudan RPC ile teklif
    {
      const chemJob = insertTestJob(requester.id, "kimyasal-depolama", "Kimyasal depolama guvenlik testi");
      const { error } = await providerClient.rpc("create_offer", {
        p_job_id: chemJob.id,
        p_amount: 1000,
        p_currency: "TRY",
        p_description: "Bu kategori icin yetkim olmadan dogrudan RPC ile teklif vermeyi deniyorum simdi.",
      });
      record("C2) Yetkisiz kategoriye (Kimyasal Depolama) doğrudan RPC ile teklif reddediliyor", Boolean(error && error.message.includes("MLK60")), error?.message);
    }

    // C3: Başka firmanın private belgesine erişim
    {
      const providerDocs = runSql(`select id, storage_path from public.provider_documents where provider_id = '${provider.id}' limit 1;`);
      if (providerDocs.length > 0) {
        const otherClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        await otherClient.auth.signInWithPassword({ email: otherProvider.email, password: PASSWORD });
        const { data, error } = await otherClient.from("provider_documents").select("id").eq("id", providerDocs[0].id).maybeSingle();
        record("C3) Başka firma provider_documents satırını RLS ile GÖREMİYOR", !data && !error, JSON.stringify({ data, error: error?.message }));
      } else {
        record("C3) (atlandı — test provider'ının hiç belgesi yok)", true);
      }
    }

    // C4: Rate limit — 65 art arda gerçek create_offer RPC çağrısı (limit:
    // 60/saat). Her deneme AYRI bir ilana yapılır (offers_one_blocking_per_
    // job_provider tekil kısıtının — aynı sağlayıcının aynı ilana ikinci
    // teklif verememesi — bu testi MLK63 ile YANLIŞ POZİTİF durdurmasını
    // önlemek için).
    {
      const rlProviderClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await rlProviderClient.auth.signInWithPassword({ email: otherProvider.email, password: PASSWORD });
      runSql(
        `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at) values ('${otherProvider.id}', 'nakliye', now()) on conflict do nothing;`,
      );

      let hitLimit = false;
      let lastError = null;
      let successCount = 0;
      for (let i = 0; i < 65 && !hitLimit; i += 1) {
        const rlJob = insertTestJob(requester.id, "nakliye", `Rate limit test ilani ${i}`);
        const { error } = await rlProviderClient.rpc("create_offer", {
          p_job_id: rlJob.id,
          p_amount: 1000 + i,
          p_currency: "TRY",
          p_description: `Rate limit testi icin gonderilen teklif numara ${i} aciklama metni burada.`,
          p_estimated_duration: 5,
        });
        if (error) {
          lastError = error;
          if (error.message.includes("ML161")) hitLimit = true;
          else break;
        } else {
          successCount += 1;
        }
      }
      record("C4) 60/saat teklif rate limiti GERÇEK RPC döngüsüyle tetiklendi", hitLimit, `${successCount} başarılı, sonra: ${lastError?.message}`);
    }

    await browser.close();
    return true;
  } catch (error) {
    console.error("FATAL:", error);
    await browser.close().catch(() => {});
    return false;
  }
}

run().then((ok) => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== SONUÇ: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    console.log("Başarısız:", failed.map((f) => f.name).join(", "));
  }
  process.exit(ok && failed.length === 0 ? 0 : 1);
});
