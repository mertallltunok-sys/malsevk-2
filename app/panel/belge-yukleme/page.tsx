import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentUploadContent } from "../../_components/document-upload-content";
import { PageContainer } from "../../_components/page-container";

export const metadata: Metadata = {
  title: "Belge Yükleme | MALSEVK.COM",
  description: "Verdiğiniz hizmetlere ait faaliyet belgelerinizi yükleyin ve admin onayını takip edin.",
};

export default function BelgeYuklemePage() {
  return (
    <section className="bg-background">
      <PageContainer size="form" className="py-16">
        <Suspense
          fallback={
            <div aria-hidden="true" className="h-64 animate-pulse rounded-card border border-border bg-surface" />
          }
        >
          <DocumentUploadContent />
        </Suspense>
      </PageContainer>
    </section>
  );
}
