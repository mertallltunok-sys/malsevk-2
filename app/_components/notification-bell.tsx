"use client";

import { Bell, Inbox } from "lucide-react";
import Link from "next/link";
import { useDropdown } from "../_lib/use-dropdown";
import { markNotificationRead } from "../_lib/notification-reads";
import { useNotifications } from "../_lib/use-notifications";
import { useReadNotificationIds } from "../_lib/use-notification-reads";
import type { Session } from "../_lib/types";

export function NotificationBell({ session }: { session: Session }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const notifications = useNotifications(session);
  const readIds = useReadNotificationIds(session.id);
  const readIdSet = new Set(readIds);
  const unreadCount = notifications.filter((notification) => !readIdSet.has(notification.id)).length;

  function handleToggle() {
    setOpen((value) => !value);
  }

  function handleNotificationClick(notificationId: string) {
    markNotificationRead(session.id, notificationId);
    setOpen(false);
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
              {notifications.slice(0, 8).map((notification) => {
                const isUnread = !readIdSet.has(notification.id);
                return (
                  <li key={notification.id}>
                    <Link
                      href={notification.href}
                      onClick={() => handleNotificationClick(notification.id)}
                      role="menuitem"
                      className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm leading-relaxed text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        isUnread ? "bg-background font-semibold hover:bg-border" : "hover:bg-background"
                      }`}
                    >
                      <Inbox
                        className={`mt-0.5 h-4 w-4 shrink-0 ${isUnread ? "text-accent" : "text-muted-foreground"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">{notification.message}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
