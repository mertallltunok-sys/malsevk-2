"use client";

import { Building2, ClipboardList, FileText, Loader2, Search, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getProviderDocumentTypeLabel } from "../_lib/provider-documents";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import { useDropdown } from "../_lib/use-dropdown";

/**
 * ÜST ÇUBUK GENEL ARAMASI (görev bölüm 18) — admin-only, gerçek Supabase
 * sorgularıyla. Bu depodaki İLK debounce kullanımı: mevcut arama/filtre
 * alanları (searchable-select.tsx, admin-companies-list.tsx) her zaman
 * ÖNCEDEN tamamen yüklenmiş bir listeyi bellekte `useMemo` ile filtreler
 * (bkz. CLAUDE.md); burada durum farklı — 5 farklı tabloyu her tuş
 * vuruşunda taramak "gereksiz tüm veritabanı taraması" anlamına gelir (görev
 * gereksinimi), bu yüzden gerçek bir sunucu round-trip'i 300ms geciktirilir.
 * Her sorgu `limit(5)` ile sınırlıdır.
 */

type SearchResultGroup = "firma" | "hizmet-alan" | "ilan" | "operasyon" | "belge";

type SearchResult = {
  group: SearchResultGroup;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

const GROUP_META: Record<SearchResultGroup, { label: string; icon: typeof Building2 }> = {
  firma: { label: "Firmalar", icon: Building2 },
  "hizmet-alan": { label: "Hizmet Alanlar", icon: Users },
  ilan: { label: "İlanlar", icon: ClipboardList },
  operasyon: { label: "Operasyonlar", icon: Workflow },
  belge: { label: "Belgeler", icon: FileText },
};

async function runSearch(query: string): Promise<SearchResult[]> {
  const supabase = createSupabaseBrowserClient();
  // Genel Güvenlik görevi §9 — `.or()` PostgREST filtresi virgül/parantezi
  // AYRI bir filtre yan tümcesi olarak yorumlar; bu karakterler arama
  // metninden çıkarılmadan ham olarak enterpole edilirse (ör. bir firma adı
  // "Firma, A.Ş." gibi virgül içerirse ya da kötü niyetli biçimde
  // "x,role.eq.admin" yazılırsa) sorgu istenmeyen ek yan tümcelerle
  // GENİŞLEYEBİLİRDİ. Arama yalnızca admin'in zaten tam okuma yetkisi olan
  // tablolara karşı çalıştığı için pratik yetki artışı riski yok, ama
  // "arama sorgularında özel karakterler kontrollü işlenmeli" gereksinimine
  // uymak için bu karakterler burada temizlenir.
  const sanitizedQuery = query.replace(/[,()]/g, " ").trim();
  const like = `%${sanitizedQuery}%`;

  const [companiesResult, requestersResult, jobsResult, documentsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, company_name")
      .eq("role", "hizmet-veren")
      .or(`full_name.ilike.${like},company_name.ilike.${like},phone.ilike.${like}`)
      .limit(5),
    supabase
      .from("profiles")
      .select("id, full_name, company_name")
      .eq("role", "hizmet-alan")
      .or(`full_name.ilike.${like},company_name.ilike.${like},phone.ilike.${like}`)
      .limit(5),
    supabase.from("admin_job_list").select("id, title, province, district").ilike("title", like).is("deleted_at", null).limit(5),
    supabase
      .from("provider_documents")
      .select("id, document_type, original_file_name, provider_id")
      .ilike("original_file_name", like)
      .is("deleted_at", null)
      .limit(5),
  ]);

  const results: SearchResult[] = [];

  for (const row of (companiesResult.data ?? []) as { id: string; full_name: string | null; company_name: string | null }[]) {
    results.push({
      group: "firma",
      id: row.id,
      label: row.company_name ?? row.full_name ?? "İsimsiz Firma",
      sublabel: row.company_name ? row.full_name : null,
      href: `/admin/firmalar/${row.id}`,
    });
  }

  for (const row of (requestersResult.data ?? []) as { id: string; full_name: string | null; company_name: string | null }[]) {
    results.push({
      group: "hizmet-alan",
      id: row.id,
      label: row.full_name ?? row.company_name ?? "İsimsiz Kullanıcı",
      sublabel: row.company_name,
      href: `/admin/hizmet-alanlar/${row.id}`,
    });
  }

  const jobRows = (jobsResult.data ?? []) as { id: string; title: string; province: string; district: string }[];
  for (const row of jobRows) {
    results.push({
      group: "ilan",
      id: row.id,
      label: row.title,
      sublabel: `${row.province} / ${row.district}`,
      href: `/admin/ilanlar/${row.id}`,
    });
  }

  // Operasyon: aynı eşleşen ilanlara bağlı teklifler — ayrı bir metin alanı
  // taşımadığı için kendi ilike sorgusu yerine yukarıdaki iş sonuçları
  // üzerinden türetilir (görev gereksinimi: gereksiz tam tablo taraması
  // yapılmasın).
  if (jobRows.length > 0) {
    const { data: offerRows } = await supabase
      .from("admin_offer_list")
      .select("id, job_id, amount, status")
      .in(
        "job_id",
        jobRows.map((row) => row.id),
      )
      .limit(5);
    for (const row of (offerRows ?? []) as { id: string; job_id: string; amount: number; status: string }[]) {
      const job = jobRows.find((item) => item.id === row.job_id);
      results.push({
        group: "operasyon",
        id: row.id,
        label: job ? `Teklif — ${job.title}` : "Teklif",
        sublabel: `${row.amount.toLocaleString("tr-TR")} ₺ · ${row.status}`,
        href: `/admin/operasyonlar/${row.id}`,
      });
    }
  }

  const providerIds = Array.from(new Set((documentsResult.data ?? []).map((row) => (row as { provider_id: string }).provider_id)));
  const providerNameById = new Map<string, string | null>();
  if (providerIds.length > 0) {
    const { data: providerRows } = await supabase.from("profiles").select("id, company_name, full_name").in("id", providerIds);
    for (const row of (providerRows ?? []) as { id: string; company_name: string | null; full_name: string | null }[]) {
      providerNameById.set(row.id, row.company_name ?? row.full_name);
    }
  }
  for (const row of (documentsResult.data ?? []) as { id: string; document_type: string; original_file_name: string; provider_id: string }[]) {
    results.push({
      group: "belge",
      id: row.id,
      label: row.original_file_name,
      sublabel: `${getProviderDocumentTypeLabel(row.document_type)} · ${providerNameById.get(row.provider_id) ?? "Bilinmeyen firma"}`,
      href: `/admin/firma-belgeleri/${row.id}`,
    });
  }

  return results;
}

