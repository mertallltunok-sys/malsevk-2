import { writeJson } from "./local-storage";
import { isServiceCategoryId } from "./service-catalog";

const PROVIDER_SERVICES_STORAGE_KEY = "malsevk.provider_services.v1";

/**
 * Bir hizmet-veren kullanıcının sunduğu TEK bir hizmet kategorisi seçimi —
 * `userId` + `serviceCategoryId` ilişkisel çifti. Bu tablo, bir kullanıcının
 * GÜNCEL hizmet seçimlerinin TEK doğruluk kaynağıdır (bkz. types.ts#
 * ProviderProfile.serviceCategories'in deprecated notu) — hem Hizmet Veren
 * kayıt formundaki "Verdiğiniz Hizmetler" alanı hem de Panel > Profilim >
 * Hizmet Bilgilerim (service-info-editor.tsx) BURAYA yazar/BURADAN okur,
 * aynı veri iki ayrı yerde tekrar tutulmaz. Aynı zamanda job-visibility.ts'in
 * Nakliye izolasyon kuralının TEK veri kaynağıdır.
 */
export type StoredProviderService = {
  id: string;
  userId: string;
  serviceCategoryId: string;
  createdAt: string;
};

// job-store.ts#userJobsStore ile AYNI desen: modül seviyesinde önbellek +
// dinleyici kümesi, böylece useSyncExternalStore ile (bkz. use-provider-services.ts)
// hem AYNI sekme içindeki (provider-services.ts'e yazan herhangi bir yer)
// hem de FARKLI sekmelerdeki (bkz. `storage` olayı) değişiklikler anında
// yansır — "provider hizmetleri değiştirildiğinde açık sekmede görünürlük
// sayfa yenilenmeden güncellenmeli" gereksinimi bu ikisi olmadan
// karşılanamazdı (job-visibility.ts'in düz fonksiyonları her çağrıda taze
// okur, ama bunu TETİKLEYECEK bir React re-render'ı olmadan ekranda hiçbir
// şey değişmez).
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedRows: StoredProviderService[] = [];
let hasCached = false;

function isStoredProviderServiceCore(value: unknown): value is StoredProviderService {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.userId === "string" &&
    typeof row.serviceCategoryId === "string" &&
    typeof row.createdAt === "string"
  );
}

function readAllSnapshot(): StoredProviderService[] {
  if (typeof window === "undefined") return EMPTY_ROWS;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PROVIDER_SERVICES_STORAGE_KEY);
  } catch {
    raw = null;
  }

  // useSyncExternalStore, ham metin değişmediyse getSnapshot'ın AYNI referansı
  // döndürmesini bekler (bkz. session.ts/job-store.ts'teki aynı desen).
  if (hasCached && raw === cachedRaw) return cachedRows;

  let parsed: StoredProviderService[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        parsed = value.filter(isStoredProviderServiceCore);
      }
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedRows = parsed;
  hasCached = true;
  return parsed;
}

const EMPTY_ROWS: StoredProviderService[] = [];

function getServerSnapshot(): StoredProviderService[] {
  return EMPTY_ROWS;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** use-provider-services.ts#useProviderServiceCategoryIds bu store'a abone olur — job-store.ts#userJobsStore ile AYNI sözleşme. */
export const providerServicesStore = {
  subscribe,
  getSnapshot: readAllSnapshot,
  getServerSnapshot,
};

function writeAll(rows: StoredProviderService[]): boolean {
  if (!writeJson(PROVIDER_SERVICES_STORAGE_KEY, rows)) return false;
  cachedRaw = null;
  hasCached = false;
  notify();
  return true;
}

/**
 * Bir kullanıcının güncel hizmet kategorisi id'lerini döner — sırasız,
 * tekrarsız. `isServiceCategoryId` ile SÜZÜLÜR: bozuk/eski (kataloğun artık
 * tanımadığı) bir id localStorage'da kalmışsa bile döndürülmez — bu, bozuk
 * verinin (ör. yanlışlıkla "nakliye"ye eşit olmayan ama yine de bir şekilde
 * geçersiz bir değerin) job-visibility.ts'teki kontrollerde tanımsız/beklenmedik
 * bir davranışa yol açmasını engeller (yalnızca gerçekten kataloğa ait bir id
 * "nakliye" ile eşleşebilir, başka hiçbir şey asla eşleşmez).
 */
export function getProviderServiceCategoryIds(userId: string): string[] {
  return readAllSnapshot()
    .filter((row) => row.userId === userId)
    .map((row) => row.serviceCategoryId)
    .filter(isServiceCategoryId);
}

/**
 * Bir kullanıcının hizmet kategorisi kümesini TAMAMEN değiştirir (var olan
 * satırları silip verilen kümeyle değiştirir) — hem kayıt formu hem Hizmet
 * Bilgilerim ekranı için TEK yazma yolu. Geçersiz (service-catalog.ts'te
 * tanımlı olmayan) id'ler sessizce elenir, tekrarlar `Set` ile tekilleştirilir.
 * Yazma başarısız olursa (bkz. local-storage.ts#writeJson) `false` döner ve
 * ÖNCEKİ satırlar hiç değiştirilmeden kalır (tek bir writeJson çağrısı,
 * kısmi yazım riski yok).
 */
export function setProviderServiceCategoryIds(userId: string, categoryIds: string[]): boolean {
  const validIds = Array.from(new Set(categoryIds.filter(isServiceCategoryId)));
  const others = readAllSnapshot().filter((row) => row.userId !== userId);
  const nextRows: StoredProviderService[] = [
    ...others,
    ...validIds.map((serviceCategoryId) => ({
      id: crypto.randomUUID(),
      userId,
      serviceCategoryId,
      createdAt: new Date().toISOString(),
    })),
  ];
  return writeAll(nextRows);
}

/** Yalnızca provider-registration.ts'in kayıt geri alma (rollback) senaryosunda kullanılır. */
export function deleteProviderServicesForUser(userId: string): boolean {
  return writeAll(readAllSnapshot().filter((row) => row.userId !== userId));
}
