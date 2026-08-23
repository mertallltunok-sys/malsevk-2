/**
 * GENEL GÜVENLİK, VERİ DOĞRULAMA VE KÖTÜYE KULLANIM KORUMASI — merkezi metin
 * normalizasyon/doğrulama kuralları (görev bölüm 3). Sistem genelindeki
 * onlarca serbest metin alanının (ilan başlığı/açıklaması, manuel ürün/tesis
 * adı, teklif açıklaması, admin notları, arama kutuları...) HER BİRİ kendi
 * dosyasında bu kuralları YENİDEN YAZMAK yerine buradan çağırır.
 *
 * BİLEREK KORUNAN karakterler (görev bölüm 3'ün kendi örnekleri): Türkçe
 * harfler, rakamlar, apostrof/tırnak, virgül/nokta, eğik çizgi, parantez,
 * tire, çarpı işareti (×/x), derece/çap sembolleri (°/Ø), yıldız (atık
 * kodlarındaki "*"), ve/yüzde/artı/iki nokta gibi yaygın lojistik
 * noktalama — hiçbiri buradaki fonksiyonlarca ENGELLENMEZ, yalnızca
 * KONTROL/GÖRÜNMEZ karakterler ve tehlikeli biçimlendirme kalıpları
 * temizlenir.
 *
 * Kontrol/görünmez karakter desenleri BİLEREK `RegExp(stringLiteral)`
 * biçiminde, kod-noktası aralıklarından (`String.fromCharCode`) inşa edilir
 * — bir `/[...]/ ` edebi regex'i içine ham kontrol/görünmez bir bayt
 * yanlışlıkla YAPIŞTIRILAMAZ/GÖMÜLEMEZ, her karakter yalnızca sayısal kod
 * noktası olarak var olur.
 */

function charRange(startCode: number, endCode: number): string {
  const chars: string[] = [];
  for (let code = startCode; code <= endCode; code += 1) {
    chars.push(String.fromCharCode(code));
  }
  return chars.join("");
}

// U+0000-U+0008, U+000B, U+000C, U+000D, U+000E-U+001F, U+007F — tab
// (U+0009) ve satır sonu (U+000A) BİLEREK hariç, çok satırlı alanlarda
// meşrudur (whitespace-collapse ayrıca bunları normalize eder).
const CONTROL_CHARS =
  charRange(0x0000, 0x0008) + charRange(0x000b, 0x000d) + charRange(0x000e, 0x001f) + String.fromCharCode(0x007f);
const CONTROL_CHAR_PATTERN = new RegExp(`[${CONTROL_CHARS}]`, "g");

// Görünmez/yön-kontrol Unicode karakterleri — sıfır genişlikli boşluk/
// birleştirici (U+200B-U+200F), bidi-override (U+202A-U+202E, metni görsel
// olarak ters gösterip gizli içerik saklamak için kullanılabilir), kelime
// birleştirici (U+2060), BOM/ZWNBSP (U+FEFF).
const INVISIBLE_CHARS = charRange(0x200b, 0x200f) + charRange(0x202a, 0x202e) + String.fromCharCode(0x2060) + String.fromCharCode(0xfeff);
const INVISIBLE_CHAR_PATTERN = new RegExp(`[${INVISIBLE_CHARS}]`, "g");

const DANGEROUS_MARKUP_PATTERN = /<\s*script|javascript:|on\w+\s*=|<\s*iframe|<\s*object|<\s*embed|data:text\/html/i;

/**
 * NFC Unicode normalizasyonu + kontrol/görünmez karakter temizliği + aşırı
 * tekrar eden boşluk/satır sonu sıkıştırma + baş/son boşluk kırpma. Türkçe
 * karakterler (İ/ı/ğ/ü/ş/ö/ç) NFC altında değişmeden kalır — bu normalizasyon
 * onları BOZMAZ, yalnızca (varsa) ayrışık kombinasyon karakterlerini
 * (kompozisyon dışı biçimler) standart tek-kod-noktalı hallerine getirir.
 */
