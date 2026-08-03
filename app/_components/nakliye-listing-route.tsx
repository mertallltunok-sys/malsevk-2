import { MoveDown } from "lucide-react";
import type { NakliyeShortRouteSide } from "../_lib/nakliye-route";

/**
 * Nakliyeci Hizmet Veren'in ana ilan listesinde (job-listing-table.tsx
 * masaüstü + job-listing-cards.tsx mobil) "Firma / Bölge / Konum" alanının
 * YERİNE geçen, yükleme→teslimat güzergâhının TEK paylaşılan render'ı — aynı
 * JSX iki dosyada ayrı ayrı yazılmaz. Üst blok HER ZAMAN yükleme (pickup),
 * alt blok HER ZAMAN teslimat (delivery) — sıra çağırandan bağımsız, asla
 * tersine çevrilmez. İl/İlçe satırları küçük+soluk (`text-xs
 * text-muted-foreground`), tesis/firma adı satırları belirgin+koyu
 * (`font-medium text-foreground`) — kendi rengini/boyutunu taşır, hangi
 * ekranda (tablo hücresi ya da kart) kullanılırsa kullanılsın üst context'ten
 * miras alınan bir renge bağımlı DEĞİLDİR. Her tarafın `nameLabel`i (tesis/
 * firma adı) boşsa (bu alandan önce oluşturulmuş, adsız eski kayıtlar)
 * yalnızca `locationLabel` (İl / İlçe) gösterilir — "undefined"/"null"/boş
 * satır asla üretilmez (nakliye-route.ts#NakliyeShortRouteSide'ın kendi
 * "yalnızca dolu alanı göster" ilkesiyle AYNI, burada ayrıca icat edilmez).
 * Çağıran taraf bunu yalnızca gerçek Nakliyeci (Hizmet Veren rolü + kendi
 * hizmet kategorisi Nakliye) bir izleyici için, VE ilanın kendisi Nakliye
 * kategorisindeyse (bkz. nakliye-route.ts#getNakliyeShortRoute'un null
 * dönüşü) render eder — bu bileşenin kendisi bu iki koşulu KONTROL ETMEZ,
 * yalnızca zaten doğrulanmış veriyi biçimlendirir.
 */
export function NakliyeListingRoute({
  pickup,
  delivery,
}: {
  pickup: NakliyeShortRouteSide;
  delivery: NakliyeShortRouteSide;
}) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="block truncate text-xs text-muted-foreground">{pickup.locationLabel}</span>
      {pickup.nameLabel && (
        <span className="block truncate font-medium text-foreground">{pickup.nameLabel}</span>
      )}
      <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <MoveDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        {delivery.locationLabel}
      </span>
      {delivery.nameLabel && (
        <span className="block truncate font-medium text-foreground">{delivery.nameLabel}</span>
      )}
    </span>
  );
}
