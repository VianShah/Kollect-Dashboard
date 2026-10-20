// Shared shell for the public legal pages (/privacy, /terms). These are reachable without a
// session: Meta requires a public privacy policy and terms URL for the WhatsApp app.
import Link from "next/link";

export function LegalPage({ title, effective, children, footer }: { title: string; effective: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[760px] px-4 pb-20 pt-12">
      <div className="text-[13px] font-bold uppercase tracking-wide text-muted">Predixion AI</div>
      <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
      <div className="mt-1.5 mb-7 text-[13px] text-muted">WhatsApp messaging service (MessageX) · Effective date: {effective}</div>
      <div className="space-y-1 text-[15px] leading-relaxed text-ink-2">{children}</div>
      <footer className="mt-12 border-t border-line pt-5 text-[13px] text-muted">{footer}</footer>
    </main>
  );
}

export const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-8 mb-2 text-[19px] font-semibold tracking-tight text-ink">{children}</h2>
);

export const P = ({ children }: { children: React.ReactNode }) => <p className="my-2">{children}</p>;

export const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
);

export const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="my-4 rounded-lg border border-line bg-sunk px-4 py-3 text-[14px]">{children}</div>
);

export const A = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href.startsWith("/") ? (
    <Link href={href} className="text-brand underline underline-offset-2 hover:text-brand-ink">{children}</Link>
  ) : (
    <a href={href} className="text-brand underline underline-offset-2 hover:text-brand-ink">{children}</a>
  );
