import { isValidEmail } from "./login-form-validation";
import { STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { normalizePhoneNumber } from "./phone";
import type { Session, UserRole } from "./types";

const CONTACT_MESSAGES_STORAGE_KEY = "malsevk.contact-messages.v1";

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

/**
 * "Bize Ulaşın" formundan gelen tek bir mesaj kaydı — job-store.ts/offers.ts
 * ile AYNI localStorage "tablo" deseni (bkz. bu dosyanın alt kısmındaki
 * store). Ayrı bir "bildirim" kaydı YOK: admin panelindeki "yeni mesaj"
 * göstergesi doğrudan `status === "yeni"` sayısından türetilir (bkz.
 * contact-messages-admin-panel.tsx) — notifications.ts'in "sabit/ayrı bir
 * olay tablosu tutma, canlı türet" ilkesiyle AYNI, bu yüzden bir mesajın
 * durumu değiştiğinde (admin onu incelemeye aldığında) sayaç kendiliğinden
 * düşer, ayrı bir "okundu" bayrağı hiç gerekmez.
 */
export type StoredContactMessage = {
  id: string;
  /** Kullanıcıya gösterilen, insan-okur kayıt numarası — GERÇEK kimlik `id`dir, bu yalnızca görüntüleme/referans içindir. */
  referenceNumber: string;
  name: string;
  /** Boş string = girilmedi (bkz. submitContactMessage — en az biri zorunlu, ikisi birden boş olamaz). */
  email: string;
  phone: string;
  subject: ContactMessageSubject;
  message: string;
  createdAt: string;
  updatedAt: string;
  /** Gönderim anında oturum açıksa o kullanıcının id'si; misafirse `null`. */
  userId: string | null;
  /** Gönderim anındaki rol; misafirse `null`. */
  userRole: UserRole | null;
  status: ContactMessageStatus;
  /** Yalnızca bir admin not eklediyse vardır. */
  adminNote?: string;
  /** Yalnızca durumu en az bir kez değiştirilmiş/notlanmışsa vardır. */
  reviewedByAdminId?: string;
};

function readContactMessages(): StoredContactMessage[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CONTACT_MESSAGES_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredContactMessage => isStoredContactMessage(item));
  } catch {
    return [];
  }
}

function isStoredContactMessage(value: unknown): value is StoredContactMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    typeof message.referenceNumber === "string" &&
    typeof message.name === "string" &&
    typeof message.email === "string" &&
    typeof message.phone === "string" &&
    isContactMessageSubject(message.subject) &&
    typeof message.message === "string" &&
    typeof message.createdAt === "string" &&
    typeof message.updatedAt === "string" &&
    (message.userId === null || typeof message.userId === "string") &&
    (message.userRole === null ||
      message.userRole === "hizmet-alan" ||
      message.userRole === "hizmet-veren" ||
      message.userRole === "admin") &&
    isContactMessageStatus(message.status)
  );
}

function writeContactMessages(messages: StoredContactMessage[]): boolean {
  return writeJson(CONTACT_MESSAGES_STORAGE_KEY, messages);
}

/** Kullanıcıya gösterilen kayıt numarası — "BU-<yıl>-<5 haneli sıra>" biçiminde, o ana kadar gönderilmiş mesaj sayısına göre üretilir. Yalnızca görüntüleme amaçlıdır, tekilliği garanti eden asıl kimlik `id`dir (crypto.randomUUID()). */
function generateReferenceNumber(existingCount: number): string {
  const year = new Date().getFullYear();
  const sequence = String(existingCount + 1).padStart(5, "0");
  return `BU-${year}-${sequence}`;
}

export type SubmitContactMessageInput = {
  session: Session | null;
  name: string;
  email: string;
  phone: string;
  subject: ContactMessageSubject;
  message: string;
};

export type SubmitContactMessageResult =
  | { ok: true; contactMessage: StoredContactMessage }
  | { ok: false; error: string };

/**
 * "Bize Ulaşın" gönderimi — arayüz doğrulamasına güvenilmez, bu fonksiyon
 * `register-form-validation.ts`/`users.ts#registerUser` ile AYNI ilkeyle
 * kuralları KENDİSİ de tekrar uygular. En az bir iletişim yolu (e-posta YA
 * DA telefon) zorunludur — hem misafir hem giriş yapmış kullanıcı için
 * (bkz. görev tanımı, ikisi de "en az biri" der).
 */
