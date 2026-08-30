"use client";

import { ChevronDown, Forklift, UserCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
  NAKLIYE_SERVICE_CATEGORY_ID,
  RECYCLING_SERVICE_CATEGORY_ID,
  STORAGE_SERVICE_GROUP_ID,
} from "../_lib/service-catalog";
import { prefersReducedMotion } from "../_lib/prefers-reduced-motion";
import { useIsSessionLoading, useSession } from "../_lib/use-session";
import { PageContainer } from "./page-container";

/**
 * "Lojistik operasyon hizmetleri" — yatay/açılır kart yeniden tasarımı
 * görevi. Eski tasarım `service-catalog.ts#SERVICE_CATEGORY_GROUPS`i
 * DÜZ gezip 27+ küçük kartı tek tek gösteriyordu (ör. Forklift, Forklift
 * Operatörü, Reach Stacker Operatörü hepsi ayrı kart) — bu dosya bunun
 * yerine, yalnızca ANA SAYFA SUNUMU için kürasyonlanmış, 9 elemanlı sabit
 * bir liste kullanır. Bu KASITLI OLARAK katalogdaki grup sınırlarıyla
 * BİREBİR örtüşmez (Liman Hizmetleri grubunun 2 alt kategorisi VE Diğer
 * Hizmetler grubunun 2 alt kategorisi burada bağımsız kart olarak kalır,
 * İş Makinesi Hizmetleri + Operatör Hizmetleri grupları [8 kategori] TEK
 * kartta birleşir) — görev talimatının kendi açık 9 maddelik listesi. Her
 * kart yine de GERÇEK katalog id'lerine (tek kategori ya da, İş Makineleri/
 * Depolama için, gerçek kategori id'leri kümesi) bağlanır; ikinci/bağımsız
 * bir katalog İCAT EDİLMEZ — yalnızca bu SUNUM için bir kürasyon katmanıdır
 * (Depolama'nın `STORAGE_SERVICE_GROUP_ID`si için zaten var olan AYNI ilke).
 *
 * Kategori kimlikleri ve etiketleri doğrudan `service-catalog.ts`ten
 * (yalnızca birebir eşleşen id'ler için dışa aktarılmış sabitler üzerinden)
 * alınır; kısa/uzun açıklamalar için katalogda hiç `description` alanı
 * YOKTUR (bkz. `ServiceCategory` tipi) — bu metinler bu dosyada, mevcut
 * ürün kararlarından (hizmetin gerçek kapsamı) türetilerek yazılmıştır,
 * yeni bir iş kuralı/garanti/süre/fiyat İDDİA ETMEZ.
 */

// ---------------------------------------------------------------------------
// Rol bazlı yönlendirme
// ---------------------------------------------------------------------------

/**
 * "İlanları gör" hedefi — provider-job-listing.tsx (Hizmet Veren'in
 * `/ilanlar` ekranı) zaten `?kategori=<id>` okuyor (hem tekil kategori
 * id'si hem `STORAGE_SERVICE_GROUP_ID` özel sentinel'i için, bkz. o
 * dosyadaki `isStorageGroupFilterActive`) — bu BAŞKA hiçbir değişiklik
 * gerektirmeden ÇALIŞAN, gerçek bir mekanizma, burada yeniden kullanılır.
 *
 * İş Makineleri kartı 8 gerçek kategoriyi (İş Makinesi Hizmetleri + Operatör
 * Hizmetleri gruplarının TAMAMI) temsil eder — `/ilanlar` sayfası tek bir
 * kategori id'sini (ya da Depolama'nın hazır grup-sentinel'ini) anlıyor,
 * çoklu-kategori filtresi YOK, ve bu görev kapsamı o sayfaya (İlan listeleme
 * sayfası) dokunmayı yasaklıyor — bu yüzden `browseCategoryParam: null`
 * (parametresiz `/ilanlar`) KASITLI bir karardır, tahmin değil (kullanıcıyla
 * netleştirildi): Hizmet Veren kendi yetkili olduğu TÜM ilanları normal
 * şekilde görür, isterse mevcut Hizmet Türü filtresinden istediği makine
 * kategorisini kendisi seçer.
 */
