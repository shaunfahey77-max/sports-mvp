import { Link } from "wouter";

function LegalNav() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#1A3066]/80 bg-[#060D1F]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-12 object-contain" />
        </Link>
        <Link href="/picks" className="text-sm text-white/60 hover:text-white transition-colors">Back to App</Link>
      </div>
    </nav>
  );
}

export function Terms() {
  return (
    <div className="min-h-screen bg-[#060D1F] text-white">
      <LegalNav />
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-black font-display text-white mb-2">Terms of Service</h1>
        <p className="text-white/40 text-sm mb-10">Last updated: April 7, 2026</p>

        <div className="bg-[#D32F2F]/10 border border-[#D32F2F]/30 rounded-xl p-4 mb-10">
          <p className="text-[#FF6B6B] text-sm font-semibold mb-1">Important Disclaimer</p>
          <p className="text-white/60 text-sm leading-relaxed">
            SportsMVP provides analytical information for informational and entertainment purposes only. Nothing on this platform constitutes financial advice, betting advice, or a guarantee of outcomes. Gambling involves significant financial risk. Only gamble with money you can afford to lose. Please gamble responsibly.
          </p>
        </div>

        <div className="prose prose-sm prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <Section title="1. Acceptance of Terms">
            By accessing or using SportsMVP (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all terms, you may not access or use the Service. These Terms apply to all visitors, users, and subscribers.
          </Section>

          <Section title="2. Description of Service">
            SportsMVP is a sports analytics platform that uses machine learning models to generate sports betting predictions across NBA, NHL, and MLB markets. Picks publish as Official only when the underlying market clears our launch thresholds; other markets and signals may surface in a Model Watch lane while they earn promotion. The Service provides:
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Automated pick recommendations with tier grades (A, B, C)</li>
              <li>Expected value (EV) and edge calculations</li>
              <li>Closing Line Value (CLV) tracking</li>
              <li>Historical performance dashboards</li>
              <li>Real-time odds ingestion from multiple sportsbooks</li>
            </ul>
          </Section>

          <Section title="3. No Gambling Advice">
            <strong className="text-white block mb-2">SportsMVP does not provide gambling advice.</strong>
            The picks, recommendations, and analytics provided by SportsMVP are statistical outputs of machine learning models and are provided for informational and entertainment purposes only. Past performance of our models does not guarantee future results. All sports betting involves risk, and you may lose money. You are solely responsible for any wagering decisions you make. SportsMVP, its founders, employees, and affiliates accept no responsibility for financial losses incurred as a result of using this Service.
          </Section>

          <Section title="4. Eligibility">
            You must be at least 18 years of age (or the legal gambling age in your jurisdiction, whichever is higher) to use this Service. By using the Service, you represent and warrant that you meet this requirement. Online sports betting may not be legal in your jurisdiction — you are solely responsible for ensuring compliance with local laws.
          </Section>

          <Section title="5. Subscription Plans and Billing">
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong className="text-white">Free Tier:</strong> No credit card required. Limited to one top pick per day.</li>
              <li><strong className="text-white">MVP ($19.99/month or $149/year):</strong> Full access to all picks, metrics, and history, including the Model Watch lane. Billed in advance. Annual plan saves approximately 38%.</li>
              <li><strong className="text-white">Auto-Renewal:</strong> Subscriptions automatically renew at the end of each billing period unless cancelled at least 24 hours before renewal.</li>
              <li><strong className="text-white">Refunds:</strong> Payments are generally non-refundable. We may grant refunds at our sole discretion for technical errors or exceptional circumstances. Contact support@sportsmvp.com within 48 hours of a billing issue.</li>
              <li><strong className="text-white">Cancellation:</strong> You may cancel your subscription at any time via your account settings. Cancellation takes effect at the end of the current billing period.</li>
            </ul>
          </Section>

          <Section title="6. Prohibited Uses">
            You may not:
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Resell, redistribute, or republish our picks or data without written permission</li>
              <li>Use automated bots or scrapers to extract data from the Service</li>
              <li>Circumvent subscription restrictions or access premium features without a valid subscription</li>
              <li>Use the Service to engage in any illegal activity</li>
              <li>Share your account credentials with others</li>
              <li>Attempt to reverse-engineer our prediction models or algorithms</li>
            </ul>
          </Section>

          <Section title="7. Intellectual Property">
            All content, models, algorithms, branding, and software on SportsMVP are the exclusive property of SportsMVP and are protected by applicable intellectual property laws. The tagline "Bet Like an MVP." is a trademark of SportsMVP. You are granted a limited, non-exclusive, non-transferable license to use the Service for personal, non-commercial purposes only.
          </Section>

          <Section title="8. Disclaimer of Warranties">
            The Service is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that picks will be profitable.
          </Section>

          <Section title="9. Limitation of Liability">
            To the fullest extent permitted by law, SportsMVP and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to losses from gambling, loss of data, or loss of profits, arising from your use of the Service, even if we have been advised of the possibility of such damages. Our total liability to you for any claims shall not exceed the amount you paid to us in the 12 months prior to the claim.
          </Section>

          <Section title="10. Indemnification">
            You agree to indemnify and hold SportsMVP, its officers, directors, employees, and agents harmless from any claims, damages, losses, or expenses (including legal fees) arising out of your use of the Service, your violation of these Terms, or your violation of any third-party rights.
          </Section>

          <Section title="11. Governing Law">
            These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law provisions. Any disputes arising from these Terms shall be resolved exclusively in the state or federal courts located in Delaware.
          </Section>

          <Section title="12. Changes to Terms">
            We reserve the right to modify these Terms at any time. Changes will be effective when posted. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.
          </Section>

          <Section title="13. Termination">
            We reserve the right to suspend or terminate your account at any time for violation of these Terms, abusive behavior, or any other reason at our sole discretion. Termination does not entitle you to a refund.
          </Section>

          <Section title="14. Contact">
            <p>For questions about these Terms:</p>
            <div className="mt-3 bg-[#0D1B3E] border border-[#1A3066] rounded-xl p-4 text-sm">
              <p className="text-white font-semibold">SportsMVP</p>
              <p className="text-white/60">support@sportsmvp.com</p>
            </div>
          </Section>
        </div>

        <div className="mt-12 pt-8 border-t border-[#1A3066] flex gap-6">
          <Link href="/privacy" className="text-[#4488FF] hover:text-[#6699FF] text-sm transition-colors">Privacy Policy</Link>
          <Link href="/" className="text-white/40 hover:text-white/70 text-sm transition-colors">Back to Home</Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-white font-bold text-base mb-3 font-display">{title}</h2>
      <div className="text-white/60 text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  );
}
