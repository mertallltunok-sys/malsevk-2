"use client";

/**
 * Nakliye Yeniden Tasarımı görevi (görsel düzeltme turu) — referans
 * görseldeki gibi Nakliye kartının her bölümü kendi FİZİKSEL OLARAK AYRI
 * beyaz kartı (ince sınır, hafif köşe yuvarlatma, numaralı daire + başlık)
 * içinde durur; tek bir dev kart içindeki "kesikli çizgi ile ayrılmış
 * bölüm" görünümü YERİNE geçer. Yalnızca Nakliye kartları için kullanılır
 * (job-request-form.tsx VE job-edit-form.tsx paylaşır) — diğer
 * kategorilerin tek-kart görünümü hiç değiştirilmedi.
 *
 * "Yük Bilgileri ve Konteyner Taşıması Birleştirmesi" görevi — isteğe bağlı
 * `headerRight`, başlık satırının SAĞINDA (numara+başlığın karşısında)
 * ekstra bir kontrol göstermek için eklendi ("2 — Yük Bilgileri" kartının
 * "Yük konteyner olarak mı taşınacak?" sorusu için). Yalnızca bunu geçen
 * çağıran etkilenir — diğer TÜM kartlar (prop hiç verilmez) eskisiyle
 * BİREBİR aynı render edilir.
 */
export function NakliyeSectionCard({
  number,
  title,
  headerRight,
  children,
}: {
  number: number;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {number}
          </span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        {headerRight}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
