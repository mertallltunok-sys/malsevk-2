"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId } from "react";
import { verifySiteAccess, type SiteAccessFormState } from "./actions";

const initialState: SiteAccessFormState = {};

export function SiteAccessForm({ next }: { next: string }) {
  const passwordId = useId();
  const [state, formAction, isPending] = useActionState(verifySiteAccess, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor={passwordId} className="text-sm font-medium text-foreground">
          Şifre
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="off"
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? `${passwordId}-error` : undefined}
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {state.error && (
          <p id={`${passwordId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {state.error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {isPending ? "Kontrol ediliyor..." : "Giriş Yap"}
      </button>
    </form>
  );
}
