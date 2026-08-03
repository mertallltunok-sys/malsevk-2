// Hizmet Veren kayıt akışına eklenen "Verdiğiniz Hizmetler" / "Faaliyet
// Belgesi Yükle" / "Belge Doğruluk Beyanı" alanlarının ve buna bağlı
// provider-services.ts / provider-documents.ts / provider-document-consents.ts
// / provider-document-reviews.ts localStorage tablolarının ve Admin > Hizmet
// Veren Belge Kontrolü (app/admin) panelinin uçtan uca doğrulaması. Gerçek
// yeni kullanıcılar oluşturur (mevcut demo hesaplara dokunmaz), her
// çalıştırmada benzersiz e-posta kullanılır.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const RUN_ID = Date.now();
const ADMIN = { email: "admin@test.com", password: "Admin123!" };
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

// login-form.tsx dev-seed hesapları (Zeynep/Mert/Mehmet Demir/Admin)
// mount sonrası bir useEffect içinde ASENKRON (crypto.subtle.digest'e bağlı)
// olarak yazılır — bir dev-seed hesabıyla giriş denemesi bu yazım
// tamamlanmadan yapılırsa "E-posta veya şifre hatalı" ile başarısız olur.
// Bu, ürün kodunda bir kusur değil, testin kendi zamanlama varsayımıdır.
async function waitForDevAccountSeeded(page, email, timeoutMs = 5000) {
  await page.waitForFunction(
    (targetEmail) => {
      try {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        return users.some((u) => u.email === targetEmail);
      } catch {
        return false;
      }
    },
    email,
    { timeout: timeoutMs },
  );
}

async function fillCommonFields(page, { firstName, lastName, email, phone, password }) {
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Telefon Numarası").fill(phone);
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar").fill(password);
}

