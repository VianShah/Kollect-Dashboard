import type { Metadata } from "next";
import { A, H2, LegalPage, Note, P, UL } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Privacy Policy | Predixion AI",
  description: "Privacy policy for Predixion AI's WhatsApp messaging service (MessageX).",
};

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      effective="19 October 2026"
      footer={
        <>
          © 2026 Digital Outcomes Technologies Private Limited (Predixion AI). <A href="/terms">Terms of Service</A> ·{" "}
          <A href="https://www.predixion.ai/privacy-policy">Website privacy policy</A>
        </>
      }
    >
      <P>
        This policy is issued by <strong className="font-semibold text-ink">Digital Outcomes Technologies Private Limited</strong> (CIN
        U72900MH2021PTC360260), operating as &ldquo;Predixion AI&rdquo; (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;),
        Hiranandani Lightbridge, Powai, Mumbai, Maharashtra 400072, India.
      </P>
      <P>
        It explains how we handle personal data when we send and receive WhatsApp messages through the WhatsApp Business Platform using
        our MessageX application. It follows India&rsquo;s Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.
      </P>

      <Note>
        Our general website privacy policy is at <A href="https://www.predixion.ai/privacy-policy">predixion.ai/privacy-policy</A>. Where
        we process data on behalf of an enterprise client (for example a lender&rsquo;s customer communications), that client decides how
        the data is used and the processing is governed by our contract and Data Processing Agreement with that client.
      </Note>

      <H2>1. Data we process</H2>
      <UL>
        <li><strong className="font-semibold text-ink">WhatsApp identifiers:</strong> your phone number and WhatsApp ID, and your WhatsApp profile name if you share it.</li>
        <li><strong className="font-semibold text-ink">Message content:</strong> the messages we send you and any messages you send us, including text and media.</li>
        <li><strong className="font-semibold text-ink">Delivery information:</strong> whether a message was sent, delivered, read or failed, with timestamps and error codes supplied by Meta.</li>
        <li><strong className="font-semibold text-ink">Context we send with a message:</strong> for example your name, or a payment reminder amount and due date, where we are messaging you on behalf of a client.</li>
      </UL>
      <P>We do not ask for financial account numbers, card details or government ID numbers over WhatsApp.</P>

      <H2>2. Why we process it</H2>
      <UL>
        <li>To send you messages you have agreed to receive, such as reminders and service updates.</li>
        <li>To read and respond to messages you send us.</li>
        <li>To confirm messages were delivered, and to find and fix delivery problems.</li>
        <li>To keep the service secure and to meet legal obligations.</li>
      </UL>
      <P>We do not sell personal data, and we do not use your WhatsApp messages to train general-purpose machine-learning models.</P>

      <H2>3. Consent and your choices</H2>
      <P>
        We only start WhatsApp conversations with people who have agreed to be contacted on WhatsApp, or where a client we act for has
        that consent. You can stop messages at any time by replying &ldquo;STOP&rdquo;, by blocking our number in WhatsApp, or by
        contacting us (Section 10). Withdrawing consent does not affect processing that already took place.
      </P>

      <H2>4. Who we share it with</H2>
      <UL>
        <li><strong className="font-semibold text-ink">Meta Platforms</strong>, which operates WhatsApp and delivers the messages, under WhatsApp&rsquo;s own terms and privacy policy.</li>
        <li><strong className="font-semibold text-ink">Service providers</strong> that host our systems (cloud hosting and logging), under contract.</li>
        <li><strong className="font-semibold text-ink">The client</strong> on whose behalf we contacted you, where applicable.</li>
        <li><strong className="font-semibold text-ink">Authorities</strong> where the law requires it, and a successor company in a merger or acquisition.</li>
      </UL>
      <P>We never share your data with third parties for their own marketing.</P>

      <H2>5. Transfers outside India</H2>
      <P>
        Meta and our hosting providers may process data on servers outside India. This is permitted under DPDP law except to countries
        the Central Government restricts. We take reasonable steps so that providers protect the data to an equivalent standard.
      </P>

      <H2>6. How long we keep it</H2>
      <P>
        We keep message and delivery data only as long as needed for the purposes above, or as the law or a client contract requires, and
        then delete or anonymise it. Technical logs on our servers are rotated and removed automatically.
      </P>

      <H2>7. Security</H2>
      <P>
        WhatsApp messages are encrypted in transit. We protect our systems with access controls, signature checks on every message Meta
        sends us, and secret management for credentials. No system is perfectly secure, but we act promptly on any incident.
      </P>

      <H2>8. Your rights</H2>
      <P>
        Under DPDP law you can ask to access a summary of your data, correct it, erase it, nominate someone to act for you, withdraw
        consent, and raise a grievance. We aim to respond to access, correction and erasure requests within 90 days. If you are not
        satisfied with our response you may approach the Data Protection Board of India.
      </P>

      <H2>9. Children</H2>
      <P>This service is not intended for anyone under 18, and we do not knowingly message children.</P>

      <H2>10. Grievance Officer and contact</H2>
      <P>
        Kamal Bhatter, Grievance Officer<br />
        Digital Outcomes Technologies Private Limited<br />
        Hiranandani Lightbridge, Powai, Mumbai, Maharashtra 400072, India<br />
        Email: <A href="mailto:legal@predixion.ai">legal@predixion.ai</A>
      </P>

      <H2>11. Changes to this policy</H2>
      <P>We will post any update on this page with a new effective date, and give additional notice for material changes.</P>
    </LegalPage>
  );
}
