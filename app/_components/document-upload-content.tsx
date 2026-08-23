"use client";

import { CheckCircle2, Loader2, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CUSTOMS_LICENSE_DOCUMENT_TYPE, GENERAL_DOCUMENT_TYPE, type ProviderDocumentType } from "../_lib/provider-documents";
import { getPhotoBlob } from "../_lib/photo-blob-store";
import {
  SERVICE_CATEGORY_GROUPS,
  GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
  PROVIDER_AUTHORIZATION_GROUPS,
  getServiceCategoryLabel,
  type ProviderAuthorizationGroup,
} from "../_lib/service-catalog";
import {
  getImoClassOptionLabel,
  HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID,
  IMO_CLASS_OPTIONS,
  STORAGE_ACTIVITY_SCOPE_OPTIONS,
  STORAGE_CONTAINER_CATEGORY_ID,
} from "../_lib/storage-container-catalog";
import { isRecyclingCategory, RECYCLING_ACTIVITY_OPTIONS } from "../_lib/recycling-catalog";
import { formatWasteCodeOptionLabel, WASTE_CODE_ENTRIES } from "../_lib/recycling-waste-code-catalog";
import { isHazardousStorageCategory, STORAGE_RISK_GROUP_CATEGORIES } from "../_lib/storage-hazard-catalog";
import { getMyExistingGroupDocumentTypes, getMyServiceAuthorizations } from "../_lib/supabase-my-service-authorizations";
import { setMyProviderServiceCategoriesRemote } from "../_lib/supabase-provider-services";
import { uploadAndRegisterProviderDocument } from "../_lib/supabase-provider-documents";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { MultiSelectChips } from "./multi-select-chips";
import { ProviderDocumentUpload, type ReadyProviderDocument } from "./provider-document-upload";

const STORAGE_ACTIVITY_SCOPE_SELECT_OPTIONS = STORAGE_ACTIVITY_SCOPE_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const IMO_CLASS_SELECT_OPTIONS = IMO_CLASS_OPTIONS.map((option) => ({
  value: option.id,
  label: getImoClassOptionLabel(option),
  description: option.groupLabel,
}));
/** IMO_CLASS_SELECT_OPTIONS İLE AYNI desen — `MultiSelectChips` (bu dosyada kullanılan, `CompactMultiSelect`'ten FARKLI bileşen) gerçek grup başlığı göstermez, kategori adını yalnızca hover-tooltip (`description`) olarak taşır. */
const STORAGE_RISK_GROUP_SELECT_OPTIONS = STORAGE_RISK_GROUP_CATEGORIES.flatMap((category) =>
  category.options.map((option) => ({ value: option.id, label: option.label, description: category.label })),
);
/** "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi — STORAGE_RISK_GROUP_SELECT_OPTIONS İLE AYNI desen, faaliyet (3 sabit id) VE atık kodu (86 resmî EK-4 kodu) eksenleri için. */
const RECYCLING_ACTIVITY_SELECT_OPTIONS = RECYCLING_ACTIVITY_OPTIONS.map((option) => ({ value: option.id, label: option.label }));
const RECYCLING_WASTE_CODE_SELECT_OPTIONS = WASTE_CODE_ENTRIES.map((entry) => ({
  value: entry.code,
  label: formatWasteCodeOptionLabel(entry),
  description: entry.groupLabel,
}));

/** Bir `PendingPick`in HEDEF kategori kümesinin Konteyner Depolama'yı içerip içermediği — "Depocu Faaliyet Alanları" seçicisinin gösterilip gösterilmeyeceğine karar veren TEK yer. */
function pickTargetsContainerStorage(pick: PendingPick): boolean {
  return pick.kind === "group" ? pick.categoryIds.includes(STORAGE_CONTAINER_CATEGORY_ID) : pick.categoryId === STORAGE_CONTAINER_CATEGORY_ID;
}

