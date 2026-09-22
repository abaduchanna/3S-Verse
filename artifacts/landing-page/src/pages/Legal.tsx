/**
 * Legal + Security pages — hash-routed (#/privacy, #/terms, #/refund,
 * #/eula, #/security). Content stays strictly accurate to how the
 * products actually work (local-first tools, GitHub-hosted license
 * ledger, FormSubmit-based forms) — no invented legal-entity details.
 */
import { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export type LegalKind = 'privacy' | 'terms' | 'refund' | 'eula' | 'security';

const UPDATED = '22 September 2026';
const EMAIL = 'Connect@3SVerse.com';

const META: Record<LegalKind, { title: string; kicker: string }> = {
  privacy: { title: 'Privacy Policy', kicker: 'How your information is handled' },
  terms: { title: 'Terms of Service', kicker: 'The rules of doing business with us' },
  refund: { title: 'Refund Policy', kicker: 'One precise promise, stated everywhere' },
  eula: { title: 'End-User License Agreement', kicker: 'What your license covers' },
  security: { title: 'Security', kicker: 'Local-first by design' },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[20px] font-medium tracking-[-0.01em] text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-[14.5px] font-light leading-7 text-[#b9b6c9]">{children}</div>
    </section>
  );
}

function Privacy() {
  return (
    <>
      <Section title="What we collect">
        <p>
          <strong className="font-medium text-white">Contact and review forms.</strong> When you submit the contact
          or dealer-review form, we receive the details you type: name, email, organization, locations, interest,
          message (and for reviews: store/city, tool and rating). Submissions are relayed to our inbox
          ({EMAIL}) by a third-party form-delivery service and used only to answer your enquiry or verify a review.
          We never sell, rent or trade them.
        </p>
        <p>
          <strong className="font-medium text-white">Orders.</strong> Order details (products, model, PC count,
          company, email) are used to generate your invoice and license keys. Invoice documents are assembled in
          your own browser; we receive a copy by email for fulfilment and accounting.
        </p>
        <p>
          <strong className="font-medium text-white">License activation.</strong> To enforce one-license-per-seat,
          the license ledger stores the license ID, customer name, and — on activation — the machine ID, hostname
          and MAC address of each PC using the license. This is what lets you reinstall on the same PC without
          re-purchase, and lets us release a seat when you change hardware.
        </p>
      </Section>
      <Section title="What we do NOT collect">
        <p>
          The desktop tools do not ship telemetry, analytics, crash reporting or advertising SDKs. Your VidaPay
          credentials, portal sessions and extracted business data stay on your PC and never reach a 3S Verse
          server — there is no 3S Verse server holding them. This website runs no third-party analytics or ad
          trackers.
        </p>
      </Section>
      <Section title="Cookies and storage">
        <p>
          The site itself avoids non-essential cookies. The storefront keeps your running order sheet in your
          browser session; nothing from it is sent anywhere until you submit the order form.
        </p>
      </Section>
      <Section title="Third parties involved">
        <p>
          Form delivery (FormSubmit), payment rails you choose (bank transfer, Wise, PayPal, USDT), GitHub (the
          private license ledger that stores activation records), and our public download mirror. Each processes
          only what is needed to deliver the service you asked for.
        </p>
      </Section>
      <Section title="Your choices">
        <p>
          Want your activation records or form submissions deleted or corrected? Email {EMAIL} from the address
          you used and we will action it. Dealership data inside the tools is yours and stays on your machine —
          uninstalling removes it.
        </p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <Section title="The service">
        <p>
          3S Verse (&ldquo;we&rdquo;) licenses the VidaPay workflow tools — Incentive Extractor, Device Ordering,
          Rebate Filing, and the Full Bundle — and provides custom software services. The tools run on your own
          Windows PC under your own VidaPay dealer login. 3S Verse is an independent software provider and is not
          affiliated with, endorsed by or sponsored by VidaPay, T-CETRA or Total Wireless.
        </p>
      </Section>
      <Section title="Orders, invoicing and delivery">
        <p>
          Place an order in the store and an invoice opens in your browser instantly (PDF-ready, emailed to you).
          Pay by bank transfer, Wise, PayPal or USDT. Once payment is confirmed, license keys plus download links
          arrive by email — usually within a few hours. Every plan includes every update while it is active;
          lifetime includes updates for the life of the product.
        </p>
      </Section>
      <Section title="Plans">
        <p>
          Monthly and annual plans renew as stated on your invoice and can be cancelled by replying to the invoice
          email before the next renewal date. Lifetime is a one-time payment with no renewals. Trials are the full
          software for 7 days on one PC, no card required.
        </p>
      </Section>
      <Section title="Fair use of the tools">
        <p>
          The tools automate actions you are entitled to perform in your own VidaPay portal under your own login.
          They pause for portal security or verification steps and never attempt to bypass them. You remain
          responsible for complying with your dealer agreements and applicable policies when using the tools.
        </p>
      </Section>
      <Section title="Custom work">
        <p>
          Custom applications, automation and websites are scoped individually and governed by the written
          quotation and delivery scope agreed for each engagement.
        </p>
      </Section>
      <Section title="Liability">
        <p>
          To the maximum extent permitted by law, our liability for any claim relating to the tools is limited to
          the amount you paid for the license in the twelve months preceding the claim. Nothing in these terms
          limits liability that cannot be limited by law.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Questions about these terms: <a className="text-[#6ee7ef] hover:underline" href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          We reply within one US Central business day.
        </p>
      </Section>
    </>
  );
}

function Refund() {
  return (
    <>
      <Section title="The guarantee">
        <p>
          Every license carries a <strong className="font-medium text-white">30-day money-back guarantee</strong>.
          If a tool does not do what this site promises on your dealership&rsquo;s data, tell us within 30 days of
          delivery and we refund you in full — <strong className="font-medium text-white">processed within 5
          business days</strong>, back to the original payment method.
        </p>
      </Section>
      <Section title="How to request one">
        <p>
          Email <a className="text-[#6ee7ef] hover:underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> (or reply to
          your invoice email) with your order number and one line about what fell short. A short call is welcome
          but never required — we do not interrogate refund requests.
        </p>
      </Section>
      <Section title="What is covered">
        <p>
          All self-serve plans: monthly, annual, lifetime and the bundle, including first renewals requested
          in error. If a VidaPay portal change breaks a tool and we cannot ship you a working fix within 30
          days of your report, that window does not count against your 30 days — it pauses until the fix lands.
        </p>
      </Section>
      <Section title="What is separate">
        <p>
          Custom development work is scoped per engagement and follows the refund or revision terms written into
          that engagement&rsquo;s quotation. Licenses terminated for fraud or chargeback abuse are excluded from
          re-purchase guarantees.
        </p>
      </Section>
      <Section title="The one rule">
        <p>
          Please request refunds directly with us before opening a card dispute — it is faster (5 business days,
          no fight) and keeps the record clean on both sides.
        </p>
      </Section>
    </>
  );
}

