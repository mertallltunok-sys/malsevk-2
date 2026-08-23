"use client";

import { useId, useState } from "react";
import { Building2, CalendarDays, CheckCircle2, ClipboardList, FileText, Package, Recycle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getCustomsRequestedServiceLabels,
  getCustomsTransactionTypeLabel,
  isCustomsBrokerageCategory,
} from "../_lib/customs-brokerage-catalog";
import { getJobLocationSummary } from "../_lib/job-location";
import { isJobVisibleForModeration } from "../_lib/job-moderation";
import { clearJobSupabaseSyncFailure } from "../_lib/job-store";
import {
  canViewJobAddress,
  getJobOfferAvailability,
  getJobOfferAvailabilityLabel,
  getJobOfferAvailabilityTone,
} from "../_lib/job-requests";
import { formatJobDateRange, getExclusiveDayCount, isJobDateInPast, isJobOpenForOffers } from "../_lib/jobs";
import { useIsJobVisibleToSession } from "../_lib/job-visibility";
import { formatCargoGroupTitle, getJobCargoGroups } from "../_lib/nakliye-cargo-groups";
import {
  formatContainerContentSummary,
  formatContainerTransportSummary,
  formatHazmatSummary,
  formatLoadingMethodSummary,
  formatLoadPreparationSummary,
  formatMeasurementSummary,
  formatNakliyeQuantity,
  getProductQuantityFieldConfig,
} from "../_lib/nakliye-transport-catalog";
import { formatProductQuantity, formatProductTonnage, hasProductInfo, isTransportationCategory } from "../_lib/product-catalog";
import {
  ALL_RECYCLING_SCOPE_OF_WORK_IDS,
  formatRecyclingQuantity,
  getRecyclingMaterialConditionLabel,
  getRecyclingMaterialTypeDetailLine,
  getRecyclingMaterialTypeLabel,
  getRecyclingRequestedOperationLabel,
  getRecyclingScopeOfWorkLabels,
  isRecyclingCategory,
} from "../_lib/recycling-catalog";
import {
  deriveWasteCodeHazardous,
  formatWasteCodeForDisplay,
  getWasteCodeEntry,
  getWasteHazardPropertyLabel,
} from "../_lib/recycling-waste-code-catalog";
import { getCategoryDisplayLabel, isStorageOnlyLocationCategory } from "../_lib/service-catalog";
import {
  computeTotalContainerQuantity,
  formatImoClassForDisplay,
  getStorageContainerSizeLabel,
  getStorageContainerStatusLabel,
  getStorageContainerTypeLabel,
  isContainerLoadApplicable,
  isContainerStorageCategory,
  isReeferContainerType,
  normalizeStorageContainerGroupsForDisplay,
} from "../_lib/storage-container-catalog";
import { getStorageRiskGroupLabel, isHazardousStorageCategory } from "../_lib/storage-hazard-catalog";
import { retryJobSupabaseSync } from "../_lib/supabase-job-sync";
import type { Job, JobCustomsDocument } from "../_lib/types";
import { useAllOffers } from "../_lib/use-offers";
import { useJobById } from "../_lib/use-jobs";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { useSession } from "../_lib/use-session";
import { DialogShell } from "./dialog-shell";
import { JobPhotoGallery } from "./job-photo-gallery";
import { OfferPanel } from "./offer-panel";
import { OperationStatusCard } from "./operation-status-card";
import { PageContainer } from "./page-container";
import { ServiceLocationPanel } from "./service-location-panel";
import { StatusBadge } from "./status-badge";