function buildBrowseHref(categoryParam: string | null): string {
  return categoryParam ? `/ilanlar?kategori=${categoryParam}` : "/ilanlar";
}

/**
 * "İlan oluştur" hedefi — `job-request-form.tsx#JobRequestForm` HİÇBİR prop
 * almıyor ve `category` state'i her zaman `""` ile başlıyor (grep ile
 * doğrulandı: ne `useSearchParams`, ne başka bir prefill mekanizması var).
 * Bu görev "İlan oluşturma formları" dosyasına dokunmayı yasaklıyor, bu
 * yüzden gerçek bir ön-seçim BUGÜN mümkün değil — `?kategori=` parametresi
 * yine de eklenir (zararsız/etkisiz, ama formun kendisi ileride bu
 * parametreyi okuyacak şekilde güncellenirse bu buton HİÇBİR değişiklik
 * gerektirmeden otomatik çalışmaya başlar) ve bu boşluk sonuç raporunda
 * açıkça belirtilir — sessizce "bağlam korunuyor" iddia edilmez.
 */
function buildCreateHref(representativeCategoryId: string): string {
  return `/hizmet-talebi-olustur?kategori=${representativeCategoryId}`;
}

function buildLoginRedirectHref(target: string): string {
  return `/giris-yap?redirect=${encodeURIComponent(target)}`;
}

// ---------------------------------------------------------------------------
// Kürasyonlanmış 9 hizmet kartı — her biri gerçek katalog id'sine bağlı
// ---------------------------------------------------------------------------

type SimpleServiceCard = {
  kind: "simple";
  id: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  /** Yalnızca büyük gruplar (Depolama) için — "alt hizmetler" listesi, gerçek katalog etiketleri. */
  subServiceLabels?: string[];
  browseCategoryParam: string;
  createCategoryId: string;
  /** `public/images/services/` altındaki gerçek kapak görseli — bkz. dosya başındaki görsel entegrasyonu notu. */
  imageSrc: string;
  /** CSS `object-position` değeri — her kartın kendi görseline göre elle ayarlanır, tek bir sabit değer TÜM kartlara uygulanmaz. */
  imagePosition?: string;
};

type MachineServiceCard = {
  kind: "machine";
  id: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  imageSrc: string;
  imagePosition?: string;
};

type HomepageServiceCard = SimpleServiceCard | MachineServiceCard;

/** İş Makinesi Hizmetleri (operatörsüz) — service-catalog.ts#RAW_SERVICE_CATEGORY_GROUPS'taki AYNI 4 id/etiket. */
const UNMANNED_MACHINE_OPTIONS: { id: string; label: string }[] = [
  { id: "forklift", label: "Forklift" },
  { id: "reach-stacker", label: "Reach Stacker" },
  { id: "vinc", label: "Vinç" },
  { id: "manlift", label: "Manlift" },
];

/** Operatör Hizmetleri — AYNI 4 makine, operatörlü karşılığı. Index'ler UNMANNED_MACHINE_OPTIONS ile hizalıdır. */
const MANNED_MACHINE_OPTIONS: { id: string; label: string }[] = [
  { id: "forklift-operatoru", label: "Forklift Operatörü" },
  { id: "reach-stacker-operatoru", label: "Reach Stacker Operatörü" },
  { id: "vinc-operatoru", label: "Vinç Operatörü" },
  { id: "manlift-operatoru", label: "Manlift Operatörü" },
];

