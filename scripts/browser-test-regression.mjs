// node scripts/browser-test-regression.mjs
//
// Fotoğraf yükleme özelliği eklendikten sonra, dokunulmaması istenen
// mevcut sistemlerin (giriş/kayıt, rol yetkileri, lokasyon seçimi, ilan
// listeleme, teklif verme, eski/fotoğrafız ilan detay sayfası) hala doğru
// çalıştığını doğrular. Ön koşul: `npm run dev` çalışıyor olmalı.
//
// "Son Açıkları Kapat" GÖREV 4 düzeltmesi: bu betik eskiden mert@test.com/
// zeynep@test.com adlı SABİT, önceden var olan (pre-Supabase-Auth-göçü
// döneminden kalma localStorage-seed) hesapları kullanıyordu. Bu hesaplar
// artık Supabase Auth'ta HİÇ yok — giriş formu "E-posta veya şifre hatalı."
// gösterip /giris-yap'ta kalıyor, `page.waitForURL(...)`'in kendi 30sn
// varsayılan zaman aşımına kadar bekleyip sonra HATA ile çıkıyordu (gerçek
// bir sonsuz "takılma" değil — ama önceki bir koşuda bu betik `| tail -100`
// ile başka birçok ağır Playwright sürecinin AYNI ANDA çalıştığı bir
// oturumda çağrılmıştı; `tail`in kendisi altta yatan komut BİTENE kadar
// hiçbir çıktı basmıyor, bu da gerçek ilerlemeyi tamamen gizleyip "sonsuza
// kadar takılı" izlenimi veriyordu). KÖK NEDEN düzeltmesi: bu betik artık
// KENDİ gerçek Supabase Auth hesaplarını (signUp + complete_registration)
// oluşturuyor — hiçbir sabit/önceden var olması gereken hesaba bağımlı
// değil — ve sonunda try/finally içinde bunları temizliyor.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`[browser-test-regression] FAIL: beklenen Development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-regtest-"));
function runSql(query) {
  const file = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, query, "utf8");
  const out = execSync(`npx supabase db query --linked --file ${file} --output json`, { encoding: "utf8" });
  return JSON.parse(out).rows ?? [];
}

function freshSupabaseClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