/** `pickTargetsContainerStorage` İLE AYNI ilke — Kimyasal Depolama/Tehlikeli Madde Depolama'yı hedefleyen bir seçim için "Risk Grupları" seçicisinin gösterilip gösterilmeyeceğine karar verir. Pratikte her ikisi de "Depo Hizmetleri Veriyorum" GRUBUNA dahildir (bkz. service-catalog.ts#PROVIDER_AUTHORIZATION_GROUPS), bu yüzden `kind: "category"` dalı yalnızca tip bütünlüğü için, konteyner deposu ile AYNI sebeple tutulur. */
function pickTargetsHazardousStorage(pick: PendingPick): boolean {
  return pick.kind === "group"
    ? pick.categoryIds.some((categoryId) => isHazardousStorageCategory(categoryId))
    : isHazardousStorageCategory(pick.categoryId);
}

/** `pickTargetsHazardousStorage` İLE AYNI ilke — Geri Dönüşüm & Atık Tahliye'yi hedefleyen bir seçim için "Faaliyetler"/"Atık Kodları" seçicilerinin gösterilip gösterilmeyeceğine karar verir. Bu kategori HİÇBİR PROVIDER_AUTHORIZATION_GROUPS grubuna dahil değildir (migration 0044'ün kendi kapsam dışı listesi) — bu yüzden `kind: "group"` dalı pratikte hiç tetiklenmez, yalnızca tip bütünlüğü için tutulur. */
function pickTargetsRecycling(pick: PendingPick): boolean {
  return pick.kind === "group" ? pick.categoryIds.some((categoryId) => isRecyclingCategory(categoryId)) : isRecyclingCategory(pick.categoryId);
}

/**
 * BELGE/YETKİ SADELEŞTİRMESİ (migration 0044) — bu kümedeki HER kategori
 * artık tek tek DEĞİL, sahibi olduğu PROVIDER_AUTHORIZATION_GROUPS grubu
 * üzerinden tek bir belgeyle seçilir/yüklenir (aşağıdaki `availableGroups`
 * hesaplaması bu kategorileri per-kategori listeden ÇIKARIR, `availableAuthorizationGroups`
 * onların YERİNE tek bir buton gösterir). İlan taksonomisi (SERVICE_CATEGORY_GROUPS,
 * job-request-form.tsx/job-edit-form.tsx'in okuduğu) HİÇ değişmedi — bu yalnızca
 * bu sayfanın kendi seçici gösterimidir.
 */
const CONSOLIDATED_CATEGORY_IDS = new Set(PROVIDER_AUTHORIZATION_GROUPS.flatMap((group) => group.categoryIds));

/**
 * "Belge Yükleme" — kayıt formundan tamamen ayrıştırılmış, kayıt-sonrası
 * hizmet ekleme akışı (görev bölüm 2/4-7). Kayıt artık yalnızca hesap
 * oluşturur; bir hizmet vereni yeni bir hizmete GERÇEK yetki (bkz.
 * provider-service-status-card.tsx#getMyServiceAuthorizations) kazandırma
 * tek yolu buradan geçer: hizmet SEÇ -> o hizmete ait belgeyi YÜKLE -> admin
 * onayı bekle. Adım adım, tek seferde tek hizmet — "Başka Hizmet de
 * Veriyorum" her yeni hizmeti kendi bağımsız belge yüklemesiyle EKLER,
 * önceki hizmetlerin onay durumunu hiç etkilemez (görev bölüm 7: bir hizmeti
 * onaylamak başka birini asla otomatik açmamalı — bu zaten
 * provider_service_authorizations'ın kendi (provider_id, service_category_id)
 * bazlı satır yapısından gelir, burada ekstra bir önlem gerekmez).
 *
 * SIRA ZORUNLU: `create_provider_document`in kendi ML124 doğrulaması (0038),
 * bir belgenin yalnızca ÇAĞIRANIN KENDİ `provider_services`ında ZATEN var
 * olan bir kategoriyle ilişkilendirilebileceğini şart koşar — bu yüzden
 * `setMyProviderServiceCategoriesRemote` HER ZAMAN `uploadAndRegisterProviderDocument`dan
 * ÖNCE, başarıyla tamamlanmış olmalıdır (aşağıdaki `handleUploadSubmit`).
 *
 * TAM DEĞİŞTİRME UYARISI: `set_provider_service_categories` RPC'si (0014)
 * delete-then-insert'tir (TAM değiştirme, artımlı EKLEME değil) — bu yüzden
 * her çağrıda önceden seçilmiş TÜM hizmetler + yeni hizmet birlikte
 * gönderilir (`selectedCategoryIds` state'i baştan yüklenir ve her başarılı
 * eklemeden sonra güncellenir), yoksa önceki hizmetler sessizce silinir.
 *
 * TEK HİZMET-EKLEME YOLU DEĞİL: Panel > Profilim > Hizmet Bilgilerim
 * (service-info-editor.tsx) da `set_provider_service_categories`'i doğrudan
 * çağırabilir — bu yüzden picker yalnızca "not_selected" değil, "document_
 * required" (o EKRANDAN belgesiz eklenmiş) kategorileri de tıklanabilir
 * gösterir (aşağıdaki `pickableCategoryIds`), yoksa o kullanıcı belgesini
 * hiçbir yerden yükleyemez.
 */

