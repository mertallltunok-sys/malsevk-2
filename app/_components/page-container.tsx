import type { ElementType, ReactNode } from "react";

/**
 * Sayfa/bölüm genişliğinin TEK ortak kaynağı — masaüstü genişlik/yoğunluk
 * düzeltmesi kapsamında eklendi. Öncesinde her sayfa kendi
 * `mx-auto max-w-X px-4 py-16 ...` div'ini elle yazıyordu (45 dosyada 68
 * farklı `max-w-` kullanımı, en genişi her yerde sabit `max-w-7xl`/1280px);
 * bu bileşen o tekrarın yerine geçer — `guest-access-card.tsx#PageCardShell`
 * (form kartları için zaten var olan aynı desen) ile aynı ruhta, onun
 * genelleştirilmiş hali, PARALEL bir ikinci sistem değil.
 *
 * `size="default"`: `lg` (1024px) altında HİÇBİR max-width eklemez (yalnızca
 * `w-full` + padding) — tablet/mobilde önceki `max-w-7xl` zaten hiç devreye
 * girmiyordu, o yüzden bu davranış değişikliği görsel fark yaratmaz. `lg`de
 * `max-w-page-sm` (1200px), `xl`de `max-w-page-md` (1360px), `2xl`de
 * `max-w-page-lg` (1536px) — üç kademeli, kullanıcı isteğiyle birebir örtüşen
 * masaüstü genişlemesi (globals.css'teki `--container-page-*` token'ları).
 *
 * `size="form"`: formlar/profil gibi okuma genişliği gerektiren içerikler
 * için — `max-w-3xl` (768px) tabanını korur, yalnızca `lg`de `max-w-page-sm`e
 * (1200px) çıkar, daha ileri genişlemez (aşırı geniş form satırları
 * okunabilirliği bozar, bkz. görev tanımı).
 *
 * `py-*`/`pt-*`/`pb-*` BİLEREK bu bileşenin dışında bırakıldı — sayfalar
 * arasında zaten farklı dikey ritimler var (`py-16` vs `sm:py-20` vs
 * `pt-4 pb-16`), bunu tek bir sabite zorlamak kapsam dışı bir refactor
 * olurdu; çağıran taraf `className` ile kendi dikey boşluğunu ekler.
 */
export function PageContainer({
  size = "default",
  as,
  className = "",
  children,
}: {
  size?: "default" | "form";
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const Tag = as ?? "div";
  const widthClassName =
    size === "form" ? "max-w-3xl lg:max-w-page-sm" : "lg:max-w-page-sm xl:max-w-page-md 2xl:max-w-page-lg";

  return (
    <Tag className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${widthClassName}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}
