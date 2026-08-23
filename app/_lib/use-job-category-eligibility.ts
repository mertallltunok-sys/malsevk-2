"use client";

import { useEffect, useState } from "react";
import { isRecyclingCategory } from "./recycling-catalog";
import { isContainerStorageCategory } from "./storage-container-catalog";
import { isHazardousStorageCategory } from "./storage-hazard-catalog";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { Job } from "./types";

export type JobCategoryEligibility = { loading: boolean; eligible: boolean | null };

/**
 * "Bu İlana Uygun" kartının GERÇEK veri kaynağı (incoming-offer-card.tsx) —
 * bir teklif verenin, GÖRÜNTÜLENEN ilanın gereksinimini HÂLÂ karşılayıp
 * karşılamadığını canlı olarak sorar. Kartın metnindeki etiketler
 * (`getRequiredStorageActivityForJob`/recycling-catalog.ts#
 * getRecyclingRequestedOperationLabel) BİLEREK saf/istemci tarafı
 * hesaplanır — çünkü Hizmet Alan zaten KENDİ ilanının TAM içeriğini
 * görebilir, bu hassas değildir; ama "bu firma hâlâ uygun mu" SORUSUNUN
 * CEVABI (bir booelan) her zaman `provider_can_view_job()` RPC'sinden
 * (migration 0059/0060/0068/0069, `create_offer`/`accept_offer`in AYNI
 * kapısı) gelir — ikinci bir eşleştirme motoru İCAT EDİLMEDİ, ve
 * provider'ın HAM `provider_service_authorizations`/`provider_recycling_
 * waste_code_authorizations` satırı (RLS: yalnızca sahibi/admin) hiçbir
 * zaman bu tarayıcıya (bir Hizmet Alan'ın oturumuna) sızmaz — yalnızca bu
 * TEK booelan.
 *
 * Bu dosya eskiden `use-storage-job-eligibility.ts` idi (yalnızca Konteyner
 * Depolama/Kimyasal-Tehlikeli Madde Depolama kapsıyordu) — "Geri Dönüşüm &
 * Atık Tahliye Uçtan Uca Geliştirme" göreviyle Geri Dönüşüm dalı da AYNI
 * TEK hooka eklendi (görev talimatı: "ikinci bir paralel mimari
 * oluşturma") ve dosya/isimler bu üç kategoriyi de kapsayacak şekilde
 * genelleştirildi — tek çağıranı (incoming-offer-card.tsx) de güncellendi.
 *
 * `useMyServiceAuthorizations` (use-my-service-authorizations.ts) İLE AYNI
 * "loading + veri" iskeleti, mount olduğunda (job/offer id değiştiğinde)
 * bir kez fetch eder.
 */
/** Depolama (Konteyner'ın faaliyet-alanı/IMO kapsamı VE Kimyasal/Tehlikeli Madde Depolama'nın risk-grubu kapsamı) VE Geri Dönüşüm & Atık Tahliye (faaliyet + atık kodu kapsamı) — DÖRDÜ de AYNI `provider_can_view_job` RPC'sini paylaşır, kategoriye göre hangi dalın devreye gireceğine RPC'nin KENDİSİ karar verir. */
function jobNeedsEligibilityCheck(job: Job): boolean {
  return isContainerStorageCategory(job.category) || isHazardousStorageCategory(job.category) || isRecyclingCategory(job.category);
}

export function useJobCategoryEligibility(job: Job | undefined, providerId: string | undefined): JobCategoryEligibility {
  const shouldFetch = Boolean(job && providerId && jobNeedsEligibilityCheck(job));
  const [state, setState] = useState<JobCategoryEligibility>({ loading: shouldFetch, eligible: null });

  useEffect(() => {
    // "Uygulanamaz" durumu (kategori/veri eksik) render zamanında zaten
    // biliniyor — burada senkron bir setState'e İHTİYAÇ YOK (react-hooks/
    // set-state-in-effect kuralı bunu yasaklar); yalnızca GERÇEK fetch
    // yolunda, .then() İÇİNDE (asenkron callback, kural kapsamı dışı)
    // setState çağrılır.
    if (!job || !providerId || !jobNeedsEligibilityCheck(job)) {
      return;
    }
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    void supabase
      .rpc("provider_can_view_job", {
        p_provider_id: providerId,
        p_category_id: job.category,
        p_storage_container_groups: job.storageContainerGroups ?? null,
        p_storage_hazardous: job.storageHazardous ?? null,
        p_storage_risk_groups: job.storageRiskGroups ?? null,
        p_recycling_requested_operation: job.recyclingRequestedOperation ?? null,
        p_recycling_waste_code: job.recyclingWasteCode ?? null,
        p_recycling_waste_code_unknown: job.recyclingWasteCodeUnknown ?? null,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({ loading: false, eligible: error ? null : Boolean(data) });
      });
    return () => {
      cancelled = true;
    };
    // job nesnesinin kendisi değil, yalnızca kimliği+ilgili alanları
    // izlenir — useAllJobs()'un döndürdüğü referansın her render'da
    // DEĞİŞMEYECEĞİ garanti edilmediği için `job` bağımlılığı sonsuz
    // yeniden-fetch riski taşırdı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    job?.id,
    job?.category,
    job?.storageContainerGroups,
    job?.storageHazardous,
    job?.storageRiskGroups,
    job?.recyclingRequestedOperation,
    job?.recyclingWasteCode,
    job?.recyclingWasteCodeUnknown,
    providerId,
  ]);

  if (!shouldFetch) return { loading: false, eligible: null };
  return state;
}
