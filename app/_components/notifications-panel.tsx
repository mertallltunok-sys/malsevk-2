"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { formatJobDate } from "../_lib/jobs";
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

  return (
    <ul className="flex flex-col gap-3">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <Link
            href={notification.href}
            onClick={() => markNotificationRead(session.id, notification.id)}
            className="flex items-start gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-foreground">{notification.message}</p>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatJobDate(notification.createdAt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
