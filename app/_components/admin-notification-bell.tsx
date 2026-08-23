"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getAdminNotifications,
  type AdminNotification,
} from "../_lib/admin-notifications";
import { getReadNotificationIds, markNotificationRead, subscribeToNotificationReads } from "../_lib/notification-reads";
import { useDropdown } from "../_lib/use-dropdown";

const SEVERITY_DOT_CLASS: Record<AdminNotification["severity"], string> = {
  critical: "bg-danger",
  warning: "bg-warning",
  info: "bg-accent",
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

export function AdminNotificationBell({ adminUserId }: { adminUserId: string }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const readIds = useSyncExternalStore(
    subscribeToNotificationReads,
    () => getReadNotificationIds(adminUserId),
    () => [] as string[],
  );

  useEffect(() => {
    let cancelled = false;
    void getAdminNotifications().then((result) => {
      if (cancelled) return;
      setNotifications(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const readSet = new Set(readIds);
  const unreadCount = notifications.filter((item) => !readSet.has(item.id)).length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Bildirimler"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Bildirimler"
          className="absolute right-0 top-12 z-50 max-h-96 w-80 overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-md"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bildirimler</p>
          {loading && <p className="px-3 py-4 text-sm text-muted-foreground">Yükleniyor...</p>}
          {!loading && notifications.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Bildirim yok.</p>
          )}
          {!loading &&
            notifications.map((item) => {
              const isRead = readSet.has(item.id);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => {
                    markNotificationRead(adminUserId, item.id);
                    setOpen(false);
                  }}
                  className={`flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-background ${isRead ? "opacity-60" : ""}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[item.severity]}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                    <span className="block text-[11px] text-muted-foreground/70">{formatRelativeTime(item.createdAtIso)}</span>
                  </span>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
