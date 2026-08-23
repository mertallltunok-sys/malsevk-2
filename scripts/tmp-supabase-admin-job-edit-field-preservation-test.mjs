// node scripts/tmp-supabase-admin-job-edit-field-preservation-test.mjs
//
// Development Supabase projesine (trfnmpihcnriqgikglpu) ve GERÇEK dev
// sunucusuna (http://localhost:3000, NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC=true
// olmalı) karşı: Admin İlan Düzenleme'nin alan-kaybı düzeltmesini (migration
// 0037) uçtan uca doğrular.
//
// BÖLÜM A — GÖREV BÖLÜM 13'ÜN BİREBİR SENARYOSU: Lashing/Unlashing ilanı
// (Ürün: Rulo Sac, Adet: 150, Tonaj: 350 — tonaj bu kategoride İSTEĞE
// BAĞLI, kök neden burada tetikleniyordu), admin GERÇEK edit formundan
// yalnızca başlığı değiştirir, DB'de tonaj/adet/ürün cinsinin AYNEN
// kaldığı doğrulanır.
//
// BÖLÜM B — GÖREV BÖLÜM 14/15: beş farklı hizmet türü (Lashing/Unlashing,
// Nakliye, Kapalı Depolama, Forklift Operatörü, Gümrük Müşavirliği —
// product-catalog.ts#PORT_SERVICE_CATEGORY_IDS'in TAMAMI tek bir üyeyle
// (Lashing/Unlashing) temsil edilir, çünkü isTonnageRequired/requiresProductInfo
// bu üç kategoriyi AYNI kod yoluyla ele alır — konteyner-dolum-bosaltim/
// gozetim-hizmetleri'nin AYRI test edilmesi aynı, zaten kanıtlanmış kod
// yolunu tekrarlamak olurdu) için: GERÇEK UI'dan ilan oluştur, DB satırını
// anlık görüntüle (snapshot), admin GERÇEK edit formundan yalnızca başlığı
// değiştir, DB'yi tekrar oku, değişen tek alanın title olduğunu (başlık
// DIŞINDA HİÇBİR alanın değişmediğini) doğrula.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET_KEY = process.env.SB_SECRET_KEY_FOR_TEST;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const PASSWORD = "TestSifre2026!";

