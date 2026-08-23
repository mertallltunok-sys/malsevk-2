import type { Metadata } from "next";
import { PanelSummary } from "../_components/panel-summary";
import { PageContainer } from "../_components/page-container";

export const metadata: Metadata = {
  title: "Panel Özeti | MALSEVK.COM",
  description: "Hizmet taleplerinizi, tekliflerinizi ve son hareketlerinizi tek ekrandan görüntüleyin.",
};

export default function PanelPage() {
  return (
    <section className="bg-background">
      <PageContainer className="py-16">
        <PanelSummary />
      </PageContainer>
    </section>
  );
}
