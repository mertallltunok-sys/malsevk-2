import type { Metadata } from "next";
import { JobListingScreen } from "../_components/job-listing-screen";

export const metadata: Metadata = {
  title: "İş İlanları | MALSEVK.COM",
  description: "Lojistik operasyon hizmeti veren firmalar için güncel iş ilanları.",
};

export default function IlanlarPage() {
  return <JobListingScreen />;
}
