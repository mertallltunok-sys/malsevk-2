"use client";

import { LogOut } from "lucide-react";
import { getProfileInfo } from "../_lib/profile";
import { useSession } from "../_lib/use-session";
import { findUserById } from "../_lib/users";
import { AuthGateNotice } from "./auth-gate-notice";
import { handleLogout } from "./profile-menu";
import { ProfileInfoCard } from "./profile-info-card";

function ComingSoonAction({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Yakında
        </span>
        {/* Gerçek bir işlem yapılmıyor: buton disabled, onClick bağlanmadı. */}
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-muted-foreground opacity-60"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Veriler yalnızca oturumdaki kullanıcının kendi id'sinden okunur. Çıkış
 * işlemi profile-menu.tsx'teki mevcut `handleLogout` fonksiyonu tekrar
 * kullanılarak yapılır — yeni bir çıkış mantığı yazılmadı.
 */
export function AccountSettingsContent() {
  const session = useSession();

  if (!session) {
    return (
      <AuthGateNotice
        message="Hesap ayarlarınızı görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/hesap-ayarlari"
      />
    );
  }

  const user = findUserById(session.id);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Hesap Ayarları
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Hesabınız ve oturumunuzla ilgili ayarları yönetin.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {user ? (
          <ProfileInfoCard profile={getProfileInfo(user)} />
        ) : (
          <p className="rounded-card border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
            Kullanıcı bilgileri bulunamadı.
          </p>
        )}

        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold text-foreground">Güvenlik</h2>
          <ComingSoonAction
            title="Şifre Değiştir"
            description="Hesap şifrenizi güncelleyin."
            actionLabel="Şifre Değiştir"
          />
        </div>

        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold text-foreground">Oturum</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Hesabınızdan güvenli şekilde çıkış yapabilirsiniz.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Çıkış Yap
          </button>
        </div>

        <div className="rounded-card border border-danger/30 bg-surface p-6">
          <h2 className="text-lg font-semibold text-foreground">Hesabı Sil</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Hesabınızı ve verilerinizi kalıcı olarak silin. Bu işlem geri alınamaz.
          </p>
          <ComingSoonAction
            title="Hesabı Sil"
            description="Hesap silme özelliği yakında kullanıma açılacaktır."
            actionLabel="Hesabı Sil"
          />
        </div>
      </div>
    </div>
  );
}
