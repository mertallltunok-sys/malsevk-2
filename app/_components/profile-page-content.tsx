"use client";

import { getProviderRatingSummary } from "../_lib/ratings";
import { useSessionProfileDetails } from "../_lib/use-session-profile";
import { useAllOffers } from "../_lib/use-offers";
import { useAllRatings } from "../_lib/use-ratings";
import { useSession } from "../_lib/use-session";
import { findUserById } from "../_lib/users";
import { AuthGateNotice } from "./auth-gate-notice";
import { ProfileInfoCard } from "./profile-info-card";
import { ProviderRatingSummaryCard } from "./provider-rating-summary-card";
import { ProviderServiceStatusCard } from "./provider-service-status-card";
import { ServiceInfoEditor } from "./service-info-editor";

/**
 * Veriler yalnızca oturumdaki kullanıcının kendi id'sinden (`session.id`)
 * okunur — başka bir kullanıcı id'si asla kabul edilmez, bu yüzden başka
 * bir kullanıcının verisi burada gösterilemez.
 *
 * PROFİL/PROVIDER GEÇİŞİ: `ProfileInfoCard` artık GERÇEK Supabase `profiles`
 * satırından (`useSessionProfileDetails()`, bkz. session.ts) beslenir —
 * localStorage'daki `StoredUser`'dan DEĞİL. `findUserById` yine de
 * korunur: `ServiceInfoEditor`/`ProviderRatingSummaryCard` hâlâ
 * `providerProfile` gibi yalnızca localStorage'da var olan alanlara ihtiyaç
 * duyuyor (bkz. son rapor'un "3 bloke alan" notu — `provider_profiles`e
 * henüz yazılamıyor).
 */
export function ProfilePageContent() {
  const session = useSession();
  const profileDetails = useSessionProfileDetails();
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
  if (!user || !profileDetails) {
    return (
      <p className="rounded-card border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        {profileDetails === null && session
          ? "Profil bilgileri yükleniyor..."
          : "Kullanıcı bilgileri bulunamadı."}
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground sm:text-4xl">Profilim</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Hesabınıza ait temel bilgileri görüntüleyin.
      </p>
      <div className="mt-8 flex flex-col gap-6">
        <ProfileInfoCard
          profile={{
            name: profileDetails.fullName,
            email: profileDetails.email,
            phone: profileDetails.phone ?? "",
            role: session.role,
          }}
        />
        {user.role === "hizmet-veren" && (
          <>
            <ProviderRatingSummaryCard summary={getProviderRatingSummary(user.id, offers, ratings)} />
            <ProviderServiceStatusCard providerId={session.id} />
            <ServiceInfoEditor session={session} user={user} />
          </>
        )}
      </div>
    </div>
  );
}
