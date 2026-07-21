import type { Metadata } from "next";
import { PanelSummary } from "../_components/panel-summary";

export const metadata: Metadata = {
  title: "Panel Özeti | MALSEVK.COM",
  description: "Hizmet taleplerinizi, tekliflerinizi ve son hareketlerinizi tek ekrandan görüntüleyin.",
};

export default function PanelPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <PanelSummary />
      </div>
    </section>
  );
}
