// node scripts/tmp-incoming-offers-category-gap-reflow-test.mjs
//
// "Gelen Teklifler" ekranındaki kategori kutularının (incoming-offers-panel.tsx)
// KALDIRMA/YENİDEN GÖRÜNME sonrası GEOMETRİK yeniden yerleşimini (masonry
// reflow) uçtan uca, GERÇEK piksel ölçümüyle doğrular. Kategori
// gruplama/görünürlük mantığının KENDİSİ zaten
// tmp-incoming-offers-category-grouping-live-test.mjs ve
// tmp-incoming-offers-hide-settled-status-test.mjs'de kanıtlanmıştır — bu
// script SADECE bir kutu kalktığında/geri geldiğinde geriye kalan kutuların
// VE sayfa footer'ının GERÇEKTEN boşluksuz yeniden dizilip dizilmediğini
// (bounding box tabanlı) test eder.
//
// KÖK NEDEN (bu testin var olma sebebi): standart CSS grid (`grid-cols-2`)
// her "satırın" yüksekliğini o satırdaki EN UZUN hücreye göre belirler —
// aynı satırdaki kısa bir kutunun ALTI, bir SONRAKİ satır başlayana kadar
// asla doldurulmaz. Kategori kutuları içerik bazlı FARKLI yüksekliklerde
// olduğu için (burada KASITLI olarak "Lashing" iki ilan grubuyla diğer
// kategorilerden belirgin biçimde uzun tutulur), bu satır-yükseklik
// eşleşmesi bir kutu kaldırıldığında/eklendiğinde büyük, kalıcı boşluklara
// yol açıyordu. incoming-offers-panel.tsx artık bunun yerine native CSS
// multi-column (`columns-2` + `break-inside-avoid-column` + `space-y-6`)
// kullanıyor; bu test o düzeltmenin GERÇEKTEN çalıştığını ölçülebilir
// biçimde kanıtlar — özellikle: (a) aynı sütundaki ardışık iki kutu arasında
// asla `gap-6`in birkaç katından fazla boşluk olmamalı, (b) footer'ın
// kategori kutularının altına olan mesafesi kaç kutu kaldırılırsa
// kaldırılsın SABİT kalmalı (kaldırılan kutunun eski yüksekliği footer'ı
// aşağıda "hapsetmemeli").
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function registerRealUser(page, { firstName, lastName, email, phone, role, companyName, password }) {
  await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
  await page.getByRole("tab", { name: "Kayıt Ol", exact: true }).click();
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  const roleLabel = role === "hizmet-alan" ? "Hizmet Alan" : "Hizmet Veren";
  await page.getByRole("radio", { name: roleLabel, exact: true }).check();
  await page.getByLabel("Telefon Numarası", { exact: true }).fill(phone);
  await page.getByLabel("Firma Adı", { exact: true }).fill(companyName);
  const companyTypeLabel = role === "hizmet-veren" ? "Hizmet Veren Tipi" : "Kullanıcı Tipi";
  await page.getByLabel(companyTypeLabel, { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "İl", exact: true }).first().click();
  await page.locator('ul[aria-label="İl"]').first().getByRole("option", { name: "Kocaeli", exact: true }).click();
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar", { exact: true }).fill(password);
  await page.getByLabel(/KVKK/).check();
  await page.getByLabel(/Kullanım Koşulları/).check();
  await page.getByRole("button", { name: "Hesap Oluştur", exact: true }).click();
  await page.getByText("Kaydınız başarıyla oluşturuldu.", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await loginAs(page, email, password);
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    ),
  });
  await page.locator("text=/1\\s*\\/\\s*10/").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

/** GERÇEK ilan oluşturma formu üzerinden, verilen kategori id'siyle tek servisli bir ilan yayınlar. */
async function createRealJobViaForm(page, { category, title, description }) {
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });

  await page.getByLabel("Hizmet Kategorisi").first().selectOption(category);
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill(description);
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-09-01");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-09-02");
  await page.getByRole("button", { name: "İlçe", exact: true }).first().click();
  await page.locator('ul[aria-label="İlçe"]').first().waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').first().getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).first().click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').first().waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .first()
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await page.getByLabel("Açık Adres").first().fill("Boşluk yerleşim testi mahallesi, cadde no:1, Dilovası");
  await page.getByLabel("Operasyon Detayları").fill("Gelen Teklifler boşluk/yeniden dizilim testi, en az on karakter.");
  await uploadOnePhoto(page);
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla", exact: true }).click();
  await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
  return page.url().split("/ilanlar/")[1];
}

