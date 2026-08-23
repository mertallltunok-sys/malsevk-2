import { ArrowDown, Flag, Lock, MapPin } from "lucide-react";
import { getJobLocationSummary } from "../_lib/job-location";
import { canViewJobAddress } from "../_lib/job-requests";
import { getNakliyeRouteInfo, isTransportationCategory, type NakliyeRouteSide } from "../_lib/nakliye-route";
import { isSafeHttpUrl } from "../_lib/text-sanitization";
import type { Job, Offer, Session } from "../_lib/types";

/**
 * MALSEVK genel ilan gizlilik kuralı — teklif kabul edilmeden önce, ilanı
 * görmeye yetkili HER Hizmet Veren (16 aktif hizmet kategorisinin
 * TAMAMINDA) yalnızca İlçe/İl görür; tesis/fabrika adı VE açık adres
 * yalnızca ilan sahibi, admin, ve teklifi kabul edilmiş/anlaşması hâlâ
 * geçerli Hizmet Veren için açılır (bkz. job-requests.ts#canViewJobAddress
 * — İKİNCİ bir gizlilik kuralı İCAT EDİLMEDİ, mevcut fonksiyon hem tesis
 * adı hem açık adres için TEK gate olarak yeniden kullanılır). Sunucu
 * tarafında zaten maskelenen alanları (bkz. supabase/migrations/0052)
 * burada AYRICA gizlemeye gerek yoktur — bu bileşen yalnızca "elimde olan
 * veriyi ne zaman göstereyim" kararını verir, ikinci bir güvenlik sınırı
 * DEĞİLDİR (gerçek sınır sunucu tarafı projeksiyon RPC'sidir).
 *
 * Nakliye iki noktalı (Yükleme/Teslim), diğer 15 kategori tek noktalı
 * ("Hizmet Konumu") gösterir — ikisi de AYNI temel bileşeni (`LocationPoint`)
 * ve AYNI kilit mesajını kullanır, sayfada başka hiçbir yerde tekrarlanmaz
 * (bkz. job-detail-content.tsx'in bu bileşeni çağırdığı tek yer — eski ayrı
 * "Taşıma Güzergâhı" kartı ve Home-ikonlu adres bloğu bu panelin lehine
 * kaldırıldı).
 */
export const LOCATION_PRIVACY_LOCK_MESSAGE = "Tesis ve açık adres, teklifiniz kabul edildiğinde paylaşılır.";

function LocationPoint({
  icon: Icon,
  label,
  district,
  province,
  isRevealed,
  facilityName,
  addressText,
  directionsNote,
  locationUrl,
  hideIcon = false,
}: {
  icon: typeof MapPin;
  label: string;
  district: string;
  province: string;
  isRevealed: boolean;
  facilityName?: string;
  addressText?: string;
  directionsNote?: string;
  locationUrl?: string;
  /**
   * Nakliye'nin iki noktalı rota görünümü (bkz. ServiceLocationPanel) pin/
   * bayrak ikonlarını KENDİ metin bloğundan ayırıp PAYLAŞILAN, tam
   * yükseklikte tek bir marker sütununda gösterir (rota hattının doğru
   * konumlanabilmesi için — bkz. o bloğun kendi dokümanı). `true` iken bu
   * bileşen yalnızca metin içeriğini döner, ikon/dış satırı HİÇ render
   * ETMEZ — çağıran taraf ikonu kendisi, ayrı yerde basar. Diğer (tek
   * noktalı "Hizmet Konumu") çağıran bu prop'u HİÇ geçirmez — varsayılan
   * `false` ile davranış ÖNCEKİYLE BİREBİR AYNI kalır.
   */
  hideIcon?: boolean;
}) {
  const content = (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-semibold text-foreground">
        {district} / {province}
      </p>
      {isRevealed ? (
        <>
          {facilityName && <p className="mt-0.5 break-words text-sm text-muted-foreground">{facilityName}</p>}
          {addressText && <p className="mt-0.5 break-words text-sm text-muted-foreground">{addressText}</p>}
          {directionsNote && <p className="mt-0.5 break-words text-xs text-muted-foreground">{directionsNote}</p>}
          {locationUrl && isSafeHttpUrl(locationUrl) && (
            <a
              href={locationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
            >
              Haritada Görüntüle
            </a>
          )}
        </>
      ) : (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {LOCATION_PRIVACY_LOCK_MESSAGE}
        </p>
      )}
    </div>
  );

  if (hideIcon) return content;

  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      {content}
    </div>
  );
}