if (!SUPABASE_URL || !ANON_KEY || !SECRET_KEY) {
  console.error("FAIL: eksik ortam değişkeni");
  process.exit(1);
}
if (!/trfnmpihcnriqgikglpu/.test(SUPABASE_URL)) {
  console.error(`FAIL: beklenen development projeyi işaret etmiyor: ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`);
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "malsevk-admin-edit-fields-"));
function runSql(sql) {
  const filePath = path.join(scratchDir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(filePath, sql, "utf8");
  const output = execSync(`npx supabase db query --file ${filePath} --linked --output json`, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output).rows ?? [];
}
function safeRunSql(sql) {
  try {
    return runSql(sql);
  } catch (error) {
    console.error("sql failed (continuing):", error?.message || error);
    return [];
  }
}

const createdUserIds = [];
const stamp = Date.now();

async function createUser(label, role) {
  const email = `malsevk-adminedit-${label}-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${label}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: role, p_full_name: `AdminEdit ${label}`, p_phone: "+905551110097",
    p_company_name: `AdminEdit Firma ${label}`, p_company_type: "bireysel", p_province: "Kocaeli", p_district: "Gebze",
  });
  if (crError) throw new Error(`complete_registration(${label}) failed: ${crError.message}`);
  return { id: data.user.id, email };
}

async function loginAs(page, email) {
  await page.goto(`${APP_ORIGIN}/giris-yap`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 15000 });
}

async function selectFromSearchable(page, label, optionText, { exact = true, index = 0 } = {}) {
  await page.getByRole("button", { name: label, exact: true }).nth(index).click();
  const listbox = page.locator(`ul[aria-label="${label}"]`).nth(index === 0 ? 0 : index);
  await listbox.waitFor({ state: "visible" });
  await listbox.getByRole("option", { name: optionText, exact }).first().click();
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

/** Beş temsili hizmet türü — her biri product-catalog.ts/customs-brokerage-catalog.ts'deki FARKLI bir alan-görünürlük kod yolunu temsil eder. */
const SCENARIOS = [
  {
    key: "lashing",
    label: "Lashing / Unlashing (Liman Hizmetleri — tonaj İSTEĞE BAĞLI, kök neden burada)",
    category: "Lashing / Unlashing",
    fill: async (page, jobTitle) => {
      await page.getByLabel("İlan Başlığı").fill(jobTitle);
      await page.getByLabel("Hizmete Özel Açıklama").fill("Görev bölüm 13'ün birebir senaryosu — Lashing/Unlashing round-trip testi.");
      await page.getByLabel("Ürün Adedi").fill("150");
      await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
      await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
      await page.getByLabel(/^Tonaj/).fill("350");
      await selectFromSearchable(page, "İl", "Kocaeli");
      await selectFromSearchable(page, "İlçe", "Gebze");
      await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
      const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
      await listbox.waitFor({ state: "visible" });
      await listbox.getByRole("option", { name: /Listede yok/ }).first().click();
      await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Lashing Sahası");
      await page.getByLabel("Açık Adres").fill("Lashing test açık adresi, en az on karakter.");
      await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
      await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
      await uploadOnePhoto(page);
    },
  },
  {
    key: "nakliye",
    label: "Nakliye (tonaj ZORUNLU + 6 teslimat alanı)",
    category: "Nakliye",
    fill: async (page, jobTitle) => {
      await page.getByLabel("İlan Başlığı").fill(jobTitle);
      await page.getByLabel("Hizmete Özel Açıklama").fill("Nakliye round-trip testi — teslimat alanları dahil.");
      await page.getByLabel("Ürün Adedi").fill("7");
      await page.getByLabel(/^Tonaj/).fill("15");
      await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
      await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
      await selectFromSearchable(page, "İl", "Kocaeli", { index: 0 });
      await selectFromSearchable(page, "İlçe", "Gebze", { index: 0 });
      await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).first().click();
      await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').first().getByRole("option", { name: /Listede yok/ }).first().click();
      await page.getByLabel("Liman / Sanayi / OSB Adı").first().fill("Yük Alım Sahası Testi");
      await page.getByLabel("Açık Adres").first().fill("Yük alınacak açık adres, en az on karakter.");
      await page.getByText("Teslim Edilecek Yer", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await selectFromSearchable(page, "İl", "İstanbul", { index: 1 });
      await selectFromSearchable(page, "İlçe", "Kadıköy", { index: 1 });
      await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).last().click();
      await page.locator('ul[aria-label="Liman / Sanayi / OSB"]').last().getByRole("option", { name: /Listede yok/ }).first().click();
      await page.getByLabel("Liman / Sanayi / OSB Adı").last().fill("Teslim Sahası Testi");
      await page.getByLabel("Açık Adres").last().fill("Teslim edilecek açık adres, en az on karakter.");
      await page.getByLabel("Başlangıç Tarihi").fill("2026-12-05");
      await page.getByLabel("Bitiş Tarihi").fill("2026-12-07");
      await uploadOnePhoto(page);
    },
  },
  {
    key: "depolama",
    label: "Kapalı Depolama (ürün bilgisi yok, sadeleştirilmiş lokasyon — yalnızca İl/İlçe)",
    category: "Kapalı Depolama",
    fill: async (page, jobTitle) => {
      await page.getByLabel("İlan Başlığı").fill(jobTitle);
      await page.getByLabel("Hizmete Özel Açıklama").fill("Kapalı Depolama round-trip testi — ürün bilgisi kapsam dışı.");
      await selectFromSearchable(page, "İl", "Kocaeli");
      await selectFromSearchable(page, "İlçe", "Gebze");
      await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
      await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
      await uploadOnePhoto(page);
    },
  },
  {
    key: "forklift",
    label: "Forklift Operatörü (ürün bilgisi yok, tam lokasyon)",
    category: "Forklift Operatörü",
    fill: async (page, jobTitle) => {
      await page.getByLabel("İlan Başlığı").fill(jobTitle);
      await page.getByLabel("Hizmete Özel Açıklama").fill("Forklift Operatörü round-trip testi.");
      await selectFromSearchable(page, "İl", "Kocaeli");
      await selectFromSearchable(page, "İlçe", "Gebze");
      await page.getByRole("button", { name: "Liman / Sanayi / OSB", exact: true }).click();
      const listbox = page.locator('ul[aria-label="Liman / Sanayi / OSB"]');
      await listbox.waitFor({ state: "visible" });
      await listbox.getByRole("option", { name: /Listede yok/ }).first().click();
      await page.getByLabel("Liman / Sanayi / OSB Adı").fill("Test Forklift Sahası");
      await page.getByLabel("Açık Adres").fill("Forklift test açık adresi, en az on karakter.");
      await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
      await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
      await uploadOnePhoto(page);
    },
  },
  {
    key: "gumruk",
    label: "Gümrük Müşavirliği (customsProductType, sadeleştirilmiş lokasyon)",
    category: "Gümrük Müşavirliği",
    fill: async (page, jobTitle) => {
      await page.getByLabel("İlan Başlığı").fill(jobTitle);
      await page.getByLabel("Hizmete Özel Açıklama").fill("Gümrük Müşavirliği round-trip testi.");
      await selectFromSearchable(page, "İşlem Türü", "İthalat");
      await page.getByRole("combobox", { name: "Ürün Cinsi", exact: true }).click();
      await page.locator('ul[aria-label="Ürün Cinsi"]').getByRole("option", { name: "Rulo Sac", exact: true }).click();
      await selectFromSearchable(page, "İl", "Kocaeli");
      await selectFromSearchable(page, "İlçe", "Gebze");
      await page.getByLabel("Başlangıç Tarihi").fill("2026-12-01");
      await page.getByLabel("Bitiş Tarihi").fill("2026-12-03");
      await uploadOnePhoto(page);
    },
  },
];

const JOB_COLUMNS =
  "title, description, operation_details, province, district, work_location_type, address_text, work_date, work_end_date, product_quantity, product_tonnage, product_type, customs_product_type, delivery_province, delivery_district, delivery_facility_name, delivery_address_text, moderation_status";

async function main() {
  const requester = await createUser("req", "hizmet-alan");
  const adminUser = await createUser("adm", "hizmet-alan");
  runSql(`update public.profiles set role = 'admin', onboarding_completed = true where id = '${adminUser.id}';`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const scenario of SCENARIOS) {
    console.log(`\n=== ${scenario.label} ===`);
    await loginAs(page, requester.email);
    const jobTitle = `ADMINEDIT-${scenario.key.toUpperCase()}-${stamp}`;
    await page.goto(`${APP_ORIGIN}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: scenario.category });
    await scenario.fill(page, jobTitle);

    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.getByText("Operasyon Özeti").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 20000 });
    const jobId = page.url().split("/ilanlar/")[1].split("?")[0];
    record(`${scenario.key}.1 İlan gerçek UI'dan oluşturuldu`, /^[0-9a-f-]{36}$/.test(jobId), jobId);

    const before = runSql(`select ${JOB_COLUMNS} from public.jobs where id = '${jobId}';`)[0];
    record(`${scenario.key}.2 Supabase'de gerçek satır var`, Boolean(before), JSON.stringify(before));

    // Admin GERÇEK edit formundan YALNIZCA başlığı değiştirir.
    await loginAs(page, adminUser.email);
    await page.goto(`${APP_ORIGIN}/admin/ilanlar/${jobId}`);
    await page.getByText(jobTitle).first().waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "İlanı Düzenle" }).click();
    const newTitle = `${jobTitle}-DUZENLENDI`;
    const titleInput = page.locator("label", { hasText: "İlan Başlığı" }).locator("input");
    await titleInput.fill(newTitle);
    await page.getByRole("button", { name: "Değişiklikleri Kaydet" }).click();
    await page.getByText(newTitle).first().waitFor({ state: "visible", timeout: 15000 });

    const after = runSql(`select ${JOB_COLUMNS} from public.jobs where id = '${jobId}';`)[0];
    record(`${scenario.key}.3 Başlık gerçekten güncellendi`, after?.title === newTitle, after?.title);

    const unchangedKeys = Object.keys(before).filter((key) => key !== "title");
    const diffs = unchangedKeys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    record(
      `${scenario.key}.4 BAŞLIK DIŞINDA HİÇBİR alan değişmedi (${unchangedKeys.length} alan kontrol edildi)`,
      diffs.length === 0,
      diffs.length > 0 ? JSON.stringify(diffs.map((k) => ({ field: k, before: before[k], after: after[k] }))) : "fark yok",
    );

    if (scenario.key === "lashing") {
      record(
        "lashing.5 GÖREV BÖLÜM 13'ÜN TAM SENARYOSU: Tonaj=350, Adet=150, Ürün=Rulo Sac hâlâ aynen duruyor",
        after.product_tonnage === "350" || Number(after.product_tonnage) === 350,
        JSON.stringify({ tonnage: after.product_tonnage, quantity: after.product_quantity, type: after.product_type }),
      );
      record("lashing.6 Ürün Adedi de korundu", Number(after.product_quantity) === 150, after.product_quantity);
      record("lashing.7 Ürün Cinsi de korundu", after.product_type === "Rulo Sac", after.product_type);
    }
    if (scenario.key === "nakliye") {
      record(
        "nakliye.5 6 teslimat alanından (province/district/facility/address) hiçbiri kaybolmadı",
        after.delivery_province === "İstanbul" && after.delivery_district === "Kadıköy" && Boolean(after.delivery_facility_name) && Boolean(after.delivery_address_text),
        JSON.stringify({ dp: after.delivery_province, dd: after.delivery_district, dfn: after.delivery_facility_name, dat: after.delivery_address_text }),
      );
      record("nakliye.6 Tonaj (ZORUNLU alan) da korundu", Number(after.product_tonnage) === 15, after.product_tonnage);
    }
    if (scenario.key === "gumruk") {
      record("gumruk.5 Gümrük Ürün Cinsi korundu", after.customs_product_type === "Rulo Sac", after.customs_product_type);
    }
  }

  await browser.close();
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    safeRunSql(`delete from public.job_photos where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.job_activity_events where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.offers where job_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.audit_logs where actor_id in (${idList}) or entity_id in (select id from public.jobs where requester_id in (${idList}));`);
    safeRunSql(`delete from public.jobs where requester_id in (${idList});`);
    safeRunSql(`delete from public.notifications where recipient_id in (${idList});`);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  rmSync(scratchDir, { recursive: true, force: true });
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
