/**
 * "Bize Ulaşın" — sabit katalog/tip tanımları. Gerçek okuma/yazma
 * `supabase-contact-messages.ts` üzerinden Supabase'e gider (migration
 * 0021, `submit_contact_message`/`review_contact_message` RPC'leri) — bu
 * dosya artık hiçbir localStorage "tablosu" TUTMAZ (önceki hâli
 * `malsevk.contact-messages.v1` localStorage anahtarını okuyup yazıyordu;
 * "Bize Ulaşın" hiçbir canlı localStorage sistemine bağımlı olmadığı için
 * tam bir Supabase cutover'ı yapıldı, hibrit/dual-write DEĞİL — bkz.
 * supabase-contact-messages.ts'in kendi dokümantasyonu). Yalnızca veri
 * kaynağından bağımsız, saf katalog/etiket/doğrulama sabitleri kalır.
 */
export type ContactMessageStatus = "yeni" | "inceleniyor" | "yanit-bekliyor" | "cozuldu" | "arsivlendi";

export const CONTACT_MESSAGE_STATUS_OPTIONS: { value: ContactMessageStatus; label: string }[] = [
  { value: "yeni", label: "Yeni" },
  { value: "inceleniyor", label: "İnceleniyor" },
  { value: "yanit-bekliyor", label: "Yanıt Bekliyor" },
  { value: "cozuldu", label: "Çözüldü" },
  { value: "arsivlendi", label: "Arşivlendi" },
];

export function isContactMessageStatus(value: unknown): value is ContactMessageStatus {
  return typeof value === "string" && CONTACT_MESSAGE_STATUS_OPTIONS.some((option) => option.value === value);
}

export type ContactMessageSubject =
  | "genel-bilgi"
  | "teknik-destek"
  | "ilan-ve-teklif-islemleri"
  | "hesap-islemleri"
  | "odeme-ve-abonelik"
  | "sikayet"
  | "dilek-ve-oneri"
  | "is-birligi"
  | "diger";

export const CONTACT_MESSAGE_SUBJECT_OPTIONS: { value: ContactMessageSubject; label: string }[] = [
  { value: "genel-bilgi", label: "Genel Bilgi" },
  { value: "teknik-destek", label: "Teknik Destek" },
  { value: "ilan-ve-teklif-islemleri", label: "İlan ve Teklif İşlemleri" },
  { value: "hesap-islemleri", label: "Hesap İşlemleri" },
  { value: "odeme-ve-abonelik", label: "Ödeme ve Abonelik" },
  { value: "sikayet", label: "Şikayet" },
  { value: "dilek-ve-oneri", label: "Dilek ve Öneri" },
  { value: "is-birligi", label: "İş Birliği" },
  { value: "diger", label: "Diğer" },
];

export function isContactMessageSubject(value: unknown): value is ContactMessageSubject {
  return typeof value === "string" && CONTACT_MESSAGE_SUBJECT_OPTIONS.some((option) => option.value === value);
}

export function getContactMessageSubjectLabel(subject: ContactMessageSubject): string {
  return CONTACT_MESSAGE_SUBJECT_OPTIONS.find((option) => option.value === subject)?.label ?? subject;
}

export function getContactMessageStatusLabel(status: ContactMessageStatus): string {
  return CONTACT_MESSAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export const CONTACT_MESSAGE_MIN_LENGTH = 10;
export const CONTACT_MESSAGE_MAX_LENGTH = 2000;
