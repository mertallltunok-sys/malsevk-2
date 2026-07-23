import Link from "next/link";
import type { ComponentProps } from "react";

const baseClass =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const variantClass = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary",
  "primary-on-dark": "bg-surface text-primary hover:bg-surface/90",
  "secondary-on-dark":
    "border border-primary-foreground/30 text-primary-foreground hover:border-primary-foreground/60",
} as const;

export type ButtonVariant = keyof typeof variantClass;

/**
 * ButtonLink'in kullandığı sınıf birleştirme mantığı — `<a>` dışında bir
 * elemente (ör. gerçek navigasyon yerine bir modal açması gereken
 * `<button>`) aynı görsel stili vermek gerektiğinde de buradan çağrılır,
 * sınıf string'i bir daha elle yazılmaz (bkz. job-listings-auth-gate.tsx'i
 * tetikleyen butonlar).
 */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  className?: string,
): string {
  return [baseClass, variantClass[variant], className].filter(Boolean).join(" ");
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
};

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ButtonLinkProps) {
  return <Link {...props} className={buttonClassName(variant, className)} />;
}
