/**
 * Pricing page (#/pricing) — structure follows the reference template's
 * pricing page: "pick a plan later" hero, plan cards with a
 * "This plan includes:" list, then a pricing FAQ. All numbers are computed
 * from src/lib/catalog.ts (the single source of truth the storefront and
 * the order API both use) — no hand-typed prices here.
 */
import { useState } from 'react';
import PageShell from './PageShell';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import {
  PRODUCTS,
  LAUNCH_OFFER,
  VOLUME_TIERS,
  perPcPrice,
  listPrice,
  discountPercent,
  formatUSD,
  type Product,
} from '@/lib/catalog';

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Do the tools come with a free trial?',
    a: 'Yes — every download is the full software with a 7-day trial built in. One PC, no card, no call. Run it on your own dealership data and decide with your own numbers; a license key unlocks the full version when you are ready.',
  },
  {
    q: 'What does per-PC pricing mean?',
    a: 'One PC can run every store you operate — most single-workstation dealers need exactly one license. Extra PCs are for extra workstations (a second office, a colleague\u2019s desk): each seat is a separate activation with its own key, support and updates, so volume discounts apply per PC.',
  },
  {
    q: 'Do you offer discounts?',
    a: 'Three ways. Volume: 10% off per PC from 2 seats, 20% from 5 seats, and 10+ seats are quoted as a district deal — message us. Plans: annual saves about 44% versus monthly. And launch pricing (shown on the cards) runs until Oct 31, 2026 and is honored to the minute — list prices return Nov 1, no extension.',
  },
  {
    q: 'What happens when VidaPay changes its portal?',
    a: 'Compatibility fixes ship to every active plan at no charge — that is what "every update included" means on the cards. When the portal shows a security or verification step, the tool pauses and hands it to you; nothing bypasses you, by design.',
  },
  {
    q: 'What if a tool does not work for my stores?',
    a: 'Every license carries a 30-day money-back guarantee. Email us with your order number and one line about what fell short — refunds are processed within 5 business days, back to the original payment method. No interrogation.',
  },
];

function PlanCard({ product, featured }: { product: Product; featured?: boolean }) {
  const lifetime = perPcPrice(product, 'lifetime', 1);
  const list = listPrice(product, 'lifetime', 1);
  const off = discountPercent(product, 'lifetime', 1);
  const isBundle = product.id === 'bundle';

  return (
    <div
      data-testid={`pricing-card-${product.id}`}
      className={`relative flex flex-col rounded-3xl border bg-card p-7 ${featured ? 'border-brand-cyan/70 shadow-[0_0_0_1px_rgba(110,231,239,.25),0_24px_48px_-24px_rgba(110,231,239,.18)]' : 'border-border'}`}
    >
      {featured && (
        <div className="absolute -top-3 left-7 rounded-full border border-brand-cyan/60 bg-background px-3 py-1 font-mono-tech text-[9px] uppercase tracking-[.22em] text-brand-cyan">
          Best value
        </div>
      )}
      <h2 className="text-[19px] font-medium tracking-[-0.01em]">{product.name}</h2>
      <p className="mt-1.5 min-h-[40px] text-[13.5px] font-light leading-6 text-foreground/75">{product.tagline}</p>

      <div className="mt-5 flex items-end gap-2.5">
        <span className="text-[clamp(2rem,3.4vw,2.6rem)] font-light leading-none tracking-[-0.02em]">
          {formatUSD(lifetime)}
        </span>
        <span className="pb-0.5 text-[12px] font-light text-muted-foreground">
          {isBundle ? 'one-time · all three tools' : 'one-time · per PC'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-light text-muted-foreground">
        {off > 0 ? (
          <span className="text-brand-cyan">
            Launch Offer — <s className="opacity-70">{formatUSD(list)}</s> ({off}% off)
          </span>
        ) : (
          <span>Lifetime license</span>
        )}
        <span>
          or {formatUSD(product.prices.monthly)}/mo &middot; {formatUSD(product.prices.annual)}/yr
        </span>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <div className="font-mono-tech text-[10px] uppercase tracking-[.22em] text-muted-foreground">This plan includes</div>
        <ul className="mt-3 space-y-2.5">
          {product.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-[13.5px] font-light leading-6 text-foreground/85">
              <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-cyan" /> {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex flex-col gap-2 pt-1">
        <a
          href="#tools"
          data-testid={`pricing-cta-${product.id}`}
          className="group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-5 py-3 text-[14px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8]"
        >
          Get started <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </a>
        <a href="#/download" className="text-center text-[12px] font-light text-muted-foreground transition-colors hover:text-brand-cyan">
          or download the free 7-day trial →
        </a>
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mt-24">
      <div className="mx-auto max-w-2xl text-center">
        <div className="font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">Pricing FAQ</div>
        <h2 className="mt-3 text-[clamp(1.6rem,3vw,2.4rem)] font-light leading-[1.12] tracking-[-0.02em]">
          Frequently asked questions
        </h2>
      </div>
      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="rounded-2xl border border-border bg-card" data-testid={`pricing-faq-${i}`}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-[15px] font-medium tracking-[-0.01em]">{item.q}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <p className="px-6 pb-5 text-[14px] font-light leading-7 text-foreground/75">{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
        <p className="pt-3 text-center text-[13.5px] font-light text-muted-foreground">
          Still have a question?{' '}
          <a className="text-brand-cyan hover:underline" href="mailto:Connect@3SVerse.com">Contact us</a> — we reply
          within one US Central business day.
        </p>
      </div>
    </div>
  );
}

export default function Pricing() {
  const volNote = VOLUME_TIERS.filter((t) => t.offPct > 0)
    .sort((a, b) => b.min - a.min)
    .map((t) => `${t.min}+ PCs: ${t.offPct}% off per PC`)
    .join(' · ');

  return (
    <PageShell
      title="Get started now, pick a plan later."
      kicker="Pricing"
      metaLine={<>Per-PC licensing &middot; every plan includes updates &middot; 30-day money-back guarantee</>}
      width="max-w-5xl"
    >
      <div className="mt-8 space-y-4 text-[15px] font-light leading-7 text-foreground/75">
        <p>
          Every tool below opens as a <strong className="font-medium text-foreground">free 7-day trial</strong> — the
          full software on one PC, no card needed. Buy when it has earned it: pick lifetime (one payment, yours
          forever, every update included), or monthly and annual if you prefer to spread it out. One license covers
          all the stores you operate from that PC.
        </p>
        <p>
          {LAUNCH_OFFER.active ? LAUNCH_OFFER.note : 'Launch pricing has ended — list prices below.'} {volNote}.{' '}
          Running 10 or more PCs? <a className="text-brand-cyan hover:underline" href="mailto:Connect@3SVerse.com">Message us</a> for district pricing.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {PRODUCTS.map((p) => (
          <PlanCard key={p.id} product={p} featured={p.id === 'bundle'} />
        ))}
      </div>

      <p className="mt-6 text-center text-[12.5px] font-light leading-5 text-muted-foreground">
        Prices in USD, per license. Lifetime is a one-time payment; monthly and annual renew as stated on your
        invoice and can be cancelled by replying to the invoice email before the next renewal date.
      </p>

      <Faq />
    </PageShell>
  );
}
