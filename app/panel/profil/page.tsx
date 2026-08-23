import type { Metadata } from "next";
import { ProfilePageContent } from "../../_components/profile-page-content";
import { PageContainer } from "../../_components/page-container";

export const metadata: Metadata = {
  title: "Profilim | MALSEVK.COM",
  description: "Hesabınıza ait temel bilgileri görüntüleyin.",
};

export default function ProfilPage() {
  return (
    <section className="bg-background">
      <PageContainer size="form" className="py-16">
        <ProfilePageContent />
      </PageContainer>
    </section>
  );
}
