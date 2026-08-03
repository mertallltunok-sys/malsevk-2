import { MessageCircle } from "lucide-react";

const WHATSAPP_PHONE_NUMBER = "905524316372";
const WHATSAPP_MESSAGE = "Merhaba, MALSEVK hakkında destek almak istiyorum.";

/**
 * Sabit, sağ-alt köşede duran "7/24 Canlı Destek" WhatsApp butonu —
 * app/layout.tsx içine TEK sefer, kök seviyede eklenir (bkz. o dosya) ki her
 * route (giriş yapılmış/yapılmamış, /admin dahil) aynı bileşeni paylaşsın —
 * hiçbir sayfa kendi kopyasını oluşturmaz. `wa.me` bağlantısı mobilde
 * WhatsApp uygulamasını, masaüstünde WhatsApp Web'i açar (platforma özel bir
 * dallanma gerekmez). `z-30`, mobile-menu.tsx'in açık menü perdesinden
 * (z-40/z-50) BİLEREK düşük tutulur — menü açıkken bu buton perdenin altında
 * kalır, hiçbir tıklamayı/görünürlüğü çakıştırmaz.
 */
export function WhatsappSupportButton() {
  const href = `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="7/24 Canlı Destek — WhatsApp üzerinden bize ulaşın"
      className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:px-5"
    >
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>7/24 Canlı Destek</span>
    </a>
  );
}
