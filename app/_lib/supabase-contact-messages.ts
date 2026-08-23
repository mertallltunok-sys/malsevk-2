import type { ContactMessageStatus, ContactMessageSubject } from "./contact-messages";
import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { UserRole } from "./types";

/**
 * "Bize Ulaşın" — Supabase geçişi. Şema/RPC'ler ZATEN vardı (migration 0021,
 * `submit_contact_message`/`review_contact_message`, RLS: gönderen kendi
 * mesajını + admin tümünü görür) — hiçbiri bu görevden önce hiçbir app-kodu
 * tarafından çağrılmıyordu, `contact-messages.ts` yalnızca localStorage'a
 * yazıyordu. Bu modül o eksik bağlantıyı tamamlar.
 *
 * Diğer Supabase geçişlerinin (jobs, provider profile/documents) aksine bu
 * TAM bir cutover'dır, hibrit/dual-write DEĞİL: "Bize Ulaşın" formu hiçbir
 * canlı localStorage sistemine (job-store.ts/offers.ts gibi) bağımlı
 * değildir, izole bir özelliktir — bu yüzden ayrı bir yerel yazım yolu
 * (fallback) tutmanın hiçbir gerekçesi yoktur; localStorage tarafı
 * (contact-messages.ts#submitContactMessage/reviewContactMessage/
 * getAllContactMessages/contactMessagesStore) tamamen kaldırıldı — bkz. o
 * dosyanın şimdiki (yalnızca katalog/tip) hâli.
 *
 * `admin-dashboard-data.ts`'in "Açık Destek Mesajı" sayacı zaten bu AYNI
 * `contact_messages` tablosunu okuyordu (status='yeni') — bu modülün yazma
 * yolu devreye girince o sayaç kendiliğinden doğru değer göstermeye başlar,
 * ayrıca bir değişiklik gerekmez.
 */
export type RemoteContactMessage = {
  id: string;
  referenceNumber: string;
  name: string;
  email: string;
  phone: string;
  subject: ContactMessageSubject;
  message: string;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  userRole: UserRole | null;
  status: ContactMessageStatus;
  adminNote?: string;
  reviewedByAdminId?: string;
};

type ContactMessageRow = {
  id: string;
  reference_number: string;
  name: string;
  email: string;
  phone: string;
  subject: ContactMessageSubject;
  message: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  user_role: UserRole | null;
  status: ContactMessageStatus;
  admin_note: string | null;
  reviewed_by_admin_id: string | null;
};

function mapRow(row: ContactMessageRow): RemoteContactMessage {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
    userRole: row.user_role,
    status: row.status,
    adminNote: row.admin_note ?? undefined,
    reviewedByAdminId: row.reviewed_by_admin_id ?? undefined,
  };
}

function mapContactMessageRpcError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK95":
      return "Ad soyad zorunludur.";
    case "MLK96":
      return "Geçerli bir konu seçiniz.";
    case "MLK97":
      return "Mesaj 10-2000 karakter arasında olmalıdır.";
    case "MLK98":
      return "E-posta veya telefon numaranızdan en az birini giriniz.";
    case "MLK99":
      return "Geçersiz durum.";
    case "MLK50":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK76":
      return "Mesaj bulunamadı.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

export type SubmitContactMessageRemoteInput = {
  name: string;
  email: string;
  phone: string;
  subject: ContactMessageSubject;
  message: string;
};

export type SubmitContactMessageRemoteResult = { ok: true; referenceNumber: string } | { ok: false; error: string };

/**
 * `submit_contact_message` RPC'si hem misafir (anon) hem oturum açık
 * kullanıcı için grant edilmiştir — `user_id`/`user_role` sunucu tarafında
 * `auth.uid()`/`current_user_role()`den belirlenir, buradan hiç
 * gönderilmez (bkz. RPC'nin kendi yorumu, "başka bir kullanıcı adına mesaj
 * oluşturulamaz").
 */
export async function submitContactMessageRemote(input: SubmitContactMessageRemoteInput): Promise<SubmitContactMessageRemoteResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("submit_contact_message", {
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_subject: input.subject,
    p_message: input.message,
  });
  if (error) return { ok: false, error: mapContactMessageRpcError(error) };
  return { ok: true, referenceNumber: (data as ContactMessageRow).reference_number };
}

/** Admin-only — RLS (`contact_messages_select_own_or_admin`) zaten is_admin() dalıyla tüm satırlara izin verir. */
export async function listAllContactMessagesForAdminRemote(): Promise<RemoteContactMessage[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("contact_messages").select("*").order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ContactMessageRow[]).map(mapRow);
}

export type ReviewContactMessageRemoteResult = { ok: true } | { ok: false; error: string };

/** `p_admin_note: undefined` -> RPC'ye `null` gider -> mevcut not korunur (bkz. RPC'nin kendi "NULL = mevcut notu koru" davranışı, review_contact_message'ın dokümantasyonu). */
export async function reviewContactMessageRemote(
  id: string,
  status: ContactMessageStatus,
  adminNote?: string,
): Promise<ReviewContactMessageRemoteResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("review_contact_message", {
    p_id: id,
    p_status: status,
    p_admin_note: adminNote ?? null,
  });
  if (error) return { ok: false, error: mapContactMessageRpcError(error) };
  return { ok: true };
}
