"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  CONTACT_MESSAGE_STATUS_OPTIONS,
  CONTACT_MESSAGE_SUBJECT_OPTIONS,
  getContactMessageSubjectLabel,
  type ContactMessageStatus,
  type ContactMessageSubject,
} from "../_lib/contact-messages";
import {
  listAllContactMessagesForAdminRemote,
  reviewContactMessageRemote,
  type RemoteContactMessage,
} from "../_lib/supabase-contact-messages";
import type { UserRole } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AdminNav } from "./admin-nav";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const STATUS_TONE: Record<ContactMessageStatus, "success" | "warning" | "neutral" | "danger"> = {
  yeni: "warning",
  inceleniyor: "neutral",
  "yanit-bekliyor": "neutral",
  cozuldu: "success",
  arsivlendi: "neutral",
};

const ROLE_LABEL: Record<UserRole, string> = {
  "hizmet-alan": "Hizmet Alan",
  "hizmet-veren": "Hizmet Veren",
  admin: "Yönetici",
};

type RoleFilter = "" | "misafir" | UserRole;

const ROLE_FILTER_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "", label: "Tüm Kullanıcılar" },
  { value: "misafir", label: "Misafir" },
  { value: "hizmet-alan", label: "Hizmet Alan" },
  { value: "hizmet-veren", label: "Hizmet Veren" },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function ContactMessageCard({ contactMessage, onSaved }: { contactMessage: RemoteContactMessage; onSaved: () => void }) {
  const statusId = useId();
  const noteId = useId();
  const [status, setStatus] = useState<ContactMessageStatus>(contactMessage.status);
  const [note, setNote] = useState(contactMessage.adminNote ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Supabase artık gerçek kaynak — kaydetme sonrası `onSaved` (üst bileşenin
  // `refresh()`'i, admin-jobs-list.tsx ile AYNI refreshKey deseni) listeyi
  // yeniden çeker; `dirty` o taze veriyle otomatik `false`'a döner.
  const dirty = status !== contactMessage.status || note !== (contactMessage.adminNote ?? "");

  async function handleSave() {
    setSubmitting(true);
    setActionError(null);
    const result = await reviewContactMessageRemote(contactMessage.id, status, note);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    onSaved();
  }

  async function handleArchive() {
    setSubmitting(true);
    setActionError(null);
    const result = await reviewContactMessageRemote(contactMessage.id, "arsivlendi");
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setStatus("arsivlendi");
    onSaved();
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{contactMessage.referenceNumber}</p>
          <p className="mt-1 text-base font-bold tracking-heading leading-tight text-foreground">
            {contactMessage.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {contactMessage.userId
              ? `Kayıtlı kullanıcı — ${contactMessage.userRole ? ROLE_LABEL[contactMessage.userRole] : "-"} (${contactMessage.userId})`
              : "Misafir kullanıcı"}
          </p>
        </div>
        <StatusBadge
          label={CONTACT_MESSAGE_STATUS_OPTIONS.find((option) => option.value === contactMessage.status)?.label ?? contactMessage.status}
          tone={STATUS_TONE[contactMessage.status]}
        />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Konu</dt>
          <dd className="text-sm text-foreground">{getContactMessageSubjectLabel(contactMessage.subject)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Gönderim Tarihi</dt>
          <dd className="text-sm text-foreground">{formatDateTime(contactMessage.createdAt)}</dd>
        </div>
        {contactMessage.email && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">E-posta</dt>
            <dd className="text-sm text-foreground">
              <a href={`mailto:${contactMessage.email}`} className="text-primary hover:underline">
                {contactMessage.email}
              </a>
            </dd>
          </div>
        )}
        {contactMessage.phone && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Telefon</dt>
            <dd className="flex flex-wrap items-center gap-3 text-sm text-foreground">
              <span>{contactMessage.phone}</span>
              <a href={`tel:${contactMessage.phone}`} className="font-medium text-primary hover:underline">
                Ara
              </a>
              <a
                href={`https://wa.me/${contactMessage.phone.replace("+", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                WhatsApp
              </a>
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Mesaj</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{contactMessage.message}</p>
      </div>

      <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <div>
          <label htmlFor={statusId} className="text-sm font-medium text-foreground">
            Durum
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => setStatus(event.target.value as ContactMessageStatus)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {CONTACT_MESSAGE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={noteId} className="text-sm font-medium text-foreground">
            Admin Notu <span className="font-normal text-muted-foreground">(yalnızca yöneticiler görür)</span>
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      {contactMessage.reviewedByAdminId && (
        <p className="mt-2 text-xs text-muted-foreground">
          Son güncelleme: {formatDateTime(contactMessage.updatedAt)}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {actionError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting || !dirty}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Kaydet
        </button>
        {contactMessage.status !== "arsivlendi" && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Arşivle
          </button>
        )}
      </div>
    </div>
  );
}

export function ContactMessagesAdminPanel() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [allMessages, setAllMessages] = useState<RemoteContactMessage[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listAllContactMessagesForAdminRemote().then((result) => {
      if (cancelled) return;
      setAllMessages(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  const searchFilterId = useId();
  const statusFilterId = useId();
  const subjectFilterId = useId();
  const roleFilterId = useId();
  const sortOrderId = useId();

  const [statusFilter, setStatusFilter] = useState<ContactMessageStatus | "">("");
  const [subjectFilter, setSubjectFilter] = useState<ContactMessageSubject | "">("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"en-yeni" | "en-eski">("en-yeni");

  const newCount = useMemo(() => allMessages.filter((message) => message.status === "yeni").length, [allMessages]);

  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = allMessages.filter((message) => {
      if (statusFilter && message.status !== statusFilter) return false;
      if (subjectFilter && message.subject !== subjectFilter) return false;
      if (roleFilter === "misafir" && message.userRole !== null) return false;
      if (roleFilter !== "" && roleFilter !== "misafir" && message.userRole !== roleFilter) return false;
      if (term.length > 0) {
        const haystack = `${message.name} ${message.email} ${message.phone} ${message.message} ${message.referenceNumber}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) =>
      sortOrder === "en-yeni" ? (a.createdAt < b.createdAt ? 1 : -1) : a.createdAt < b.createdAt ? -1 : 1,
    );
  }, [allMessages, statusFilter, subjectFilter, roleFilter, search, sortOrder]);

  if (!session) {
    return (
      <AuthGateNotice
        message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız."
        loginRedirect="/admin/iletisim-mesajlari"
      />
    );
  }
  if (session.role !== "admin") {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Yükleniyor...
      </div>
    );
  }

  return (
    <div>
      <AdminNav newContactMessageCount={newCount} />

      <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">Bize Ulaşın Mesajları</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ana sayfadaki &ldquo;Bize Ulaşın&rdquo; formundan gelen tüm mesajları görüntüleyin, durumunu güncelleyin ve
        iç not ekleyin.
      </p>

      <div className="mt-6 grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor={searchFilterId} className="text-xs font-medium text-muted-foreground">
            Ara
          </label>
          <input
            id={searchFilterId}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad, e-posta, telefon, mesaj..."
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div>
          <label htmlFor={statusFilterId} className="text-xs font-medium text-muted-foreground">
            Durum
          </label>
          <select
            id={statusFilterId}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ContactMessageStatus | "")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tümü</option>
            {CONTACT_MESSAGE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={subjectFilterId} className="text-xs font-medium text-muted-foreground">
            Konu
          </label>
          <select
            id={subjectFilterId}
            value={subjectFilter}
            onChange={(event) => setSubjectFilter(event.target.value as ContactMessageSubject | "")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tümü</option>
            {CONTACT_MESSAGE_SUBJECT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={roleFilterId} className="text-xs font-medium text-muted-foreground">
            Kullanıcı Rolü
          </label>
          <select
            id={roleFilterId}
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {ROLE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={sortOrderId} className="text-xs font-medium text-muted-foreground">
            Sıralama
          </label>
          <select
            id={sortOrderId}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as "en-yeni" | "en-eski")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="en-yeni">En Yeni</option>
            <option value="en-eski">En Eski</option>
          </select>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {filteredMessages.length} / {allMessages.length} mesaj gösteriliyor.
      </p>

      {filteredMessages.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Kriterlere uyan mesaj bulunamadı.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {filteredMessages.map((message) => (
            <ContactMessageCard key={message.id} contactMessage={message} onSaved={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
