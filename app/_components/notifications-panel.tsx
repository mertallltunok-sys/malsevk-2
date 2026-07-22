"use client";

import { Inbox, Trash2 } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { formatJobDate } from "../_lib/jobs";
import { dismissNotification } from "../_lib/notification-dismissals";
import { markNotificationRead } from "../_lib/notification-reads";
import { useNotifications } from "../_lib/use-notifications";
import { useSession } from "../_lib/use-session";
import type { Session } from "../_lib/types";
import { AuthGateNotice } from "./auth-gate-notice";

export function NotificationsPanel() {
  const session = useSession();

  if (!session) {
    return (
      <AuthGateNotice
        message="Bildirimlerinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/bildirimler"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return <AuthGateNotice message="Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir." />;
  }

  return <NotificationsList session={session} />;
}

function NotificationsList({ session }: { session: Session }) {
  const notifications = useNotifications(session);

  if (notifications.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Henüz bildiriminiz bulunmuyor.
        </p>
      </div>
    );
  }

  function handleDelete(event: MouseEvent, notificationId: string) {
    // Buton, satırın Link'ine kardeş (nested değil) olduğu için yönlendirme
    // zaten tetiklenmez; yine de savunma amaçlı durduruluyor.
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm("Bu bildirimi silmek istiyor musunuz?")) return;
    dismissNotification(session.id, notificationId);
  }

  return (
    <ul className="flex flex-col gap-3">
      {notifications.map((notification) => (
        <li key={notification.id} className="relative">
          <Link
            href={notification.href}
            onClick={() => markNotificationRead(session.id, notification.id)}
            className="flex items-start gap-3 rounded-card border border-border bg-surface p-4 pr-12 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm leading-relaxed text-foreground">{notification.message}</p>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatJobDate(notification.createdAt)}
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={(event) => handleDelete(event, notification.id)}
            aria-label="Bildirimi sil"
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
