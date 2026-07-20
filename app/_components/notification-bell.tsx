"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useDropdown } from "../_lib/use-dropdown";
import { useNotifications } from "../_lib/use-notifications";
import type { Session } from "../_lib/types";

export function NotificationBell({ session }: { session: Session }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const notifications = useNotifications(session);
  const [viewed, setViewed] = useState(false);
  const unreadCount = viewed ? 0 : notifications.length;

  function handleToggle() {
    setOpen((value) => !value);
    setViewed(true);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Bildirimler, ${unreadCount} okunmamış` : "Bildirimler"
        }
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-background hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Bildirimler"
          className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-2 shadow-md"
        >
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Yeni bildiriminiz yok.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {notifications.slice(0, 8).map((notification) => (
                <li key={notification.id}>
                  <Link
                    href={notification.href}
                    onClick={() => setOpen(false)}
                    role="menuitem"
                    className="block rounded-md px-3 py-2 text-sm leading-relaxed text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {notification.message}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
