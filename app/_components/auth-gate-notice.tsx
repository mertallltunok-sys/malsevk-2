import { Lock } from "lucide-react";
import Link from "next/link";

export function AuthGateNotice({
  message,
  loginRedirect,
  action,
}: {
  message: string;
  loginRedirect?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6 text-center sm:p-8">
      <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {loginRedirect && (
        <Link
          href={`/giris-yap?redirect=${encodeURIComponent(loginRedirect)}`}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Giriş Yap
        </Link>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
