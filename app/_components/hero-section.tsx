"use client";

import { ButtonLink } from "./button-link";
import { HeroMotionVideo } from "./hero-motion-video";
import { PageContainer } from "./page-container";
import { useIsSessionLoading, useSession } from "../_lib/use-session";

/**
 * "Hero rol bazlı buton" görevi — bir önceki görev (hero sadeleştirme) iki
 * butonu HER rolde birlikte gösteriyordu; bu görev bunu geri alıp gerçek rol
 * bazlı görünürlüğe döndürüyor: Ziyaretçi iki buton, Hizmet Alan yalnız
 * "Hizmet Talebi Oluştur", Hizmet Veren yalnız "İş İlanlarını Görüntüle".
 * Rol çözümü İKİNCİ bir auth/rol sistemi İCAT ETMİYOR — `useSession()` +
 * `useIsSessionLoading()` (`session.ts`/`use-session.ts`, services-
 * section.tsx'in "yavaş ağda yanlış CTA" düzeltmesinde zaten kanıtlanmış AYNI
 * merkezi kaynak) yeniden kullanılıyor; rol asla URL/kullanıcı adı/
 * localStorage'dan TAHMİN EDİLMİYOR. Rol bazlı buton mantığı BİLEREK
 * `HeroMotionVideo`nun (görselin/videonun kendisi) İÇİNE gömülmedi — o
 * bileşen tamamen değişmeden, oturumdan bağımsız kaldı; tüm rol dallanması
 * bu (session-aware) üst bileşende çözülüyor.
 */
export function HeroSection() {
  const session = useSession();
  const isSessionLoading = useIsSessionLoading();

  // "Yavaş Ağda/Yüklemede Yanlış CTA" — services-section.tsx'teki AYNI ilke:
  // rol henüz çözülmemişken (isSessionLoading === true) `resolvedRole`
  // `undefined` kalır, bu da aşağıdaki HeroCtaRow'un HİÇBİR butonu (ne
  // ziyaretçininkini ne rolünkini) GÖSTERMEDEN, yalnızca ölçüyü koruyan boş
  // bir alanla beklemesini sağlar — "göz kırpma"/yanlış rol butonunun kısa
  // süreliğine görünmesi ihtimalini yapısal olarak ORTADAN KALDIRIR.
  const resolvedRole: "hizmet-alan" | "hizmet-veren" | "guest" | undefined = isSessionLoading
    ? undefined
    : session === null
      ? "guest"
      : session.role === "hizmet-alan" || session.role === "hizmet-veren"
        ? session.role
        : "guest"; // admin: bu bölümün hedef kitlesi değil, ziyaretçiyle aynı genel görünüm.

  return (
    <section className="border-b border-border bg-background">
      <PageContainer className="py-10 sm:py-12">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            Türkiye&apos;nin lojistik hizmet platformu
          </span>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-heading text-foreground sm:text-4xl">
            Lojistik operasyonunuz tek platformda
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            İhtiyacınızı yayınlayın, uzman firmalardan teklif alın ve tüm süreci tek ekrandan yönetin.
          </p>

          <HeroCtaRow role={resolvedRole} />
        </div>

        {/* Sayfanın TEK operasyon akışı anlatımı — bkz. hero-motion-video.tsx
            (bu görevde HİÇ değiştirilmedi: dosya yolu/animasyon/oran aynı). */}
        <div className="mt-8 sm:mt-10">
          <HeroMotionVideo />
        </div>
      </PageContainer>
    </section>
  );
}

const CTA_BASE_CLASSNAME = "w-full sm:w-auto";

/**
 * Üç oturum durumuna göre TAM olarak görev talimatının tablosunu uygular.
 * `role === undefined` (oturum henüz çözülmedi) HİÇBİR buton göstermez —
 * yanlış CTA'nın kısa süreli görünmesini engelleyen tek yer burasıdır.
 * Yükleme yer tutucusunun yüksekliği (`h-[46px]`), gerçek buton
 * yüksekliğiyle (`ButtonLink`'in `py-3` + metin) eşleşecek şekilde
 * services-section.tsx'teki AYNI değerle seçildi — layout shift önlenir.
 */
function HeroCtaRow({
  role,
}: {
  role: "hizmet-alan" | "hizmet-veren" | "guest" | undefined;
}) {
  if (role === undefined) {
    return <div className="mt-8 h-[46px]" aria-hidden="true" />;
  }

  if (role === "hizmet-alan") {
    return (
      <div className="mt-8 flex justify-center">
        <ButtonLink href="/hizmet-talebi-olustur" variant="primary" className={CTA_BASE_CLASSNAME}>
          Hizmet Talebi Oluştur
        </ButtonLink>
      </div>
    );
  }

  if (role === "hizmet-veren") {
    return (
      <div className="mt-8 flex justify-center">
        <ButtonLink href="/ilanlar" variant="primary" className={CTA_BASE_CLASSNAME}>
          İş İlanlarını Görüntüle
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      <ButtonLink href="/hizmet-talebi-olustur" variant="primary" className={CTA_BASE_CLASSNAME}>
        Hizmet Talebi Oluştur
      </ButtonLink>
      <ButtonLink href="/ilanlar" variant="secondary" className={CTA_BASE_CLASSNAME}>
        İş İlanlarını İncele
      </ButtonLink>
    </div>
  );
}
