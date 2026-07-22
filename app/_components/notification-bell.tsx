"use client";

import { Bell, Inbox, Trash2 } from "lucide-react";
import Link from "next/link";
import { useDropdown } from "../_lib/use-dropdown";
import { dismissNotification } from "../_lib/notification-dismissals";
import { markNotificationRead } from "../_lib/notification-reads";
import { useDismissAnimation } from "../_lib/use-dismiss-animation";
import { useNotifications } from "../_lib/use-notifications";
import { useReadNotificationIds } from "../_lib/use-notification-reads";
import type { AppNotification } from "../_lib/notifications";
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
            <ul className="flex flex-col">
              {notifications.slice(0, 8).map((notification) => (
                <NotificationBellRow
                  key={notification.id}
                  notification={notification}
                  isUnread={!readIdSet.has(notification.id)}
                  onRead={() => {
                    markNotificationRead(session.id, notification.id);
                    setOpen(false);
                  }}
                  onDismiss={() => dismissNotification(session.id, notification.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationBellRow({
  notification,
  isUnread,
  onRead,
  onDismiss,
}: {
  notification: AppNotification;
  isUnread: boolean;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const { rowRef, removing, style, trigger } = useDismissAnimation(onDismiss);

  return (
    <li ref={rowRef} style={style} className="relative mb-1 last:mb-0">
      <div className="flex items-center gap-1">
        <Link
          href={notification.href}
          onClick={onRead}
          role="menuitem"
          className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-md py-2 pl-3 pr-2 text-sm leading-relaxed text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            isUnread ? "bg-background font-semibold hover:bg-border" : "hover:bg-background"
          }`}
        >
          <Inbox
            className={`mt-0.5 h-4 w-4 shrink-0 ${isUnread ? "text-accent" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 break-words">{notification.message}</span>
        </Link>
        <button
          type="button"
          onClick={(event) => {
            // Buton artık linkin üzerine binen mutlak konumlu bir eleman
            // değil, linkle aynı flex satırındaki ayrı bir kardeş — bu
            // yüzden linke tıklama/yönlendirme zaten tetiklenmez; yine de
            // savunma amaçlı durduruluyor.
            event.preventDefault();
            event.stopPropagation();
            trigger();
          }}
          disabled={removing}
          aria-label="Bildirimi sil"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
