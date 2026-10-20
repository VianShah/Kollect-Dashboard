import type { Metadata } from "next";
import { A, H2, LegalPage, Note, P } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Terms of Service | Predixion AI",
  description: "Terms of service for Predixion AI's WhatsApp messaging service (MessageX).",
};

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      effective="19 October 2026"
      footer={
        <>
          © 2026 Digital Outcomes Technologies Private Limited (Predixion AI). <A href="/privacy">Privacy Policy</A> ·{" "}
          <A href="https://www.predixion.ai/terms-of-use">Website terms of use</A>
        </>
      }
    >
      <P>
        These terms are issued by <strong className="font-semibold text-ink">Digital Outcomes Technologies Private Limited</strong> (CIN
        U72900MH2021PTC360260), operating as &ldquo;Predixion AI&rdquo; (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;),
        Hiranandani Lightbridge, Powai, Mumbai, Maharashtra 400072, India.
      </P>
      <P>
        They apply when you receive messages from, or send messages to, Predixion AI on WhatsApp through our MessageX application (the
        &ldquo;Service&rdquo;). By messaging us or continuing to receive our messages, you accept these terms.
      </P>

      <Note>
        Our general website terms are at <A href="https://www.predixion.ai/terms-of-use">predixion.ai/terms-of-use</A>. Services we
        provide to enterprise clients are governed by the signed agreement with that client, which takes precedence over these terms.
      </Note>

      <H2>1. Eligibility</H2>
      <P>You must be at least 18 years old to use the Service.</P>

      <H2>2. Messages you receive</H2>
      <P>
        We send WhatsApp messages only to people who have agreed to be contacted, or on behalf of a client that holds that consent.
        Messages may include reminders, service updates and replies to your questions. You can stop them at any time by replying
        &ldquo;STOP&rdquo;, by blocking our number in WhatsApp, or by contacting us (Section 11).
      </P>

      <H2>3. Acceptable use</H2>
      <P>
        When messaging us you must not send unlawful, abusive, defamatory or infringing content, impersonate anyone, send malware, or
        attempt to interfere with or gain unauthorised access to our systems.
      </P>

      <H2>4. WhatsApp</H2>
      <P>
        WhatsApp is provided by Meta Platforms. Your use of WhatsApp is also subject to WhatsApp&rsquo;s own terms and privacy policy,
        and we are not responsible for how WhatsApp itself operates.
      </P>

      <H2>5. Intellectual property</H2>
      <P>
        Content we send you, and the names VOIZ, KOLLECT, LEADX and AGENTX, belong to or are licensed to Predixion AI. Feedback you send
        us may be used without any confidentiality obligation.
      </P>

      <H2>6. No warranty</H2>
      <P>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We do not guarantee that it will be uninterrupted,
        error-free, or that every message will be delivered.
      </P>

      <H2>7. Limitation of liability</H2>
      <P>
        To the extent permitted by law, we are not liable for indirect, incidental, special, consequential or punitive damages, or for
        lost profits, and our total liability is limited to INR 10,000. This does not limit obligations under a signed client agreement,
        or liability that cannot be limited by law.
      </P>

      <H2>8. Privacy</H2>
      <P>
        Our <A href="/privacy">Privacy Policy</A> explains how we handle personal data in the Service and forms part of these terms.
      </P>

      <H2>9. Governing law and disputes</H2>
      <P>
        These terms are governed by the laws of India. Before starting formal proceedings, both sides will give written notice and spend
        at least 30 days trying to resolve the matter in good faith. After that, the courts at Mumbai, Maharashtra have exclusive
        jurisdiction.
      </P>

      <H2>10. Changes and suspension</H2>
      <P>
        We may update these terms by posting a new version on this page with a new effective date. We may suspend or stop the Service for
        anyone we reasonably believe has breached these terms or the law. We are not liable for failures caused by events beyond our
        reasonable control.
      </P>

      <H2>11. Contact</H2>
      <P>
        Digital Outcomes Technologies Private Limited<br />
        Hiranandani Lightbridge, Powai, Mumbai, Maharashtra 400072, India<br />
        Email: <A href="mailto:contact@predixion.ai">contact@predixion.ai</A>
      </P>
    </LegalPage>
  );
}