export function ServiceLocationPanel({ job, session, offers }: { job: Job; session: Session | null; offers: Offer[] }) {
  const isRevealed = canViewJobAddress(session, job, offers);
  const nakliyeRoute = isTransportationCategory(job.category) ? getNakliyeRouteInfo(job) : null;

  if (nakliyeRoute) {
    const pickup: NakliyeRouteSide = nakliyeRoute.pickup;
    const delivery: NakliyeRouteSide = nakliyeRoute.delivery;
    return (
      // DÜZELTME (2. tur): rota hattı ÖNCE ayrı bir "orta satır" (kendi
      // layout yüksekliği olan bir flex-col çocuğu) olarak eklenmişti — bu
      // hem Yükleme/Teslim arasını gereğinden fazla açıyordu HEM DE pin/
      // bayrağın TAM altında/üstünde başlamıyor/bitmiyordu (metin bloğunun
      // değişken yüksekliği yüzünden). Doğru çözüm: pin VE bayrağı, metin
      // bloklarından AYRI, PAYLAŞILAN tek bir marker sütununda (soldaki
      // `w-4` sütun) göstermek — bu sütun, sağındaki içerik sütunuyla AYNI
      // flex-satırda olduğu için `align-items: stretch` (varsayılan)
      // sayesinde OTOMATİK olarak içerik kadar uzar; pin sütunun EN
      // ÜSTÜNDE, bayrak `mt-auto` ile EN ALTINDA sabitlenir. Kesikli çizgi +
      // ok bu sütunun İÇİNDE `position: absolute` bir overlay'dir — normal
      // akışta HİÇ yer kaplamaz, bu yüzden Yükleme/Teslim metinleri artık
      // yalnızca `gap-3` (12px, görev tanımındaki 12-16px aralığının alt
      // sınırı) ile ayrılır. `top-5`/`bottom-5` (20px), 16px'lik ikon
      // yüksekliğinin dışına yalnızca ~4px taşar — yani çizgi pinin
      // hemen altından başlar, bayrağın hemen üstünde biter. Yatay merkez:
      // pin/bayrak/çizgi/ok'un HEPSİ aynı `w-4` sütununda ortalanır
      // (`items-center` + `left-1/2 -translate-x-1/2`) — `left: 50%` ile
      // SAYFAYI/metin alanını ortalayan bir hile DEĞİL, yalnızca bu dar
      // marker sütununun kendi içinde ortalama. Renk/ok rengi ÖNCEKİ
      // düzeltmeyle AYNI (mevcut `--muted-fg`/`--success` token'ları,
      // yeni bir sabit renk YOK). Masaüstü/mobilde AYNI yapı kullanılır,
      // responsive'e özel bir dal YOK.
      <div className="flex gap-2.5">
        <div className="relative flex w-4 shrink-0 flex-col items-center" aria-hidden="true">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <div className="pointer-events-none absolute top-5 bottom-5 left-1/2 flex w-0 -translate-x-1/2 flex-col items-center">
            <span className="w-0 flex-1 border-l-2 border-dashed border-muted-foreground/40" />
            <ArrowDown className="h-4 w-4 shrink-0 text-success" />
            <span className="w-0 flex-1 border-l-2 border-dashed border-muted-foreground/40" />
          </div>
          <Flag className="mt-auto h-4 w-4 shrink-0 text-primary" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <LocationPoint
            hideIcon
            icon={MapPin}
            label="Yükleme Noktası"
            district={pickup.district}
            province={pickup.province}
            isRevealed={isRevealed}
            facilityName={pickup.facilityName ?? undefined}
            addressText={pickup.addressText ?? undefined}
            directionsNote={job.directionsNote}
            locationUrl={job.locationUrl}
          />
          <LocationPoint
            hideIcon
            icon={Flag}
            label="Teslim Noktası"
            district={delivery.district}
            province={delivery.province}
            isRevealed={isRevealed}
            facilityName={delivery.facilityName ?? undefined}
            addressText={delivery.addressText ?? undefined}
          />
        </div>
      </div>
    );
  }

  // DÜZELTME: Nakliye-dışı (tek noktalı) "Hizmet Konumu" görünümü eskiden
  // kendi iç kartına (sol koyu çizgi + gri arka plan + border + radius +
  // padding) sarılıyordu — ana bilgi panelinin İÇİNDE ikinci bir kart
  // hissi yaratan, Nakliye'nin kartsız rota tasarımıyla tutarsız bir
  // görsel katman. O sarmalayıcı kaldırıldı: `LocationPoint` artık
  // doğrudan ana panelin (job-detail-content.tsx'teki beyaz bilgi kartı)
  // üzerine, çevresinde ekstra çerçeve/arka plan olmadan render edilir —
  // Nakliye dalı zaten hiçbir zaman böyle bir sarmalayıcı kullanmıyordu,
  // bu değişiklik ikisini görsel olarak hizalar. Veri/gizlilik/prop akışı
  // (`isRevealed`, kilit mesajı, pin ikonu, etiket) BİREBİR AYNI kaldı —
  // yalnızca çevresindeki dekoratif `<div>` kaldırıldı.
  const summary = getJobLocationSummary(job);
  return (
    <LocationPoint
      icon={MapPin}
      label="Hizmet Konumu"
      district={summary.district}
      province={summary.province}
      isRevealed={isRevealed}
      facilityName={summary.facilityDisplayName || undefined}
      addressText={job.addressText}
      directionsNote={job.directionsNote}
      locationUrl={job.locationUrl}
    />
  );
}
