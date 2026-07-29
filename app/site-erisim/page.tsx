import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isSafeNextPath, isSiteAccessGateActive, isValidSiteAccessToken, SITE_ACCESS_COOKIE } from "../_lib/site-access";
import { clearSiteAccess } from "./actions";
import { SiteAccessForm } from "./site-access-form";

export const metadata: Metadata = {
  title: "Site Erişimi | MALSEVK.COM",
  description: "Geliştirme dönemi site erişim şifresi.",
  robots: { index: false, follow: false },
};

function resolveNextTarget(next: string | undefined): string {
  return next && isSafeNextPath(next) ? next : "/";
}

export default async function SiteErisimPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextTarget = resolveNextTarget(next);

  if (!isSiteAccessGateActive()) {
    return (
      <section className="bg-background">
        <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">Site Erişimi</h1>
          <div className="mt-8 rounded-card border border-border bg-surface p-6 text-sm text-muted-foreground sm:p-8">
            Geliştirme modunda (<code>npm run dev</code>) bu koruma devre dışıdır — doğrudan uygulamaya devam
            edebilirsiniz.
          </div>
        </div>
      </section>
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SITE_ACCESS_COOKIE)?.value;
  const isAuthenticated = isValidSiteAccessToken(token);

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1 className="text-3xl font-bold tracking-heading leading-tight text-foreground">Site Erişimi</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Bu, geçici bir geliştirme dönemi korumasıdır. Devam etmek için erişim şifresini girin.
        </p>
        <div className="mt-8 rounded-card border border-border bg-surface p-6 sm:p-8">
          {isAuthenticated ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-foreground">Site erişimi zaten etkin.</p>
              <form action={clearSiteAccess}>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-danger/40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Erişimi Kilitle
                </button>
              </form>
            </div>
          ) : (
            <SiteAccessForm next={nextTarget} />
          )}
        </div>
      </div>
    </section>
  );
}
