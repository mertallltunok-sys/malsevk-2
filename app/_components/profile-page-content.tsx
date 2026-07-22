"use client";

import { getProfileInfo } from "../_lib/profile";
import { getProviderRatingSummary } from "../_lib/ratings";
import { useAllOffers } from "../_lib/use-offers";
import { useAllRatings } from "../_lib/use-ratings";
import { useSession } from "../_lib/use-session";
import { findUserById } from "../_lib/users";
import { AuthGateNotice } from "./auth-gate-notice";
import { ProfileInfoCard } from "./profile-info-card";
import { ProviderRatingSummaryCard } from "./provider-rating-summary-card";

/**
 * Veriler yalnızca oturumdaki kullanıcının kendi id'sinden (`session.id`)
 * okunur — başka bir kullanıcı id'si asla kabul edilmez, bu yüzden başka
 * bir kullanıcının verisi burada gösterilemez.
 */
export function ProfilePageContent() {
  const session = useSession();
  const offers = useAllOffers();
  const ratings = useAllRatings();

  if (!session) {
    return (
      <AuthGateNotice
        message="Profilinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/profil"
      />
    );
  }

  const user = findUserById(session.id);
  if (!user) {
    return (
      <p className="rounded-card border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        Kullanıcı bilgileri bulunamadı.
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Profilim</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Hesabınıza ait temel bilgileri görüntüleyin.
      </p>
      <div className="mt-8">
        <ProfileInfoCard profile={getProfileInfo(user)} />
      </div>
      {user.role === "hizmet-veren" && (
        <ProviderRatingSummaryCard summary={getProviderRatingSummary(user.id, offers, ratings)} />
      )}
    </div>
  );
}
