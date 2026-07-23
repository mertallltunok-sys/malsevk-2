import type { Metadata } from "next";
import { JobRequestForm } from "../_components/job-request-form";

export const metadata: Metadata = {
  title: "Hizmet Talebi Oluştur | MALSEVK.COM",
  description: "Lojistik hizmet ihtiyacınızı tanımlayarak yeni bir ilan oluşturun.",
};

export default function HizmetTalebiOlusturPage() {
  return <JobRequestForm />;
}
