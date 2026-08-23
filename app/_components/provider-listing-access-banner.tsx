import { AlertTriangle, Clock, FileWarning, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import type { MyServiceAuthorizationRow, MyServiceStatus } from "../_lib/supabase-my-service-authorizations";

/**
 * Provider'ın "Aktif İlanlar" ekranındaki üç ayrı, KASITLI OLARAK asla
 * birbirine karıştırılmayan boş-durum bannerı (görev bölüm 12-19/46):
 * hiç yetki yok / belge onay bekliyor / belge reddedildi — hiçbiri "ilan
 * bulunamadı"nın genel metniyle aynı DEĞİLDİR, provider'ın "neden hiçbir şey
 * göremiyorum" sorusuna GERÇEK nedeni verir. KISMİ yetkili bir provider
 * (bazı hizmetleri onaylı) için bu bileşen HİÇBİR ZAMAN blanket bir uyarı
 * göstermez — yalnızca (a) "Tümü" seçiliyken VE hiçbir hizmeti onaylı
 * değilken, ya da (b) SPESİFİK olarak yetkisi olmayan bir kategori
 * seçildiğinde devreye girer. İkinci durum, birinciden ÖNCELİKLİDİR — bir
 * kategori seçilmişse kullanıcının asıl bilmek istediği o kategorinin
 * durumudur.
 */

const CATEGORY_UPLOAD_HREF = (categoryId: string) => `/panel/belge-yukleme?hizmet=${encodeURIComponent(categoryId)}`;

function formatAuthorizedList(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} ve ${labels[labels.length - 1]}`;
}

function BannerShell({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof AlertTriangle;
  tone: "warning" | "danger" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    warning: "border-warning/30 bg-warning-soft",
    danger: "border-danger/30 bg-danger-soft",
    neutral: "border-border bg-surface",
  }[tone];
  const iconToneClass = { warning: "text-warning", danger: "text-danger", neutral: "text-muted-foreground" }[tone];

  return (
    <div className={`mt-4 rounded-card border p-6 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconToneClass}`} aria-hidden="true" />
        <div>
          <h2 className="text-base font-bold tracking-heading leading-tight text-foreground">{title}</h2>
          <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

function NoAccessYetNotice({ hasAnySelected }: { hasAnySelected: boolean }) {
  return (
    <BannerShell icon={ShieldOff} tone="neutral" title="Hizmet ilanlarına erişiminiz henüz aktif değil">
      <p>Faaliyet belgeniz admin tarafından onaylanmadığı için aktif hizmet ilanlarını şu anda görüntüleyemiyorsunuz.</p>
      {!hasAnySelected && (
        <p>
          Henüz bir hizmet seçip belge yüklemediyseniz, önce hangi hizmeti verdiğinizi belirtip faaliyet belgenizi
          yüklemeniz gerekiyor.
        </p>
      )}
      <Link
        href="/panel/belge-yukleme"
        className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Faaliyet Belgesi Yükle
      </Link>
    </BannerShell>
  );
}

function PendingNotice() {
  return (
    <BannerShell icon={Clock} tone="warning" title="Faaliyet belgeniz admin onayı bekliyor">
      <p>
        Belgeniz inceleniyor. Admin onayladıktan sonra ilgili hizmete ait ilanları görüntüleyebilir ve teklif
        verebilirsiniz — onaylandığında bir bildirim alacaksınız.
      </p>
    </BannerShell>
  );
}

/**
 * DÜZELTME (proje raporu, "Belge Onayı / Hizmet Yetkilendirme Senkron
 * Sorunu"): bu durum (`approved_awaiting_authorization`) eskiden hiç
 * tanınmıyordu ve sessizce `NoAccessYetNotice`in "belge yükleyin" CTA'sına
 * düşüyordu — provider'a zaten onaylanmış belgesini YENİDEN YÜKLEMESİNİ
 * söylüyordu. migration 0041 belge onayını otomatik yetkilendirmeye
 * bağladığı için bu ekran artık pratikte nadiren/anlık görünür, ama hâlâ
 * dürüst ve doğru bir mesaj vermesi gerekir — "yeniden yükle" DEĞİL.
 */
function AwaitingAuthorizationNotice() {
  return (
    <BannerShell icon={ShieldCheck} tone="warning" title="Belgeniz onaylandı, hizmet yetkiniz açılıyor">
      <p>
        Faaliyet belgeniz admin tarafından onaylandı. Hizmet yetkiniz normal şartlarda onayla birlikte otomatik
        açılır — birkaç dakika içinde açılmazsa lütfen yönetici ile iletişime geçin.
      </p>
    </BannerShell>
  );
}

function RejectedNotice({ rows }: { rows: MyServiceAuthorizationRow[] }) {
  const rejected = rows.find((row) => row.status === "document_rejected");
  return (
    <BannerShell icon={FileWarning} tone="danger" title="Faaliyet belgeniz onaylanmadı">
      <p>Bu hizmeti kullanabilmek için geçerli bir faaliyet belgesi yüklemeniz gerekiyor.{rejected?.documentReviewNote ? ` Neden: ${rejected.documentReviewNote}` : ""}</p>
      <Link
        href="/panel/hesap-ayarlari"
        className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Yeni Belge Yükle
      </Link>
    </BannerShell>
  );
}

function UnauthorizedCategoryNotice({
  categoryId,
  label,
  status,
  authorizedLabels,
}: {
  categoryId: string;
  label: string;
  status: MyServiceStatus | undefined;
  authorizedLabels: string[];
}) {
  const authorizedText =
    authorizedLabels.length > 0
      ? `Profiliniz şu anda ${formatAuthorizedList(authorizedLabels)} için onaylanmıştır.`
      : "Henüz hiçbir hizmet için yetkilendirilmediniz.";

  return (
    <BannerShell icon={AlertTriangle} tone="neutral" title={`${label} hizmetine erişiminiz bulunmuyor`}>
      <p>{authorizedText}</p>
      {status === "document_pending" ? (
        <p>{label} için yüklediğiniz belge admin incelemesinde — onaylandığında bu hizmete ait ilanları görüntüleyebileceksiniz.</p>
      ) : status === "approved_awaiting_authorization" ? (
        <p>
          {label} için yüklediğiniz belge onaylandı, yetkiniz normal şartlarda otomatik açılır — birkaç dakika
          içinde açılmazsa lütfen yönetici ile iletişime geçin.
        </p>
      ) : status === "revoked" ? (
        <p>Bu hizmete erişiminiz admin tarafından durduruldu. Yeniden erişim için admin ile iletişime geçin.</p>
      ) : status === "document_rejected" ? (
        <>
          <p>{label} için yüklediğiniz belge onaylanmadı. İlanları görüntüleyebilmek ve teklif verebilmek için yeni bir belge yüklemeniz gerekiyor.</p>
          <Link
            href="/panel/hesap-ayarlari"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Yeni Belge Yükle
          </Link>
        </>
      ) : (
        <>
          <p>
            {label} ilanlarını görüntüleyebilmek ve teklif verebilmek için {label} faaliyet belgenizi yüklemeniz
            gerekiyor.
          </p>
          <Link
            href={CATEGORY_UPLOAD_HREF(categoryId)}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Faaliyet Belgesi Yükle
          </Link>
        </>
      )}
    </BannerShell>
  );
}

export function ProviderListingAccessBanner({
  loading,
  rows,
  selectedCategoryId,
  selectedCategoryLabel,
}: {
  loading: boolean;
  rows: MyServiceAuthorizationRow[];
  /** `filters.category` — boş string "Tümü" demektir. */
  selectedCategoryId: string;
  /** Katalogdan çözülmüş görünen ad — `rows` içinde bu id bulunamazsa (teorik olarak imkansız, katalog her zaman TAM döner) yedek olarak kullanılır. */
  selectedCategoryLabel: string;
}) {
  if (loading) return null;

  const authorizedLabels = rows.filter((row) => row.status === "authorized").map((row) => row.serviceCategoryLabel);

  if (selectedCategoryId) {
    const selectedRow = rows.find((row) => row.serviceCategoryId === selectedCategoryId);
    if (selectedRow?.status === "authorized") return null;
    return (
      <UnauthorizedCategoryNotice
        categoryId={selectedCategoryId}
        label={selectedRow?.serviceCategoryLabel ?? selectedCategoryLabel}
        status={selectedRow?.status}
        authorizedLabels={authorizedLabels}
      />
    );
  }

  if (authorizedLabels.length > 0) return null;

  if (rows.some((row) => row.status === "document_rejected")) return <RejectedNotice rows={rows} />;
  if (rows.some((row) => row.status === "document_pending")) return <PendingNotice />;
  if (rows.some((row) => row.status === "approved_awaiting_authorization")) return <AwaitingAuthorizationNotice />;
  return <NoAccessYetNotice hasAnySelected={rows.some((row) => row.status !== "not_selected")} />;
}
