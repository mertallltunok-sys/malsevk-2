import { readJson, STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { getProviderDocumentById, updateProviderDocumentReviewFields } from "./provider-documents";
import type { ProviderDocumentReviewStatus, Session } from "./types";

const PROVIDER_DOCUMENT_REVIEWS_STORAGE_KEY = "malsevk.provider_document_reviews.v1";

/**
 * Değişmez (append-only) inceleme AKSİYON günlüğü — "hangi admin, hangi
 * belge için, ne zaman, hangi kararı verdi" geçmişinin tam kaydı.
 * `provider-documents.ts#StoredProviderDocument`'ın reviewStatus/reviewNote/
 * reviewedAt alanları bu günlüğün yalnızca EN SON satırının denormalize
 * edilmiş bir yansımasıdır — ikisi aynı veriyi TUTMAZ, biri geçmiş biri
 * güncel durum sorusuna cevap verir (bkz. provider-documents.ts'in kendi
 * dokümantasyonu).
 */
export type StoredProviderDocumentReview = {
  id: string;
  documentId: string;
  userId: string;
  adminId: string;
  action: ProviderDocumentReviewStatus;
  note?: string;
  createdAt: string;
};

function readAll(): StoredProviderDocumentReview[] {
  const raw = readJson<unknown[]>(PROVIDER_DOCUMENT_REVIEWS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is StoredProviderDocumentReview => {
    if (typeof item !== "object" || item === null) return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      typeof value.documentId === "string" &&
      typeof value.userId === "string" &&
      typeof value.adminId === "string" &&
      typeof value.action === "string" &&
      typeof value.createdAt === "string"
    );
  });
}

function writeAll(rows: StoredProviderDocumentReview[]): boolean {
  return writeJson(PROVIDER_DOCUMENT_REVIEWS_STORAGE_KEY, rows);
}

export function getProviderDocumentReviewHistory(documentId: string): StoredProviderDocumentReview[] {
  return readAll()
    .filter((row) => row.documentId === documentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type RecordProviderDocumentReviewInput = {
  documentId: string;
  status: "approved" | "rejected" | "revision_requested";
  note?: string;
};

export type RecordProviderDocumentReviewResult =
  | { ok: true; documentId: string; status: ProviderDocumentReviewStatus }
  | { ok: false; error: string };

/**
 * Admin belge kontrolü ekranının TEK yazma yolu — Onayla/Reddet/Yeniden
 * Belge İste eylemlerinin hepsi buradan geçer (offers.ts#updateOfferStatus
 * ile aynı "veri katmanı yetki otoritesi" deseni: arayüz kuralı burada da
 * tekrar uygulanır, yalnızca UI'ya güvenilmez). Red/yeniden-belge-isteme
 * için açıklama ZORUNLUDUR (görev gereksinimi); onayda isteğe bağlıdır.
 * Başarılı olursa hem günlük satırı (bu dosya) hem denormalize edilmiş
 * güncel durum (provider-documents.ts) TEK bir mantıksal işlem olarak
 * güncellenir — günlük satırı yalnızca durum alanı gerçekten yazılabildiyse
 * eklenir (kısmen tutarsız bir durumdan kaçınmak için).
 */
export function recordProviderDocumentReview(
  session: Session | null,
  input: RecordProviderDocumentReviewInput,
): RecordProviderDocumentReviewResult {
  if (!session || session.role !== "admin") {
    return { ok: false, error: "Bu işlem için yönetici girişi gereklidir." };
  }

  const document = getProviderDocumentById(input.documentId);
  if (!document) {
    return { ok: false, error: "Belge bulunamadı." };
  }

  const trimmedNote = input.note?.trim();
  if ((input.status === "rejected" || input.status === "revision_requested") && !trimmedNote) {
    return {
      ok: false,
      error:
        input.status === "rejected"
          ? "Reddetme işlemi için açıklama girmelisiniz."
          : "Yeniden belge isteme işlemi için açıklama girmelisiniz.",
    };
  }

  const updated = updateProviderDocumentReviewFields({
    documentId: input.documentId,
    status: input.status,
    note: trimmedNote,
    adminId: session.id,
  });
  if (!updated) {
    return { ok: false, error: "Belge durumu güncellenemedi. Lütfen tekrar deneyin." };
  }

  const logRow: StoredProviderDocumentReview = {
    id: crypto.randomUUID(),
    documentId: input.documentId,
    userId: document.userId,
    adminId: session.id,
    action: input.status,
    note: trimmedNote,
    createdAt: updated.reviewedAt ?? new Date().toISOString(),
  };
  // DÜZELTME (Y4, veritabanı geçişi öncesi denetim): eskiden bu yazımın
  // dönüş değeri hiç kontrol edilmiyordu — günlük satırı yazılamasa bile
  // fonksiyon koşulsuz {ok:true} dönüyordu; admin ekranında "başarılı"
  // görünüyordu ama inceleme geçmişi sessizce kayboluyordu (belge durumu ile
  // günlük arasında kalıcı bir "yarım başarı" oluşuyordu). localStorage
  // mimarisinde gerçek bir transaction olmadığı için tam atomiklik mümkün
  // değil — en yakın pratik yaklaşım olarak, günlük yazımı başarısız olursa
  // az önce yazılan denormalize durum en iyi çabayla ESKİ (değişiklik
  // öncesi) değerine geri alınır (deleteJobWithOffers'ın kendi best-effort
  // ikincil yazım deseniyle AYNI felsefe) ve kullanıcıya/admin arayüzüne
  // gerçek bir hata döner.
  if (!writeAll([...readAll(), logRow])) {
    const rolledBack = updateProviderDocumentReviewFields({
      documentId: input.documentId,
      status: document.reviewStatus,
      note: document.reviewNote,
      adminId: document.reviewedByAdminId ?? session.id,
    });
    if (!rolledBack) {
      console.error(
        "recordProviderDocumentReview: inceleme günlüğü yazılamadı VE geri alma da başarısız oldu — belge durumu artık günlükle tutarsız olabilir.",
      );
    }
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  return { ok: true, documentId: input.documentId, status: input.status };
}
