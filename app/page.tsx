import { FinalCtaSection } from "./_components/final-cta-section";
import { HeroSection } from "./_components/hero-section";
import { HowItWorksSection } from "./_components/how-it-works-section";
import { RoleCardsSection } from "./_components/role-cards-section";
import { ServicesSection } from "./_components/services-section";
import { TrustValueSection } from "./_components/trust-value-section";

export default function Home() {
  return (
    <>
      <HeroSection />
      <RoleCardsSection />
      <ServicesSection />
      <HowItWorksSection />
      <TrustValueSection />
      <FinalCtaSection />
    </>
  );
}
