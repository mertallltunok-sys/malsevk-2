import type { Metadata } from "next";
import { Suspense } from "react";
import { JobDetailContent } from "../../_components/job-detail-content";
import { getJobById } from "../../_lib/jobs";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const job = getJobById(id);
  return {
    title: job ? `${job.title} | MALSEVK.COM` : "İlan Detayı | MALSEVK.COM",
  };
}

export default async function IlanDetayPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <section className="bg-background">
      <Suspense fallback={<div aria-hidden="true" className="h-96 animate-pulse bg-surface" />}>
        <JobDetailContent id={id} />
      </Suspense>
    </section>
  );
}