export function submitContactMessage(input: SubmitContactMessageInput): SubmitContactMessageResult {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, error: "Ad soyad zorunludur." };
  }

  if (!isContactMessageSubject(input.subject)) {
    return { ok: false, error: "Konu seçiniz." };
  }

  const message = input.message.trim();
  if (message.length === 0) {
    return { ok: false, error: "Mesaj zorunludur." };
  }
  if (message.length < CONTACT_MESSAGE_MIN_LENGTH) {
    return { ok: false, error: `Mesaj en az ${CONTACT_MESSAGE_MIN_LENGTH} karakter olmalıdır.` };
  }
  if (message.length > CONTACT_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Mesaj en fazla ${CONTACT_MESSAGE_MAX_LENGTH} karakter olabilir.` };
  }

  const emailRaw = input.email.trim();
  if (emailRaw.length > 0 && !isValidEmail(emailRaw)) {
    return { ok: false, error: "Geçerli bir e-posta adresi giriniz." };
  }

  let normalizedPhone = "";
  const phoneRaw = input.phone.trim();
  if (phoneRaw.length > 0) {
    const phoneResult = normalizePhoneNumber(phoneRaw);
    if (!phoneResult.ok) {
      return { ok: false, error: phoneResult.error };
    }
    normalizedPhone = phoneResult.value;
  }

  if (emailRaw.length === 0 && normalizedPhone.length === 0) {
    return { ok: false, error: "E-posta veya telefon numaranızdan en az birini giriniz." };
  }

  const existing = readContactMessages();
  const now = new Date().toISOString();
  const contactMessage: StoredContactMessage = {
    id: crypto.randomUUID(),
    referenceNumber: generateReferenceNumber(existing.length),
    name,
    email: emailRaw,
    phone: normalizedPhone,
    subject: input.subject,
    message,
    createdAt: now,
    updatedAt: now,
    userId: input.session?.id ?? null,
    userRole: input.session?.role ?? null,
    status: "yeni",
  };

  if (!writeContactMessages([...existing, contactMessage])) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  contactMessagesStore.notify();
  return { ok: true, contactMessage };
}

/** Tüm mesajları en yeniden en eskiye döner — yalnızca admin ekranı için (bkz. contact-messages-admin-panel.tsx). */
export function getAllContactMessages(): StoredContactMessage[] {
  return [...readContactMessages()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export type ReviewContactMessageInput = {
  id: string;
  status: ContactMessageStatus;
  /** `undefined` = admin notu bu çağrıda değiştirilmiyor (mevcut not korunur). Boş string = notu temizle. */
  adminNote?: string;
};

export type ReviewContactMessageResult =
  | { ok: true; contactMessage: StoredContactMessage }
  | { ok: false; error: string };

/**
 * Durum değiştirme VE admin notu ekleme TEK bir yazma yolundan geçer —
 * provider-document-reviews.ts#recordProviderDocumentReview ile AYNI
 * savunma ilkesi: arayüze güvenmeden `session.role === "admin"` burada
 * TEKRAR kontrol edilir (veri katmanı yetkisi). "Arşivleme" ayrı bir
 * fonksiyon DEĞİLDİR — yalnızca `status: "arsivlendi"` ile bu fonksiyonun
 * çağrılmasıdır (bkz. görev tanımı — kayıt asla silinmez, yalnızca durumu
 * değişir).
 */
export function reviewContactMessage(
  session: Session | null,
  input: ReviewContactMessageInput,
): ReviewContactMessageResult {
  if (!session || session.role !== "admin") {
    return { ok: false, error: "Bu işlem için yönetici girişi yapmalısınız." };
  }

  const existing = readContactMessages();
  const target = existing.find((item) => item.id === input.id);
  if (!target) {
    return { ok: false, error: "Mesaj bulunamadı." };
  }

  const updated: StoredContactMessage = {
    ...target,
    status: input.status,
    adminNote: input.adminNote !== undefined ? input.adminNote.trim() || undefined : target.adminNote,
    reviewedByAdminId: session.id,
    updatedAt: new Date().toISOString(),
  };

  if (!writeContactMessages(existing.map((item) => (item.id === input.id ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  contactMessagesStore.notify();
  return { ok: true, contactMessage: updated };
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedMessages: StoredContactMessage[] = [];

function getSnapshot(): StoredContactMessage[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CONTACT_MESSAGES_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedMessages;
  cachedRaw = raw;
  cachedMessages = readContactMessages();
  return cachedMessages;
}

function getServerSnapshot(): StoredContactMessage[] {
  return [];
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** job-store.ts/offers.ts ile AYNI modül-önbellek + useSyncExternalStore deseni — bu tabloya özel `notify()`, yalnızca AYNI sekmedeki dinleyicileri (ör. admin panelini açık tutan bir sekme) anında günceller; `storage` event'i farklı sekmeler arasını kapsar. */
export const contactMessagesStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  notify(): void {
    for (const listener of listeners) listener();
  },
};
