"use client";

import { Inbox, Trash2 } from "lucide-react";
import Link from "next/link";
import { formatJobDate } from "../_lib/jobs";
import { dismissNotification } from "../_lib/notification-dismissals";
import { markNotificationRead } from "../_lib/notification-reads";
import { useDismissAnimation } from "../_lib/use-dismiss-animation";
import { useNotifications } from "../_lib/use-notifications";
import { useSession } from "../_lib/use-session";
import type { AppNotification } from "../_lib/notifications";
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

  return (
    <ul className="flex flex-col">
      {notifications.map((notification) => (
        <NotificationPanelRow
          key={notification.id}
          notification={notification}
          onRead={() => markNotificationRead(session.id, notification.id)}
          onDismiss={() => dismissNotification(session.id, notification.id)}
        />
      ))}
    </ul>
  );
}

function NotificationPanelRow({
  notification,
  onRead,
  onDismiss,
}: {
  notification: AppNotification;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const { rowRef, removing, style, trigger } = useDismissAnimation(onDismiss);

  return (
    <li ref={rowRef} style={style} className="mb-3 last:mb-0">
      <div className="flex items-center gap-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary/40">
        <Link
          href={notification.href}
          onClick={onRead}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
          onClick={(event) => {
            // Buton, linkle aynı flex satırındaki ayrı bir kardeş (üzerine
            // binen mutlak konumlu bir eleman değil) — bu yüzden linke
            // tıklama zaten tetiklenmez; yine de savunma amaçlı durduruluyor.
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
