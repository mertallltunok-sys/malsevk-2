// Development Supabase + gerçek dev sunucusuna karşı — service-location-panel.tsx
// DÜZELTMESİNİN (rota hattı hizalama hatası) kanıtı: pin merkezi, kesikli
// çizgi merkezi, ok merkezi ve bayrak merkezi arasındaki YATAY fark
// tarayıcı ölçümüyle en fazla 1-2px olmalı. 1366x768 VE mobil ekran
// görüntüsü alınır.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const APP_ORIGIN = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "TestSifre2026!";

const PG_SCRATCH_DIR =
  "C:\\Users\\merta\\AppData\\Local\\Temp\\claude\\c--Users-merta-malsevk-2\\9e4157e5-e75d-4ce8-b194-55c7c3eac189\\scratchpad\\pg-scratch";
function runSql(sql) {
  const out = execFileSync("node", ["run-sql.mjs", sql], { cwd: PG_SCRATCH_DIR, encoding: "utf8" });
  return JSON.parse(out);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 300) : ""));
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();
const createdUserIds = [];
let createdJobId = null;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fakePhotos(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    storage_path: `naklalign/${stamp}/${index}.jpg`,
    original_file_name: `test-${index}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: 12345,
    width: null,
    height: null,
  }));
}

async function main() {
  const email = `naklaligntest-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { error: crError } = await client.rpc("complete_registration", {
    p_role: "hizmet-alan",
    p_full_name: "NaklAlignTest",
    p_phone: "+905321119911",
    p_company_name: "NaklAlignTest Firma",
    p_company_type: "bireysel",
    p_province: "Kocaeli",
    p_district: "Gebze",
  });
  if (crError) throw crError;
  record("Kurulum: hesap oluşturuldu", true);

  const { data: job, error: jobError } = await client.rpc("create_job", {
    p_category_id: "nakliye",
    p_title: "NaklAlignTest — Hizalama Testi",
    p_description: "Rota hattı hizalama testi için otomasyonla oluşturulan ilan.",
    p_operation_details: "",
    p_province: "Kocaeli",
    p_district: "Gebze",
    p_work_location_type: "Test Yükleme Tesisi",
    p_work_date: todayPlus(15),
    p_photos: fakePhotos(),
    p_address_text: "Test Yükleme Açık Adresi, Gebze",
    p_delivery_province: "İstanbul",
    p_delivery_district: "Kartal",
    p_delivery_location_type: "open_address",
    p_delivery_facility_name: "Test Teslim Tesisi",
    p_delivery_address_text: "Test Teslim Açık Adresi, Kartal",
  });
  record("Kurulum: Nakliye ilanı oluşturuldu", !jobError, jobError?.message);
  createdJobId = job?.id;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

    await page.goto(`${APP_ORIGIN}/giris-yap`, { waitUntil: "domcontentloaded", timeout: 60000 });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.getByRole("button", { name: "Giriş Yap" }).click();
      await page.waitForURL((url) => url.pathname !== "/giris-yap", { timeout: 30000 }).catch(() => {});
      if (!page.url().includes("/giris-yap")) break;
    }

    async function measureAndAssert(label) {
      await page.goto(`${APP_ORIGIN}/ilanlar/${createdJobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      let ok = await page
        .waitForFunction((t) => document.body.innerText.includes(t), "NaklAlignTest", { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await page
          .waitForFunction((t) => document.body.innerText.includes(t), "NaklAlignTest", { timeout: 30000 })
          .catch(() => {});
      }
      await page.waitForTimeout(500);

      const measurement = await page.evaluate(() => {
        // Yeni yapı (2. tur düzeltme): pin/bayrak/çizgi/ok artık AYRI
        // satırlarda değil, TEK bir paylaşılan marker sütununda
        // (`<div class="relative flex w-4 shrink-0 flex-col items-center">`).
        // Bu sütunu, "Yükleme Noktası" metninin en yakın ATASI olan
        // `.relative` sütun kardeşinden buluyoruz (metin sütunu ile marker
        // sütunu, `<div class="flex gap-2.5">` ortak ebeveyninin doğrudan
        // çocuklarıdır).
        const yukleme = Array.from(document.querySelectorAll("p")).find(
          (p) => p.textContent?.trim().toLowerCase() === "yükleme noktası",
        );
        if (!yukleme) return { found: false };
        // yukleme -> <p> -> içerik div (min-w-0 flex-1) -> LocationPoint dönüşü (hideIcon=true, doğrudan content) ->
        // içerik sütunu (flex flex-col gap-3) -> ortak satır (flex gap-2.5)
        const contentDiv = yukleme.parentElement; // min-w-0 flex-1
        const contentColumn = contentDiv?.parentElement; // flex flex-col gap-3
        const outerRow = contentColumn?.parentElement; // flex gap-2.5 (marker sütunu + içerik sütunu)
        const markerColumn = outerRow?.firstElementChild; // relative flex w-4 shrink-0 flex-col items-center
        if (!markerColumn) return { found: false, reason: "markerColumn-not-found" };

        const markerIcons = Array.from(markerColumn.querySelectorAll(":scope > svg"));
        const pinIcon = markerIcons[0] ?? null;
        const flagIcon = markerIcons[markerIcons.length - 1] ?? null;
        const overlay = markerColumn.querySelector(":scope > div.absolute");
        const arrowIcon = overlay?.querySelector("svg") ?? null;
        const dashSegments = overlay ? Array.from(overlay.querySelectorAll('span[class*="border-dashed"]')) : [];

        function centerX(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.left + r.width / 2;
        }
        function rect(el) {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
        }

        return {
          found: true,
          pinCenterX: centerX(pinIcon),
          dashCenterX: dashSegments.length > 0 ? centerX(dashSegments[0]) : null,
          arrowCenterX: centerX(arrowIcon),
          flagCenterX: centerX(flagIcon),
          dashSegmentCount: dashSegments.length,
          pinRect: rect(pinIcon),
          flagRect: rect(flagIcon),
          overlayRect: rect(overlay),
          markerColumnRect: rect(markerColumn),
          outerRowRect: rect(outerRow),
        };
      });

      record(`${label}: panel bulundu`, measurement.found, JSON.stringify(measurement));
      if (!measurement.found) return;

      const centers = [measurement.pinCenterX, measurement.dashCenterX, measurement.arrowCenterX, measurement.flagCenterX];
      const validCenters = centers.filter((c) => c !== null && c !== undefined);
      record(`${label}: pin/çizgi/ok/bayrak merkezlerinin TAMAMI ölçülebildi`, validCenters.length === 4, JSON.stringify(centers));
      if (validCenters.length === 4) {
        const maxDiff = Math.max(...validCenters) - Math.min(...validCenters);
        record(
          `${label}: pin/çizgi/ok/bayrak yatay merkez farkı <= 2px`,
          maxDiff <= 2,
          `pin=${measurement.pinCenterX?.toFixed(1)} dash=${measurement.dashCenterX?.toFixed(1)} arrow=${measurement.arrowCenterX?.toFixed(1)} flag=${measurement.flagCenterX?.toFixed(1)} fark=${maxDiff.toFixed(2)}px`,
        );
      }
      record(`${label}: iki kesikli segment (pin->ok, ok->bayrak) var`, measurement.dashSegmentCount === 2, measurement.dashSegmentCount);
    }

    const tmp = os.tmpdir();
    await page.setViewportSize({ width: 1366, height: 768 });
    await measureAndAssert("1366x768");
    await page.screenshot({ path: path.join(tmp, "nakliye-route-align-1366.png"), fullPage: false }).catch(() => {});

    await page.setViewportSize({ width: 390, height: 844 });
    await measureAndAssert("Mobil (390px)");
    await page.screenshot({ path: path.join(tmp, "nakliye-route-align-mobile.png"), fullPage: true }).catch(() => {});

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function cleanup() {
  const idList = createdUserIds.map((id) => `'${id}'`).join(",");
  if (idList) {
    try {
      if (createdJobId) {
        runSql(`delete from public.job_photos where job_id = '${createdJobId}';`);
        runSql(`delete from public.job_activity_events where job_id = '${createdJobId}';`);
        runSql(`delete from public.jobs where id = '${createdJobId}';`);
      }
      runSql(`delete from public.audit_logs where actor_id in (${idList});`);
      runSql(`delete from public.notifications where recipient_id in (${idList});`);
    } catch (error) {
      console.error("cleanup sql failed (continuing):", error?.message || error);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
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
