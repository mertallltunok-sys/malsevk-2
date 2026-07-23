"use client";

import { useEffect } from "react";
import { runDemoDataResetMigrationIfNeeded } from "../_lib/reset-demo-data";
import { useSession } from "../_lib/use-session";
import { ButtonLink } from "./button-link";
import { NotificationBell } from "./notification-bell";
import { ProfileMenu } from "./profile-menu";

export function HeaderAuthActions({ layout }: { layout: "desktop" | "mobile" }) {
  const session = useSession();

  // Her sayfada mutlaka mount edilen bileşen olduğu için buraya bağlandı —
  // demo hesaplara ait eski test verilerini bir kerelik, otomatik olarak
  // temizler (bkz. reset-demo-data.ts). Yalnızca NODE_ENV==="development"
  // iken ve tarayıcı başına yalnızca bir kez çalışır (versiyon bayrağıyla
  // korunur); herhangi bir React state güncellemesi yapmaz, yalnızca
  // localStorage/IndexedDB üzerinde yan etkili bir temizlik yapar.
  useEffect(() => {
    void runDemoDataResetMigrationIfNeeded();
  }, []);

  if (!session) {
    return (
      <div
        className={
          layout === "desktop"
            ? "hidden items-center gap-3 md:flex"
            : "flex flex-col gap-2"
        }
      >
        <ButtonLink href="/giris-yap" variant="secondary">
          Giriş Yap
        </ButtonLink>
        <ButtonLink href="/giris-yap?mode=kayit" variant="primary">
          Kayıt Ol
        </ButtonLink>
      </div>
    );
  }

  if (layout === "mobile") {
    return <ProfileMenu session={session} layout="mobile" />;
  }

  return (
    <div className="hidden items-center gap-2 md:flex">
      <NotificationBell session={session} />
      <ProfileMenu session={session} layout="desktop" />
    </div>
  );
}
