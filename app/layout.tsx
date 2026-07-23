import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "./_components/site-footer";
import { SiteHeader } from "./_components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MALSEVK.COM | Lojistik Hizmet Platformu",
  description:
    "MALSEVK, hizmet alan firmalar ile uzman lojistik hizmet verenlerini güvenli, hızlı ve profesyonel şekilde buluşturan Türkiye'nin lojistik hizmet platformudur.",
};

// Bilinçli ürün kararı: mobilde pinch/double-tap zoom tamamen kapalı
// (dokunma sırasında istemsiz ölçekleme yaşanmasın diye). Next.js App
// Router'da viewport meta'sının TEK kaynağı burasıdır — başka hiçbir
// dosyada <meta name="viewport"> veya metadata.viewport yok.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