export function normalizeFreeText(raw: string): string {
  let value = raw.normalize("NFC");
  value = value.replace(CONTROL_CHAR_PATTERN, "");
  value = value.replace(INVISIBLE_CHAR_PATTERN, "");
  value = value.replace(/[ \t]{2,}/g, " ");
  value = value.replace(/\n{3,}/g, "\n\n");
  return value.trim();
}

/** Çok satırlı olmayan (başlık, manuel ürün adı, arama kutusu vb.) alanlar için — \n dahil her whitespace tek boşluğa indirgenir. */
export function normalizeSingleLineText(raw: string): string {
  return normalizeFreeText(raw.replace(/[\r\n\t]+/g, " "));
}

/** Yalnızca boşluk, noktalama veya tekrar eden tek karakterden oluşan (harfsiz/rakamsız) bir değer "anlamsız" sayılır. */
export function isMeaninglessText(value: string): boolean {
  const normalized = normalizeFreeText(value);
  if (normalized.length === 0) return true;
  return !/[\p{L}\p{N}]/u.test(normalized);
}

export function containsDangerousMarkup(value: string): boolean {
  return DANGEROUS_MARKUP_PATTERN.test(value);
}

export type FreeTextValidationOptions = {
  fieldLabel: string;
  maxLength: number;
  minLength?: number;
  /** Varsayılan true — çok satırlı alanlar (açıklama, not) için false geçin. */
  singleLine?: boolean;
  /** Varsayılan true — boş/anlamsız değer reddedilir. Opsiyonel alanlarda (boş bırakılabilir) false geçip önce `value.length === 0` kontrolünü kendiniz yapın. */
  rejectMeaningless?: boolean;
};

export type FreeTextValidationResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Sistem genelindeki serbest metin alanları için TEK ortak doğrulama
 * fonksiyonu. Normalize eder, boş/anlamsız/aşırı uzun/tehlikeli-biçimli
 * girdiyi reddeder — her çağıran kendi `fieldLabel`/`maxLength`ini geçer,
 * mesaj metni her zaman Türkçe ve anlaşılırdır (görev gereksinimi).
 */
export function validateFreeText(raw: string, options: FreeTextValidationOptions): FreeTextValidationResult {
  const singleLine = options.singleLine ?? true;
  const rejectMeaningless = options.rejectMeaningless ?? true;
  const value = singleLine ? normalizeSingleLineText(raw) : normalizeFreeText(raw);

  if (rejectMeaningless && isMeaninglessText(value)) {
    return { ok: false, error: `${options.fieldLabel} boş veya anlamsız olamaz.` };
  }
  if (options.minLength && value.length < options.minLength) {
    return { ok: false, error: `${options.fieldLabel} en az ${options.minLength} karakter olmalıdır.` };
  }
  if (value.length > options.maxLength) {
    return { ok: false, error: `${options.fieldLabel} en fazla ${options.maxLength} karakter olabilir.` };
  }
  if (containsDangerousMarkup(value)) {
    return { ok: false, error: `${options.fieldLabel} izin verilmeyen içerik barındırıyor.` };
  }
  return { ok: true, value };
}

/**
 * `http(s)://` dışındaki şemaları (javascript:/data:/vbscript: vb.) reddeder
 * — "Konum Bağlantısı" gibi kullanıcı tarafından girilip gerçek bir
 * `<a href>`e yazılan alanlar için. Boş değeri GEÇERLİ sayar (opsiyonel
 * alan) — zorunluluk kontrolü çağıranın kendi işidir.
 */
export function isSafeHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  return /^https?:\/\//i.test(trimmed);
}

export const UNSAFE_URL_MESSAGE = "Yalnızca http:// veya https:// ile başlayan bağlantılar kabul edilir.";
