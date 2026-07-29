import { KVKK_SECTIONS } from "./legal-content-kvkk";
import { PRIVACY_POLICY_SECTIONS } from "./legal-content-privacy";
import { TERMS_OF_SERVICE_SECTIONS } from "./legal-content-terms";

export type LegalDocumentId = "privacy_policy" | "terms_of_service" | "kvkk";

export type LegalDocumentSection = {
  heading: string;
  paragraphs: string[];
  /** Madde numarası içermeyen sade bir liste (ör. haklar/veri kategorileri) — varsa paragraflardan SONRA render edilir. */
  list?: string[];
};

export type LegalDocumentMeta = {
  id: LegalDocumentId;
  title: string;
  /**
   * SÜRÜM SİSTEMİ (tek doğruluk kaynağı): bir hukuki metin değiştiğinde
   * `version`/`lastUpdatedDate` burada güncellenir ve ilgili
   * `legal-content-*.ts` dosyasındaki `sections` içeriği düzenlenir —
   * başka HİÇBİR yerde (footer, modal, sayfa) sürüm/tarih bilgisi ayrıca
   * yazılmaz, hepsi bu kayıttan okunur. `effectiveDate` metnin yürürlüğe
   * girdiği tarihtir; bir metin YALNIZCA içerik değişmeden düzeltme
   * (yazım vb.) alırsa `effectiveDate` aynı kalıp yalnızca
   * `lastUpdatedDate` güncellenebilir — içerik gerçekten değiştiğinde
   * `version` de artırılmalıdır (ör. "1.0" -> "1.1"/"2.0").
   */
  version: string;
  /** ISO 8601 tarih (YYYY-MM-DD). */
  effectiveDate: string;
  /** ISO 8601 tarih (YYYY-MM-DD) — ilk yayında effectiveDate ile aynıdır. */
  lastUpdatedDate: string;
  /**
   * Bu belgenin footer/modal DIŞINDA, doğrudan bağlantıyla (SEO, e-posta
   * imzası, üçüncü taraf entegrasyonları vb.) erişilebildiği sayfa —
   * bkz. app/gizlilik-politikasi, app/kullanim-kosullari,
   * app/kvkk-aydinlatma-metni. Footer bağlantıları bu path'i `href` olarak
   * kullanır (sağ tık/yeni sekme/orta tık için gerçek bir hedef sağlar)
   * ama normal sol tıkta modalı açar — bkz. site-footer.tsx.
   */
  routePath: string;
  sections: LegalDocumentSection[];
};

const LEGAL_DOCUMENT_REGISTRY: Record<LegalDocumentId, LegalDocumentMeta> = {
  privacy_policy: {
    id: "privacy_policy",
    title: "Gizlilik Politikası",
    version: "1.0",
    effectiveDate: "2026-07-28",
    lastUpdatedDate: "2026-07-28",
    routePath: "/gizlilik-politikasi",
    sections: PRIVACY_POLICY_SECTIONS,
  },
  terms_of_service: {
    id: "terms_of_service",
    title: "Kullanım Koşulları",
    version: "1.0",
    effectiveDate: "2026-07-28",
    lastUpdatedDate: "2026-07-28",
    routePath: "/kullanim-kosullari",
    sections: TERMS_OF_SERVICE_SECTIONS,
  },
  kvkk: {
    id: "kvkk",
    title: "KVKK Aydınlatma Metni",
    version: "1.0",
    effectiveDate: "2026-07-28",
    lastUpdatedDate: "2026-07-28",
    routePath: "/kvkk-aydinlatma-metni",
    sections: KVKK_SECTIONS,
  },
};

export function getLegalDocumentMeta(id: LegalDocumentId): LegalDocumentMeta {
  return LEGAL_DOCUMENT_REGISTRY[id];
}

export function getAllLegalDocuments(): LegalDocumentMeta[] {
  return Object.values(LEGAL_DOCUMENT_REGISTRY);
}

export function isLegalDocumentId(value: string): value is LegalDocumentId {
  return value === "privacy_policy" || value === "terms_of_service" || value === "kvkk";
}

/** "28 Temmuz 2026" — `timeZone: "UTC"` bilerek sabitlenir ki tarih, görüntüleyenin yerel saat dilimine göre bir gün kaymasın (ISO tarih zaten gün hassasiyetinde, saat bilgisi taşımıyor). */
export function formatLegalDate(isoDate: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}