const HOMEPAGE_SERVICE_CARDS: HomepageServiceCard[] = [
  {
    kind: "simple",
    id: NAKLIYE_SERVICE_CATEGORY_ID,
    title: "Nakliye",
    shortDescription: "Parça ve komple yüklerin karayoluyla taşınmasına yönelik operasyon çözümleri.",
    longDescription:
      "Parça veya komple yüklerin; yükleme ve teslimat noktaları, araç tercihi ve yük bilgileriyle planlandığı karayolu taşımacılığı hizmetidir. Hizmet Alanlar taşıma ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    browseCategoryParam: NAKLIYE_SERVICE_CATEGORY_ID,
    createCategoryId: NAKLIYE_SERVICE_CATEGORY_ID,
    imageSrc: "/images/services/nakliye.webp",
    imagePosition: "62% 55%",
  },
  {
    kind: "simple",
    id: GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
    title: "Gümrük Müşavirliği",
    shortDescription: "İthalat, ihracat ve transit işlemlerine yönelik gümrük müşavirliği hizmetleri.",
    longDescription:
      "İthalat, ihracat ve transit süreçlerinde gerekli gümrük işlemlerinin yetkili uzmanlar tarafından yürütülmesine yönelik hizmettir. Hizmet Alanlar işlem ihtiyaçlarını ilan eder, yetkili gümrük müşavirleri uygun ilanlara teklif sunar.",
    browseCategoryParam: GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
    createCategoryId: GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID,
    imageSrc: "/images/services/gumruk-musavirligi.webp",
    imagePosition: "68% 50%",
  },
  {
    kind: "simple",
    id: "lashing-unlashing",
    title: "Lashing / Unlashing",
    shortDescription: "Yüklerin güvenli biçimde sabitlenmesi ve sabitlemelerin çözülmesine yönelik saha hizmetleri.",
    longDescription:
      "Konteyner, araç veya proje yüklerinin taşıma öncesinde sabitlenmesi ve operasyon sonunda sabitlemelerin güvenli biçimde çözülmesini kapsar. Hizmet Alanlar operasyon detaylarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    browseCategoryParam: "lashing-unlashing",
    createCategoryId: "lashing-unlashing",
    imageSrc: "/images/services/lashing-unlashing.webp",
    imagePosition: "72% 55%",
  },
  {
    kind: "simple",
    id: "gozetim-hizmetleri",
    title: "Gözetim Hizmetleri",
    shortDescription: "Yükleme ve boşaltma operasyonlarının sahada izlenmesi ve raporlanması.",
    longDescription:
      "Yükleme ve boşaltma süreçlerinin sahada izlenmesi, durum kontrollerinin yapılması ve operasyon bilgilerinin kayıt altına alınmasını kapsayan gözetim hizmetidir. Hizmet Alanlar ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    browseCategoryParam: "gozetim-hizmetleri",
    createCategoryId: "gozetim-hizmetleri",
    imageSrc: "/images/services/gozetim-hizmetleri.webp",
    imagePosition: "68% 50%",
  },
  {
    kind: "machine",
    id: "operatorlu-operatorsuz-is-makineleri",
    title: "Operatörlü / Operatörsüz İş Makineleri",
    shortDescription: "Forklift, reach stacker, vinç ve manlift için operatörlü veya operatörsüz çözümler.",
    longDescription:
      "Forklift, reach stacker, vinç ve manlift ihtiyaçlarının operasyonun niteliğine göre operatörlü veya operatörsüz karşılanmasını kapsar. Hizmet Alanlar makine ve operasyon ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    imageSrc: "/images/services/operatorlu-operatorsuz-is-makineleri.webp",
    imagePosition: "62% 60%",
  },
  {
    kind: "simple",
    id: STORAGE_SERVICE_GROUP_ID,
    title: "Depolama Hizmetleri",
    shortDescription: "Yüklerin uygun açık veya kapalı alanlarda belirli sürelerle depolanmasına yönelik hizmetler.",
    longDescription:
      "Yüklerin türü, miktarı, depolama süresi ve saha koşullarına göre uygun alanlarda muhafaza edilmesini kapsayan depolama hizmetidir. Hizmet Alanlar depolama ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    subServiceLabels: [
      "Elleçleme",
      "Genel Depolama",
      "Açık Saha Depolama",
      "Kapalı Depolama",
      "Antrepo (Gümrüklü)",
      "Geçici Depolama",
      "Konteyner Depolama",
      "Dökme Yük Depolama",
      "Proje Yükü Depolama",
      "Soğuk Hava Depolama",
      "Kimyasal Depolama",
      "Tehlikeli Madde Depolama",
    ],
    browseCategoryParam: STORAGE_SERVICE_GROUP_ID,
    createCategoryId: "kapali-depolama",
    imageSrc: "/images/services/depo-hizmetleri.webp",
    imagePosition: "66% 55%",
  },
  {
    kind: "simple",
    id: "personel-temini",
    title: "Personel Temini",
    shortDescription: "Saha ve operasyon ihtiyaçlarına uygun personel temini hizmetleri.",
    longDescription:
      "Lojistik ve saha operasyonlarında görev alacak personelin işin kapsamı, süresi ve çalışma koşullarına göre temin edilmesini kapsar. Hizmet Alanlar personel ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    browseCategoryParam: "personel-temini",
    createCategoryId: "personel-temini",
    imageSrc: "/images/services/personel-temini.webp",
    imagePosition: "70% 48%",
  },
  {
    kind: "simple",
    id: "acil-operasyon-destegi",
    title: "Acil Operasyon Desteği",
    shortDescription: "Plan dışı ve zaman kritik saha ihtiyaçlarına yönelik operasyon desteği.",
    longDescription:
      "Beklenmeyen, zaman kritik veya kısa sürede müdahale gerektiren lojistik saha ihtiyaçları için operasyon desteğini kapsar. Hizmet Alanlar ihtiyaçlarını ilan eder, uygun ve yetkili Hizmet Verenler teklif sunar.",
    browseCategoryParam: "acil-operasyon-destegi",
    createCategoryId: "acil-operasyon-destegi",
    imageSrc: "/images/services/acil-operasyon-destegi.webp",
    imagePosition: "62% 55%",
  },
  {
    kind: "simple",
    id: RECYCLING_SERVICE_CATEGORY_ID,
    title: "Geri Dönüşüm & Atık Tahliye",
    shortDescription: "Endüstriyel atıkların tahliyesi ve geri dönüşüm süreçlerine yönelik hizmetler.",
    longDescription:
      "Endüstriyel atıkların türüne ve operasyon koşullarına göre sahadan tahliye edilmesi ve uygun geri dönüşüm sürecine yönlendirilmesini kapsar. Hizmet Alanlar ihtiyaçlarını ilan eder, yetkili Hizmet Verenler uygun ilanlara teklif sunar.",
    browseCategoryParam: RECYCLING_SERVICE_CATEGORY_ID,
    createCategoryId: RECYCLING_SERVICE_CATEGORY_ID,
    imageSrc: "/images/services/geri-donusum-atik-tahliye.webp",
    imagePosition: "68% 48%",
  },
];

