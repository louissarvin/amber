import Hero from '@/components/amber/sections/Hero'
import ProofStrip from '@/components/amber/sections/ProofStrip'
import HowItWorks from '@/components/amber/sections/HowItWorks'
import ReputationShowcase from '@/components/amber/sections/ReputationShowcase'
import MemoryPortrait from '@/components/amber/sections/MemoryPortrait'
import PricingSection from '@/components/amber/sections/PricingSection'
import DevelopersSection from '@/components/amber/sections/DevelopersSection'
import FooterCTA from '@/components/amber/sections/FooterCTA'

export default function AmberLanding() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <HowItWorks />
      <ReputationShowcase />
      <MemoryPortrait />
      <PricingSection />
      <DevelopersSection />
      <FooterCTA />
    </>
  )
}
