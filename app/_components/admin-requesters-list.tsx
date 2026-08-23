"use client";

import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listRequestersForAdmin, type AdminRequesterListItem } from "../_lib/admin-requesters";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

function accountStatusLabel(status: AdminRequesterListItem["accountStatus"]): string {
  return status === "active" ? "Aktif" : status === "suspended" ? "Askıya Alınmış" : "Yasaklı";
}

export function AdminRequestersList() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [requesters, setRequesters] = useState<AdminRequesterListItem[]>([]);

  const [search, setSearch] = useState("");
  const [accountStatusFilter, setAccountStatusFilter] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listRequestersForAdmin().then((result) => {
      if (cancelled) return;
      setRequesters(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
    return requesters.filter((requester) => {
      if (normalizedSearch) {
        const haystack = `${requester.fullName ?? ""} ${requester.companyName ?? ""} ${requester.phone ?? ""}`.toLocaleLowerCase("tr-TR");
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (accountStatusFilter === "active" && requester.accountStatus !== "active") return false;
      if (accountStatusFilter === "inactive" && requester.accountStatus === "active") return false;
      return true;
    });
  }, [requesters, search, accountStatusFilter]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/hizmet-alanlar" />;
  }
  if (!isAdmin) {
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
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad soyad, firma veya telefon ara..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:max-w-xs">
          <select
            value={accountStatusFilter}
            onChange={(event) => setAccountStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Aktif / Pasif (tümü)</option>
            <option value="active">Yalnız aktif</option>
            <option value="inactive">Yalnız pasif</option>
          </select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} hizmet alan kullanıcı bulundu.</p>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Ad Soyad</th>
              <th className="px-4 py-3">Firma</th>
              <th className="px-4 py-3">Telefon</th>
              <th className="px-4 py-3">İl / İlçe</th>
              <th className="px-4 py-3">Kayıt Tarihi</th>
              <th className="px-4 py-3">Hesap Durumu</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((requester) => (
              <tr key={requester.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-medium text-foreground">{requester.fullName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{requester.companyName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{requester.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{[requester.province, requester.district].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(requester.createdAt).toLocaleDateString("tr-TR")}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    label={accountStatusLabel(requester.accountStatus)}
                    tone={requester.accountStatus === "active" ? "success" : "danger"}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/hizmet-alanlar/${requester.id}`}
                    className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Detay
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Arama/filtre kriterlerine uyan hizmet alan kullanıcı bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