function Eula() {
  return (
    <>
      <Section title="1. The license">
        <p>
          A 3S Verse license grants the purchasing dealership a non-exclusive, non-transferable right to run the
          licensed tool on the number of PCs purchased (seats), for the term purchased (monthly, annual or
          lifetime). Each seat is machine-locked to the PC it is activated on.
        </p>
      </Section>
      <Section title="2. Seats and machine changes">
        <p>
          Replacing a PC or re-imaging Windows does not burn a seat: contact support and we release the old
          binding so you can activate on the new machine. Reasonable seat moves during normal operations
          (staff departures, hardware refreshes) are free and expected. Reselling, sharing or sub-licensing
          seats outside your dealership is not permitted.
        </p>
      </Section>
      <Section title="3. Permitted use and restrictions">
        <p>
          You may use the tools for your own dealership operations. You may not redistribute the installers,
          resell licenses, or use the tools to provide bulk filing/extraction services to third-party dealerships
          without a written agreement. You agree not to attempt to defeat the license enforcement.
        </p>
      </Section>
      <Section title="4. Updates and portal changes">
        <p>
          Updates are included with every active plan and ship as normal installer updates. When the VidaPay
          portal changes, we ship compatibility fixes to all plans at no charge. When the portal shows a security
          or verification step, the tool pauses and hands it to you — by design, nothing bypasses you.
        </p>
      </Section>
      <Section title="5. Your data">
        <p>
          The tools process VidaPay portal data on your PC under your login. Extracted workbooks, stored
          credentials and logs are yours and live on your machine. See the Privacy Policy for the only records
          kept outside your PC (activation/seat records in the license ledger).
        </p>
      </Section>
      <Section title="6. Trial">
        <p>
          The 7-day trial is the full software on one PC, provided &ldquo;as is&rdquo; for evaluation, with the
          same data-handling guarantees as the paid product.
        </p>
      </Section>
      <Section title="7. Termination and liability">
        <p>
          The license terminates on material breach (for example, seat sharing or redistribution); refunds follow
          the Refund Policy. Liability is limited as set out in the Terms of Service. These terms are the complete
          agreement between you and 3S Verse for the software.
        </p>
      </Section>
    </>
  );
}

