import { ArrowDown, Lock, MapPin } from "lucide-react";
import { canViewJobAddress } from "../_lib/job-requests";
import { getNakliyeRouteInfo } from "../_lib/nakliye-route";
import type { Job, Offer, Session } from "../_lib/types";

/** Adres gizli olduğunda gösterilen nötr metin — contact-access.ts/job-requests.ts'in mevcut "yalnızca kabul edilen teklif sonrası görünür" ilkesiyle tutarlı, yeni bir metin/kural icat edilmez. */
const HIDDEN_ADDRESS_NOTICE = "Tam adres, teklif kabul edildikten sonra görüntülenebilir.";

type RouteSideDisplay = {
  title: string;
  district: string;
  province: string;
  facilityName: string | null;
  addressText: string | null;
};

/**
 * Bir güzergâh tarafının (pickup ya da delivery) gövdesi — tesis/manuel ad VE
 * açık adres artık BİRLİKTE, ikisi de gösterilir (bkz. görev tanımı madde 9:
 * "İl/İlçe, tesis adı (katalog ya da manuel), açık adres" hepsi aynı anda) —
 * eski "ya tesis adı ya açık adres" (mutually exclusive) gösterim KALDIRILDI,
 * çünkü açık adres artık seçilen yönteme bakılmaksızın her zaman zorunlu/dolu
 * (bkz. nakliye-route.ts#NakliyeRouteSide). facilityName `null` yalnızca bu
 * alandan önce oluşturulmuş eski kayıtlarda görülebilir (geriye dönük
 * uyumluluk) ve o durumda hiç render edilmez. Adres kısmı hâlâ (görünürse)
 * gerçek metindir ya da (gizliyse) kilitli bildirim metnidir.
 */
function RouteSideBlock({ side, showAddress }: { side: RouteSideDisplay; showAddress: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{side.title}</p>
      <p className="mt-1 text-sm text-foreground">
        {side.district} / {side.province}
      </p>
      {side.facilityName && (
        <p className="mt-0.5 text-sm font-medium text-foreground break-words">{side.facilityName}</p>
      )}
      {showAddress ? (
        side.addressText && <p className="mt-0.5 break-words text-sm text-muted-foreground">{side.addressText}</p>
      ) : (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {HIDDEN_ADDRESS_NOTICE}
        </p>
      )}
    </div>
  );
}

/**
 * "Taşıma Güzergâhı" kartı — Nakliye ilanlarında Yük Alınacak Yer/Teslim
 * Edilecek Yer'i ayrı ayrı gösterir (bkz. görev tanımı madde 6/9). Nakliye
 * dışındaki hiçbir kategoride render EDİLMEZ (null döner) — bu, çağıranın
 * (job-detail-content.tsx) kendi kategori kontrolü yapmasına gerek
 * bırakmaz, TEK doğruluk kaynağı burasıdır. Aynı sayfada teklif alanına
 * yakın, tek bir güzergâh kartı olarak kalır (bkz. görev tanımı madde 10 —
 * mükerrer büyük kart oluşturulmaz). Açık adres kısmı job.addressText/
 * job.deliveryAddressText ile AYNI gizlilik kapısını (job-requests.ts#
 * canViewJobAddress) kullanır — yeni bir güvenlik kuralı YOKTUR; tesis/manuel
 * adı hiçbir zaman gizlenmez (bkz. görev tanımı madde 9 — "Listede yok,
 * kendim gireceğim" metni asla gösterilmez, yalnızca kullanıcının yazdığı
 * gerçek ad gösterilir).
 */
export function NakliyeRouteCard({
  job,
  offers,
  session,
}: {
  job: Job;
  offers: Offer[];
  session: Session | null;
}) {
  const route = getNakliyeRouteInfo(job);
  if (!route) return null;

  const showAddress = canViewJobAddress(session, job, offers);

  const pickup: RouteSideDisplay = {
    title: "Yük Alınacak Yer",
    district: route.pickup.district,
    province: route.pickup.province,
    facilityName: route.pickup.facilityName,
    addressText: route.pickup.addressText,
  };
  const delivery: RouteSideDisplay = {
    title: "Teslim Edilecek Yer",
    district: route.delivery.district,
    province: route.delivery.province,
    facilityName: route.delivery.facilityName,
    addressText: route.delivery.addressText,
  };

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-heading leading-tight text-foreground">
        <MapPin className="h-5 w-5 text-accent" aria-hidden="true" />
        Taşıma Güzergâhı
      </h2>
      <div className="mt-4 flex flex-col items-start gap-3">
        <RouteSideBlock side={pickup} showAddress={showAddress} />
        <ArrowDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <RouteSideBlock side={delivery} showAddress={showAddress} />
      </div>
    </div>
  );
}
