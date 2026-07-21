import type { Metadata } from "next";
import { NotificationsPanel } from "../../_components/notifications-panel";

export const metadata: Metadata = {
  title: "Bildirimler | MALSEVK.COM",
  description: "İlanlarınıza gelen tekliflere dair bildirimlerinizi görüntüleyin.",
};

export default function BildirimlerPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Bildirimler
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          İlanlarınıza gelen tekliflere dair bildirimlerinizi buradan görüntüleyebilirsiniz.
        </p>
        <div className="mt-10">
          <NotificationsPanel />
        </div>
      </div>
    </section>
  );
}