const VALID_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const FAKE_PDF_BYTES = Buffer.from("bu gercek bir pdf degil, sadece duz metin.");

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    // ============ 1) Hizmet Alan akışı HİÇ ETKİLENMEMİŞ ============
    console.log("\n=== Hizmet Alan kaydı: yeni alanlar hiç görünmüyor ===");
    await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
    await page.getByRole("radio", { name: "Hizmet Alan" }).click();
    await page.waitForTimeout(150);
    check("'Verdiğiniz Hizmetler' GÖRÜNMÜYOR", (await page.getByText("Verdiğiniz Hizmetler").count()) === 0);
    check(
      "'Faaliyet Belgesi veya Faaliyet Raporu Yükle' GÖRÜNMÜYOR",
      (await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").count()) === 0,
    );
    check(
      "Belge Doğruluk Beyanı metni GÖRÜNMÜYOR",
      (await page.getByText("Yüklediğim belgelerin güncel").count()) === 0,
    );

    const requesterEmail = `hizmet-alan-${RUN_ID}@example.com`;
    await fillCommonFields(page, {
      firstName: "Ayşe",
      lastName: "Kaya",
      email: requesterEmail,
      phone: "0532 111 22 33",
      password: "Guclu1!Sifre",
    });
    await page.getByLabel("Firma Adı").fill("Kaya Nakliyat");
    await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });
    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "İstanbul");
    await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Kadıköy");
    await page.getByLabel(/Gizlilik Politikası/).check();
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page
      .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
      .waitFor({ state: "visible", timeout: 10000 });
    check("Hizmet Alan kaydı hâlâ başarıyla tamamlanıyor (regresyon yok)", true);
    check("Kayıt akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 2) Hizmet Veren: zorunlu alan doğrulaması ============
    console.log("\n=== Hizmet Veren kaydı: yeni zorunlu alanlar doğrulanıyor ===");
    await page.getByRole("tab", { name: "Kayıt Ol" }).click();
    await page.getByRole("radio", { name: "Hizmet Veren" }).click();
    await page.waitForTimeout(150);
    check("'Verdiğiniz Hizmetler' GÖRÜNÜYOR", await page.getByText("Verdiğiniz Hizmetler").isVisible());
    check(
      "'Faaliyet Belgesi veya Faaliyet Raporu Yükle' GÖRÜNÜYOR",
      await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").isVisible(),
    );
    check("Belge Doğruluk Beyanı metni GÖRÜNÜYOR", await page.getByText("Yüklediğim belgelerin güncel").isVisible());

    const providerEmail = `hizmet-veren-${RUN_ID}@example.com`;
    await fillCommonFields(page, {
      firstName: "Mehmet",
      lastName: "Öz",
      email: providerEmail,
      phone: "+905354445566",
      password: "Guclu1!Sifre",
    });
    await page.getByLabel("Firma Adı").fill("Öz Lojistik A.Ş.");
    await page.getByLabel("Hizmet Veren Tipi").selectOption({ label: "Bireysel Hizmet Veren" });
    await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "İzmir");
    await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Çiğli");
    await page.getByLabel(/Gizlilik Politikası/).check();

    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page.waitForTimeout(200);
    check("Hizmet seçilmeden hata görünüyor", await page.getByText("En az bir hizmet seçmelisiniz.").isVisible());
    check(
      "Belge yüklenmeden hata görünüyor",
      await page.getByText("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.").isVisible(),
    );
    check(
      "Beyan kabul edilmeden hata görünüyor",
      await page.getByText("Belge doğruluk beyanını kabul etmelisiniz.").isVisible(),
    );

    // ============ 3) Belge yükleme: geçersiz dosyalar reddediliyor ============
    console.log("\n=== Belge yükleme: istemci tarafı doğrulama ===");
    const fileInput = page.locator('input[type="file"]');

    await fileInput.setInputFiles({ name: "belge.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await page.waitForTimeout(200);
    check(
      "Desteklenmeyen uzantı (.exe) reddedildi",
      await page.getByText("Desteklenmeyen dosya türü.").isVisible(),
    );

    await fileInput.setInputFiles({
      name: "belge.exe.pdf",
      mimeType: "application/pdf",
      buffer: VALID_PDF_BYTES,
    });
    await page.waitForTimeout(200);
    check(
      "Çift uzantılı (belge.exe.pdf) reddedildi",
      await page.getByText("Çift uzantılı veya güvenli olmayan dosya adı kabul edilmez.").isVisible(),
    );

    await fileInput.setInputFiles({ name: "sahte.pdf", mimeType: "application/pdf", buffer: FAKE_PDF_BYTES });
    await page.waitForTimeout(200);
    check(
      "İçeriği uzantısıyla uyuşmayan sahte PDF reddedildi",
      await page.getByText(/Dosya içeriği, uzantısıyla uyuşmuyor/).isVisible(),
    );

    // ============ 4) Geçerli belge yükleniyor ve sunucu doğrulamasından geçiyor ============
    console.log("\n=== Geçerli PDF yükleniyor ===");
    await fileInput.setInputFiles({ name: "faaliyet-belgesi.pdf", mimeType: "application/pdf", buffer: VALID_PDF_BYTES });
    await page.getByText("1 / 5 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    check("Belge kartı listede görünüyor", await page.getByText("faaliyet-belgesi.pdf").isVisible());
    check("Kayıt akışı: konsol hatası yok (belge yükleme)", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 5) Hizmetler seçiliyor + beyan işaretleniyor ============
    console.log("\n=== Hizmet seçimi + beyan ===");
    await page.getByRole("button", { name: "Lashing", exact: true }).click();
    await page.getByRole("button", { name: "Forklift", exact: true }).click();
    await page.getByLabel(/Yüklediğim belgelerin güncel/).check();

    // ============ 6) Kayıt gönderiliyor ============
    console.log("\n=== Hizmet Veren kaydı gönderiliyor ===");
    await page.getByRole("button", { name: "Hesap Oluştur" }).click();
    await page
      .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
      .waitFor({ state: "visible", timeout: 15000 });
    check("Hizmet Veren kaydı başarıyla tamamlandı", true);
    check("Kayıt sonrası: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 7) localStorage tabloları doğru yazılmış mı ============
    console.log("\n=== localStorage: yeni tablolar doğru yazılmış ===");
    const state = await page.evaluate((email) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const user = users.find((u) => u.email === email) ?? null;
      const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
      const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
      const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
      return {
        user,
        services: user ? services.filter((s) => s.userId === user.id) : [],
        documents: user ? documents.filter((d) => d.userId === user.id) : [],
        consents: user ? consents.filter((c) => c.userId === user.id) : [],
      };
    }, providerEmail);

    check("Kullanıcı kaydı oluşmuş", state.user !== null);
    check("providerProfile.serviceCategories YAZILMAMIŞ (deprecated alan)", !state.user?.providerProfile?.serviceCategories);
    check("provider_services.v1: 2 hizmet kaydı", state.services.length === 2);
    check(
      "provider_services.v1: doğru id'ler (lashing, forklift)",
      state.services.map((s) => s.serviceCategoryId).sort().join(",") === "forklift,lashing",
    );
    check("provider_documents.v1: 1 belge kaydı", state.documents.length === 1);
    check("Belge reviewStatus başlangıçta 'pending'", state.documents[0]?.reviewStatus === "pending");
    check("Belge mimeType 'application/pdf'", state.documents[0]?.mimeType === "application/pdf");
    check("Belge indexedDbStorageKey dolu", typeof state.documents[0]?.indexedDbStorageKey === "string" && state.documents[0].indexedDbStorageKey.length > 0);
    check("provider_document_consents.v1: 1 kabul kaydı", state.consents.length === 1);
    check("Beyan sürümü '1.0'", state.consents[0]?.statementVersion === "1.0");

    const documentId = state.documents[0]?.id;

    // ============ 8) Admin: Hizmet Veren Belge Kontrolü ============
    console.log("\n=== Admin girişi ve belge kontrolü ekranı ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fadmin`);
    await waitForDevAccountSeeded(page, ADMIN.email);
    await page.getByLabel("E-posta").fill(ADMIN.email);
    await page.getByLabel("Şifre", { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/admin`, { timeout: 10000 });
    check("Admin girişinde /admin'e yönlendirildi", page.url() === `${BASE_URL}/admin`);

    await page.getByText("Hizmet Veren Belge Kontrolü").waitFor({ state: "visible", timeout: 10000 });
    check("Yeni Hizmet Veren kartı listede görünüyor", await page.getByText("Öz Lojistik A.Ş.").isVisible());
    check("Seçilen hizmetler görünüyor (Lashing)", await page.getByText("Lashing", { exact: true }).isVisible());
    check("Seçilen hizmetler görünüyor (Forklift)", await page.getByText("Forklift", { exact: true }).isVisible());
    // exact: true — Nakliyeci demo hesabı da admin panelinde kendi belgesiyle
    // ("malsevk-nakliye-demo-faaliyet-belgesi.pdf") listelendiği için tam
    // eşleşme olmadan iki farklı dosya adına birden (alt dize eşleşmesiyle)
    // çarpabilir.
    check(
      "Belge dosya adı görünüyor",
      await page.getByText("faaliyet-belgesi.pdf", { exact: true }).isVisible(),
    );
    // .first() — Nakliyeci demo hesabı da kendi "Beyan kabul edildi" satırıyla
    // listelendiği için (bkz. yukarıdaki dosya adı notuyla aynı gerekçe) en az
    // bir eşleşmenin görünür olması yeterlidir.
    check(
      "Beyan kabul bilgisi görünüyor",
      await page.getByText("Beyan kabul edildi", { exact: false }).first().isVisible(),
    );
    check("Admin ekranı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 9) Reddet: açıklamasız gönderilemiyor ============
    console.log("\n=== Reddetme: açıklama zorunlu ===");
    // Nakliyeci demo hesabı da admin panelinde kendi kartıyla listelendiği
    // için (bu ekranda artık 2 sağlayıcı kartı var) etkileşim, YENİ kayıt
    // olan "Öz Lojistik A.Ş."nin kendi kartıyla sınırlandırılır.
    const providerCard = page
      .getByText("Öz Lojistik A.Ş.", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
    await providerCard.getByRole("button", { name: "Reddet" }).click();
    const sendButton = providerCard.getByRole("button", { name: "Gönder" });
    check("Açıklama boşken 'Gönder' pasif", await sendButton.isDisabled());
    await providerCard.getByPlaceholder("Açıklama girin...").fill("Belge okunaklı değil, lütfen net bir tarama yükleyin.");
    check("Açıklama girilince 'Gönder' aktif", !(await sendButton.isDisabled()));
    await sendButton.click();
    await providerCard.getByText("Reddedildi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    check("Belge durumu 'Reddedildi' olarak güncellendi", true);
    check(
      "Red açıklaması listede görünüyor",
      await providerCard.getByText("Belge okunaklı değil, lütfen net bir tarama yükleyin.").isVisible(),
    );

    const reviewState = await page.evaluate((docId) => {
      const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
      const reviews = JSON.parse(localStorage.getItem("malsevk.provider_document_reviews.v1") || "[]");
      const doc = documents.find((d) => d.id === docId) ?? null;
      return { doc, reviewCount: reviews.filter((r) => r.documentId === docId).length };
    }, documentId);
    check("localStorage: belge reviewStatus 'rejected'", reviewState.doc?.reviewStatus === "rejected");
    check("localStorage: reviewedByAdminId dolu", typeof reviewState.doc?.reviewedByAdminId === "string");
    check("localStorage: reviewedAt dolu", typeof reviewState.doc?.reviewedAt === "string");
    check("provider_document_reviews.v1: 1 günlük satırı yazılmış", reviewState.reviewCount === 1);

    // ============ 10) Reddedilen Hizmet Veren bildirim görüyor mu ============
    console.log("\n=== Hizmet Veren: red bildirimi ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel%2Fbildirimler`);
    await page.getByLabel("E-posta").fill(providerEmail);
    await page.getByLabel("Şifre", { exact: true }).fill("Guclu1!Sifre");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel/bildirimler`, { timeout: 10000 });
    check(
      "'Belgeniz Reddedildi' bildirimi görünüyor",
      await page.getByText("Belgeniz Reddedildi", { exact: true }).first().isVisible().catch(() => false),
    );

    // ============ 11) Rol değiştirince belge listesi sıfırlanıyor ============
    console.log("\n=== Rol Hizmet Alan'a değiştirilince belge state'i temizleniyor ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
    await page.getByRole("radio", { name: "Hizmet Veren" }).click();
    await page.waitForTimeout(150);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "gecici.pdf", mimeType: "application/pdf", buffer: VALID_PDF_BYTES });
    await page.getByText("1 / 5 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("radio", { name: "Hizmet Alan" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("radio", { name: "Hizmet Veren" }).click();
    await page.waitForTimeout(150);
    check(
      "Rol Hizmet Alan'a değiştirilip geri dönünce belge listesi boş (0 / 5)",
      await page.getByText("0 / 5 belge yüklendi", { exact: false }).isVisible(),
    );
    check("Rol değişimi akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 12) Mevcut demo hesap (Zeynep) hâlâ çalışıyor ============
    console.log("\n=== Mevcut demo hesap (Zeynep) hâlâ çalışıyor ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap?redirect=%2Fpanel`);
    await waitForDevAccountSeeded(page, ZEYNEP.email);
    await page.getByLabel("E-posta").fill(ZEYNEP.email);
    await page.getByLabel("Şifre", { exact: true }).fill(ZEYNEP.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForURL(`${BASE_URL}/panel`, { timeout: 10000 });
    check("Demo hesap (Zeynep/hizmet-alan) hâlâ giriş yapabiliyor", true);

    // ============ 13) admin oturumu /panel/tekliflerim gibi rol-özel sayfalara girmiyor ============
    console.log("\n=== Admin oturumu diğer rol-özel ekranları kırmıyor ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await page.goto(`${BASE_URL}/giris-yap`);
    await waitForDevAccountSeeded(page, ADMIN.email);
    await page.getByLabel("E-posta").fill(ADMIN.email);
    await page.getByLabel("Şifre", { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForTimeout(500);
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(300);
    check("Admin oturumuyla ana sayfa hatasız açılıyor", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    await context.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
