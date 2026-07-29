/**
 * Kullanıcıya gösterilecek TEK, merkezi localStorage yazma hatası metni —
 * hiçbir çağıran katman kendi versiyonunu icat etmez (bkz. CLAUDE.md B1
 * düzeltmesi). Teknik detay (exception adı/stack) içermez; gerçek hata
 * yalnızca console.error ile (bkz. writeJson) loglanır.
 */
export const STORAGE_WRITE_ERROR_MESSAGE =
  "İşlem kaydedilemedi. Tarayıcı depolama alanını kontrol edip tekrar deneyin.";

export function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * `localStorage.setItem` kota dolması, gizli sekme/tarayıcı kısıtlaması gibi
 * nedenlerle exception fırlatabilir — ÖNCEDEN bu burada sessizce yutulup
 * çağırana her zaman "başarılı" gibi davranılıyordu (bkz. CLAUDE.md B1 kök
 * neden analizi). Artık gerçek hata burada (merkezi noktada) console.error
 * ile loglanır VE çağırana `false` olarak bildirilir — her yazma yardımcısı
 * (job-store.ts/users.ts/offers.ts/session.ts/...) bu sonucu kendi mevcut
 * `{ok,error}` sözleşmesine çevirir, böylece yazma başarısız olduğunda hiçbir
 * iş fonksiyonu başarı döndürmez.
 */
export function writeJson<T>(key: string, value: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`localStorage yazma hatası (${key}):`, error);
    return false;
  }
}

export function removeItem(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`localStorage silme hatası (${key}):`, error);
    return false;
  }
}
