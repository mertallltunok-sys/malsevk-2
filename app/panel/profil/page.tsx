import type { Metadata } from "next";
import { ProfilePageContent } from "../../_components/profile-page-content";

export const metadata: Metadata = {
  title: "Profilim | MALSEVK.COM",
  description: "Hesabınıza ait temel bilgileri görüntüleyin.",
};

export default function ProfilPage() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <ProfilePageContent />
      </div>
    </section>
  );
}
