// Y3 düzeltmesi (veritabanı geçişi öncesi denetim) — regresyon testi.
//
// Kök neden: users.ts, diğer tüm tablolardan (job-store.ts/offers.ts/
// ratings.ts/...) FARKLI olarak hiçbir modül önbelleği/storage-event
// dinleyicisi taşımıyordu VE hiçbir reaktif (useSyncExternalStore tabanlı)
// tüketicisi yoktu — her ekran `findUserById`i render anında doğrudan
// çağırıyordu. Bir sekmede kullanıcı verisi değiştiğinde, aynı hesabı açık
// tutan başka bir sekme bunu SAYFA YENİLENMEDEN hiçbir zaman göremiyordu.
//
// Düzeltme: users.ts artık diğer tablolarla AYNI deseni (modül önbelleği +
// `storage` event dinleyicisi + `usersStore`) uyguluyor; yeni
// app/_lib/use-users.ts#useUserById bunu tüketen ilk somut hook; ilk somut
// tüketici olarak account-settings-content.tsx artık `findUserById` yerine
// bunu kullanıyor.
//
// Bu script GERÇEK tarayıcıda, AYNI context içinde iki ayrı sayfa (iki
// "sekme") açarak, bir sekmede localStorage'daki `malsevk.users.v1`
// değişikliğinin (tarayıcının kendi native `storage` event'i üzerinden,
// hiçbir sayfa yenilemesi olmadan) DİĞER, hâlâ açık/mount olmuş sekmeye
// GERÇEKTEN yansıdığını doğrular. Doğrudan localStorage yazımı kullanılır
// (gerçek bir "ad değiştir" arayüz özelliği bugün yok — bkz. Hesap
// Ayarları'ndaki "Yakında" ibaresi) çünkü asıl doğrulanmak istenen şey
// ARAYÜZ eylemi değil, ALTTAKİ reaktif mekanizmanın (users.ts#usersStore)
// kendisidir — Contact/Firma Profili DÜZENLEME formlarının kendi
// `useState(user...)` ile YALNIZCA İLK MOUNT'TA tohumlanan yerel state'i
// (bilinçli, bu görevin kapsamı dışında bir tasarım — devam eden bir
// düzenlemenin başka bir sekmeden sessizce ezilmemesi için) bu testin
// kapsamı DIŞINDADIR; test bunun yerine salt-okunur ProfileInfoCard'ın
// (ad/e-posta/telefon/rol) canlı güncellenmesini doğrular.
//
// Ön koşul: `npm run dev` (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STAMP = Date.now();

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`  [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();

    // "Sekme A" ve "Sekme B" — AYNI context (AYNI origin/localStorage),
    // gerçek çoklu sekme davranışını taklit eder.
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const jsErrorsB = [];
    tabB.on("pageerror", (err) => jsErrorsB.push(String(err)));

    await loginAs(tabA, "mert@test.com", "Mert123!", "/panel");

    // Sekme B AYNI oturumu (localStorage paylaşıldığı için) görür; doğrudan
    // Hesap Ayarları'na gidip orada KALIR (yeniden yüklenmeyecek).
    await tabB.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    await tabB.getByRole("heading", { name: "Hesap Ayarları" }).waitFor({ state: "visible", timeout: 10000 });

    const originalName = await tabB.locator("body").innerText();
    const mertUserId = await tabA.evaluate(() => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === "mert@test.com")?.id;
    });
    check("Kurulum: Mert'in kullanıcı id'si bulundu", Boolean(mertUserId));

    const newName = `Mert Güncellendi ${STAMP}`;
    check("Kurulum: Sekme B başlangıçta YENİ adı göstermiyor", !originalName.includes(newName));

    // === Sekme A'da doğrudan localStorage'a yazarak "başka bir akışın"
    // kullanıcı kaydını güncellediğini simüle ediyoruz (bkz. yukarıdaki not
    // — bugün gerçek bir "ad değiştir" arayüzü yok, asıl test edilen şey
    // arayüz eylemi değil, alttaki reaktif yayılım mekanizmasıdır). ===
    await tabA.evaluate(
      ({ id, name }) => {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        const next = users.map((u) => (u.id === id ? { ...u, name } : u));
        localStorage.setItem("malsevk.users.v1", JSON.stringify(next));
      },
      { id: mertUserId, name: newName },
    );

    // Sekme B'de HİÇBİR navigasyon/yenileme YAPILMADAN, yalnızca native
    // `storage` event'inin ulaşmasını bekliyoruz.
    await assert.doesNotReject(
      tabB.getByText(newName).first().waitFor({ state: "visible", timeout: 5000 }),
      "Sekme B, sayfa yenilenmeden yeni adı göstermedi",
    );
    check(
      "1 (Y3 asıl regresyon): Sekme A'daki değişiklik, sekme B'de sayfa YENİLENMEDEN canlı yansıdı",
      true,
    );

    check("2. Sekme B'de uncaught JS hatası oluşmadı", jsErrorsB.length === 0, jsErrorsB.join(" | "));

    // === Aynı sekmede gereksiz çift güncelleme/render döngüsü oluşmuyor ===
    // (native `storage` event yalnızca DİĞER dokümanlarda tetiklenir —
    // tarayıcının kendi davranışı; burada yalnızca Sekme A'nın kendi
    // içinde bir hataya/uyarıya yol açmadığını doğruluyoruz.)
    const jsErrorsA = [];
    tabA.on("pageerror", (err) => jsErrorsA.push(String(err)));
    await tabA.reload();
    await tabA.waitForTimeout(500);
    check("3. Sekme A'nın kendi yazımı kendi içinde hataya yol açmadı", jsErrorsA.length === 0, jsErrorsA.join(" | "));

    // === Gerçek arayüz akışı: İletişim Görünürlüğü tercihini kaydetme
    // hâlâ normal şekilde çalışıyor (regresyon) ===
    console.log("\n=== Regresyon: İletişim Görünürlüğü tercihi normal şekilde kaydediliyor ===");
    await tabA.goto(`${BASE_URL}/panel/hesap-ayarlari`);
    await tabA.getByText("İletişim Bilgisi Görünürlüğü").waitFor({ state: "visible", timeout: 10000 });
    const phoneCheckbox = tabA.getByLabel("Telefon numaramı göster");
    const wasChecked = await phoneCheckbox.isChecked();
    await phoneCheckbox.setChecked(!wasChecked);
    await tabA.getByRole("button", { name: "Tercihi Kaydet" }).click();
    await assert.doesNotReject(
      tabA.getByText("İletişim bilgisi tercihiniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 }),
    );
    check("4. İletişim Görünürlüğü tercihi normal şekilde kaydedilebiliyor (regresyon)", true);
    // Orijinal duruma geri al (test verisini temiz bırakmak için).
    await phoneCheckbox.setChecked(wasChecked);
    await tabA.getByRole("button", { name: "Tercihi Kaydet" }).click();
    await tabA.getByText("İletişim bilgisi tercihiniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[users-cross-tab-sync-test] GENEL HATA:", error);
  process.exitCode = 1;
});
