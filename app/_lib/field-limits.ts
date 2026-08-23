/**
 * "Tüm İlan Formlarında Gerçek, Alana Uygun ve Aşılamaz Giriş Sınırları"
 * görevi — ilan formlarındaki metin/sayı/tekrar-eden-grup alanlarının TEK
 * merkezi üst sınır kaynağı. Önceki "Genel Güvenlik" görevi bu sınırları
 * dosya dosya (job-edit-form.tsx#DESCRIPTION_MAX_LENGTH,
 * nakliye-transport-catalog.ts#sanitizePositiveNumber'ın üst sınırsız
 * hâli, vb.) dağınık/eksik/tutarsız bırakmıştı — bu dosya onların YERİNE
 * GEÇMEZ (metin uzunluğu sabitleri hâlâ kendi bileşen dosyalarında
 * tanımlı, yalnızca DOĞRU değerlere hizalandı), yalnızca daha önce HİÇ
 * merkezi bir karşılığı olmayan sayısal/tekrar-eden-grup sınırlarını
 * tek yerde toplar — job-form-validation.ts, nakliye-transport-catalog.ts,
 * storage-container-catalog.ts, product-catalog.ts ve ilgili _components
 * dosyaları BU sabitleri import eder, ikinci bir bağımsız sayı doğrulama
 * sistemi İCAT EDİLMEZ.
 */

/**
 * Metin alanı üst sınırları — görev talimatı madde 2. Bulunan gerçek açık:
 * ilan oluşturma formu (job-request-form.tsx) başlık alanına zaten
 * `maxLength={80}` uyguluyordu, ama paylaşılan `validateJobForm`/
 * `validateServiceItem` (bu dosya) 150 karakteri kabul ediyordu VE ilan
 * düzenleme formu (job-edit-form.tsx) ayrıca kendi başına `maxLength={150}`
 * kullanıyordu — üç farklı sınır aynı alan için aynı anda geçerliydi. Bu
 * sabitler artık TEK doğruluk kaynağı; hem `job-form-validation.ts` hem
 * ilgili `_components` dosyaları BUNLARI import eder.
 */
export const TITLE_MAX_LENGTH = 80;
export const DESCRIPTION_MAX_LENGTH = 1_000;
/** Açık Adres — önceki tutarlı-ama-yanlış sınır 500 idi, görev talimatı 250 olarak sabitliyor. */
export const ADDRESS_MAX_LENGTH = 250;
/** Manuel tesis/liman/OSB/sanayi adı. */
export const FACILITY_NAME_MAX_LENGTH = 150;
/** "Listede yok / Kendim gireceğim" ile açılan kısa manuel metin alanları (yük cinsi, yük şekli, hazırlanış biçimi, vb.) VE Ürün/Yük Cinsi. */
export const MANUAL_ENTRY_TEXT_MAX_LENGTH = 100;

/** Ürün Adedi / Konteyner Adedi gibi tam sayı "adet" alanları — minimum 1 (ayrıca kontrol edilir), maksimum 1.000.000. */
export const MAX_PRODUCT_QUANTITY = 1_000_000;

/** Toplam Ağırlık — Ton birimindeyken üst sınır ve izin verilen ondalık basamak sayısı. */
export const MAX_TONNAGE_TON = 100_000;
export const TONNAGE_TON_DECIMAL_PLACES = 3;
/** Toplam Ağırlık — Kg birimindeyken üst sınır ve izin verilen ondalık basamak sayısı. */
export const MAX_TONNAGE_KG = 100_000_000;
export const TONNAGE_KG_DECIMAL_PLACES = 2;

/** Ölçü ve Yerleşim Bilgileri — En/Boy/Yükseklik/Çap alanlarının cm cinsinden üst sınırları (görev talimatı madde 2). */
export const MAX_WIDTH_CM = 1_000;
export const MAX_LENGTH_CM = 5_000;
export const MAX_HEIGHT_CM = 1_000;
export const MAX_DIAMETER_CM = 1_000;
/** Rulo/Bobin genişliği — En ile aynı mertebede bir ölçü, aynı üst sınırı paylaşır. */
export const MAX_ROLL_WIDTH_CM = MAX_WIDTH_CM;
/** "Dökme" yük için Yaklaşık Hacim (m³) — cm ölçülerinden bağımsız, makul bir üst sınır (10km × 10km × 10km'lik bir hacmin çok altında, hiçbir gerçek sevkiyatı engellemeyecek kadar cömert). */
export const MAX_VOLUME_M3 = 100_000;
/** Ölçü alanlarında izin verilen ondalık basamak sayısı (görev talimatı: "en fazla iki ondalık basamak"). */
export const MEASUREMENT_DECIMAL_PLACES = 2;

/** "En Fazla İstif Katı" — yalnızca tam sayı, makul bir üst sınır (fiziksel olarak hiçbir yükün binlerce kat istiflenmesi mümkün değildir). */
export const MAX_STACK_COUNT = 200;

/** Konteyner Adedi (Nakliye Yük Grubu + Depolama Konteyner Grubu ortak) — tek bir ilan/grup için makul bir üst sınır; gerçek bir sevkiyat birden çok araç/konteyner içerebileceği için cömert tutuldu. */
export const MAX_CONTAINER_QUANTITY = 1_000;

/** İlan başına maksimum tekrar eden yük/konteyner grubu sayısı — Nakliye Yük Grupları VE Depolama Konteyner Grupları ortak (görev talimatı madde 2 ve 7: "Konteyner grupları ayrı tekrar eden yapıysa aynı kötüye kullanım riskine karşı makul grup limiti uygula"). */
export const MAX_CARGO_GROUPS = 20;
export const MAX_STORAGE_CONTAINER_GROUPS = 20;