const stamp = Date.now();
const createdUserIds = [];
async function createRealTestUser(label, role, companyType) {
  const email = `malsevk-regtest-${label}-${stamp}@gmail.com`;
  const cli = freshSupabaseClient();
  const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user.id;
  createdUserIds.push(userId);
  if (!data.session) {
    // `confirmed_at` artık bu Supabase projesinde GENERATED bir sütun
    // (email_confirmed_at'ten türetiliyor) — doğrudan SET edilemiyor.
    // email_confirmed_at tek başına yeterli, ama bu da signUp()'ın
    // döndürdüğü oturumsuz `cli`'ı gerçekten oturum açmış hâle GETİRMEZ
    // (proje artık e-posta onayını zorunlu kılıyor) — bir sonraki RPC
    // çağrısının auth.uid()'e sahip olması için gerçek bir giriş şart.
    runSql(`update auth.users set email_confirmed_at = now() where id = '${userId}';`);
    const { error: signInError } = await cli.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signInWithPassword(${label}) failed: ${signInError.message}`);
  }
  const { error: crError } = await cli.rpc("complete_registration", {
    p_role: role, p_full_name: `Regresyon Test ${label}`, p_phone: "+905551110077",
    p_company_name: `Regresyon Test Firma ${label}`, p_company_type: companyType, p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: userId, email, client: cli };
}

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function main() {
  console.log("--- Gerçek test hesapları oluşturuluyor (Development) ---");
  const provider = await createRealTestUser("prov", "hizmet-veren", "bireysel");
  const requester = await createRealTestUser("req", "hizmet-alan", "bireysel");
  // ilan-001 (statik örnek ilan, jobs.ts) kategorisi "Lashing" (eski/legacy
  // ham metin) -> resolveLegacyJobCategoryToId ile "lashing-unlashing"e
  // eşlenir. Service Authorization (migration 0038) yalnızca Supabase'e
  // yazılan gerçek ilanları DEĞİL, job-visibility.ts#resolveVisibility'nin
  // KENDİSİ üzerinden statik seed ilanlarını da kapsar — bu yüzden provider
  // bu kategoriye AÇIKÇA yetkilendirilmeden ilan görünmez/teklif veremez.
  // "forklift-operatoru": adım 3b'nin kontrol ettiği ilan-002 (Kocaeli/Gebze
  // sabit örnek ilanı, "Forklift Operatörü" -> resolveLegacyJobCategoryToId
  // ile bu id'ye eşlenir) da aynı şekilde yalnızca yetkili bir provider'a
  // görünür.
  runSql(
    `insert into public.provider_service_authorizations (provider_id, service_category_id, authorized_at)
     values ('${provider.id}', 'lashing-unlashing', now()), ('${provider.id}', 'forklift-operatoru', now())
     on conflict do nothing;`,
  );
  console.log(`provider=${provider.email} requester=${requester.email} (lashing-unlashing + forklift-operatoru için yetkilendirildi)`);

  let realJobId;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    // GÖREV 4 kök neden düzeltmesi (2. bulgu): `public.jobs.id` gerçek bir
    // uuid sütunudur, ama `ilan-001`/`ilan-002` (jobs.ts'teki statik örnek
    // ilanlar) hiçbir zaman Supabase'e yazılmamış kod-içi sabit id'lerdir.
    // Teklif verme artık (supabase-offer-sync.ts, "localStorage Bağımlılığını
    // Kaldır" görevi) KOŞULSUZ ve BLOKLAYICI olarak `create_offer` RPC'sine
    // bağlı olduğundan, statik bir seed ilana gerçek teklif vermek artık
    // yapısal olarak imkansız (RPC, "ilan-001" değerini uuid'ye çeviremediği
    // için 400 döner). Bu yüzden teklif adımı için requester'ın KENDİ gerçek
    // Supabase ilanını oluşturup admin onayından geçiriyoruz; ilan-001
    // kontrolü (adım 2) hâlâ geçerli ve değişmedi — o yalnızca "eski/
    // fotoğrafsız ilan detay sayfası çökmüyor mu"yu doğruluyor, teklif
    // vermiyor. create_job, requester kimliğini YALNIZCA auth.uid()'den
    // okur (bkz. CLAUDE.md "Faz 2 — real job creation") — bu yüzden ham SQL/
    // postgres bağlantısıyla değil, requester'ın KENDİ oturum açmış
    // istemcisiyle çağrılmalı, yoksa auth.uid() NULL olur ve
    // assert_active_user() ML125 ile reddeder.
    const workDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: createdJob, error: createJobError } = await requester.client
      .rpc("create_job", {
        p_category_id: "lashing-unlashing",
        p_title: "Regresyon Testi İlanı",
        p_description: "Regresyon testi için otomatik oluşturulmuş açıklama.",
        p_operation_details: "Regresyon testi.",
        p_province: "Kocaeli",
        p_district: "Dilovası",
        p_work_location_type: "Beldeport",
        p_work_date: workDate,
        // create_job en az 1 fotoğraf zorunlu kılar (MLK51, "job photo min/
        // max is 1–10"). Gerçek bir Storage nesnesi gerekmiyor — job_photos
        // satırı yalnızca metadata tutar, offer-panel hiçbir zaman fotoğrafın
        // GERÇEKTEN yüklenebilir olmasını kontrol etmez.
        p_photos: [
          {
            storage_path: `job-photos/${requester.id}/regresyon-test-placeholder.jpg`,
            original_file_name: "regresyon-test-placeholder.jpg",
            mime_type: "image/jpeg",
            size_bytes: 1024,
            width: 800,
            height: 600,
          },
        ],
      })
      .single();
    if (createJobError || !createdJob) {
      throw new Error(`create_job (regresyon test ilanı) başarısız: ${createJobError?.message}`);
    }
    realJobId = createdJob.id;
    runSql(`update public.jobs set moderation_status = 'approved' where id = '${realJobId}';`);
    console.log(`realJobId=${realJobId} (approved)`);

    // 1) İlan listeleme sayfası: oturum açılmamışsa artık giriş-gerekli kartı
    // gösterir (bkz. guest-access-card.tsx) — "İş İlanlarını İncele" CTA'ları
    // artık modal değil, doğrudan bu sayfaya yönlendirir. Gerçek listelemenin
    // hâlâ çalıştığı adım 3'ten sonra (Hizmet Veren girişiyle) doğrulanır.
    await page.goto(`${BASE_URL}/ilanlar`);
    await assert.doesNotReject(
      page.getByText("İlanları görüntülemek için giriş yapmalısınız.").waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("İlan listeleme sayfası (/ilanlar) oturumsuz kullanıcıda giriş-gerekli kartı gösteriyor");

    // 2) Eski/fotoğrafsız bir ilanın detay sayfası çökmeden açılıyor, boş durum gösteriyor
    await page.goto(`${BASE_URL}/ilanlar/ilan-001`);
    await assert.doesNotReject(
      page.getByText("Konteyner Sahasında Lashing Operasyonu").waitFor({ state: "visible", timeout: 10000 }),
    );
    await assert.doesNotReject(
      page.getByText("Bu ilan için fotoğraf eklenmemiş.").waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Fotoğrafsız eski ilan (ilan-001) detay sayfası çökmeden açılıyor, güvenli boş durum gösteriliyor");

    // 3) Giriş/kayıt: Hizmet Veren olarak giriş yap, GERÇEK (Supabase'e
    // yazılmış, admin onaylı) test ilanına teklif ver — statik seed ilan
    // (ilan-001) DEĞİL, bkz. yukarıdaki kök neden notu.
    await page.goto(`${BASE_URL}/giris-yap?redirect=/ilanlar/${realJobId}`);
    await page.locator('input[type="email"]').fill(provider.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/ilanlar/${realJobId}`, { timeout: 15000 });
    ok("Hizmet Veren (gerçek Supabase Auth hesabı) girişi çalışıyor");

    // "Tamamlanması Taahhüt Edilen Gün" artık yalnızca Nakliye kategorisindeki
    // ilanlarda gösteriliyor — test ilanı kategorisi Lashing olduğu için bu
    // alan BİLEREK render edilmiyor, bu yüzden burada hiç doldurulmaz/aranmaz.
    await page.getByLabel("Teklif Tutarı").fill("2500");
    await assert.rejects(
      page.getByLabel("Tamamlanması Taahhüt Edilen Gün").waitFor({ state: "visible", timeout: 2000 }),
    );
    await page
      .getByLabel("Teklif Açıklaması")
      .fill("Bu teklif otomatik regresyon testi tarafından oluşturulmuştur, en az yirmi karakter içerir.");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await assert.doesNotReject(
      page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("Hizmet Veren, gerçek (Supabase'e senkronlanmış) bir ilana teklif verebiliyor (teklif akışı bozulmamış)");

    // 3b) Oturum açıkken /ilanlar hâlâ gerçek listelemeyi gösteriyor (gate değil).
    // "Konteyner Sahasında Lashing Operasyonu" (ilan-001) DEĞİL — o İzmir'de,
    // İl filtresi artık Türkiye geneli serbestçe seçilebilir olsa da varsayılan
    // başlangıç değeri hâlâ Kocaeli'dir (bkz. job-listing-filters.ts)
    // ve bu test filtreyi hiç değiştirmez — bu yüzden Aktif İlanlar listesinde
    // hâlâ görünmez. Kocaeli'deki sabit örnek ilanı (ilan-002) kontrol edilir.
    await page.goto(`${BASE_URL}/ilanlar`);
    await assert.doesNotReject(
      page.getByText("Fabrika Sahasında Forklift Operatörü İhtiyacı").waitFor({ state: "visible", timeout: 10000 }),
    );
    ok("Oturum açık Hizmet Veren için /ilanlar gerçek listelemeyi gösteriyor (varsayılan Kocaeli filtreli)");

    // 4) Rol yetkisi: Hizmet Veren ilan oluşturma formunu göremez (fotoğraf öncesi de böyleydi)
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await assert.doesNotReject(
      page.getByText("Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir.").waitFor({ state: "visible" }),
    );
    ok("Rol yetkisi: Hizmet Veren hâlâ ilan oluşturamıyor");

    // 5) Lokasyon seçimi: Hizmet Alan olarak giriş yap, İl/İlçe/Liman-Sanayi-OSB
    // seçimi çalışıyor (2026-07-25: "İşin Yapılacağı Yer Türü" ayrı adımı
    // kaldırıldı, tek bir "Liman / Sanayi / OSB" seçiciyle birleştirildi).
    // Türkiye Geneli İl/İlçe: İl artık Nakliye DIŞINDAKİ hizmetlerde de gerçek
    // bir SearchableSelect'tir, Kocaeli yalnızca başlangıç varsayılanıdır (bkz.
    // job-request-form.tsx) — bu adım İl'in seçilebilir olduğunu VE varsayılan
    // olarak Kocaeli geldiğini doğrular, İlçe -> Liman / Sanayi / OSB akışı
    // değişmeden devam eder.
    await page.goto(`${BASE_URL}/giris-yap?redirect=/hizmet-talebi-olustur`);
    await page.locator('input[type="email"]').fill(requester.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/hizmet-talebi-olustur`, { timeout: 15000 });
    const provinceButton = page.getByRole("button", { name: "İl", exact: true }).first();
    await assert.doesNotReject(provinceButton.waitFor({ state: "visible", timeout: 5000 }));
    const provinceButtonText = await provinceButton.innerText();
    assert.match(provinceButtonText, /Kocaeli/);
    ok("İl artık seçilebilir bir SearchableSelect, varsayılan olarak Kocaeli geliyor (kilitli/readonly değil)");
    await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
    await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();
    await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
    await assert.doesNotReject(
      page
        .locator('ul[aria-label="Liman / Sanayi / OSB"]')
        .getByRole("option", { name: "Beldeport", exact: false })
        .waitFor({ state: "visible", timeout: 5000 }),
    );
    ok("Lokasyon seçimi (İl seçilebilir/varsayılan Kocaeli, İlçe -> Liman / Sanayi / OSB, Beldeport dahil) hâlâ doğru çalışıyor");

    if (consoleErrors.length > 0) {
      console.log("\n[browser-test-regression] UYARI: Konsolda hata yakalandı:");
      for (const err of consoleErrors) console.log(`  ! ${err}`);
    } else {
      console.log("\n[browser-test-regression] Konsolda hiç JS hatası yakalanmadı.");
    }

    console.log(`\n[browser-test-regression] ${passed}/${passed} test geçti.`);
  } finally {
    await browser.close();
    console.log("--- Test hesapları temizleniyor ---");
    if (realJobId) {
      // FK-safe sıralama (jobs -> offers zincirinin bağımlıları önce silinir).
      try {
        runSql(`delete from public.job_activity_events where job_id = '${realJobId}';`);
        runSql(`delete from public.notifications where job_id = '${realJobId}';`);
        runSql(`delete from public.offer_status_history where offer_id in (select id from public.offers where job_id = '${realJobId}');`);
        runSql(`delete from public.notifications where offer_id in (select id from public.offers where job_id = '${realJobId}');`);
        runSql(`delete from public.offers where job_id = '${realJobId}';`);
        runSql(`delete from public.job_photos where job_id = '${realJobId}';`);
        runSql(`delete from public.jobs where id = '${realJobId}';`);
      } catch (e) {
        console.error(`  (uyarı) test ilanı (${realJobId}) temizlenemedi: ${e.message}`);
      }
    }
    for (const id of createdUserIds) {
      try {
        runSql(`delete from public.provider_service_authorizations where provider_id = '${id}';`);
        runSql(`delete from auth.users where id = '${id}';`);
      } catch (e) {
        console.error(`  (uyarı) ${id} temizlenemedi: ${e.message}`);
      }
    }
    const remaining = runSql(`select count(*) as n from auth.users where email ilike 'malsevk-regtest-%@gmail.com';`)[0]?.n ?? 0;
    console.log(`Temizlik sonrası kalan test hesabı: ${remaining}`);
  }
}

main().catch((error) => {
  console.error("[browser-test-regression] HATA:", error);
  process.exitCode = 1;
});
