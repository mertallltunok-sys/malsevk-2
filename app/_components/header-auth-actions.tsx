"use client";

import { useSession } from "../_lib/use-session";
import { ButtonLink } from "./button-link";
import { NotificationBell } from "./notification-bell";
import { ProfileMenu } from "./profile-menu";

export function HeaderAuthActions({ layout }: { layout: "desktop" | "mobile" }) {
  const session = useSession();

  if (!session) {
    return (
      <div
        className={
          layout === "desktop"
            ? "hidden items-center gap-3 md:flex"
            : "mt-2 flex flex-col gap-2"
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