// ---------------------------------------------------------------------------
// Rol bazlı çağrı butonları — yalnızca açılan kart içeriğinde gösterilir
// ---------------------------------------------------------------------------

const CTA_BASE_CLASSNAME =
  "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";
const CTA_PRIMARY_CLASSNAME = `${CTA_BASE_CLASSNAME} bg-primary text-primary-foreground hover:bg-primary-hover`;
const CTA_SECONDARY_CLASSNAME = `${CTA_BASE_CLASSNAME} border border-border bg-surface text-foreground hover:border-primary/40`;

/**
 * Üç oturum durumuna göre tam olarak görev talimatının kurallarını uygular:
 * Hizmet Alan → tek "ilan oluştur" butonu; Hizmet Veren → tek "ilanları gör"
 * butonu; ziyaretçi → İKİ ayrı buton (tek, slash'lı bir metin DEĞİL). `role`
 * `undefined` iken (oturum henüz çözülmedi) HİÇBİR buton göstermez — yanlış
 * CTA'nın kısa süreli görünmesini engelleyen tek yer burasıdır (bkz.
 * `ServicesSection`'daki `resolvedRole` notu).
 */
function ServiceCardCtaRow({
  role,
  createHref,
  browseHref,
}: {
  role: "hizmet-alan" | "hizmet-veren" | "guest" | undefined;
  createHref: string;
  browseHref: string;
}) {
  if (role === undefined) {
    return <div className="mt-6 h-[46px]" aria-hidden="true" />;
  }

  if (role === "hizmet-alan") {
    return (
      <div className="mt-6 flex justify-center">
        <Link href={createHref} className={CTA_PRIMARY_CLASSNAME}>
          Bu hizmet için ilan oluştur
        </Link>
      </div>
    );
  }

  if (role === "hizmet-veren") {
    return (
      <div className="mt-6 flex justify-center">
        <Link href={browseHref} className={CTA_PRIMARY_CLASSNAME}>
          Bu hizmet için ilanları gör
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <Link href={buildLoginRedirectHref(createHref)} className={CTA_PRIMARY_CLASSNAME}>
        Bu hizmet için ilan oluştur
      </Link>
      <Link href={buildLoginRedirectHref(browseHref)} className={CTA_SECONDARY_CLASSNAME}>
        Bu hizmet için ilanları gör
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// İş Makineleri kartının özel içeriği — operatörlü/operatörsüz + makine seçimi
// ---------------------------------------------------------------------------

const MODE_BOX_CLASSNAME =
  "flex flex-1 items-start gap-3 rounded-md border p-4 text-left transition-colors";

function MachineCardContent({
  role,
  browseHref,
}: {
  role: "hizmet-alan" | "hizmet-veren" | "guest" | undefined;
  browseHref: string;
}) {
  const [manned, setManned] = useState(false);
  const [machineIndex, setMachineIndex] = useState(0);
  const options = manned ? MANNED_MACHINE_OPTIONS : UNMANNED_MACHINE_OPTIONS;
  const selectedCategoryId = options[machineIndex].id;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setManned(false)}
          aria-pressed={!manned}
          className={`${MODE_BOX_CLASSNAME} ${!manned ? "border-primary bg-accent-soft/40" : "border-border bg-surface hover:border-primary/40"}`}
        >
          <Forklift className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="block text-sm font-bold text-foreground">Operatörsüz</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              İş makinesini kendi operatörünüzle kullanmanız için kiralama.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setManned(true)}
          aria-pressed={manned}
          className={`${MODE_BOX_CLASSNAME} ${manned ? "border-primary bg-accent-soft/40" : "border-border bg-surface hover:border-primary/40"}`}
        >
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="block text-sm font-bold text-foreground">Operatörlü</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Deneyimli operatörlerimizle güvenli ve verimli operasyon desteği.
            </span>
          </span>
        </button>
      </div>

      <p className="mt-5 text-sm font-medium text-foreground">Uygun iş makinesini seçin</p>
      {/* Çip etiketleri KASITLI OLARAK her zaman temel makine adını gösterir
          (operatörlü modda bile "Forklift Operatörü" değil "Forklift") —
          operatörlü/operatörsüz ayrımı zaten yukarıdaki iki kutuda seçiliyor,
          burada tekrarı önler. Seçilen index + mod, aşağıdaki `options`
          (aktif mod dizisi) üzerinden gerçek kategori id'sine çözülür. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMachineIndex(index)}
            aria-pressed={machineIndex === index}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              machineIndex === index
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground hover:border-primary/40"
            }`}
          >
            {UNMANNED_MACHINE_OPTIONS[index].label}
          </button>
        ))}
      </div>

      <ServiceCardCtaRow role={role} createHref={buildCreateHref(selectedCategoryId)} browseHref={browseHref} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Kapak görseli — 9 gerçek hizmet fotoğrafı entegrasyonu görevi. Önceki saf
// CSS-gradyan yer tutucusunun (diagonal `from-primary via-primary-hover
// to-accent` katmanı) yerini gerçek bir `next/image` aldı; SOLDAN SAĞA
// okunabilirlik overlay'i (`from-primary ... to-transparent`) AYNEN
// korunmuştur — sol metin bölgesi koyu, sağdaki görsel görünür kalır.
// ---------------------------------------------------------------------------

/**
 * `object-position` her kartta AYRI ayarlanır (bkz. HOMEPAGE_SERVICE_CARDS):
 * kaynak görseller ~2.5:1–2.8:1 oranındayken kart kapsayıcısı mobilde daha
 * DAR (yatay kırpma baskın), masaüstünde ÇOK DAHA GENİŞ (dikey kırpma
 * baskın) — tek bir sabit % değeri ikisini de makul dengeler, ekran
 * görüntüleriyle görsel olarak doğrulanmıştır.
 */
function ServiceCardCoverImage({
  src,
  objectPosition,
  preload,
}: {
  src: string;
  objectPosition: string;
  preload: boolean;
}) {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Image
        src={src}
        alt=""
        fill
        preload={preload}
        loading={preload ? "eager" : "lazy"}
        sizes="(max-width: 1023px) 100vw, (max-width: 1279px) 1136px, (max-width: 1535px) 1296px, 1472px"
        className="object-cover"
        style={{ objectPosition }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/70 to-primary/10 sm:to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tek kart — kapalı (yatay şerit) + açılır (beyaz panel) durumları
// ---------------------------------------------------------------------------

/**
 * Panelin `maxHeight` geçişini `use-dismiss-animation.ts`teki AYNI "gerçek
 * pikseli ölç, ardından hedefe geçiş yap" tekniğiyle yönetir — CSS `auto`
 * değerine animasyonlanamadığı için. Kart açıkken pencere yeniden
 * boyutlandırılırsa (ör. mobil ekran döndürme) içerik yeniden akar ve
 * yüksekliği değişebilir — bu yüzden yalnızca `isOpen` geçişinde değil,
 * açık kaldığı sürece `resize` olayında da yeniden ölçülür.
 */
function useAccordionPanelHeight(isOpen: boolean) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [heightPx, setHeightPx] = useState(0);

  useLayoutEffect(() => {
    if (!isOpen || !contentRef.current) return;
    const remeasure = () => {
      if (contentRef.current) setHeightPx(contentRef.current.scrollHeight);
    };
    remeasure();
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [isOpen]);

  return { contentRef, maxHeight: isOpen ? heightPx : 0 };
}

function ServiceAccordionCard({
  card,
  isOpen,
  onToggle,
  role,
  headingId,
  preloadImage,
}: {
  card: HomepageServiceCard;
  isOpen: boolean;
  onToggle: () => void;
  role: "hizmet-alan" | "hizmet-veren" | "guest" | undefined;
  headingId: string;
  /** Yalnızca ilk (ilk ekranda görülen) kart için `true` — bkz. `ServicesSection`teki `.map` çağrısı. */
  preloadImage: boolean;
}) {
  const { contentRef, maxHeight } = useAccordionPanelHeight(isOpen);
  const panelId = `${headingId}-panel`;
  const reducedMotion = prefersReducedMotion();

  const browseHref = card.kind === "simple" ? buildBrowseHref(card.browseCategoryParam) : buildBrowseHref(null);
  const createHref = card.kind === "simple" ? buildCreateHref(card.createCategoryId) : "";

  let expandedBody: ReactNode;
  if (card.kind === "machine") {
    expandedBody = (
      <>
        <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">{card.longDescription}</p>
        <MachineCardContent role={role} browseHref={browseHref} />
      </>
    );
  } else {
    expandedBody = (
      <>
        <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">{card.longDescription}</p>
        {card.subServiceLabels && (
          <>
            <p className="mt-5 text-sm font-medium text-foreground">Kapsamındaki hizmetler</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.subServiceLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
        <ServiceCardCtaRow role={role} createHref={createHref} browseHref={browseHref} />
      </>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border shadow-sm">
      {/*
       * "Hover ile açılma geçersiz" düzeltme görevi — kart artık YALNIZCA
       * gerçek bir tıklama/dokunma/Enter/Space ile açılır/kapanır; hover
       * hiçbir state DEĞİŞTİRMEZ, yalnızca aşağıdaki `hover:` CSS
       * sınıflarıyla sade bir görsel vurgu (gölge/kenarlık) verir. Önceki
       * hover-önizleme + `event.detail` tabanlı fare/klavye ayrımı BİLEREK
       * kaldırıldı — artık `onToggle` tek, basit bir aç/kapa anahtarı.
       */}
      <button
        type="button"
        id={headingId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className="relative block h-40 w-full text-left transition-shadow duration-200 hover:shadow-md sm:h-44 lg:h-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <ServiceCardCoverImage src={card.imageSrc} objectPosition={card.imagePosition ?? "50% 50%"} preload={preloadImage} />
        <span className="relative z-10 flex h-full items-center justify-between gap-3 px-5 sm:px-8">
          <span className="max-w-[75%] sm:max-w-[60%]">
            <span className="block text-lg font-bold tracking-heading leading-snug text-white sm:text-xl">
              {card.title}
            </span>
            <span className="mt-1.5 block text-sm leading-relaxed text-white/85">{card.shortDescription}</span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-white transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        style={{
          maxHeight: reducedMotion ? undefined : maxHeight,
          display: reducedMotion ? (isOpen ? "block" : "none") : undefined,
          transition: reducedMotion ? undefined : "max-height 300ms ease-out",
        }}
        className="overflow-hidden bg-surface"
      >
        <div ref={contentRef} className="p-5 sm:p-8">
          {expandedBody}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bölüm — akordeon durumu (aynı anda tek kart açık) + rol çözümü
// ---------------------------------------------------------------------------

export function ServicesSection() {
  const session = useSession();
  // "Yavaş Ağda Yanlış CTA" düzeltme görevi — `session.ts#useIsSessionLoading()`
  // (yeni, tamamen ayrı bir kanal — `Session`/`useSession()` sözleşmesi
  // DEĞİŞMEDİ) sayfa yüklemesindeki İLK gerçek Supabase kontrolü tamamlanana
  // kadar `true` kalır; bu, hem SSR/hidrasyon anındaki flaşı HEM yavaş ağdaki
  // asenkron çözülme penceresini kapsar (gerçek CDP ağ kısıtlamasıyla
  // doğrulandı — bkz. görev raporu).
  const isSessionLoading = useIsSessionLoading();

  // "Hover İle Açılma Geçersiz" düzeltme görevi — kartlar ARTIK yalnızca
  // gerçek bir tıklama/dokunma/Enter/Space ile açılır/kapanır (native bir
  // <button>'ın onClick'i klavye etkinleştirmesini zaten kapsar, ayrıca bir
  // olay ayrımı gerekmez). Önceki hover-önizleme + kilit mantığı ve onunla
  // birlikte gelen `event.detail`/`hoverEnabled` karmaşıklığı TAMAMEN
  // kaldırıldı — tek durum, basit bir aç/kapa anahtarı yeterlidir.
  const [openId, setOpenId] = useState<string | null>(null);

  function handleToggle(cardId: string) {
    setOpenId((current) => (current === cardId ? null : cardId));
  }

  const resolvedRole: "hizmet-alan" | "hizmet-veren" | "guest" | undefined = isSessionLoading
    ? undefined
    : session === null
      ? "guest"
      : session.role === "hizmet-alan" || session.role === "hizmet-veren"
        ? session.role
        : // admin: bu bölümün hedef kitlesi değil (bkz. hero-section.tsx'teki
          // AYNI ilke) — CTA'sız, salt bilgilendirici "ziyaretçi" görünümüyle
          // aynı şekilde render edilir, ama admin'in KENDİ davranışı
          // (yetkileri/yönlendirmeleri) hiçbir şekilde değişmez.
          "guest";

  const isProvider = resolvedRole === "hizmet-veren";

  return (
    <section id="hizmetler" aria-labelledby="hizmetler-baslik" className="scroll-mt-20 bg-background">
      <PageContainer className="py-16">
        <div className="max-w-2xl">
          <h2
            id="hizmetler-baslik"
            className="text-2xl font-bold tracking-heading leading-tight text-foreground sm:text-3xl"
          >
            Lojistik operasyon hizmetleri
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {isProvider
              ? "Uzmanlığınıza uygun hizmet kategorisini seçin, doğrudan ilgili iş ilanlarına ulaşın."
              : "İhtiyacınıza uygun hizmet kategorisini inceleyin ve uzman hizmet verenlerden teklif alın."}
          </p>
        </div>
        <div className="mt-10 flex flex-col gap-4">
          {HOMEPAGE_SERVICE_CARDS.map((card, index) => (
            <ServiceAccordionCard
              key={card.id}
              card={card}
              isOpen={openId === card.id}
              onToggle={() => handleToggle(card.id)}
              role={resolvedRole}
              headingId={`hizmet-kart-${card.id}`}
              preloadImage={index === 0}
            />
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
