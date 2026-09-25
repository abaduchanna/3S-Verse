/**
 * About page (#/about) — structure follows the reference template's About:
 * mission hero + "how we work" value cards + a meet-the-products grid +
 * a closing CTA. Content stays strictly accurate to how 3S Verse actually
 * operates (operator-built, local-first, no invented team members).
 */
import PageShell from './PageShell';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PRODUCTS } from '@/lib/catalog';

const VALUES: Array<{ title: string; body: string }> = [
  {
    title: 'Commitment',
    body: 'When a VidaPay portal change breaks a tool, the fix ships to every active plan at no charge — and if we cannot fix it within 30 days of your report, your refund window pauses until we do. Support replies within one US Central business day.',
  },
  {
    title: 'Ownership',
    body: 'Your data lives on your machines. Your licenses are machine-locked to the PCs you bought them for, every workbook the tools produce is yours to keep, and uninstalling removes everything — there is no 3S Verse server holding your dealership data.',
  },
  {
    title: 'Openness',
    body: 'No telemetry, no hidden installers, no invented reviews. Installer checksums are published so you can verify every download, policies are written in plain English, and the limits of the tools are stated before you pay — not after.',
  },
  {
    title: 'Innovation',
    body: 'Every tool started as a fix for a real store\u2019s weekly grind. Dealers ask, we build, updates ship. The pause-for-verification design exists because automation that bypasses portal security is automation nobody can trust.',
  },
];

function SectionHead({ kicker, title, lede }: { kicker: string; title: string; lede: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">{kicker}</div>
      <h2 className="mt-3 text-[clamp(1.6rem,3vw,2.4rem)] font-light leading-[1.12] tracking-[-0.02em]">{title}</h2>
      <p className="mt-4 text-[15px] font-light leading-7 text-foreground/75">{lede}</p>
    </div>
  );
}

export default function About() {
  return (
    <PageShell
      title="Our mission is to hand VidaPay dealers their hours back."
      kicker="About 3S Verse"
      metaLine={<>Operator-built software &middot; Questions: <a className="normal-case text-brand-cyan hover:underline" href="mailto:Connect@3SVerse.com">Connect@3SVerse.com</a></>}
    >
      {/* Mission lede — template's hero paragraph slot */}
      <div className="mt-8 space-y-4 text-[15px] font-light leading-7 text-foreground/75">
        <p>
          3S Verse exists because wireless retail runs on hours nobody budgets for: pulling incentive data store
          by store, retyping IMEIs into Excel, filing rebates one claim at a time. We build the software we wished
          existed when we were running those floors ourselves — tools that log into the VidaPay portal the way you
          do, do the repetitive part precisely, and hand you a clean workbook while you get on with the store.
        </p>
        <p>
          We are an independent software provider, not a portal vendor and not a reseller middleman. That single
          fact shapes everything: the tools run on your PC under your own dealer login, they pause for every
          security step instead of bypassing it, and the only records we keep are the license activations that
          let us enforce one-license-per-seat fairly.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href="#tools"
          data-testid="about-cta-tools"
          className="group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8]"
        >
          Explore the dealer tools <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </a>
        <a
          href="#/pricing"
          data-testid="about-cta-pricing"
          className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-input px-6 py-3.5 text-[15px] font-medium text-foreground transition-colors hover:border-brand-cyan/70 hover:text-brand-cyan"
        >
          See pricing
        </a>
      </div>

      {/* How we work — template's four value cards */}
      <div className="mt-24">
        <SectionHead
          kicker="How we work"
          title="Four rules we do not bend."
          lede="Policies only mean something when they cost the company something. These are ours — stated once, kept everywhere."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-3xl border border-border bg-card p-7" data-testid={`about-value-${v.title.toLowerCase()}`}>
              <div className="font-mono-tech text-[11px] uppercase tracking-[.24em] text-brand-cyan">{v.title}</div>
              <p className="mt-3 text-[14px] font-light leading-6 text-foreground/75">{v.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Meet the products — template's "Meet our team" slot, honestly filled */}
      <div className="mt-24">
        <SectionHead
          kicker="What we build"
          title="Meet the tools."
          lede="Three VidaPay workflow tools and one bundle — plus the custom automation work that pays for this site's honesty policy."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {PRODUCTS.map((p) => (
            <a
              key={p.id}
              href="#/pricing"
              data-testid={`about-product-${p.id}`}
              className="group rounded-3xl border border-border bg-card p-7 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-cyan/60"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[17px] font-medium tracking-[-0.01em]">{p.name}</h3>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-cyan" />
              </div>
              <p className="mt-2 text-[13.5px] font-light leading-6 text-foreground/75">{p.tagline}</p>
            </a>
          ))}
          <div className="rounded-3xl border border-dashed border-input bg-foreground/[.015] p-7 sm:col-span-2">
            <h3 className="text-[17px] font-medium tracking-[-0.01em]">Custom dealership automation</h3>
            <p className="mt-2 text-[13.5px] font-light leading-6 text-foreground/75">
              Websites, internal dashboards, portal automations and data pipelines — scoped individually and
              delivered to the same standard. If your store does it manually every week,{' '}
              <a className="text-brand-cyan hover:underline" href="mailto:Connect@3SVerse.com">tell us about it</a>.
            </p>
          </div>
        </div>
      </div>

      {/* Closing CTA — template's "Join our team" slot */}
      <div className="mt-24 rounded-3xl border border-border bg-gradient-to-br from-card via-card to-card p-8 sm:p-12">
        <h2 className="text-[clamp(1.6rem,3vw,2.4rem)] font-light leading-[1.12] tracking-[-0.02em]">
          Built by operators, priced for dealers.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] font-light leading-7 text-foreground/75">
          Every license starts the same way: download the tool, run it on your own dealership data for seven days,
          and decide with your own numbers. No demos gated behind calls, no card for the trial — the software has
          to earn the key.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#/download"
            data-testid="about-cta-download"
            className="group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8]"
          >
            Start with a free trial <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </a>
          <a
            href="#/terms"
            className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-input px-6 py-3.5 text-[15px] font-medium text-foreground transition-colors hover:border-brand-cyan/70 hover:text-brand-cyan"
          >
            Read the terms
          </a>
        </div>
      </div>
    </PageShell>
  );
}