export function AdminGlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // `setResults`/`setLoading`'in senkron sıfırlanması BİLEREK burada değil,
  // `handleQueryChange` (gerçek bir kullanıcı olayı) içinde yapılır — bu
  // proje `react-hooks/set-state-in-effect` kuralını zorunlu kılar (bkz.
  // admin-jobs-list.tsx'in AYNI deseni). Bu effect yalnızca (asenkron)
  // debounce zamanlayıcısını kurar/temizler.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const thisRequestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      void runSearch(trimmed).then((next) => {
        if (requestIdRef.current !== thisRequestId) return;
        setResults(next);
        setLoading(false);
      });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setOpen(true);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  const grouped = (Object.keys(GROUP_META) as SearchResultGroup[])
    .map((group) => ({ group, items: results.filter((result) => result.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Firma, ilan veya kullanıcı ara..."
          maxLength={100}
          className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 top-12 z-50 max-h-96 w-full min-w-[20rem] overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-md">
          {loading && results.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Aranıyor...</p>}
          {!loading && grouped.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Sonuç bulunamadı.</p>}
          {grouped.map(({ group, items }) => {
            const meta = GROUP_META[group];
            const Icon = meta.icon;
            return (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                {items.map((item) => (
                  <Link
                    key={`${item.group}-${item.id}`}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-background"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{item.label}</span>
                      {item.sublabel && <span className="block truncate text-xs text-muted-foreground">{item.sublabel}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
