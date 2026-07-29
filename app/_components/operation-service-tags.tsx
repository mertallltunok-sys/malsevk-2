import type { OperationServiceSummary } from "../_lib/job-listing-row";

/**
 * "Aktif İlanlar" listesindeki bir operasyon satırının/kartının "Operasyon ·
 * N Hizmet" rozetinin HEMEN ALTINDA gösterilen, operasyondaki TÜM hizmetlerin
 * (job-listing-row.ts#OperationListingItem.services — zaten service-catalog.ts
 * sırasına göre sıralı, tekilleştirilmiş) eksiksiz özeti. job-listing-table.tsx
 * (masaüstü) ve job-listing-cards.tsx (mobil) TARAFINDAN PAYLAŞILAN TEK
 * bileşen, aynı markup iki yerde ayrı ayrı yazılmaz.
 *
 * HİÇBİR HİZMET GİZLENMEZ / METİN HİÇBİR ZAMAN KESİLMEZ ("…" YOK): "+N" özet
 * etiketi yoktur, `truncate` yoktur — operasyondaki HER hizmet aynı anda,
 * eksiksiz görünür.
 *
 * DÜZEN: sabit sütunlu bir CSS grid ("Operasyon · N Hizmet" özelliğinin ÖNCEKİ
 * sürümü) BİLEREK TERK EDİLDİ — gerçek kullanıcı geri bildirimiyle tespit
 * edildi: sütun genişliği en uzun hizmet adına (ör. "Konteyner Boşaltım")
 * göre sabitlendiğinde, kısa adlar (ör. "Lashing") ile aynı satırdaki komşu
 * hizmet arasında satırdan satıra TUTARSIZ görünen boşluklar oluşuyordu — her
 * satır teknik olarak hizalı olsa da GÖRSEL OLARAK dağınık/düzensiz
 * hissettiriyordu. Bunun yerine hizmet adları `flex flex-wrap` bir kapsayıcı
 * içinde, aralarında "·" ayracıyla (bu ekranın kendi "Operasyon · N Hizmet"
 * rozetiyle AYNI ayraç karakteri — yeni bir tasarım öğesi İCAT EDİLMEZ)
 * dizilir; her hizmet kendi `whitespace-nowrap` öğesidir (bir hizmet adının,
 * ör. "Konteyner Boşaltım", kelimeleri arasında bölünüp iki satıra düşmesini
 * engellemek için), ama kapsayıcının kendi `gap`i sayesinde satırlar arası
 * boşluk her zaman EŞİT kalır — sabit sütun genişliğinin yol açtığı
 * eşitsiz boşluk sorunu yapısal olarak ORTADAN KALKAR, çünkü artık "sütun"
 * kavramı yoktur, yalnızca tek tip bir `gap` vardır. Satır sonu her zaman iki
 * hizmet arasındaki boşlukta gerçekleşir, asla bir hizmet adının ORTASINDA
 * değil.
 *
 * Hizmet sayısı arttıkça yazı boyutu `getServiceTagFontSizeClass` ile
 * kademeli küçülür (12px -> 11px -> 10px -> 9px), 9px'te SABİT kalır
 * ("belirli bir fontla sabit kalsın" gereksinimi — sonsuza dek küçülmez).
 * Yalnızca `services.length`e bakan saf/deterministik bir eşik tablosudur,
 * DOM ölçümü/ResizeObserver YOK.
 *
 * TASARIM: arka plansız, düz metin — hap/rozet şekli (`bg-accent-soft` +
 * `rounded-full` dolgusu) BİLEREK KULLANILMAZ (gerçek kullanıcı geri
 * bildirimiyle: soluk mavi arka plan alanları görsel olarak ağır duruyordu).
 * Aktif/teklif bekleyen/devam eden hizmet adları mevcut vurgu rengiyle
 * (`text-accent` — "Operasyon · N Hizmet" rozetiyle AYNI ton), NORMAL yazıyla
 * gösterilir. Tamamlanmış bir hizmet (`service.isCompleted`, job-listing-row.ts#
 * OperationServiceSummary'nin TEK doğruluk kaynağından — ilerleme yüzdesi/
 * ilan başlığı/operationId'den ASLA tahmin edilmez) YALNIZCA daha soluk bir
 * tonda (`text-muted-foreground` — sitenin genelinde ikincil metinler için
 * zaten kullanılan, okunabilirliği koruyan aynı yumuşak gri ton, tamamen
 * silik bir renk İCAT EDİLMEZ) ve ince bir `line-through`la (`decoration-1`
 * — kalın/dikkat dağıtıcı olmasın diye, çizgi rengi `currentColor` ile AYNI
 * yumuşak griyi takip eder) gösterilir. BİLEREK BUNUN DIŞINDA HİÇBİR ŞEY
 * YOK: rozet, ikon, "Tamamlandı" yazısı EKLENMEZ — tek görsel gösterge
 * üstü çizili görünümün kendisidir (gerçek kullanıcı geri bildirimiyle: ikon+
 * kelime eklemek bu özet listeyi gereksiz yere kalabalıklaştırıyordu).
 * Ayraçlar ("·") ayrıca daha soluk (`text-muted-foreground/70`) boyanır —
 * dikkat hizmet adlarında kalsın diye. Yeni bir renk/tasarım dili İCAT
 * EDİLMEZ. Ayrıntılı durum (Teklife Açık/İşe Başlandı/İtiraz Sürecinde vb.)
 * BİLEREK gösterilmez — bu ekran yalnızca özet bilgi verir, detaylar ilan
 * detay sayfasındadır (bkz. OperationServiceSummary'nin kendi
 * dokümantasyonu). Hiçbir hizmet adı Link/button DEĞİLDİR — salt bilgi
 * amaçlı, tıklanamaz; tamamlanma durumu SADECE görsel bir gösterge olduğu
 * için hover/tıklama davranışında da hiçbir fark yaratmaz (zaten hiçbiri
 * etkileşimli değil).
 *
 * SIRALAMA: hizmetler `service-catalog.ts#getServiceCategoryOrderIndex`e göre
 * sabit sırayla gösterilir (job-listing-row.ts#buildOperationListingItem,
 * DEĞİŞTİRİLMEDİ) — tamamlanma durumu bu sırayı HİÇ ETKİLEMEZ, tamamlanan bir
 * hizmet listenin sonuna taşınmaz, olduğu konumda kalır (yalnızca rengi/çizgisi
 * değişir) — kullanıcı operasyonun akışını hep aynı sırada takip edebilsin diye.
 *
 * PERFORMANS: gerçek zamanlı DOM ölçümü/ResizeObserver KULLANILMAZ — satır
 * kırma tamamen `flex-wrap`in kendi düzenlemesiyle, ekstra bir render/efekt
 * olmadan gerçekleşir.
 */
function getServiceTagFontSizeClass(count: number): string {
  if (count <= 3) return "text-xs"; // ~12px
  if (count <= 5) return "text-[11px]";
  if (count <= 7) return "text-[10px]";
  return "text-[9px]"; // taban — bundan sonra küçülmeye devam etmez
}

export function OperationServiceTags({ services }: { services: OperationServiceSummary[] }) {
  if (services.length === 0) return null;
  const fontSizeClass = getServiceTagFontSizeClass(services.length);

  return (
    <p
      className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium leading-relaxed ${fontSizeClass}`}
    >
      {services.map((service, index) => (
        <span key={service.jobId} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span
            className={`whitespace-nowrap ${
              service.isCompleted ? "text-muted-foreground line-through decoration-1" : "text-accent"
            }`}
          >
            {service.categoryLabel}
          </span>
          {index < services.length - 1 && (
            <span aria-hidden="true" className="text-muted-foreground/70">
              ·
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
