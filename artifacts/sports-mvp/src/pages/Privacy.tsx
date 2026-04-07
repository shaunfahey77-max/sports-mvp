import { Link } from "wouter";

function LegalNav() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#1A3066]/80 bg-[#060D1F]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-8 object-contain" />
        </Link>
        <Link href="/picks" className="text-sm text-white/60 hover:text-white transition-colors">Back to App</Link>
      </div>
    </nav>
  );
}

export function Privacy() {
  return (
    <div className="min-h-screen bg-[#060D1F] text-white">
      <LegalNav />
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-black font-display text-white mb-2">Privacy Policy</h1>
        <p className="text-white/40 text-sm mb-10">Last updated: April 7, 2026</p>

        <div className="prose prose-sm prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <Section title="1. Introduction">
            SportsMVP ("we," "us," or "our") operates the SportsMVP website and analytics platform (the "Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our Service. Please read this policy carefully. If you disagree with its terms, please discontinue use of the Service.
          </Section>

          <Section title="2. Information We Collect">
            <p>We may collect the following categories of information:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li><strong className="text-white">Account Information:</strong> When you create an account, we collect your email address, name, and password (stored as a cryptographic hash).</li>
              <li><strong className="text-white">Payment Information:</strong> Billing details are processed by our payment provider (Stripe). We do not store full credit card numbers on our servers.</li>
              <li><strong className="text-white">Usage Data:</strong> We collect information about how you interact with the Service, including pages visited, picks viewed, time spent, and features used.</li>
              <li><strong className="text-white">Device Information:</strong> Browser type, operating system, IP address, and device identifiers.</li>
              <li><strong className="text-white">Cookies and Tracking:</strong> We use cookies and similar tracking technologies to maintain sessions and analyze usage patterns. You may opt out of non-essential cookies via your browser settings.</li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Provide, operate, and maintain the Service</li>
              <li>Process payments and manage subscriptions</li>
              <li>Send transactional emails (receipts, password resets, pick alerts for subscribers)</li>
              <li>Analyze and improve the accuracy of our prediction models</li>
              <li>Monitor and prevent fraud or abuse</li>
              <li>Comply with legal obligations</li>
              <li>Send marketing communications (with your consent; you may opt out at any time)</li>
            </ul>
          </Section>

          <Section title="4. Data Sharing and Disclosure">
            <p>We do not sell your personal information. We may share information in the following circumstances:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li><strong className="text-white">Service Providers:</strong> We use trusted third-party vendors (e.g., Stripe for payments, cloud hosting providers) who are contractually bound to protect your data.</li>
              <li><strong className="text-white">Legal Requirements:</strong> We may disclose your information if required to do so by law or in response to valid requests by public authorities.</li>
              <li><strong className="text-white">Business Transfers:</strong> In the event of a merger, acquisition, or sale of assets, user data may be transferred as part of that transaction.</li>
            </ul>
          </Section>

          <Section title="5. Data Retention">
            We retain your personal information for as long as your account is active or as needed to provide the Service. You may request deletion of your account and associated data at any time by contacting us at privacy@sportsmvp.com. We will process deletion requests within 30 days, subject to any legal retention obligations.
          </Section>

          <Section title="6. Security">
            We implement industry-standard security measures including HTTPS encryption, password hashing, and access controls. However, no method of transmission over the Internet is 100% secure. We cannot guarantee absolute security of your data.
          </Section>

          <Section title="7. Your Rights">
            <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Right to access and receive a copy of your data</li>
              <li>Right to correction of inaccurate data</li>
              <li>Right to deletion ("right to be forgotten")</li>
              <li>Right to opt out of marketing communications</li>
              <li>Right to data portability (where applicable)</li>
              <li>Rights under GDPR (for EU/EEA residents) and CCPA (for California residents)</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, contact us at privacy@sportsmvp.com.</p>
          </Section>

          <Section title="8. Children's Privacy">
            The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from minors. If you become aware that a child has provided us with personal information, please contact us immediately.
          </Section>

          <Section title="9. Third-Party Links">
            Our Service may contain links to sportsbook partners and third-party websites. We are not responsible for the privacy practices of those sites. We encourage you to review their privacy policies before providing any information.
          </Section>

          <Section title="10. Changes to This Policy">
            We reserve the right to update this Privacy Policy at any time. Changes will be posted on this page with an updated "Last updated" date. Continued use of the Service after changes constitutes acceptance of the new policy.
          </Section>

          <Section title="11. Contact Us">
            <p>For questions about this Privacy Policy, contact us at:</p>
            <div className="mt-3 bg-[#0D1B3E] border border-[#1A3066] rounded-xl p-4 text-sm">
              <p className="text-white font-semibold">SportsMVP</p>
              <p className="text-white/60">privacy@sportsmvp.com</p>
            </div>
          </Section>
        </div>

        <div className="mt-12 pt-8 border-t border-[#1A3066] flex gap-6">
          <Link href="/terms" className="text-[#0033A0] hover:text-[#4488FF] text-sm transition-colors">Terms of Service</Link>
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