/** Bir Gümrük Müşavirliği evrakını, IndexedDB'deki blob'undan çözülen bir bağlantı olarak gösterir — job-photo-editor.tsx#ExistingPhotoCard'daki AYNI "hook'u sarmalayan küçük alt bileşen" deseni (hook'lar .map() içinde doğrudan çağrılamaz). */
function CustomsDocumentLink({ document }: { document: JobCustomsDocument }) {
  const url = useJobPhotoUrl(document.storageKey);
  if (!url) {
    return (
      <span className="truncate text-sm text-muted-foreground" title={document.fileName}>
        {document.fileName}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={document.fileName}
      className="truncate text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      title={document.fileName}
    >
      {document.fileName}
    </a>
  );
}

/**
 * Orta sütunun tüm "hizmete özel bilgi" bloklarının (Depolama/Nakliye/Liman/
 * Geri Dönüşüm/Gümrük) paylaştığı TEK kompakt istatistik kutusu — masaüstü
 * tek-ekran yoğunlaştırma görevi öncesi her kategori kendi
 * `rounded-[10px] border ... px-4 py-3` metnini AYRI AYRI tekrarlıyordu;
 * artık tek yerden. Görsel biçim DEĞİŞMEDİ (aynı token'lar/renkler),
 * yalnızca tekrar ortadan kalktı ve padding biraz sıkılaştırıldı.
 *
 * `line-clamp-2` GERÇEK bir taşma bulgusuyla eklendi: 3 kutu AYNI CSS Grid
 * satırında olduğu için (görev tanımı: "aynı satırda yer alsın") hepsi aynı
 * satır yüksekliğini paylaşır — çok uzun bir "Ürün Cinsi" değeri (ör.
 * "Hassas Elektronik Ekipman") sınırsız sarılırsa TÜM satırı (kısa
 * komşularıyla birlikte) öngörülemez şekilde büyütüp 1366×768'de dikey
 * taşmaya yol açabiliyordu (gerçek Playwright ölçümüyle doğrulandı — bkz.
 * proje raporu). 2 satırla sınırlamak en kötü durumu ÖNGÖRÜLEBİLİR kılıyor
 * (sabit +1 satır ≈ 20px), veri hiçbir zaman kesilmez/kaybolmaz — yalnızca
 * görsel olarak katlanır, tam değer DOM'da kalır.
 */
function InfoStatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-background px-2.5 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 line-clamp-2 break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/** Bir kategori bloğunun küçük başlığı — eskiden her kart kendi `rounded-card border ... p-6` kabuğuyla birlikte büyük bir `text-lg` başlık taşıyordu; artık hepsi ORTA SÜTUNUN TEK kartı içinde akıyor, bu yüzden başlık daha küçük/soluk (bkz. görev tanımı: "Etiket daha küçük ve soluk renkte"). */
function SectionHeading({ icon: Icon, children }: { icon: typeof Package; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-heading leading-tight text-foreground">
      <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      {children}
    </h2>
  );
}

/**
 * İş Açıklaması — masaüstü tek-ekran yoğunlaştırma görevi: artık satır içi
 * aç/kapa DEĞİL, kısa bir önizleme (`line-clamp-3`) + "Devamını Göster"
 * tıklandığında TAM metnin açıldığı bir modal (mevcut, paylaşılan
 * `DialogShell` — offer-outcome-panel.tsx/job-rating-modal.tsx/
 * legal-document-modal.tsx ile AYNI kabuk, ikinci bir modal sistemi İCAT
 * EDİLMEDİ). Bu kart artık GENİŞ (sol grubun tam genişliği, ~900-1000px)
 * olduğu için eşik (~480 karakter) dar sütun döneminden daha yüksek —
 * normal uzunlukta bir açıklama artık genellikle TAM sığar, "Devamını
 * Göster" yapay olarak gösterilmez (görev tanımı: "sığan metin için
 * kullanma"). Kısa açıklamalarda link hiç render edilmez (veri hiçbir
 * zaman kesilmez/kaybolmaz, yalnızca CSS ile katlanır — DOM'da ve modalda
 * her zaman TAM metin vardır).
 */
function JobDescriptionPanel({ description }: { description: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const headingId = useId();
  const isLong = description.trim().length > 480;
  return (
    <div>
      <h2 className="text-sm font-bold tracking-heading leading-tight text-foreground">İş Açıklaması</h2>
      <p className={`mt-2 break-words text-sm leading-relaxed text-foreground ${isLong ? "line-clamp-3" : ""}`}>
        {description}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-1 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Devamını Göster
          <span aria-hidden="true">→</span>
        </button>
      )}
      {modalOpen && (
        <DialogShell labelledBy={headingId} onClose={() => setModalOpen(false)} size="lg">
          <h2 id={headingId} className="text-lg font-bold tracking-heading leading-tight text-foreground">
            İş Açıklaması
          </h2>
          <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
            {description}
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Kapat
          </button>
        </DialogShell>
      )}
    </div>
  );
}

/**
 * "Konteyner Grupları" — YALNIZCA hizmet türü "Konteyner Depolama" iken
 * (bkz. storage-container-catalog.ts#isContainerStorageCategory, TEK
 * doğruluk kaynağı) orta sütunda gösterilen KOMPAKT KARTLAR (görev
 * talimatı: "konteyner grupları kompakt kartlar halinde gösterilsin" —
 * önceki `<table>` tasarımının yerini aldı). Her kartın BİRİNCİ satırı
 * Adet/Ölçü/Tip/Yük Durumu (+ tehlikeliyse küçük bir "Tehlikeli" rozeti);
 * İKİNCİ satırda YALNIZCA mevcut olan bilgiler (Yük İçeriği/Brüt Ağırlık/
 * Reefer Sıcaklığı/Elektrik Bağlantısı/UN/IMO), her biri DOĞRU GRUBUN
 * kendi kartında — başka bir grupla KARIŞMAZ (her kart kendi `group.id`sine
 * göre anahtarlanır, ikinci satır parçaları o TEK grubun kendi alanlarından
 * derlenir). Altta "Toplam: N Konteyner" (bkz. computeTotalContainerQuantity,
 * TEK toplama kaynağı — istemciden/kaydedilmiş bir "toplam" alanına HİÇ
 * güvenilmez). IMO kodu `formatImoClassForDisplay` ile "{kod} – {açıklama}"
 * olarak gösterilir; eski/tanınamayan bir ham değer SİLİNMEDEN olduğu gibi
 * gösterilir (bkz. o fonksiyonun kendi dokümanı). `normalizeStorageContainer
 * GroupsForDisplay` eski (DEPRECATED düz alanlı) bir ilanı da TEK kartlık
 * bir listeye yükseltir. Hiç grup yoksa bölüm hiç render edilmez.
 */