/** Tekil bir kategori seçimi ile bir GRUP seçimi (migration 0044) arasındaki tek fark: kaç kategori id'sinin `provider_services`e ekleneceği ve hangi `document_type`in gönderileceği. */
type PendingPick =
  | { kind: "category"; categoryId: string; label: string }
  | { kind: "group"; groupId: string; label: string; documentType: ProviderDocumentType; categoryIds: string[] };

type FlowStep =
  | { kind: "loading" }
  | { kind: "picking" }
  | { kind: "uploading"; pick: PendingPick }
  | { kind: "added"; label: string };

/** `pickedId`: bu oturumda tekrar seçilmemesi için izlenen id (kategori id'si YA DA grup id'si — iki ayrı ad alanı, çakışma riski yok). `categoryIds`: gerçekte `provider_services`e eklenmesi/onay sonrası authorize edilmesi gereken kategori(ler). */
type CompletedEntry = { pickedId: string; label: string; categoryIds: string[] };

function documentTypeForCategory(categoryId: string): ProviderDocumentType {
  return categoryId === GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID ? CUSTOMS_LICENSE_DOCUMENT_TYPE : GENERAL_DOCUMENT_TYPE;
}


export function DocumentUploadContent() {
  const session = useSession();
  const searchParams = useSearchParams();
  // §37 (bildirim derin bağlantısı): ?hizmet=<id> ile gelen bir bildirim,
  // seçici adımını atlayıp doğrudan o hizmetin belge yükleme adımına düşer —
  // yalnızca hâlâ SEÇİLEBİLİR/BELGE-YÜKLENEBİLİR bir kategoriyse.
  const deepLinkCategoryId = searchParams.get("hizmet");

  // `selectedCategoryIds`: provider'ın ŞU AN `provider_services`'ta olan HER
  // kategorisi (durumu ne olursa olsun) — TAM DEĞİŞTİRME RPC'sine (aşağıda)
  // gönderilecek taban küme budur. `pickableCategoryIds`: bu sayfada
  // TIKLANABİLİR kategoriler — yalnızca "not_selected" (hiç seçilmemiş) VEYA
  // "document_required" (seçilmiş ama HİÇ belgesi olmayan, ör. Panel >
  // Profilim > Hizmet Bilgilerim'den DOĞRUDAN, belgesiz eklenmiş bir hizmet
  // — bu sayfa TEK hizmet-ekleme yolu değil, bu yüzden bu durumu da
  // KARŞILAMALI, yoksa o kullanıcı belge yükleyecek hiçbir yer bulamaz).
  // "document_pending"/"authorized"/"revoked" burada hiç gösterilmez (eylem
  // gerektirmez ya da kendi ayrı yeniden-yükleme akışı vardır, bkz.
  // provider-document-status-list.tsx); "document_rejected" de burada değil,
  // AYNI o ayrı akıştan yönetilir — bu sayfa yalnızca "hiç belge yok" ilk
  // eklemeyi kapsar.
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [pickableCategoryIds, setPickableCategoryIds] = useState<Set<string>>(new Set());
  const [existingGroupDocumentTypes, setExistingGroupDocumentTypes] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<CompletedEntry[]>([]);
  const [step, setStep] = useState<FlowStep>({ kind: "loading" });
  const [documents, setDocuments] = useState<ReadyProviderDocument[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Genel Güvenlik görevi §15 — çift-gönderim koruması: job-request-form.tsx#
  // handlePublish / offer-form.tsx İLE AYNI senkron kilit deseni (React
  // state tek başına aynı JS event-loop turundaki ikinci bir çağrıyı
  // durduramaz).
  const submitLockRef = useRef(false);
  // "Depocu Faaliyet Alanları" — YALNIZCA seçilen pick Konteyner Depolama'yı
  // kapsıyorsa anlamlı (bkz. pickTargetsContainerStorage), her yeni pick'te
  // sıfırlanır (aşağıdaki handlePickCategory/handlePickGroup).
  const [storageActivityScopes, setStorageActivityScopes] = useState<string[]>([]);
  const [imoClassCodes, setImoClassCodes] = useState<string[]>([]);
  // "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi —
  // storageActivityScopes/imoClassCodes İLE AYNI "yalnızca hedef pick bu
  // kategorileri kapsıyorsa anlamlı, her yeni pick'te sıfırlanır" kuralı.
  const [requestedStorageRiskGroups, setRequestedStorageRiskGroups] = useState<string[]>([]);
  // "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi —
  // requestedStorageRiskGroups İLE AYNI "yalnızca hedef pick bu kategoriyi
  // kapsıyorsa anlamlı, her yeni pick'te sıfırlanır, otomatik yetki VERMEZ"
  // ilkesi — iki BAĞIMSIZ eksen (faaliyet + atık kodu).
  const [requestedRecyclingActivities, setRequestedRecyclingActivities] = useState<string[]>([]);
  const [requestedRecyclingWasteCodes, setRequestedRecyclingWasteCodes] = useState<string[]>([]);

  // §37 (bildirim derin bağlantısı): ilk yükleme tamamlandığında, ?hizmet=
  // ile gelinmiş VE hâlâ tıklanabilir bir kategoriyse doğrudan o kategorinin
  // yükleme adımına geçilir — bu karar ayrı bir effect'te DEĞİL, async
  // fetch'in kendi `.then()` callback'i İÇİNDE verilir (proje kuralı: bir
  // effect gövdesinde senkron `setState` yasak, bkz. CLAUDE.md "No real
  // backend" — react-hooks/set-state-in-effect). Eklenmemiş/geçersiz bir
  // kategoriyse (tekrar tıklanan eski bir bildirim) sessizce normal seçiciye
  // düşülür, hataya düşürülmez.
  useEffect(() => {
    if (session?.role !== "hizmet-veren") return;
    let cancelled = false;
    void Promise.all([getMyServiceAuthorizations(session.id), getMyExistingGroupDocumentTypes(session.id)]).then(([rows, groupDocTypes]) => {
      if (cancelled) return;
      setSelectedCategoryIds(rows.filter((row) => row.status !== "not_selected").map((row) => row.serviceCategoryId));
      const pickable = new Set(
        rows.filter((row) => row.status === "not_selected" || row.status === "document_required").map((row) => row.serviceCategoryId),
      );
      setPickableCategoryIds(pickable);
      setExistingGroupDocumentTypes(groupDocTypes);
      // Bir admin bildirimi (request_provider_document) sadeleştirmeden
      // ÖNCE tekil bir alt kategoriye (ör. "kapali-depolama") deep-link
      // vermiş olabilir — o kategori artık ayrı bir yükleme hedefi değil,
      // sahibi olduğu GRUBUN yükleme adımına yönlendirilir.
      const deepLinkGroup = deepLinkCategoryId ? PROVIDER_AUTHORIZATION_GROUPS.find((group) => group.categoryIds.includes(deepLinkCategoryId)) : undefined;
      if (deepLinkGroup && !groupDocTypes.has(deepLinkGroup.documentType)) {
        setStep({ kind: "uploading", pick: { kind: "group", groupId: deepLinkGroup.id, label: deepLinkGroup.label, documentType: deepLinkGroup.documentType as ProviderDocumentType, categoryIds: deepLinkGroup.categoryIds } });
      } else if (deepLinkCategoryId && pickable.has(deepLinkCategoryId) && !CONSOLIDATED_CATEGORY_IDS.has(deepLinkCategoryId)) {
        setStep({ kind: "uploading", pick: { kind: "category", categoryId: deepLinkCategoryId, label: getServiceCategoryLabel(deepLinkCategoryId) ?? deepLinkCategoryId } });
      } else {
        setStep({ kind: "picking" });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.role]);

  if (!session) {
    return <AuthGateNotice message="Belge yüklemek için giriş yapmalısınız." loginRedirect="/panel/belge-yukleme" />;
  }
  if (session.role !== "hizmet-veren") {
    return (
      <p className="rounded-card border border-border bg-surface p-6 text-sm text-muted-foreground">
        Bu sayfa yalnızca Hizmet Veren hesapları içindir.
      </p>
    );
  }

  const completedIds = new Set(completed.map((entry) => entry.pickedId));
  // CONSOLIDATED_CATEGORY_IDS'e ait kategoriler bu per-kategori listeden
  // tamamen ÇIKARILIR (aşağıdaki availableAuthorizationGroups onların YERİNE
  // geçer) — is-makinesi-hizmetleri/operator-hizmetleri/depo-hizmetleri
  // grupları bu filtreden sonra 0 kategoriyle kalıp doğal olarak listeden
  // düşer, hiçbir grup id'si burada elle hariç tutulmaz.
  const availableGroups = SERVICE_CATEGORY_GROUPS.map((group) => ({
    ...group,
    categories: group.categories.filter(
      (category) => pickableCategoryIds.has(category.id) && !completedIds.has(category.id) && !CONSOLIDATED_CATEGORY_IDS.has(category.id),
    ),
  })).filter((group) => group.categories.length > 0);

  // Bir grup yalnızca bu oturumda ZATEN eklenmediyse VE o document_type için
  // (hangi durumda olursa olsun — pending/approved/rejected) hiç belge
  // yoksa gösterilir (bkz. getMyExistingGroupDocumentTypes'ın kendi
  // dokümantasyonu — reddedilmiş bir grup belgesinin yeniden yüklenmesi bu
  // ekrandan değil, "Belgelerim"den yapılır, tekil kategorilerle AYNI kural).
  const availableAuthorizationGroups = PROVIDER_AUTHORIZATION_GROUPS.filter(
    (group) => !completedIds.has(group.id) && !existingGroupDocumentTypes.has(group.documentType),
  );

  function handlePickCategory(categoryId: string, label: string) {
    setDocuments([]);
    setSubmitError(null);
    setStorageActivityScopes([]);
    setImoClassCodes([]);
    setRequestedStorageRiskGroups([]);
    setRequestedRecyclingActivities([]);
    setRequestedRecyclingWasteCodes([]);
    setStep({ kind: "uploading", pick: { kind: "category", categoryId, label } });
  }

  function handlePickGroup(group: ProviderAuthorizationGroup) {
    setDocuments([]);
    setSubmitError(null);
    setStorageActivityScopes([]);
    setImoClassCodes([]);
    setRequestedStorageRiskGroups([]);
    setRequestedRecyclingActivities([]);
    setRequestedRecyclingWasteCodes([]);
    setStep({ kind: "uploading", pick: { kind: "group", groupId: group.id, label: group.label, documentType: group.documentType as ProviderDocumentType, categoryIds: group.categoryIds } });
  }

  /** "Dolu Tehlikeli Konteyner Depolama" kapsamı kaldırıldığında IMO seçimleri de temizlenir (görev talimatı: "kaldırılırsa IMO seçimleri temizlenmeli"). */
  function handleStorageActivityScopesChange(next: string[]) {
    setStorageActivityScopes(next);
    if (!next.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID)) {
      setImoClassCodes([]);
    }
  }

  async function handleUploadSubmit() {
    if (step.kind !== "uploading") return;
    if (submitting || submitLockRef.current) return;
    const { pick } = step;
    const document = documents[0];
    if (!document) return;

    const targetsContainerStorage = pickTargetsContainerStorage(pick);
    const targetsHazardousStorage = pickTargetsHazardousStorage(pick);
    const targetsRecycling = pickTargetsRecycling(pick);
    if (targetsContainerStorage && storageActivityScopes.length === 0) {
      setSubmitError("En az bir faaliyet alanı seçmelisiniz.");
      return;
    }
    if (targetsContainerStorage && storageActivityScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) && imoClassCodes.length === 0) {
      setSubmitError("Dolu Tehlikeli Konteyner Depolama için en az bir IMO sınıfı seçmelisiniz.");
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    const blob = await getPhotoBlob(document.indexedDbStorageKey);
    if (!blob) {
      submitLockRef.current = false;
      setSubmitting(false);
      setSubmitError("Belge dosyası okunamadı. Lütfen tekrar yükleyin.");
      return;
    }

    // TAM DEĞİŞTİRME: mevcut seçili TÜMÜ + bu oturumda eklenenler + yeni
    // hizmet(ler) birlikte (dedup) — bir GRUP seçimi TÜM alt kategorilerini
    // birden ekler (migration 0044), tekil bir kategori seçimi yalnızca
    // kendisini.
    const idsToAdd = pick.kind === "group" ? pick.categoryIds : [pick.categoryId];
    const nextCategoryIds = Array.from(
      new Set([...selectedCategoryIds, ...completed.flatMap((entry) => entry.categoryIds), ...idsToAdd]),
    );
    const servicesResult = await setMyProviderServiceCategoriesRemote(nextCategoryIds);
    if (!servicesResult.ok) {
      submitLockRef.current = false;
      setSubmitting(false);
      setSubmitError("Hizmet seçiminiz kaydedilemedi. Lütfen tekrar deneyin.");
      return;
    }

    const uploadResult = await uploadAndRegisterProviderDocument({
      blob,
      extension: document.extension,
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
      sizeBytes: document.size,
      documentType: pick.kind === "group" ? pick.documentType : documentTypeForCategory(pick.categoryId),
      // Grup belgeleri KASITLI OLARAK tek bir kategoriye değil, tamamına
      // bağlıdır — service_category_id gönderilmez (RPC bunu NULL alır,
      // ML124 doğrulaması bu yüzden hiç tetiklenmez, bkz. migration 0044).
      serviceCategoryId: pick.kind === "group" ? undefined : pick.categoryId,
      storageActivityScopes: targetsContainerStorage ? storageActivityScopes : undefined,
      imoClassCodes: targetsContainerStorage && storageActivityScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) ? imoClassCodes : undefined,
      requestedStorageRiskGroups: targetsHazardousStorage && requestedStorageRiskGroups.length > 0 ? requestedStorageRiskGroups : undefined,
      requestedRecyclingActivities: targetsRecycling && requestedRecyclingActivities.length > 0 ? requestedRecyclingActivities : undefined,
      requestedRecyclingWasteCodes: targetsRecycling && requestedRecyclingWasteCodes.length > 0 ? requestedRecyclingWasteCodes : undefined,
    });
    submitLockRef.current = false;
    setSubmitting(false);
    if (!uploadResult.ok) {
      setSubmitError(uploadResult.error);
      return;
    }

    setSelectedCategoryIds(nextCategoryIds);
    const pickedId = pick.kind === "group" ? pick.groupId : pick.categoryId;
    setCompleted((current) => [...current, { pickedId, label: pick.label, categoryIds: idsToAdd }]);
    if (pick.kind === "group") setExistingGroupDocumentTypes((current) => new Set(current).add(pick.documentType));
    setDocuments([]);
    setStorageActivityScopes([]);
    setImoClassCodes([]);
    setRequestedStorageRiskGroups([]);
    setRequestedRecyclingActivities([]);
    setRequestedRecyclingWasteCodes([]);
    setStep({ kind: "added", label: pick.label });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground sm:text-4xl">Belge Yükleme</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Bir hizmete ilan/teklif erişimi kazanmak için önce o hizmeti seçin, ardından faaliyet belgenizi yükleyin.
          Belgeniz admin tarafından incelenip onaylandıktan sonra o hizmete ait ilanları görüntüleyebilir ve teklif
          verebilirsiniz.
        </p>
      </div>

      {completed.length > 0 && step.kind !== "added" && (
        <div className="rounded-card border border-success/30 bg-success-soft p-4">
          <p className="text-sm font-medium text-success">Bu oturumda eklenen hizmetler</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {completed.map((entry) => (
              <li key={entry.pickedId} className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                {entry.label} — belgeniz yüklendi, admin onayı bekliyor.
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor...
        </div>
      )}

      {step.kind === "picking" && (
        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Hangi hizmeti veriyorsunuz?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Zaten eklediğiniz hizmetler bu listede tekrar görünmez — her hizmet yalnızca bir kez eklenebilir.
          </p>

          {availableGroups.length === 0 && availableAuthorizationGroups.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Katalogdaki tüm hizmetleri zaten eklediniz. Durumlarını{" "}
              <Link href="/panel/profil" className="font-medium text-accent underline underline-offset-2">
                Profilim
              </Link>{" "}
              sayfasından takip edebilirsiniz.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-5">
              {availableGroups.map((group) => (
                <div key={group.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => handlePickCategory(category.id, category.label)}
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {availableAuthorizationGroups.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hizmet Grupları</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bu gruplardan biri için yükleyeceğiniz TEK belge, gruptaki tüm alt hizmetlere erişiminizi açar.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {availableAuthorizationGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => handlePickGroup(group)}
                        className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step.kind === "uploading" && (
        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">{step.pick.label} — Faaliyet Belgesi</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {step.pick.kind === "group"
              ? `${step.pick.label} için tek bir faaliyet belgesi yükleyin — onaylandığında bu gruptaki tüm hizmetlere erişiminiz açılır.`
              : `${step.pick.label} hizmeti için faaliyet belgenizi yükleyin.`}
          </p>

          {pickTargetsContainerStorage(step.pick) && (
            <div className="mt-4 flex flex-col gap-4 rounded-[10px] border border-border bg-background p-4">
              <MultiSelectChips
                id="storage-activity-scopes"
                label="Depocu Faaliyet Alanları"
                options={STORAGE_ACTIVITY_SCOPE_SELECT_OPTIONS}
                selected={storageActivityScopes}
                onChange={handleStorageActivityScopesChange}
              />
              <p className="text-xs text-muted-foreground">
                Bu belgenin hangi faaliyet alanlarını kapsadığını seçin — birden fazla seçebilirsiniz. Tek belge birden
                fazla faaliyet alanını kapsayabilir; farklı bir alan için ayrı bir belge de yükleyebilirsiniz.
              </p>

              {storageActivityScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) && (
                <MultiSelectChips
                  id="imo-class-codes"
                  label="IMO Sınıfları"
                  options={IMO_CLASS_SELECT_OPTIONS}
                  selected={imoClassCodes}
                  onChange={setImoClassCodes}
                  searchable
                  searchPlaceholder="IMO sınıfı ara..."
                />
              )}
            </div>
          )}

          {pickTargetsHazardousStorage(step.pick) && (
            <div className="mt-4 flex flex-col gap-4 rounded-[10px] border border-border bg-background p-4">
              <MultiSelectChips
                id="requested-storage-risk-groups"
                label="Depolama Risk Grupları (opsiyonel)"
                options={STORAGE_RISK_GROUP_SELECT_OPTIONS}
                selected={requestedStorageRiskGroups}
                onChange={setRequestedStorageRiskGroups}
                searchable
                searchPlaceholder="Risk grubu ara..."
              />
              <p className="text-xs text-muted-foreground">
                Kimyasal Depolama veya Tehlikeli Madde Depolama kapsamında hangi risk gruplarında hizmet
                verebildiğinizi belirtin — bu yalnızca bir taleptir, otomatik yetki vermez. Admin belgenizi
                incelerken her grubu ayrı ayrı onaylar veya reddeder; onaylanmayan bir grup için ilgili ilanları
                göremez ve teklif veremezsiniz. Hiç seçim yapmazsanız hiçbir risk grubu için yetki talep edilmez.
              </p>
            </div>
          )}

          {pickTargetsRecycling(step.pick) && (
            <div className="mt-4 flex flex-col gap-4 rounded-[10px] border border-border bg-background p-4">
              <MultiSelectChips
                id="requested-recycling-activities"
                label="Faaliyetler (opsiyonel)"
                options={RECYCLING_ACTIVITY_SELECT_OPTIONS}
                selected={requestedRecyclingActivities}
                onChange={setRequestedRecyclingActivities}
              />
              <MultiSelectChips
                id="requested-recycling-waste-codes"
                label="Atık Kodları (opsiyonel)"
                options={RECYCLING_WASTE_CODE_SELECT_OPTIONS}
                selected={requestedRecyclingWasteCodes}
                onChange={setRequestedRecyclingWasteCodes}
                searchable
                searchPlaceholder="Atık kodu ara..."
              />
              <p className="text-xs text-muted-foreground">
                Geri Dönüşüm & Atık Tahliye kapsamında hangi faaliyetleri (taşıma/tahliye, geri kazanım, bertaraf) ve
                hangi resmî atık kodlarında hizmet verebildiğinizi belirtin — bu yalnızca bir taleptir, otomatik
                yetki vermez. Admin belgenizi incelerken her faaliyeti ve her atık kodunu ayrı ayrı onaylar veya
                reddeder; onaylanmayan bir faaliyet/kod için ilgili ilanları göremez ve teklif veremezsiniz. Hiç
                seçim yapmazsanız hiçbir faaliyet/kod için yetki talep edilmez.
              </p>
            </div>
          )}

          <div className="mt-4">
            <ProviderDocumentUpload
              maxFiles={1}
              onDocumentsChange={setDocuments}
              onBusyChange={setUploadBusy}
              disabled={submitting}
            />
          </div>

          {submitError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {submitError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleUploadSubmit()}
              disabled={
                documents.length === 0 ||
                uploadBusy ||
                submitting ||
                (pickTargetsContainerStorage(step.pick) &&
                  (storageActivityScopes.length === 0 ||
                    (storageActivityScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) && imoClassCodes.length === 0)))
              }
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Belgeyi Gönder
            </button>
            <button
              type="button"
              onClick={() => {
                setDocuments([]);
                setSubmitError(null);
                setStorageActivityScopes([]);
                setImoClassCodes([]);
                setRequestedStorageRiskGroups([]);
                setRequestedRecyclingActivities([]);
                setRequestedRecyclingWasteCodes([]);
                setStep({ kind: "picking" });
              }}
              disabled={submitting}
              className="rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {step.kind === "added" && (
        <div className="rounded-card border border-success/30 bg-success-soft p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">
              {step.label} belgeniz yüklendi
            </h2>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Admin belgenizi incelemeden bu hizmete ait ilanları göremez ve teklif veremezsiniz — onaylandığında bir
            bildirim alacaksınız.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {(availableGroups.length > 0 || availableAuthorizationGroups.length > 0) && (
              <button
                type="button"
                onClick={() => setStep({ kind: "picking" })}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Başka Hizmet de Veriyorum
              </button>
            )}
            <Link
              href="/panel/profil"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Bitti, Hizmet Yetkilerime Git
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
