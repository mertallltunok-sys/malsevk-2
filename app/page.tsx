import { FinalCtaSection } from "./_components/final-cta-section";
import { HeroSection } from "./_components/hero-section";
import { RoleCardsSection } from "./_components/role-cards-section";
import { ServicesSection } from "./_components/services-section";

export default function Home() {
  return (
    <>
      <HeroSection />
      <RoleCardsSection />
      <ServicesSection />
      <FinalCtaSection />
    </>
  );
}