function StorageContainerGroupsCards({ job }: { job: Job }) {
  if (!isContainerStorageCategory(job.category)) return null;
  const groups = normalizeStorageContainerGroupsForDisplay(job);
  if (groups.length === 0) return null;
  const total = computeTotalContainerQuantity(groups);

  return (
    <div className="mt-2 border-t border-border pt-2">
      <SectionHeading icon={Package}>Konteyner Grupları</SectionHeading>
      <div className="mt-2 flex flex-col gap-2">
        {groups.map((group) => {
          const sizeLabel = getStorageContainerSizeLabel(group.size) ?? group.size;
          const typeLabel = getStorageContainerTypeLabel(group.type) ?? group.type;
          const statusLabel = getStorageContainerStatusLabel(group.status) ?? group.status;
          const isLoaded = isContainerLoadApplicable(group.status);
          const isReefer = isReeferContainerType(group.type);
          const isHazardous = isLoaded && group.hazardous === true;

          const secondLineParts: string[] = [];
          if (isLoaded && group.content) secondLineParts.push(group.content);
          if (isLoaded && group.grossWeight !== undefined) secondLineParts.push(`${group.grossWeight} ton`);
          if (isReefer && group.reeferTemperature !== undefined) secondLineParts.push(`${group.reeferTemperature}°C`);
          if (isReefer && group.reeferElectrical !== undefined) {
            secondLineParts.push(`Elektrik: ${group.reeferElectrical ? "Evet" : "Hayır"}`);
          }
          // Dolu ama tehlikeli OLMAYAN bir grup, "Tehlikesiz" kelimesini
          // açıkça gösterir (görev örneği: "Elektronik malzeme · 3,5 ton ·
          // Tehlikesiz") — tehlikeli gruplar bu kelimeyi TEKRARLAMAZ,
          // onlarda zaten UN/IMO bilgisi + "Tehlikeli" rozeti bulunuyor.
          if (isLoaded && group.hazardous === false) secondLineParts.push("Tehlikesiz");
          if (isHazardous && group.unNumber) {
            // "UN Numarası" alanının kendi placeholder'ı ("Ör. UN1230")
            // kullanıcının "UN" ön ekini ZATEN girdiğini varsayar — burada
            // koşulsuzca "UN " EKLEMEK "UN UN1230" gibi çift bir önek
            // üretirdi (gerçek Playwright testiyle bulunan bir hata). Var
            // olan bir "UN"/"un" ön eki (varsa, boşluklu/boşluksuz) ÖNCE
            // temizlenir, SONRA tek bir tutarlı "UN {rakam}" biçiminde
            // yeniden eklenir — kullanıcı ister "UN1230" ister yalnızca
            // "1230" yazsın, gösterim her zaman aynıdır.
            const unDigits = group.unNumber.trim().replace(/^un\s*/i, "");
            secondLineParts.push(`UN ${unDigits}`);
          }
          if (isHazardous && group.imoClass) {
            const imoLabel = formatImoClassForDisplay(group.imoClass);
            if (imoLabel) secondLineParts.push(`IMO ${imoLabel}`);
          }

          return (
            <div key={group.id} className="min-w-0 rounded-[10px] border border-border bg-background px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-foreground">
                <span className="font-semibold">{group.quantity} adet</span>
                <span className="text-muted-foreground">|</span>
                <span>{sizeLabel}</span>
                <span className="text-muted-foreground">|</span>
                <span>{typeLabel}</span>
                <span className="text-muted-foreground">|</span>
                <span>{statusLabel}</span>
                {isHazardous && (
                  <span className="ml-1 inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                    Tehlikeli
                  </span>
                )}
              </div>
              {secondLineParts.length > 0 && (
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                  {secondLineParts.join(" · ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">Toplam: {total} Konteyner</p>
    </div>
  );
}

/**
 * "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi —
 * StorageContainerGroupsCards İLE AYNI "yalnızca kendi kategorisinde
 * render edilir, hiç veri yoksa hiç görünmez" ilkesi. Tehlikeli madde
 * kapsamındaysa "Tehlikeli Madde: Evet" + onaylı/talep edilen risk grupları
 * listelenir; değilse (Kimyasal Depolama'da Hayır seçilmişse) yalnızca
 * "Tehlikeli Madde: Hayır" gösterilir, risk grubu satırı hiç render edilmez.
 */
function StorageHazardInfo({ job }: { job: Job }) {
  if (!isHazardousStorageCategory(job.category)) return null;
  const isHazardous = job.storageHazardous === true;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Tehlikeli Madde</dt>
          <dd className="text-right text-foreground">{isHazardous ? "Evet" : "Hayır"}</dd>
        </div>
      </dl>
      {isHazardous && job.storageRiskGroups && job.storageRiskGroups.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Depolama Risk Grupları</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {job.storageRiskGroups.map((riskGroupId) => (
              <li key={riskGroupId} className="inline-flex items-center rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
                {getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
 * Taşındı" görevleri — eski TEK "Ürün Bilgileri"/"Yük ve Yerleşim"/
 * "Konteyner Taşıması" bloklarının YERİNE geçer: her Yük Grubu artık KENDİ
 * bağımsız kartında gösterilir, normal yük bilgisi VE konteyner bilgisi
 * ASLA aynı anda gösterilmez (görev talimatı — grup başına birbirini
 * dışlayan iki dal, StorageContainerGroupsCards İLE AYNI "her grup kendi
 * kartı" ilkesi). `getJobCargoGroups` eski (bu görevden önce kaydedilmiş)
 * tek-gruplu bir ilanı SALT OKUNUR olarak "Yük Grubu 1" sentezler — bu
 * durumda tek bir kart gösterilir, davranış eskisiyle BİREBİR aynı görünür
 * (yalnızca başlık artık "Yük Grubu 1" der).
 *
 * "Toplam Ağırlık" artık HER İKİ dalda da (normal VE konteyner) gösterilir
 * (görev talimatı: "toplam tonaj alanını tekrar etmeden kullan") — eski (bu
 * görevden önce kaydedilmiş) bir konteyner grubunun ağırlığı yalnızca
 * `containerTransport.grossWeightTon`'da olabilir, bu durumda o eski değer
 * burada geriye dönük GÖSTERİLİR (`formatContainerTransportSummary`'nin
 * kendi grossWeightTon-embed mantığı DEĞİŞMEDİ — yeni kayıtlarda o alan hiç
 * üretilmediği için burada asla iki kez gösterilmez).
 *
 * Tehlikeli Madde/ADR artık job seviyesinde DEĞİL, HER Yük Grubu'nun kendi
 * kartının altında, bağımsız olarak gösterilir — bir grubun ADR durumu
 * diğerini hiç etkilemez (eski, bağımsız job-seviyeli "Tehlikeli Madde /
 * ADR" bloğu bu görevle TAMAMEN kaldırıldı).
 */
function NakliyeCargoGroupsDetailCards({ job }: { job: Job }) {
  if (!isTransportationCategory(job.category)) return null;
  const groups = getJobCargoGroups(job);

  return (
    <>
      {groups.map((group, index) => {
        const isContainerMode = group.containerTransport.status === "evet";
        const loadPreparationLabel = !isContainerMode
          ? formatLoadPreparationSummary(group.loadPreparationType, group.loadPreparationCustomText)
          : undefined;
        const quantityFieldConfig = !isContainerMode
          ? getProductQuantityFieldConfig(group.loadPreparationType ?? "", group.loadPreparationCustomText)
          : undefined;
        const measurementSummary = !isContainerMode
          ? group.measurementInfo?.dimensionsUnknown
            ? { dimensionsLabel: "Ölçüler bilinmiyor" }
            : formatMeasurementSummary(group.measurementInfo)
          : {};
        const hasGroupProductInfo = !isContainerMode && (group.productQuantity !== undefined || Boolean(group.productType));
        const containerTransportLabel = isContainerMode ? formatContainerTransportSummary(group.containerTransport) : null;
        const containerContentLabel = isContainerMode ? formatContainerContentSummary(group.containerTransport) : null;
        // Paylaşılan Toplam Ağırlık — eski konteyner kayıtları için grossWeightTon'a düşer.
        const effectiveTonnage = group.productTonnage ?? (isContainerMode ? group.containerTransport.grossWeightTon : undefined);
        const hazmatLabel = formatHazmatSummary(group.hazmat);

        return (
          <div key={group.id} className="mt-2 border-t border-border pt-2">
            <SectionHeading icon={Package}>
              {groups.length > 1 ? formatCargoGroupTitle(index) : "Yük Bilgileri"}
            </SectionHeading>

            {(hasGroupProductInfo || effectiveTonnage !== undefined) && (
              <dl className="mt-2 grid grid-cols-3 gap-2">
                {hasGroupProductInfo && <InfoStatCard label="Ürün Cinsi" value={group.productType} />}
                {hasGroupProductInfo &&
                  (quantityFieldConfig?.useVolumeInstead
                    ? group.measurementInfo?.volumeM3 !== undefined && (
                        <InfoStatCard
                          label={quantityFieldConfig.label}
                          value={formatNakliyeQuantity(group.measurementInfo.volumeM3, quantityFieldConfig.unit)}
                        />
                      )
                    : group.productQuantity !== undefined && (
                        <InfoStatCard
                          label={quantityFieldConfig?.label ?? "Ürün Adedi"}
                          value={formatNakliyeQuantity(group.productQuantity, quantityFieldConfig?.unit ?? "adet")}
                        />
                      ))}
                {effectiveTonnage !== undefined && (
                  <InfoStatCard label="Toplam Ağırlık" value={formatProductTonnage(effectiveTonnage, group.productTonnageUnit)} />
                )}
              </dl>
            )}

            {!isContainerMode && (loadPreparationLabel || measurementSummary.dimensionsLabel || measurementSummary.placementLabel || measurementSummary.maxStackLabel) && (
              <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                {loadPreparationLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Hazırlanış</dt>
                    <dd className="text-right text-foreground">{loadPreparationLabel}</dd>
                  </div>
                )}
                {measurementSummary.dimensionsLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Birim ölçüsü</dt>
                    <dd className="text-right text-foreground">{measurementSummary.dimensionsLabel}</dd>
                  </div>
                )}
                {measurementSummary.placementLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Yerleşim</dt>
                    <dd className="text-right text-foreground">{measurementSummary.placementLabel}</dd>
                  </div>
                )}
                {measurementSummary.maxStackLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">En fazla istif</dt>
                    <dd className="text-right text-foreground">{measurementSummary.maxStackLabel}</dd>
                  </div>
                )}
              </dl>
            )}

            {isContainerMode && containerTransportLabel && (
              <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Konteyner Taşıması</dt>
                  <dd className="text-right text-foreground">{containerTransportLabel}</dd>
                </div>
                {containerContentLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Konteyner içindeki yük</dt>
                    <dd className="text-right text-foreground">{containerContentLabel}</dd>
                  </div>
                )}
              </dl>
            )}

            {hazmatLabel && (
              <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Tehlikeli Madde / ADR</dt>
                  <dd className="text-right text-foreground">{hazmatLabel}</dd>
                </div>
              </dl>
            )}
          </div>
        );
      })}
    </>
  );
}

export function JobDetailContent({ id }: { id: string }) {
  const job = useJobById(id);
  const offers = useAllOffers();
  const session = useSession();
  const searchParams = useSearchParams();
  // "Kritik İlan Senkronizasyonu" görevi (bölüm 2) — bu sayfaya eklenen
  // `?senkronUyarisi=1` URL parametresi geçici/tarayıcı-yenilemede kaybolan
  // bir sinyaldi ve "ilanınız normal şekilde kullanılabilir" gibi YANLIŞ bir
  // güvence veriyordu (senkron gerçekten başarısız olduysa ilan sunucuda hiç
  // YOK, admin onay kuyruğunda da hiç görünmez). Artık `job.supabaseSyncFailedAt`
  // (kalıcı, job-store.ts) TEK doğruluk kaynağı — job-requests-panel.tsx ile
  // AYNI kalıp/aynı yeniden deneme mekanizması.
  const syncWarning = searchParams.get("senkronUyarisi") === "1";
  const syncFailed = Boolean(job?.supabaseSyncFailedAt);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetrySync() {
    if (!job) return;
    setRetrying(true);
    setRetryError(null);
    const result = await retryJobSupabaseSync(job);
    if (result.ok) {
      clearJobSupabaseSyncFailure(job.id);
    } else {
      setRetryError(result.error);
    }
    setRetrying(false);
  }

  // Nakliye izolasyonu (bkz. job-visibility.ts): doğrudan jobId URL erişimi
  // DAHİL, bu sayfaya ULAŞAN her yol (panel içi bağlantılar, bildirimler,
  // operasyon kardeş ilan linkleri) buradan geçer — bu yüzden merkezi kapı
  // burada uygulanmak, tüm bu yolları TEK seferde kapatmak için yeterlidir.
  // Görünmeyen bir ilan, mevcut "gerçekten yok" durumuyla AYNI mesajı
  // gösterir (bkz. aşağıdaki `!job` dalı) — ilanın var olduğu ama
  // erişilemediği bilgisi bile sızdırılmaz. İlan Onayı (bkz. job-moderation.ts)
  // AYNI merkezi noktada, Nakliye izolasyonundan bağımsız ikinci bir kapı
  // olarak uygulanır — admin henüz onaylamamış (ya da reddetmiş) bir ilana,
  // sahibi veya bir admin DIŞINDA hiç kimse doğrudan URL ile bile erişemez.
  const isVisible = useIsJobVisibleToSession(session, job) && (!job || isJobVisibleForModeration(session, job));

  if (!job || !isVisible) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold tracking-heading leading-tight text-foreground">
          İlan bulunamadı veya artık yayında değil.
        </h1>
        <Link
          href="/ilanlar"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          İlanlara Dön
        </Link>
      </div>
    );
  }

  const offerAvailability = getJobOfferAvailability(job, offers);
  const locationSummary = getJobLocationSummary(job);
  // MALSEVK genel ilan gizlilik kuralı — canViewJobAddress artık yalnızca
  // açık adres için değil, "Firma / Fabrika Adı" (legacy companyOrFactoryName)
  // dahil HER hassas konum/tesis alanı için TEK gate'tir; asıl tesis adı/
  // açık adres/harita bloğu artık service-location-panel.tsx#ServiceLocationPanel
  // içinde (aynı fonksiyonu kendi içinde çağırarak) render edilir, burada
  // yalnızca companyOrFactoryName'in gösterilip gösterilmeyeceğine karar
  // vermek için kullanılır.
  const isLocationRevealed = canViewJobAddress(session, job, offers);
  // Depolama Süresi: Depo Hizmetleri grubunun TAMAMında (bkz.
  // isStorageOnlyLocationCategory — artık 12 alt kategori) ve yalnızca tarih
  // aralığı geçerliyse (bkz. jobs.ts#getExclusiveDayCount — eksik/geçersiz
  // tarihte null döner, yanlış bir gün sayısı asla göstermeyiz) hesaplanır.
  // DÜZ takvim farkı kullanılır (16.08→24.08 = 8 gün), kapsayıcı (+1) DEĞİL —
  // kullanıcı onayıyla BİLEREK böyle (bkz. getExclusiveDayCount üstündeki doküman).
  const isStorageJob = isStorageOnlyLocationCategory(job.category);
  const storageDurationDays = isStorageJob ? getExclusiveDayCount(job.workDate, job.workEndDate ?? "") : null;
  const isNakliyeJob = isTransportationCategory(job.category);
  // "Nakliye Çoklu Yük Grubu" + "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne
  // Taşındı" görevleri — Ürün Bilgileri/Yükün Hazırlanış Biçimi/Ölçü ve
  // Yerleşim/Konteyner Taşıması/Tehlikeli Madde-ADR artık BURADA (job
  // seviyesinde, TEK) DEĞİL, grup başına <NakliyeCargoGroupsDetailCards>
  // içinde hesaplanır/gösterilir (bkz. o bileşenin kendi doküman notu).
  // Yükleme Yöntemi bu görevlerin kapsamı DIŞINDA — job seviyesinde, TEK
  // kalmaya devam eder.
  const loadingMethodLabel = isNakliyeJob
    ? formatLoadingMethodSummary(job.nakliyeDetails?.loadingMethod, job.nakliyeDetails?.loadingMethodCustomText)
    : undefined;
  const isCustomsJob = isCustomsBrokerageCategory(job.category);
  const isRecyclingJob = isRecyclingCategory(job.category);
  const recyclingScopeLabels = job.recyclingScopeOfWork ? getRecyclingScopeOfWorkLabels(job.recyclingScopeOfWork) : [];
  // "Tüm Süreç" hiçbir zaman kaydedilmeyen 5. bir değer olmadığı için (bkz.
  // recycling-catalog.ts'in kendi dokümanı) burada da AYRI bir rozet olarak
  // GÖSTERİLMEZ — yalnızca dört gerçek id'nin TAMAMI seçiliyse başlığın
  // yanında salt görsel bir özet notu eklenir, gerçek dört rozet YİNE ayrı
  // ayrı erişilebilir kalır (görev tanımının kendi kuralı).
  const recyclingScopeIds = job.recyclingScopeOfWork ?? [];
  const recyclingAllScopeSelected = ALL_RECYCLING_SCOPE_OF_WORK_IDS.every((id) => recyclingScopeIds.includes(id));

  return (
    <PageContainer className="py-4 lg:py-3">
      <Link
        href="/ilanlar"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      >
        ← İlanlara Dön
      </Link>

      {syncFailed ? (
        <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <p className="font-medium">Senkronizasyon Başarısız</p>
          <p className="mt-1 text-danger/80">
            Bu ilan yalnızca bu cihazda kaydedildi, sunucuya (Supabase) ulaşmadı — admin onay kuyruğunda görünmez ve
            başka bir cihazdan erişilemez.
            {job?.supabaseSyncError ? ` Hata: ${job.supabaseSyncError}` : ""}
          </p>
          {retryError && <p className="mt-1 text-danger/80">Yeniden deneme başarısız: {retryError}</p>}
          <button
            type="button"
            onClick={handleRetrySync}
            disabled={retrying}
            className="mt-2 inline-flex items-center rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            {retrying ? "Deneniyor..." : "Yeniden Dene"}
          </button>
        </div>
      ) : (
        syncWarning && (
          <p role="alert" className="mt-3 rounded-md bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
            İlanınız bu cihazda oluşturuldu, sunucu senkronizasyonu deneniyor/denendi. Bu sayfayı yenilerseniz güncel
            durum gösterilir.
          </p>
        )
      )}

      {/*
        ÜÇ SÜTUNLU MASAÜSTÜ YERLEŞİM (3. tur, referans görsele göre) — kök
        neden: önceki (2. tur) sürüm SOL GRUP tek bir "yığın" olarak
        tasarlanmıştı (başlık şeridi + [fotoğraf, bilgi] satırı + İş
        Açıklaması, hepsi ALTALTA), SAĞDA yalnızca Teklif Ver vardı — bu, iki
        gerçek sütun anlamına geliyordu, ÜÇ DEĞİL. Bu sürüm dış grid'i
        GERÇEK üç sütuna ayırır: SOL (fotoğraf galerisi + hemen altında İş
        Açıklaması — ikisi AYNI dar sütunda üst üste), ORTA (konum + tarih +
        hizmete özel bilgi bloğu — Konteyner Depolama için Depolama Talebi/
        Depolama Türü/Depolama Süresi/Konteyner Grupları dahil), SAĞ (Teklif
        Ver, sticky — davranışı/yetkilendirmesi DEĞİŞMEDİ). Başlık şeridi
        (rozetler + ilan başlığı) artık üç sütunun TAMAMININ ÜSTÜNDE, grid'in
        DIŞINDA, tam sayfa genişliğinde AYRI bir kart (tek bir sol "grup"a ait
        DEĞİL, hiçbir sütuna sıkışmıyor).

        Kategoriye özel kartların `lg:hidden` mobil-özel kopyaları ve
        masaüstü tek-satır özetleri (productInfoLine/recyclingSummaryLine/
        formatCustomsBrokerageSummaryLine) TAMAMEN KALDIRILDI — artık TEK bir
        render yeri (orta sütunun bilgi kartı) HER viewport'ta (mobilde
        grid'in altına doğal olarak yığılır) aynı, tam bilgiyi gösteriyor.
      */}
      <div className="mt-3 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {getCategoryDisplayLabel(job.category)}
          </span>
          <StatusBadge
            label={getJobOfferAvailabilityLabel(offerAvailability)}
            tone={getJobOfferAvailabilityTone(offerAvailability)}
          />
        </div>
        {/* Veri hiçbir zaman kesilmez, yalnızca CSS ile katlanır; tam
            başlık DOM'da ve `title` niteliğinde erişilebilir kalır —
            geniş şerit sayesinde uygun uzunluktaki başlıklar `line-clamp`
            sınırına hiç değmeden 1-2 satırda tam görünür. */}
        <h1
          title={job.title}
          className="mt-1.5 break-words text-2xl font-bold leading-tight tracking-heading text-foreground sm:text-3xl lg:line-clamp-2 lg:text-2xl"
        >
          {job.title}
        </h1>
      </div>

      <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(280px,320px)] lg:items-start lg:gap-4">
        {/* SOL SÜTUN — fotoğraf galerisi + hemen altında İş Açıklaması,
            AYNI dar sütunda üst üste (görev talimatı: "İş Açıklaması artık
            sayfanın altında tam genişlikte ayrı kart olarak bulunmasın,
            fotoğrafların altındaki boş alanı kullansın"). */}
        <div className="flex flex-col gap-2">
          <div className="rounded-card border border-border bg-surface p-4">
            <JobPhotoGallery photos={job.photos} jobTitle={job.title} />
          </div>
          <div className="rounded-card border border-border bg-surface p-4">
            <JobDescriptionPanel description={job.description} />
          </div>
        </div>

        {/* ORTA SÜTUN — konum + tarih + hizmete özel bilgi bloğu; doğrudan
            (varsa) firma adı → rota/konum → tarih → (varsa) "tarihi
            güncelleyin" uyarısı → hizmete özel bilgi bloğuyla başlar. */}
        <div className="mt-2 rounded-card border border-border bg-surface p-4 lg:mt-0">
          <div className="flex flex-col gap-2">
            {isLocationRevealed && locationSummary.companyOrFactoryName && (
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {locationSummary.companyOrFactoryName}
              </span>
            )}

                <ServiceLocationPanel job={job} session={session} offers={offers} />

                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {formatJobDateRange(job.workDate, job.workEndDate)}
                </span>

                {session?.id === job.requesterId && job.status !== "tamamlandi" && isJobDateInPast(job.workDate) && (
                  <p className="text-xs text-warning">Tarihi güncellemeniz önerilir.</p>
                )}
              </div>

              {/* Hizmete özel bilgi bloğu — kategoriye göre TAM OLARAK biri
                  render edilir (birbirini dışlayan dallar), her zaman AYNI
                  kompakt `InfoStatCard` kutularıyla. */}
              {isStorageJob && (
            <div className="mt-2 border-t border-border pt-2">
              <SectionHeading icon={Package}>Depolama Talebi</SectionHeading>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                {job.storageProductType && <InfoStatCard label="Depolanacak Ürün" value={job.storageProductType} />}
                {job.storageProductQuantity !== undefined && job.storageProductUnit && (
                  <InfoStatCard
                    label="Miktar"
                    value={formatRecyclingQuantity(job.storageProductQuantity, job.storageProductUnit)}
                  />
                )}
                {job.storageProductTonnage !== undefined && (
                  <InfoStatCard label="Toplam Tonaj" value={formatProductTonnage(job.storageProductTonnage)} />
                )}
                <InfoStatCard label="Depolama Türü" value={getCategoryDisplayLabel(job.category)} />
                {storageDurationDays !== null && <InfoStatCard label="Depolama Süresi" value={`${storageDurationDays} gün`} />}
              </dl>
              <StorageContainerGroupsCards job={job} />
              <StorageHazardInfo job={job} />
            </div>
          )}

          {isNakliyeJob && <NakliyeCargoGroupsDetailCards job={job} />}

          {isNakliyeJob && loadingMethodLabel && (
            <div className="mt-2 border-t border-border pt-2">
              <SectionHeading icon={Package}>Yükleme Yöntemi</SectionHeading>
              <p className="mt-2 text-sm text-foreground">{loadingMethodLabel}</p>
            </div>
          )}

          {!isNakliyeJob && !isStorageJob && hasProductInfo(job) && (
            <div className="mt-2 border-t border-border pt-2">
              <SectionHeading icon={Package}>Ürün Bilgileri</SectionHeading>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                {job.productQuantity !== undefined && (
                  <InfoStatCard label="Ürün Adedi" value={formatProductQuantity(job.productQuantity)} />
                )}
                {job.productTonnage !== undefined && (
                  <InfoStatCard label="Tonaj" value={formatProductTonnage(job.productTonnage)} />
                )}
                <InfoStatCard label="Ürün Cinsi" value={job.productType} />
              </dl>
            </div>
          )}

          {isRecyclingJob && (
            <div className="mt-2 border-t border-border pt-2">
              <SectionHeading icon={Recycle}>Geri Dönüşüm & Atık Tahliye Bilgileri</SectionHeading>
              <dl className="mt-2 flex flex-col gap-2 text-sm">
                {job.recyclingRequestedOperation && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Talep Edilen İşlem</dt>
                    <dd className="text-right text-foreground">
                      {getRecyclingRequestedOperationLabel(job.recyclingRequestedOperation) ?? "-"}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Atık Türü</dt>
                  <dd className="text-right text-foreground">
                    {job.recyclingMaterialCategoryId ? getRecyclingMaterialTypeLabel(job.recyclingMaterialCategoryId) ?? "-" : "-"}
                    {job.recyclingMaterialCategoryId
                      ? (() => {
                          const detail = getRecyclingMaterialTypeDetailLine(job.recyclingMaterialCategoryId, job.recyclingMaterialSubtypeId);
                          return detail ? ` — ${detail}` : "";
                        })()
                      : ""}
                  </dd>
                </div>
                {job.recyclingWasteCodeUnknown ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Atık Kodu</dt>
                    <dd className="text-right text-warning">Bilinmiyor — admin incelemesi bekleniyor</dd>
                  </div>
                ) : job.recyclingWasteCode ? (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Atık Kodu</dt>
                      <dd className="text-right text-foreground">
                        {formatWasteCodeForDisplay(job.recyclingWasteCode)}
                        {getWasteCodeEntry(job.recyclingWasteCode) ? ` — ${getWasteCodeEntry(job.recyclingWasteCode)!.description}` : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Tehlike Durumu</dt>
                      <dd
                        className={`text-right font-medium ${
                          (job.recyclingHazardous ?? deriveWasteCodeHazardous(job.recyclingWasteCode)) ? "text-danger" : "text-success"
                        }`}
                      >
                        {(job.recyclingHazardous ?? deriveWasteCodeHazardous(job.recyclingWasteCode)) ? "Tehlikeli" : "Tehlikesiz"}
                      </dd>
                    </div>
                    {job.recyclingHazardProperties && job.recyclingHazardProperties.length > 0 && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Tehlike Özelliği</dt>
                        <dd className="text-right text-foreground">
                          {job.recyclingHazardProperties.map((id) => getWasteHazardPropertyLabel(id) ?? id).join(", ")}
                        </dd>
                      </div>
                    )}
                  </>
                ) : null}
                {job.recyclingQuantity !== undefined && job.recyclingUnit && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Tahmini Miktar</dt>
                    <dd className="text-right text-foreground">{formatRecyclingQuantity(job.recyclingQuantity, job.recyclingUnit)}</dd>
                  </div>
                )}
                {job.recyclingMaterialCondition && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Malzeme Durumu</dt>
                    <dd className="text-right text-foreground">
                      {getRecyclingMaterialConditionLabel(job.recyclingMaterialCondition) ?? "-"}
                      {job.recyclingMaterialCondition === "diger" && job.recyclingMaterialConditionNote
                        ? ` (${job.recyclingMaterialConditionNote})`
                        : ""}
                    </dd>
                  </div>
                )}
              </dl>
              {recyclingScopeLabels.length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Hizmet Kapsamı
                    {recyclingAllScopeSelected && <span className="text-muted-foreground/70"> (Tüm Süreç)</span>}
                  </p>
                  {/* Rozetler — "Tüm Süreç" bir rozet DEĞİL, yalnızca
                      yukarıdaki başlığın yanında görsel bir not; dört
                      seçim (varsa) her zaman ayrı ayrı erişilebilir
                      rozetler olarak burada kalır. */}
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {recyclingScopeLabels.map((label) => (
                      <li
                        key={label}
                        className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                      >
                        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {isCustomsJob && (
            <div className="mt-2 border-t border-border pt-2">
              <SectionHeading icon={FileText}>Gümrük Müşavirliği Bilgileri</SectionHeading>
              <dl className="mt-2 flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">İşlem Türü</dt>
                  <dd className="text-right text-foreground">
                    {job.customsTransactionType ? getCustomsTransactionTypeLabel(job.customsTransactionType) ?? "-" : "-"}
                  </dd>
                </div>
                {job.customsRequestedServices && job.customsRequestedServices.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Talep Edilen Hizmetler</dt>
                    <dd className="text-right text-foreground">{getCustomsRequestedServiceLabels(job.customsRequestedServices).join(", ")}</dd>
                  </div>
                )}
                {job.customsProductType && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Ürün Cinsi</dt>
                    <dd className="text-right text-foreground">{job.customsProductType}</dd>
                  </div>
                )}
              </dl>
              {job.customsDocuments && job.customsDocuments.length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="text-xs font-medium text-muted-foreground">Destekleyici Evraklar</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {job.customsDocuments.map((document) => (
                      <li key={document.id}>
                        <CustomsDocumentLink document={document} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        </div>

        {/*
          SAĞ SÜTUN — yalnızca "Teklif Ver": `lg:sticky lg:top-24` ile
          kaydırma sırasında görünür kalır (bkz. bu bileşenin üst
          kısmındaki grid yorumunun tam gerekçesi). OfferPanel'in
          oturum-açmamış/rol-uygun-değil dallarında artık `AuthGateNotice`
          `bare` modda render edilir (bkz. o bileşenin kendi yorumu) — bu
          kartın İÇİNDE ikinci, iç içe bir kart kalmaz; kilit ikonu/mesaj/
          buton doğrudan bu kartın akışında yer alır. OfferPanel'in kendi
          diğer iç durumları (REOFFER_BLOCKED, süre dolmuş, kapasite dolu,
          vb.) hâlâ kasıtlı olarak `bg-background` ikincil kutular kullanıyor
          — bu, Ürün Bilgileri kartının kendi `InfoStatCard`larıyla AYNEN
          aynı, projede zaten var olan "kart içinde ikincil kutu" deseni;
          "gereksiz çift kart" sorunu YALNIZCA AuthGateNotice içindi.
        */}
        <div className="mt-6 lg:sticky lg:top-24 lg:mt-0 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Teklif Ver</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Yalnızca Hizmet Veren kullanıcılar bu ilana teklif verebilir.
            </p>
            <div className="mt-4">
              {isJobOpenForOffers(job.status) ? (
                <OfferPanel job={job} offers={offers} />
              ) : (
                <p className="rounded-card border border-border bg-background p-6 text-sm leading-relaxed text-muted-foreground">
                  Bu ilan şu anda teklif almaya açık değil.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/*
        NADİR/ESKİ İÇERİK — kabul kriterlerinin kapsamı DIŞINDA (yalnızca
        "Ürün Bilgileri"/"İş Açıklaması" ana gridin altında KALMAMALI
        deniyor): bu üçü gerçek ilanların ezici çoğunluğunda hiç render
        edilmez — `operationDetails` formdan tamamen kaldırıldığı için yalnız
        bu değişiklikten ÖNCEki eski ilanlarda dolu olabilir,
        `OperationStatusCard` yalnızca Çoklu Hizmet Operasyonu'nun bir
        parçası olan ilanlarda görünür. Sıfır-kaydırma hedefi normal/tipik
        bir ilan için geçerlidir; bu üç nadir durum en altta, ayrı bir
        blokta kalmaya devam eder.
      */}
      {(job.operationDetails.trim().length > 0 || job.operationId) && (
        <div className="mt-6 flex flex-col gap-6">
          {job.operationDetails.trim().length > 0 && (
            <div className="rounded-card border border-border bg-surface p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
                <ClipboardList className="h-5 w-5 text-accent" aria-hidden="true" />
                Operasyon Detayları
              </h2>
              <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{job.operationDetails}</p>
            </div>
          )}

          {job.operationId && <OperationStatusCard currentJob={job} offers={offers} session={session} />}
        </div>
      )}
    </PageContainer>
  );
}
