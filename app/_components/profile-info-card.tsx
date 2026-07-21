import { formatProfileField, getInitials, getUserRoleLabel, type ProfileInfo } from "../_lib/profile";

export function ProfileInfoCard({ profile }: { profile: ProfileInfo }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {getInitials(profile.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-foreground">{profile.name}</p>
          <p className="text-sm text-muted-foreground">{getUserRoleLabel(profile.role)}</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ad Soyad</dt>
          <dd className="mt-1 truncate text-sm text-foreground">{formatProfileField(profile.name)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">E-posta</dt>
          <dd className="mt-1 truncate text-sm text-foreground">{formatProfileField(profile.email)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Telefon</dt>
          <dd className="mt-1 truncate text-sm text-foreground">{formatProfileField(profile.phone)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kullanıcı Türü</dt>
          <dd className="mt-1 text-sm text-foreground">{getUserRoleLabel(profile.role)}</dd>
        </div>
      </dl>
    </div>
  );
}