function Security() {
  return (
    <>
      <Section title="Local-first architecture">
        <p>
          The tools are native Windows applications that log into VidaPay from your own store PC, under your own
          dealer login. Your portal credentials are entered on your machine and stay on your machine — there is
          no 3S Verse server that receives them, holds them or proxies them. Extracted data is written to Excel
          files on your disk.
        </p>
      </Section>
      <Section title="What leaves your PC">
        <p>
          Only two things: (1) the requests the tools make to the VidaPay portal itself, exactly like the requests
          your own browser makes when you log in — portal security or verification steps pause the tool and wait
          for you to approve them; and (2) license activation and heartbeat checks over HTTPS to the private
          license ledger (a GitHub repository), using an access token scoped to that ledger only. Machine ID,
          hostname and MAC are stored with your license record so reinstalls on the same PC are recognized.
        </p>
      </Section>
      <Section title="No telemetry">
        <p>
          No analytics, no crash reporting, no usage statistics, no advertising identifiers. The only network
          traffic is what is listed above.
        </p>
      </Section>
      <Section title="Installer integrity">
        <p>
          Every public trial build is served from a controlled GitHub repository and is re-published on a fixed
          sync schedule. The <a className="text-[#6ee7ef] hover:underline" href="#/download">Download page</a>{' '}
          shows the live SHA-256 checksum of each installer straight from that repository — verify the file you
          downloaded against it before running. Paid (FULL) builds are never publicly downloadable; they are
          delivered to paying customers through an order-number-gated request.
        </p>
        <p>
          Code signing: the installers are not yet Authenticode-signed. A code-signing certificate is on the
          roadmap; until then the SHA-256 checksums above are the verification mechanism we can stand behind.
        </p>
      </Section>
      <Section title="Updates and vulnerability reporting">
        <p>
          Updates are included with every plan and ship as normal installers — when the VidaPay portal changes,
          fixes ship to everyone at no charge. If you believe you have found a security issue in our tools,
          website or licensing system, email{' '}
          <a className="text-[#6ee7ef] hover:underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> with the details.
          We acknowledge within one US Central business day, and we will happily credit responsible reports on
          this page (with your permission).
        </p>
      </Section>
    </>
  );
}

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const meta = META[kind];
  useEffect(() => {
    document.title = `${meta.title} — 3S Verse`;
    window.scrollTo(0, 0);
  }, [kind, meta.title]);

  return (
    <div className="min-h-screen bg-[#060509] text-white">
      <header className="sticky top-0 z-10 border-b border-white/[.06] bg-[#060509]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-4xl items-center justify-between px-5">
          <a href="#/" aria-label="3S Verse — home" className="flex items-center gap-2.5">
            <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-4 w-auto" />
          </a>
          <a
            href="#/"
            data-testid="legal-back"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2 text-[12.5px] font-medium text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-14">
        <div className="font-mono-tech text-[10px] uppercase tracking-[.3em] text-[#6ee7ef]">{meta.kicker}</div>
        <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] font-light leading-[1.08] tracking-[-0.02em]">
          {meta.title}
        </h1>
        <p className="mt-4 font-mono-tech text-[10px] uppercase tracking-[.2em] text-[#8d8a9e]">
          Last updated {UPDATED} · Questions: <a className="normal-case text-[#6ee7ef] hover:underline" href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </p>

        {kind === 'privacy' && <Privacy />}
        {kind === 'terms' && <Terms />}
        {kind === 'refund' && <Refund />}
        {kind === 'eula' && <Eula />}
        {kind === 'security' && <Security />}

        <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/[.06] pt-7 font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
          <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#6ee7ef]" /> 3S Verse — operator-built software</span>
          <a href="#/download" className="transition-colors hover:text-white">Download</a>
          <a href="#/security" className="transition-colors hover:text-white">Security</a>
          <a href="#/privacy" className="transition-colors hover:text-white">Privacy</a>
          <a href="#/terms" className="transition-colors hover:text-white">Terms</a>
          <a href="#/refund" className="transition-colors hover:text-white">Refund</a>
          <a href="#/eula" className="transition-colors hover:text-white">EULA</a>
        </div>
        <p className="mt-8 text-[11.5px] font-light leading-5 text-[#6f6c80]">
          3S Verse is an independent software provider and is not affiliated with, endorsed by, or sponsored by
          VidaPay, T-CETRA, Total Wireless, or their parent companies. Product names and trademarks belong to
          their respective owners.
        </p>
      </main>
    </div>
  );
}