async function submitRealOffer(page, jobId, amount, description) {
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Teklif Fiyatı").fill(String(amount));
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 gün");
  await page.getByLabel("Teklif Açıklaması").fill(description);
  await page.getByRole("button", { name: "Teklif Gönder", exact: true }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
}

function amountText(amount) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}

function offerCard(page, amount) {
  return page.locator("div.rounded-card").filter({ hasText: amountText(amount) });
}

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => {
    const originalX = window.scrollX;
    window.scrollTo(99999, window.scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(originalX, window.scrollY);
    return scrolledX === 0;
  });
}

/** Sayfadaki TÜM kategori kutularının (section) başlık metni + bounding box'ını DOM sırasıyla döner. */
async function getCategoryBoxes(page) {
  const sections = page.locator("section:not(.bg-background)");
  const count = await sections.count();
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const section = sections.nth(i);
    const heading = await section.getByRole("heading", { level: 2 }).first().innerText();
    const box = await section.boundingBox();
    assert.ok(box, `'${heading}' kategori kutusunun bounding box'ı olmalı`);
    boxes.push({ heading, box });
  }
  return boxes;
}

/** x koordinatına göre kutuları "sütun" kümelerine ayırır (aynı sütun ~ aynı x, 5px tolerans). */
function clusterColumns(boxes) {
  const columns = [];
  for (const item of boxes) {
    const col = columns.find((c) => Math.abs(c.x - item.box.x) < 5);
    if (col) col.items.push(item);
    else columns.push({ x: item.box.x, items: [item] });
  }
  return columns;
}

function maxBottom(boxes) {
  return Math.max(...boxes.map((b) => b.box.y + b.box.height));
}

/**
 * HER sütun içinde, dikey olarak ardışık iki kutu arasındaki boşluğun
 * tasarımdaki `gap-6`/`space-y-6` (~24px) ölçeğinde kaldığını doğrular —
 * kaldırılan bir kutunun eski satır yüksekliğinden kalma BÜYÜK bir boşluk
 * varsa bu, gap değerinin onlarca/yüzlerce piksele fırlamasıyla yakalanır.
 */
function assertTightColumns(boxes, label) {
  const columns = clusterColumns(boxes);
  for (const column of columns) {
    const sorted = [...column.items].sort((a, b) => a.box.y - b.box.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].box.y - (sorted[i].box.y + sorted[i].box.height);
      assert.ok(
        gap >= -2 && gap <= 40,
        `${label}: '${sorted[i].heading}' ile '${sorted[i + 1].heading}' arasında beklenmeyen boşluk: ${Math.round(gap)}px (sütun x=${Math.round(column.x)})`,
      );
    }
  }
}

let browser;
let profileDir;

async function main() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "malsevk-incoming-offers-gap-reflow-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1440, height: 1400 },
  });
  browser = context.browser();
  const page = await context.newPage();

  const suffix = crypto.randomUUID().slice(0, 8);
  const AMOUNTS = {
    lashingA: 31000,
    lashingB: 32000,
    unlashing: 33000,
    konteyner: 34000,
    forklift: 35000,
    depo: 36000,
    reappearMiddle: 37000,
    reappearLast: 38000,
  };

  // =====================================================================
  // KURULUM: 1 talep sahibi + 6 ilan. "Lashing" kategorisinde İKİ ayrı ilan
  // (=> "Lashing" kutusu İKİ ilan grubu içerir, diğer 4 kategori TEK ilan
  // grubuyla belirgin biçimde daha KISA kalır) — bu KASITLI yükseklik farkı
  // olmadan standart grid'in "satır yüksekliği" hatası hiç tetiklenmez.
  // =====================================================================
  const requesterEmail = `gap-reflow-${suffix}@example.com`;
  await registerRealUser(page, {
    firstName: "Boşluk",
    lastName: "TestSahibi",
    email: requesterEmail,
    phone: "+905556660000",
    role: "hizmet-alan",
    companyName: "Boşluk Testi Firması",
    password: "BoslukTest1!",
  });

  const jobLashingAId = await createRealJobViaForm(page, {
    category: "lashing",
    title: `Boşluk Lashing A ${suffix}`,
    description: "Lashing A açıklaması, en az yirmi karakter içerir.",
  });
  const jobLashingBId = await createRealJobViaForm(page, {
    category: "lashing",
    title: `Boşluk Lashing B ${suffix}`,
    description: "Lashing B açıklaması, en az yirmi karakter içerir.",
  });
  const jobUnlashingId = await createRealJobViaForm(page, {
    category: "unlashing",
    title: `Boşluk Unlashing ${suffix}`,
    description: "Unlashing açıklaması, en az yirmi karakter içerir.",
  });
  const jobKonteynerId = await createRealJobViaForm(page, {
    category: "konteyner-bosaltim",
    title: `Boşluk Konteyner ${suffix}`,
    description: "Konteyner boşaltım açıklaması, en az yirmi karakter.",
  });
  const jobForkliftId = await createRealJobViaForm(page, {
    category: "forklift",
    title: `Boşluk Forklift ${suffix}`,
    description: "Forklift açıklaması, en az yirmi karakter içerir.",
  });
  const jobDepoId = await createRealJobViaForm(page, {
    category: "genel-depolama",
    title: `Boşluk Depo ${suffix}`,
    description: "Genel depolama açıklaması, en az yirmi karakter.",
  });
  ok("KURULUM: 6 ilan (Lashing A+B, Unlashing, Konteyner Boşaltım, Forklift, Genel Depolama) GERÇEK formla oluşturuldu");

  let providerCounter = 0;
  async function newProviderOffer(label, jobId, amount, description) {
    providerCounter += 1;
    await registerRealUser(page, {
      firstName: "Sağlayıcı",
      lastName: label,
      email: `gap-saglayici-${label.toLowerCase()}-${suffix}@example.com`,
      phone: `+90556${String(2000 + providerCounter).padStart(7, "0")}`,
      role: "hizmet-veren",
      companyName: `Sağlayıcı ${label}`,
      password: "GapSaglayici1!",
    });
    await submitRealOffer(page, jobId, amount, description);
  }

  await newProviderOffer("Bir", jobLashingAId, AMOUNTS.lashingA, "Lashing A teklifi, yirmi karakterden uzun bir açıklama.");
  await newProviderOffer("Iki", jobLashingBId, AMOUNTS.lashingB, "Lashing B teklifi, yirmi karakterden uzun bir açıklama.");
  await newProviderOffer("Uc", jobUnlashingId, AMOUNTS.unlashing, "Unlashing teklifi, yirmi karakterden uzun bir açıklama.");
  await newProviderOffer("Dort", jobKonteynerId, AMOUNTS.konteyner, "Konteyner teklifi, yirmi karakterden uzun bir açıklama.");
  await newProviderOffer("Bes", jobForkliftId, AMOUNTS.forklift, "Forklift teklifi, yirmi karakterden uzun bir açıklama.");
  await newProviderOffer("Alti", jobDepoId, AMOUNTS.depo, "Depo teklifi, yirmi karakterden uzun bir açıklama.");
  ok("KURULUM: 6 teklif, 6 AYRI sağlayıcı hesabıyla GERÇEK teklif formundan gönderildi");

  await loginAs(page, requesterEmail, "BoslukTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(150);

  // Hangi ilan/kategori hangi tekliflerle temsil ediliyor — kaldırma
  // adımlarında hangi tutarların "Reddet" butonuna basılacağını bulmak için.
  const categoryOffers = {
    Lashing: [AMOUNTS.lashingA, AMOUNTS.lashingB],
    Unlashing: [AMOUNTS.unlashing],
    "Konteyner Boşaltım": [AMOUNTS.konteyner],
    Forklift: [AMOUNTS.forklift],
    "Genel Depolama": [AMOUNTS.depo],
  };
  const jobIdByCategory = {
    Lashing: jobLashingAId, // yeniden-görünme testinde kullanılan ilk ilan
    Unlashing: jobUnlashingId,
    "Konteyner Boşaltım": jobKonteynerId,
    Forklift: jobForkliftId,
    "Genel Depolama": jobDepoId,
  };

  async function rejectCategory(categoryLabel) {
    const amounts = categoryOffers[categoryLabel];
    for (const amount of amounts) {
      await offerCard(page, amount).getByRole("button", { name: "Reddet", exact: true }).click();
    }
    await page.getByRole("heading", { level: 2, name: categoryLabel, exact: true }).waitFor({ state: "hidden", timeout: 10000 });
  }

  // =====================================================================
  // BAŞLANGIÇ: tüm 5 kategori kutusu görünürken yerleşim doğru mu?
  // =====================================================================
  let boxes = await getCategoryBoxes(page);
  assert.equal(boxes.length, 5, "BAŞLANGIÇ: 5 AYRI kategori kutusu görünmeli (Lashing iki ilanla TEK kutuda birleşir)");
  const lashingBaseline = boxes.find((b) => b.heading === "Lashing");
  assert.ok(lashingBaseline, "BAŞLANGIÇ: Lashing kategori kutusu bulunmalı");
  for (const box of boxes) {
    if (box.heading === "Lashing") continue;
    assert.ok(
      lashingBaseline.box.height > box.box.height + 20,
      `Test senaryosunun anlamlı olması için Lashing (2 ilan grubu) diğer kategorilerden (${box.heading}, 1 ilan grubu) belirgin biçimde daha uzun olmalı — ölçülen Lashing=${lashingBaseline.box.height}px, ${box.heading}=${box.box.height}px`,
    );
  }
  assertTightColumns(boxes, "BAŞLANGIÇ (5 kutu, tümü görünür)");
  const footerBaselineBox = await page.locator("footer").boundingBox();
  assert.ok(footerBaselineBox, "footer bounding box'ı olmalı");
  const footerGapBaseline = footerBaselineBox.y - maxBottom(boxes);
  assert.ok(
    footerGapBaseline >= 0 && footerGapBaseline < 400,
    `footer boşluğu makul bir sabit olmalı, ölçülen: ${Math.round(footerGapBaseline)}px`,
  );
  const halfColumnWidthReference = lashingBaseline.box.width;
  ok(
    `BAŞLANGIÇ: 5 kategori kutusu arasında/altında boşluksuz (sütun-içi ardışık boşluk <=40px) düzen kuruldu; footer referans boşluğu ${Math.round(footerGapBaseline)}px olarak kaydedildi`,
  );

  /**
   * Her ADIM'dan sonra çağrılır — beklenen kategori kümesinin göründüğünü,
   * sütun-içi boşlukların sıkı kaldığını VE footer'ın DOĞRU konumda
   * olduğunu doğrular. Footer'ın "doğru konumu" İKİ adaydan büyük olanıdır:
   * (a) `naturalFooterY` — içeriğin hemen altı (`maxBottom` + BAŞLANGIÇ'ta
   * ölçülen sabit boşluk `footerGapBaseline`), (b) `pinnedFooterY` — site
   * genelinde kullanılan "sticky footer" düzeni (`app/layout.tsx`: `body`
   * `flex min-h-full flex-col`, `main` `flex-1`) yüzünden içerik viewport'tan
   * KISA kaldığında footer'ın viewport'un en altına sabitlenmesi (bu, bu
   * TESTİN hatası DEĞİL, uygulamanın KASITLI/mevcut düzeni — çok az kategori
   * kaldığında content kısa kalıp footer viewport altına sabitlenebilir).
   * `Math.max` bu iki BAĞIMSIZ tahminin büyüğünü alır: içerik viewport'tan
   * uzunsa (a) baskın olur ve eski satır-yükseklik hatasını hâlâ yakalar
   * (kaldırılan bir kutunun ardından footer beklenenden daha aşağıdaysa bu
   * iki tahminin HİÇBİRİYLE eşleşmez ve assertion başarısız olur); içerik
   * kısaysa (b) baskın olur ve YANLIŞ pozitif üretmez.
   */
  async function assertSnapshot(expectedLabels, label) {
    const currentBoxes = await getCategoryBoxes(page);
    const headings = currentBoxes.map((b) => b.heading).sort();
    assert.deepEqual(headings, [...expectedLabels].sort(), `${label}: görünen kategori kutuları beklenenle eşleşmeli`);
    if (currentBoxes.length > 0) {
      assertTightColumns(currentBoxes, label);
      const footerBox = await page.locator("footer").boundingBox();
      const viewport = page.viewportSize();
      const naturalFooterY = maxBottom(currentBoxes) + footerGapBaseline;
      const pinnedFooterY = viewport ? viewport.height - footerBox.height : naturalFooterY;
      const expectedFooterY = Math.max(naturalFooterY, pinnedFooterY);
      assert.ok(
        Math.abs(footerBox.y - expectedFooterY) <= 30,
        `${label}: footer, içeriğin hemen altına (${Math.round(naturalFooterY)}px) YA DA (içerik kısaysa) viewport altına sabitlenmiş (${Math.round(pinnedFooterY)}px) konuma denk gelmeli — ölçülen: ${Math.round(footerBox.y)}px. Sapma varsa kaldırılan bir kutunun eski yüksekliği footer'ı hâlâ aşağı itiyor demektir`,
      );
    }
    return currentBoxes;
  }

  // =====================================================================
  // ADIM 1 — "İlk sıradaki bir şablon kaldırıldığında alt şablonlar yukarı
  // çıkmalı": DOM sırasındaki İLK kategori kutusunu kaldır.
  // =====================================================================
  const remaining = new Set(Object.keys(categoryOffers));
  const firstLabel = boxes[0].heading;
  await rejectCategory(firstLabel);
  remaining.delete(firstLabel);
  await assertSnapshot(remaining, `ADIM 1 (ilk sıradaki '${firstLabel}' kaldırıldı)`);
  ok(`ADIM 1: İlk sıradaki kategori ('${firstLabel}') kaldırıldığında kalan ${remaining.size} kutu boşluksuz yeniden dizildi`);

  // =====================================================================
  // ADIM 2 — "Ortadaki bir şablon kaldırıldığında eski alan boş kalmamalı":
  // MEVCUT DOM sırasının ortasındaki kategoriyi kaldır.
  // =====================================================================
  let currentBoxes = await getCategoryBoxes(page);
  const middleIndex = Math.floor((currentBoxes.length - 1) / 2);
  const middleLabel = currentBoxes[middleIndex].heading;
  await rejectCategory(middleLabel);
  remaining.delete(middleLabel);
  await assertSnapshot(remaining, `ADIM 2 (ortadaki '${middleLabel}' kaldırıldı)`);
  ok(`ADIM 2: Ortadaki kategori ('${middleLabel}') kaldırıldığında eski alanı boş bırakmadan kalan ${remaining.size} kutu yeniden dizildi`);

  // =====================================================================
  // ADIM 3 — "Sol sütundaki bir şablon kaldırıldığında kalanlar boşluğu
  // doldurmalı": MEVCUT sütun kümelerinden SOL sütunun EN ALTTAKİ kutusunu
  // kaldır (sütun ataması içeriğe göre dinamik olduğundan, kaldırılacak
  // kutu ÖNCE gerçek ölçümle belirlenir, isim varsayılmaz).
  // =====================================================================
  currentBoxes = await getCategoryBoxes(page);
  let columns = clusterColumns(currentBoxes).sort((a, b) => a.x - b.x);
  assert.ok(columns.length >= 2, "ADIM 3: bu noktada masaüstünde İKİ sütun aktif olmalı");
  const leftColumn = columns[0];
  const leftBottomItem = [...leftColumn.items].sort((a, b) => b.box.y - a.box.y)[0];
  await rejectCategory(leftBottomItem.heading);
  remaining.delete(leftBottomItem.heading);
  await assertSnapshot(remaining, `ADIM 3 (sol sütundaki '${leftBottomItem.heading}' kaldırıldı)`);
  ok(`ADIM 3: Sol sütundaki kategori ('${leftBottomItem.heading}') kaldırıldığında kalan ${remaining.size} kutu boşluğu doldurdu`);

  // =====================================================================
  // ADIM 4 — "Sağ sütundaki bir şablon kaldırıldığında kalanlar boşluğu
  // doldurmalı": aynı mantık, SAĞ sütun.
  // =====================================================================
  currentBoxes = await getCategoryBoxes(page);
  columns = clusterColumns(currentBoxes).sort((a, b) => a.x - b.x);
  assert.ok(columns.length >= 2, "ADIM 4: bu noktada hâlâ İKİ sütun aktif olmalı (2 kutu kaldı)");
  const rightColumn = columns[columns.length - 1];
  const rightItem = [...rightColumn.items].sort((a, b) => b.box.y - a.box.y)[0];
  await rejectCategory(rightItem.heading);
  remaining.delete(rightItem.heading);
  await assertSnapshot(remaining, `ADIM 4 (sağ sütundaki '${rightItem.heading}' kaldırıldı)`);
  ok(`ADIM 4: Sağ sütundaki kategori ('${rightItem.heading}') kaldırıldığında kalan ${remaining.size} kutu boşluğu doldurdu`);

  // =====================================================================
  // ADIM 5 — tam olarak TEK kategori kaldığında hâlâ TAM GENİŞLİĞE geçmeli
  // (iki sütunun yarısında durmamalı) — bu davranış DEĞİŞTİRİLMEDİ, sadece
  // yeni masonry dalının yanlışlıkla bozmadığını doğruluyoruz.
  // =====================================================================
  assert.equal(remaining.size, 1, "ADIM 5: bu noktada tam olarak 1 kategori kalmalı");
  const lastLabel = [...remaining][0];
  currentBoxes = await getCategoryBoxes(page);
  const lastBox = currentBoxes.find((b) => b.heading === lastLabel);
  assert.ok(lastBox, "ADIM 5: son kalan kategori kutusu bulunmalı");
  assert.ok(
    lastBox.box.width > halfColumnWidthReference * 1.5,
    `ADIM 5: tek kategori kaldığında kutu TAM GENİŞLİĞE geçmeli (yarım sütun genişliğinde kalmamalı) — referans yarım-sütun genişliği ${Math.round(halfColumnWidthReference)}px, ölçülen: ${Math.round(lastBox.box.width)}px`,
  );
  ok(`ADIM 5: Tam olarak tek kategori ('${lastLabel}') kaldığında kutu tam genişliğe geçti (${Math.round(lastBox.box.width)}px)`);

  // =====================================================================
  // ADIM 6 — "Son şablon kaldırıldığında footer doğru konumda başlamalı":
  // son kalan kategoriyi de kaldır -> boş ekran mesajı görünmeli, footer
  // devasa bir boşluk bırakmadan hemen altında başlamalı.
  // =====================================================================
  await rejectCategory(lastLabel);
  remaining.delete(lastLabel);
  await page.getByText("Henüz gelen teklif yok.", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const emptyStateBox = await page
    .getByText("Henüz gelen teklif yok.", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
    .boundingBox();
  assert.ok(emptyStateBox, "boş ekran kutusunun bounding box'ı olmalı");
  const footerAfterAllRemoved = await page.locator("footer").boundingBox();
  const viewportAfterAllRemoved = page.viewportSize();
  // Aynı İKİ-aday mantığı (bkz. assertSnapshot'ın dokümantasyonu): boş ekran
  // kutusu tek başına viewport'u doldurmayacak kadar kısa olduğundan burada
  // `pinnedFooterY` (sticky footer, app/layout.tsx) neredeyse KESİN baskın
  // çıkar — bu YANLIŞ pozitif değil, sitenin KASITLI düzeni.
  const naturalEmptyStateFooterY = emptyStateBox.y + emptyStateBox.height + footerGapBaseline;
  const pinnedEmptyStateFooterY = viewportAfterAllRemoved
    ? viewportAfterAllRemoved.height - footerAfterAllRemoved.height
    : naturalEmptyStateFooterY;
  const expectedEmptyStateFooterY = Math.max(naturalEmptyStateFooterY, pinnedEmptyStateFooterY);
  assert.ok(
    Math.abs(footerAfterAllRemoved.y - expectedEmptyStateFooterY) <= 30,
    `ADIM 6: son kategori de kaldırıldığında footer, boş-ekran kutusunun hemen altına (${Math.round(naturalEmptyStateFooterY)}px) YA DA viewport altına sabitlenmiş (${Math.round(pinnedEmptyStateFooterY)}px) konuma denk gelmeli — ölçülen: ${Math.round(footerAfterAllRemoved.y)}px`,
  );
  ok("ADIM 6: Son kategori de kaldırıldığında boş-ekran mesajı göründü, footer devasa/açıklanamayan bir boşluk bırakmadan doğru konumda başladı");

  // =====================================================================
  // ADIM 7 — "Yeni teklif geldiği için daha önce kaldırılan bir şablon
  // yeniden görünür olduğunda düzen tekrar hatasız kurulmalı": daha önce
  // kaldırılan İKİ farklı kategoriye (ortadaki + ilk sıradaki) YENİ birer
  // sağlayıcıdan taze teklif gönder — ikisi de geri gelmeli.
  // =====================================================================
  await newProviderOffer(
    "Yedi",
    jobIdByCategory[middleLabel],
    AMOUNTS.reappearMiddle,
    "Yeniden görünme testi teklifi (ortadaki kategori), yirmi karakterden uzun.",
  );
  await newProviderOffer(
    "Sekiz",
    jobIdByCategory[firstLabel],
    AMOUNTS.reappearLast,
    "Yeniden görünme testi teklifi (ilk sıradaki kategori), yirmi karakterden uzun.",
  );
  // newProviderOffer, oturumu son sağlayıcı hesabına ("Sekiz") geçirdi —
  // Gelen Teklifler yalnızca Hizmet Alan'a açık olduğundan, kontrol etmeden
  // önce talep sahibi hesabına GERİ dönmek gerekir.
  await loginAs(page, requesterEmail, "BoslukTest1!", "/panel/gelen-teklifler");
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(150);
  await assertSnapshot(new Set([middleLabel, firstLabel]), "ADIM 7 (iki kategori yeniden göründü)");
  ok(`ADIM 7: Yeni teklif gelince '${middleLabel}' ve '${firstLabel}' kategori kutuları hatasız, boşluksuz biçimde yeniden kuruldu`);
  // Bu iki kategorinin ESKİ teklifleri (categoryOffers'daki eski tutarlar)
  // hâlâ reddedilmiş durumda ve bir daha ASLA görünmeyecek — ADIM 8'in
  // (aşağıda) doğru kartı reddedebilmesi için haritayı TAZE tekliflerin
  // tutarlarıyla güncelliyoruz.
  categoryOffers[middleLabel] = [AMOUNTS.reappearMiddle];
  categoryOffers[firstLabel] = [AMOUNTS.reappearLast];

  // =====================================================================
  // ADIM 8 — "Mobil ve masaüstü görünümde aynı kurallar çalışmalı": mobil
  // genişlikte tek sütun + boşluksuz dizilim + yatay taşma yok; mobilde de
  // bir kategori kaldırıldığında aynı kurallar geçerli olmalı.
  // =====================================================================
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(150);
  let mobileBoxes = await getCategoryBoxes(page);
  assert.equal(mobileBoxes.length, 2, "ADIM 8: mobilde de aynı 2 kategori kutusu görünmeli");
  const mobileColumns = clusterColumns(mobileBoxes);
  assert.equal(mobileColumns.length, 1, "ADIM 8: 375px genişlikte kutular TEK sütunda (aynı x) olmalı");
  assertTightColumns(mobileBoxes, "ADIM 8 (mobil, 2 kutu)");
  assert.ok(await hasNoHorizontalOverflow(page), "ADIM 8: 375px genişlikte yatay taşma OLMAMALI");
  ok("ADIM 8: Mobilde (375px) iki kategori kutusu tek sütunda, boşluksuz ve yatay taşma olmadan diziliyor");

  // Mobilde de bir kategori kaldırıldığında aynı kural (masaüstündekiyle
  // AYNI footer-referans mesafesi) geçerli mi? Mobil sayfa dikey padding'i
  // (`py-16`) breakpoint'e göre değişmediği için BAŞLANGIÇ referansıyla
  // (footerGapBaseline) karşılaştırmak GEÇERLİDİR.
  const mobileRemainingLabel = mobileBoxes.map((b) => b.heading).find((h) => h !== middleLabel) ?? firstLabel;
  await rejectCategory(mobileRemainingLabel === middleLabel ? firstLabel : middleLabel);
  await assertSnapshot(new Set([mobileRemainingLabel]), "ADIM 8 (devam, mobilde bir kategori daha kaldırıldı)");
  assert.ok(await hasNoHorizontalOverflow(page), "ADIM 8 (devam): kaldırma sonrası da 375px'te yatay taşma OLMAMALI");
  ok("ADIM 8 (devam): Mobilde de bir kategori kaldırıldığında aynı boşluksuz/footer kuralı geçerli kaldı");

  await context.close();
  console.log(`\n[tmp-incoming-offers-category-gap-reflow-test] ${passed} test geçti.`);
}

main()
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (browser) await browser.close();
    } catch {
      // yok say
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // yok say
    }
  });
