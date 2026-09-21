import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
/* Invoice Studio is a separate hash-route (#/invoice) used only when a
   seller opens it — landing visitors should never pay its JS cost, so it
   is code-split and fetched on demand. */
const InvoiceStudio = lazy(() => import('@/pages/InvoiceStudio'));
import DealerStore from '@/components/DealerStore';
// NOTE: /order/:id + /admin routes were removed — they depended on the
// Netlify server functions, which are dormant since the GitHub Pages deploy.
// Orders now flow through FormSubmit inside DealerStore.tsx (static-safe).
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AnimatePresence, motion, useInView, useScroll, useSpring, type Variants } from 'framer-motion';
import { useEffect, useRef, useState, lazy, Suspense, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Check,
  Clock,
  Database,
  Download,
  Eye,
  Facebook,
  Globe2,
  Instagram,
  Linkedin,
  Menu,
  Network,
  Package,
  Play,
  Plus,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Workflow,
  X,
  Zap,
  ArrowUp,
  Star,
  FileSpreadsheet,
  ShoppingCart,
  Store,
  History,
  TrendingUp,
  ClipboardCheck,
} from 'lucide-react';

const queryClient = new QueryClient();
const CONTACT_EMAIL = 'Connect@3SVerse.com';
const LINKEDIN_URL = 'https://www.linkedin.com/company/3s-verse/';
const INSTAGRAM_URL = 'https://www.instagram.com/3s.verse/';
const FACEBOOK_URL = 'https://www.facebook.com/3sverse/';
// Cloudflare Turnstile site key (public by design) — bot protection for the
// contact form. Create one free: dash.cloudflare.com → Turnstile → Add site
// (domain: 3sverse.com) → copy the Site Key here and redeploy. While it is
// empty the form renders no widget and still relies on the honeypot field.
const TURNSTILE_SITE_KEY = '';
const EXPERIENCE_START_YEAR = 2013;
const YEARS_EXPERIENCE = new Date().getFullYear() - EXPERIENCE_START_YEAR;

/* ─────────────────────────── shared bits ─────────────────────────── */

const reveal: Variants = {
  hidden: { opacity: 0, y: 34, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
};

function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-70px' });
  return (
    <motion.div ref={ref} initial="hidden" animate={inView ? 'visible' : 'hidden'} variants={reveal} transition={{ delay }} className={className}>
      {children}
    </motion.div>
  );
}

/* The template's exact 3D energy shapes — glossy swirl / torus / sphere /
   segmented ring — dropped in as transparent images on the near-black canvas.
   v1 = hero spiral, v2 = integrate torus, v3 = sphere, v4 = segmented ring.
   Each shape drifts on a slow sine float; opt-in slow rotation via `spin`. */
function Shape({ v, className = '', style, spin = 0, dir = 1, floatY = 0, floatDur = 9 }: { v: 1 | 2 | 3 | 4; className?: string; style?: CSSProperties; spin?: number; dir?: 1 | -1; floatY?: number; floatDur?: number }) {
  /* Intrinsic sizes (kept in sync with public/shapes after recompression)
     let the browser reserve space pre-load: no unsized-image jank. */
  const dims: Record<1 | 2 | 3 | 4, [number, number]> = {
    1: [900, 932],
    2: [720, 652],
    3: [640, 640],
    4: [720, 713],
  };
  const [w, h] = dims[v];
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none select-none ${className}`}
      style={style}
      animate={floatY ? { y: [-floatY, floatY, -floatY] } : undefined}
      transition={floatY ? { duration: floatDur, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <motion.img
        src={`/shapes/shape-v${v}.webp`}
        alt=""
        width={w}
        height={h}
        draggable={false}
        loading={v === 1 ? 'eager' : 'lazy'}
        fetchPriority={v === 1 ? 'high' : undefined}
        decoding="async"
        className="h-auto w-full will-change-transform"
        animate={spin ? { rotate: 360 * dir } : undefined}
        transition={spin ? { duration: spin, repeat: Infinity, ease: 'linear' } : undefined}
      />
    </motion.div>
  );
}

/* Brand cursor — custom pointer + side loop. The native arrow is hidden
   (html.bc-active) and replaced by a glowing brand point that tracks the
   pointer 1:1, swells over interactive elements, dips on press, and yields
   to the native I-beam over text fields. Just right of it, a smooth
   follower hosts the infinite 27s loop with three equal 8s phases: the
   official logo chip, a mini copy of the hero's spiral ring, and a mini
   copy of the footer's glossy orb. */

function BrandCursor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const pointerEl = pointerRef.current;
    const chipEl = chipRef.current;
    if (!root || !pointerEl || !chipEl) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.documentElement.classList.add('bc-active');

    const target = { x: -200, y: -200 };
    const follow = { x: -200, y: -200 };
    let shown = false;
    let hover = false;
    let raf = 0;
    const HOVER_SEL = 'a, button, [role="button"], label, summary, [data-cursor="hover"]';
    const TEXT_SEL = 'input, textarea';

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      target.x = event.clientX;
      target.y = event.clientY;
      // Individual `translate` (NOT `transform`): the standalone `scale` on
      // .is-hover/.is-press composes OUTSIDE the transform property, so writing
      // transform here made the dot land at scale*(x,y) — e.g. 1.9x toward the
      // bottom-right on every button/label hover. `translate` is the outermost
      // matrix, so `scale` only morphs the dot's local box, never its position.
      pointerEl.style.translate = `${target.x}px ${target.y}px`;
      if (!shown) {
        shown = true;
        follow.x = target.x;
        follow.y = target.y;
        root.style.opacity = '1';
      }
      const over = event.target instanceof Element ? event.target : null;
      const overText = !!over?.closest(TEXT_SEL);
      const overHover = !overText && !!over?.closest(HOVER_SEL);
      pointerEl.classList.toggle('is-text', overText);
      if (overHover !== hover) {
        hover = overHover;
        pointerEl.classList.toggle('is-hover', hover);
      }
    };

    const onDown = () => pointerEl.classList.add('is-press');
    const onUp = () => pointerEl.classList.remove('is-press');

    const onLeave = () => { root.style.opacity = '0'; };
    const onEnter = () => { if (shown) root.style.opacity = '1'; };

    const tick = () => {
      follow.x += (target.x - follow.x) * 0.16;
      follow.y += (target.y - follow.y) * 0.16;
      chipEl.style.transform = `translate3d(${(follow.x + 14).toFixed(1)}px, ${follow.y.toFixed(1)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.documentElement.addEventListener('mouseenter', onEnter);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('bc-active');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.documentElement.removeEventListener('mouseenter', onEnter);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden="true" className="brand-cursor-root">
      {/* custom pointer — brand-glow point that replaces the native arrow */}
      <div ref={pointerRef} className="brand-cursor-pointer" />
      {/* the 27s loop, right of the pointer: logo chip → mini hero ring → mini footer orb */}
      <div ref={chipRef} className="brand-cursor-chip-anchor will-change-transform">
        <div className="brand-cursor-fade f-chip">
          <img src="/logo-240.png" alt="" width={240} height={57} draggable={false} className="select-none" />
        </div>
        <div className="brand-cursor-fade f-ring">
          <img src="/shapes/shape-v1.webp" alt="" width={900} height={932} draggable={false} />
        </div>
        <div className="brand-cursor-fade f-orb">
          <img src="/shapes/shape-v3.webp" alt="" width={640} height={640} draggable={false} />
        </div>
      </div>
    </div>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7]"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

function ScrollTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          data-testid="button-scroll-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'instant' })}
          initial={{ opacity: 0, y: 16, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          aria-label="Scroll to top"
          className="fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#0c0b13]/85 text-[#f2f0fa] shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-[#6ee7ef]/60 hover:text-[#6ee7ef]"
        >
          <ArrowUp className="h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/* Ambient pointer spotlight. Perf-critical: this used to call setState on
   EVERY pointermove (re-rendering the tree + driving a framer-motion spring
   per event) — the single biggest main-thread cost on the page. Now it
   lerps in a requestAnimationFrame loop with direct style writes, idles
   when the pointer stops, and is disabled for touch devices and
   reduced-motion users. Visual output is unchanged. */
function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let visible = false;
    const target = { x: -700, y: -700 };
    const pos = { x: -700, y: -700 };
    const tick = () => {
      pos.x += (target.x - pos.x) * 0.14;
      pos.y += (target.y - pos.y) * 0.14;
      el.style.transform = `translate3d(${(pos.x - 320).toFixed(1)}px, ${(pos.y - 320).toFixed(1)}px, 0)`;
      raf = visible ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) {
        visible = true;
        pos.x = target.x;
        pos.y = target.y;
        el.style.opacity = '1';
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onLeave = () => {
      visible = false;
      el.style.opacity = '0';
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[20] h-[640px] w-[640px] rounded-full opacity-0 transition-opacity duration-500 will-change-transform"
      style={{
        background:
          'radial-gradient(circle, rgba(110,231,239,.10) 0%, rgba(228,75,215,.06) 42%, transparent 70%)',
        filter: 'blur(6px)',
        transform: 'translate3d(-700px, -700px, 0)',
      }}
    />
  );
}

/* GPT-X button language: crisp white rectangle (primary) + quiet outlined
   twin (secondary). Brand colors live in the glow, not the fill. */
function BtnWhite({ children, href = '#contact', testId, className = '' }: { children: ReactNode; href?: string; testId: string; className?: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      className={`group inline-flex items-center justify-center gap-2.5 rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] shadow-[0_10px_30px_rgba(255,255,255,.07)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8] hover:shadow-[0_16px_40px_rgba(247,243,232,.13)] ${className}`}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
    </a>
  );
}

function BtnGhost({ children, href = '#contact', testId, className = '' }: { children: ReactNode; href?: string; testId: string; className?: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      className={`group inline-flex items-center justify-center gap-2.5 rounded-xl border border-white/20 bg-white/[.03] px-6 py-3.5 text-[15px] font-medium tracking-tight text-[#f2f0fa] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#6ee7ef]/70 hover:text-[#6ee7ef] ${className}`}
    >
      {children}
    </a>
  );
}

/* Small uppercase mono kicker used above every section heading. */
function Kicker({ children, magenta = false }: { children: ReactNode; magenta?: boolean }) {
  return (
    <div className={`mb-6 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] ${magenta ? 'text-[#e44bd7]' : 'text-[#6ee7ef]'}`}>
      <span className="h-px w-8 bg-current opacity-60" />
      {children}
    </div>
  );
}

const MARQUEE_ITEMS = [
  'VIDAPAY INCENTIVE EXTRACTOR',
  'VIDAPAY DEVICE ORDERING',
  'WORKFLOW AUTOMATION',
  'AI AGENTS',
  'LIVE DASHBOARDS',
  'WEB & MOBILE APPS',
];

function Marquee() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="relative overflow-hidden border-y border-white/[.06] bg-[#060509] py-9">
      <div className="flex w-max animate-marquee items-center gap-20">
        {items.map((item, i) => (
          <span key={i} className="whitespace-nowrap text-[16px] font-medium uppercase tracking-[.24em] text-[#85829a] sm:text-[19px]">
            {item}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-36 bg-gradient-to-r from-[#060509] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-36 bg-gradient-to-l from-[#060509] to-transparent" />
    </div>
  );
}

const navItems = [
  { label: 'What we offer', href: '#services' },
  { label: 'How it works', href: '#how' },
  { label: 'Dealer tools', href: '#tools' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Reviews', href: '#reviews' },
];

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-white/[.06] bg-[#060509]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 lg:px-8">
        <a href="#top" data-testid="link-brand" className="shrink-0">
          <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-5 w-auto object-contain" />
        </a>
        <nav className="hidden items-center gap-9 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
              className="text-[14px] font-medium text-[#b9b6c9] transition-colors duration-300 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <BtnGhost href="#contact" testId="button-nav-contact" className="px-5 py-2.5 text-[14px]">Contact</BtnGhost>
          <BtnWhite href="#contact" testId="button-nav-get-started" className="px-5 py-2.5 text-[14px]">Let&apos;s build</BtnWhite>
        </div>
        <button
          data-testid="button-mobile-menu"
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-white/15 p-2 text-[#f2f0fa] md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-white/[.06] bg-[#0a0910] px-5 py-4 md:hidden">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} data-testid={`link-mobile-${item.label.toLowerCase().replace(/ /g, '-')}`} className="block border-b border-white/[.06] py-3.5 text-[15px] font-medium text-[#d8d5e8]">
                {item.label}
              </a>
            ))}
            <a href="#contact" onClick={() => setOpen(false)} data-testid="button-mobile-get-started" className="mt-4 block rounded-xl bg-white px-4 py-3 text-center text-[15px] font-semibold text-[#0b0a10]">Let&apos;s build</a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/* The hero app window — the template's "product screenshot" slot, dressed in
   3S Verse brand panels (cyan/magenta on near-black, DM Mono labels). */
function OpsPanel() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 44 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0a11]/95 shadow-[0_40px_120px_rgba(0,0,0,.6)]"
    >
      <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <img src="/logo-240.png" alt="" width={240} height={57} className="h-3 w-auto opacity-90" />
          <span className="font-mono-tech text-[10px] tracking-[.22em] text-[#8d8a9e]">OPERATIONS / LIVE</span>
        </div>
        <div className="flex items-center gap-3 font-mono-tech text-[10px] text-[#6ee7ef]">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70] shadow-[0_0_8px_#c7ef70]" /> SYNCED</span>
          <span className="hidden rounded-md border border-white/10 bg-white/[.04] px-2 py-0.5 text-[#d8d5e8] sm:inline">42ms</span>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
              <span>Throughput</span><span className="text-[#c7ef70]">+12.4%</span>
            </div>
            <div className="mt-2 flex items-end justify-between">
              <strong className="text-[26px] font-light tracking-tight text-white">84.7<span className="text-sm text-[#6ee7ef]">%</span></strong>
            </div>
            <div className="mt-3 flex h-14 items-end gap-1">
              {[35, 48, 40, 58, 52, 67, 61, 76, 72, 88, 82, 95].map((height, i) => (
                <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${height}%` }} transition={{ delay: 0.9 + i * 0.04, duration: 0.45 }} className={`w-full rounded-t-[2px] ${i > 8 ? 'bg-[#6ee7ef]' : 'bg-[#78a6ff]/40'}`} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
              <span>Queue health</span><span className="rounded border border-[#c7ef70]/30 px-1.5 py-0.5 text-[#c7ef70]">NORMAL</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
              <motion.div initial={{ width: 0 }} animate={{ width: '72%' }} transition={{ delay: 1.1, duration: 1 }} className="h-full rounded-full bg-gradient-to-r from-[#6ee7ef] to-[#e44bd7]" />
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono-tech text-[9px] text-[#8d8a9e]">
              <Bell className="h-3 w-3 text-[#ff9d66]" /> 2 rules executed automatically
            </div>
          </div>
        </div>
        <div className="relative rounded-xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
            <span>Flow map</span><Network className="h-3.5 w-3.5 text-[#e44bd7]" />
          </div>
          <svg viewBox="0 0 210 150" className="mt-2 h-[150px] w-full">
            <path d="M19 85 C48 85 41 42 73 42 S100 112 130 105 149 44 189 44" fill="none" stroke="#6ee7ef" strokeWidth="1.5" strokeDasharray="4 4" opacity=".85" />
            <path d="M30 20 C58 20 57 70 89 70 S124 24 158 24" fill="none" stroke="#e44bd7" strokeWidth="1" opacity=".7" />
            <path d="M24 128 C60 128 96 118 186 118" fill="none" stroke="#78a6ff" strokeWidth="1" strokeDasharray="2 5" opacity=".5" />
            {[[19, 85], [73, 42], [130, 105], [189, 44], [30, 20], [89, 70], [158, 24], [24, 128], [186, 118]].map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r="4.5" fill="#0b0a11" stroke={i % 2 ? '#e44bd7' : '#6ee7ef'} strokeWidth="1.4" />
                <circle cx={cx} cy={cy} r="1.6" fill={i % 2 ? '#e44bd7' : '#6ee7ef'} />
              </g>
            ))}
          </svg>
          <div className="flex justify-between border-t border-white/[.06] pt-2.5 font-mono-tech text-[9px] text-[#8d8a9e]">
            <span>7 active paths</span><span className="text-[#6ee7ef]">0 blocked</span>
          </div>
        </div>
      </div>
      <div className="animate-scan pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-transparent via-[#6ee7ef]/[.05] to-transparent" />
    </motion.div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-[76px]">
      {/* backdrop: faint brand grid + drifting glow dots */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="grid-tech absolute inset-x-0 top-0 h-[760px] opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="absolute left-[6%] top-[18%] h-1.5 w-1.5 rounded-full bg-[#6ee7ef] shadow-[0_0_24px_#6ee7ef] animate-pulse-line" />
        <div className="absolute right-[22%] top-[12%] h-1 w-1 rounded-full bg-[#e44bd7] shadow-[0_0_20px_#e44bd7]" />
        <div className="absolute left-[10%] bottom-[30%] h-1 w-1 rounded-full bg-[#ff9d66] shadow-[0_0_18px_#ff9d66]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pb-10 pt-20 sm:pt-24 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[1.12fr_.88fr] lg:gap-10">
          <div className="relative z-10">
            <Reveal>
              <div className="mb-7 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] text-[#6ee7ef]">
                <Sparkles className="h-3.5 w-3.5 text-[#e44bd7]" /> Software · Systems · Operations
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="text-[clamp(2.4rem,8.5vw,4.6rem)] font-light leading-[1.06] tracking-[-0.03em] text-white">
                The systems your
                <br />
                business runs on —
                <br />
                <span className="font-normal text-[#6ee7ef]">built by operators.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-8 max-w-xl text-[17px] font-light leading-8 text-[#b9b6c9]">
                Spreadsheets, copy-paste, end-of-month scrambles — that&apos;s the work we take off your hands. 3S Verse builds the custom software, web &amp; mobile apps, AI agents, live dashboards, and workflow automation modern businesses run on — cutting costs, recovering lost money, and keeping your operation moving around the clock. Behind every build: {YEARS_EXPERIENCE}+ years of real operations experience.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <BtnWhite href="#contact" testId="button-hero-get-started">Let&apos;s build something</BtnWhite>
                <a href="#services" data-testid="link-hero-explore" className="group inline-flex items-center gap-2 px-2 py-3 text-[15px] font-medium text-[#d8d5e8] transition-colors hover:text-white">
                  See what we offer
                  <ArrowDownRight className="h-4 w-4 text-[#6ee7ef] transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1" />
                </a>
              </div>
            </Reveal>
            <Reveal delay={0.32}>
              <div className="mt-14 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/[.07] pt-5 font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
                <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70]" /> {YEARS_EXPERIENCE}+ years in real operations</span>
                <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#6ee7ef]" /> $265K+ recovered for clients</span>
                <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#e44bd7]" /> Running in dealerships daily</span>
              </div>
            </Reveal>
          </div>
          {/* template's exact hero swirl — huge, bleeding off the right edge */}
          <div className="relative">
            <Shape v={1} spin={120} floatY={16} floatDur={12} className="absolute -right-[38vw] -top-40 hidden w-[820px] max-w-none opacity-90 sm:block lg:-right-[24vw] lg:-top-52 lg:w-[900px]" />
          </div>
        </div>
        {/* full-width app window, template-style */}
        <div className="relative z-10 mx-auto mt-4 max-w-5xl">
          <OpsPanel />
        </div>
      </div>
    </section>
  );
}

/* Split section — orb left, thin divider, text right (template's
   "Easily integrate our services into your product" moment). */
function IntegrateSection() {
  return (
    <section className="relative overflow-hidden py-28 lg:py-40">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[1.05fr_1px_1fr] lg:gap-0 lg:px-8">
        {/* template's exact torus — cropped off the left edge */}
        <div className="relative">
          <Shape v={2} spin={95} dir={-1} floatY={14} floatDur={10} className="w-[340px] opacity-95 sm:w-[440px] lg:-ml-24 lg:w-[560px]" />
        </div>
        <div aria-hidden="true" className="hidden w-px self-stretch bg-gradient-to-b from-transparent via-white/10 to-transparent lg:block" />
        <div className="lg:pl-20">
          <Reveal>
            <Kicker>Power your business</Kicker>
            <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
              Automation that meets the work <span className="text-[#6ee7ef]">where it happens.</span>
            </h2>
            <p className="mt-7 max-w-lg text-[16px] font-light leading-8 text-[#b9b6c9]">
              AI agents that draft, reconcile, and answer for you. Pipelines that move data between the systems you already run. No rip-and-replace, no six-month projects — we plug automation straight into VidaPay portals, spreadsheets, ERPs, and WhatsApp, and it starts saving hours from week one.
            </p>
            <div className="mt-10">
              <BtnWhite href="#contact" testId="button-integrate-start">Start a project</BtnWhite>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const features = [
  {
    index: '01',
    title: 'Process automation',
    description: 'If your team does it twice a week, it should be automated. We turn repeatable, error-prone workflows into fast, reliable pipelines — often with nothing more than a well-built script.',
    icon: Zap,
    color: 'cyan',
    detail: ['Workflow automation', 'Scripts & pipelines', 'Live in days'],
  },
  {
    index: '02',
    title: 'Web & mobile apps',
    description: 'Full-stack web and Android apps that carry real operational weight — internal tools, customer-facing products, everything in between — shipped on schedule and on budget.',
    icon: Smartphone,
    color: 'magenta',
    detail: ['Full-stack web apps', 'Android development', 'On time, on budget'],
  },
  {
    index: '03',
    title: 'Custom websites',
    description: 'Fast, responsive, conversion-driven websites that make you look as sharp as you operate — engineered to turn visitors into enquiries.',
    icon: Globe2,
    color: 'cyan',
    detail: ['Conversion-led design', 'Fast & responsive', 'Built to scale'],
  },
  {
    index: '04',
    title: 'AI agents & assistants',
    description: 'No gimmicks — AI where it saves real hours. Agents that research, draft, reconcile, and clear the busywork, so your team spends its time on decisions, not data entry.',
    icon: Bot,
    color: 'magenta',
    detail: ['Custom AI agents', 'Workflow copilots', 'Practical, not hype'],
  },
  {
    index: '05',
    title: 'Dashboards & data',
    description: 'One live view of inventory, sales, procurement, and finance — KPI dashboards that turn scattered spreadsheets into a daily operating picture your team actually trusts.',
    icon: BarChart3,
    color: 'cyan',
    detail: ['KPI dashboards', 'ERP & spreadsheet reporting', 'Live operational view'],
  },
  {
    index: '06',
    title: 'Supply chain & operations',
    description: `Our home turf — inventory planning, procurement, rebates and claims, designed by people with ${YEARS_EXPERIENCE}+ years across telecom, FMCG, and pharma. Not theorists.`,
    icon: Boxes,
    color: 'magenta',
    detail: ['Inventory & procurement', 'Claims & loss recovery', 'Multi-location operations'],
  },
];

function Services() {
  return (
    <section id="services" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>01 — What we offer</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                Every system your business needs — <span className="text-[#6ee7ef]">under one roof.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              One partner across the whole spectrum: a website that sells, apps that run your day, AI that clears the busywork, dashboards that keep score, and automation that never sleeps. Scoped in weeks, not quarters, by people who have actually run these operations.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            const accent = feature.color === 'magenta' ? '#e44bd7' : '#6ee7ef';
            return (
              <Reveal key={feature.title} delay={i * 0.07}>
                <motion.article
                  whileHover={{ y: -6 }}
                  data-testid={`card-service-${feature.index}`}
                  className="group relative h-full overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b0a11] p-8 transition-colors duration-500 hover:border-white/[.16] lg:p-10"
                >
                  <div className="absolute right-0 top-0 h-40 w-40 opacity-[.13] transition-opacity duration-500 group-hover:opacity-30" style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 68%)` }} />
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.04]" style={{ color: accent }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="font-mono-tech text-[10px] text-[#8d8a9e]/60">{feature.index}</span>
                  </div>
                  <h3 className="mt-12 text-[26px] font-light tracking-[-0.02em] text-white">{feature.title}</h3>
                  <p className="mt-4 max-w-md text-[14px] font-light leading-7 text-[#b9b6c9]">{feature.description}</p>
                  <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
                    {feature.detail.map((item) => (
                      <span key={item} className="flex items-center gap-2 font-mono-tech text-[9px] uppercase tracking-[.14em] text-[#8d8a9e]">
                        <Check className="h-3 w-3" style={{ color: accent }} /> {item}
                      </span>
                    ))}
                  </div>
                  <ArrowUpRight className="absolute bottom-9 right-9 h-5 w-5 -translate-x-2 translate-y-2 text-white/20 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-[#6ee7ef] group-hover:opacity-100" />
                </motion.article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* "Learn how it works" — numbered steps left, automation form visual right
   (template's "Train a new model AI" moment). */
function HowVisual() {
  return (
    <div className="relative mb-16 lg:mb-20">
      <div className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-[#0b0a11] p-6 shadow-[0_30px_90px_rgba(0,0,0,.45)] sm:p-8">
        <div className="flex items-center gap-3 border-b border-white/[.07] pb-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[.04] text-[#6ee7ef]"><Workflow className="h-4 w-4" /></span>
          <span className="text-[15px] font-medium text-white">Automate a workflow</span>
        </div>
        <div className="mt-5 space-y-4">
          {[
            ['Process', 'Rebates & claims intake'],
            ['Tools', 'VidaPay portal → Sheets'],
            ['Owner', 'Ops team · runs daily'],
          ].map(([label, value], i) => (
            <motion.div key={label} initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.12 }}>
              <div className="font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">{label}</div>
              <div className="mt-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-3.5 py-2.5 text-[13px] text-[#d8d5e8]">{value}</div>
            </motion.div>
          ))}
          <div className="rounded-lg border border-white/[.08] bg-white/[.03] px-3.5 py-2.5">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
              <span>Status</span>
              <span className="flex items-center gap-1.5 text-[#c7ef70]"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70] shadow-[0_0_8px_#c7ef70]" /> running</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
              <motion.div initial={{ width: 0 }} whileInView={{ width: '88%' }} viewport={{ once: true }} transition={{ delay: 0.5, duration: 1.1 }} className="h-full rounded-full bg-gradient-to-r from-[#6ee7ef] to-[#e44bd7]" />
            </div>
          </div>
        </div>
      </div>
      {/* overlapping results card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.55, duration: 0.7 }}
        className="absolute -bottom-10 -right-3 w-[240px] rounded-2xl border border-white/[.1] bg-[#0d0c14] p-5 shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:-right-8"
      >
        <div className="text-[14px] font-medium text-white">Results</div>
        <svg viewBox="0 0 200 90" className="mt-3 w-full">
          <polyline points="0,78 28,66 56,70 84,48 112,52 140,30 168,34 200,14" fill="none" stroke="#6ee7ef" strokeWidth="1.8" strokeLinejoin="round" />
          <polyline points="0,82 28,76 56,72 84,64 112,60 140,50 168,44 200,38" fill="none" stroke="#e44bd7" strokeWidth="1.2" strokeDasharray="3 3" opacity=".7" />
          <line x1="0" y1="88" x2="200" y2="88" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        </svg>
        <div className="mt-2 flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.16em] text-[#8d8a9e]">
          <span>hours saved / wk</span>
          <span className="text-[#c7ef70]">+38%</span>
        </div>
      </motion.div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ['01', 'Map the real work', 'We start where the work happens — the manual loops, the bottlenecks, the hours nobody tracks. You can’t fix what nobody has measured.'],
    ['02', 'Build the fix', 'App, website, AI, dashboard, or automation — the right build for the problem, shipped clean, documented, and live on a date we committed to.'],
    ['03', 'Keep it moving', 'Operations change, and your systems keep up. We stay close — tuning and extending what we built so it never becomes the next bottleneck.'],
  ];
  return (
    <section id="how" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-start gap-16 lg:grid-cols-[.85fr_1px_1.15fr] lg:gap-0">
          <div className="lg:pr-16">
            <Reveal>
              <Kicker magenta>02 — How it works</Kicker>
              <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                From bottleneck
                <br />
                to <span className="text-[#e44bd7]">live system</span>
                <br />
                in three moves.
              </h2>
              <div className="mt-12 space-y-10">
                {steps.map(([number, title, copy], i) => (
                  <Reveal key={number} delay={i * 0.1}>
                    <div className="border-l border-white/10 pl-6">
                      <h3 className="text-[22px] font-light tracking-[-0.01em] text-white transition-colors duration-300 hover:text-[#6ee7ef]">
                        {number}. {title}
                      </h3>
                      <p className="mt-2.5 max-w-md text-[14px] font-light leading-7 text-[#b9b6c9]">{copy}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>
          </div>
          <div aria-hidden="true" className="hidden w-px self-stretch bg-gradient-to-b from-transparent via-white/10 to-transparent lg:block" />
          <div className="lg:pl-16">
            <HowVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

/* Outcomes — template's "35+ Pages / 90+ Sections" cards: a small visual
   on top, big light number below, all in near-black rounded cards. */
function StatVisual({ kind }: { kind: 'bars' | 'rings' | 'line' }) {
  if (kind === 'bars') {
    return (
      <div className="flex h-24 items-end justify-center gap-1.5">
        {[30, 44, 38, 56, 50, 68, 62, 82, 76, 95].map((height, i) => (
          <motion.span key={i} initial={{ height: 0 }} whileInView={{ height: `${height}%` }} viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.5 }} className={`w-3 rounded-t-[3px] ${i > 7 ? 'bg-[#e44bd7]' : 'bg-white/[.16]'}`} />
        ))}
      </div>
    );
  }
  if (kind === 'rings') {
    return (
      <div className="flex h-24 items-center justify-center gap-5">
        {[52, 76, 92].map((pct, i) => (
          <svg key={i} viewBox="0 0 60 60" className="h-16 w-16">
            <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="5" />
            <motion.circle cx="30" cy="30" r="24" fill="none" stroke={i === 2 ? '#e44bd7' : '#6ee7ef'} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 150.8} 150.8`} transform="rotate(-90 30 30)" initial={{ strokeDasharray: '0 150.8' }} whileInView={{ strokeDasharray: `${(pct / 100) * 150.8} 150.8` }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15, duration: 1 }} />
          </svg>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-24 items-end justify-center">
      <svg viewBox="0 0 220 80" className="w-full max-w-[260px]">
        <polyline points="0,68 30,58 60,62 90,42 120,46 150,26 180,30 220,10" fill="none" stroke="#6ee7ef" strokeWidth="2" strokeLinejoin="round" />
        <polyline points="0,74 30,70 60,66 90,58 120,54 150,46 180,42 220,34" fill="none" stroke="#e44bd7" strokeWidth="1.4" strokeDasharray="3 3" opacity=".7" />
      </svg>
    </div>
  );
}

function Outcomes() {
  const stats = [
    { value: '$265K+', label: 'recovered in claims & losses', kind: 'bars' as const },
    { value: '$121K', label: 'vendor savings in one year', kind: 'line' as const },
    { value: '15%', label: 'inventory turnover lift', kind: 'rings' as const },
  ];
  return (
    <section id="outcomes" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>03 — Real results</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                Builds that <span className="text-[#e44bd7]">recover real money.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              No vanity metrics — numbers pulled straight from live deployments: retail operations, distribution, and multi-store programs running on systems we built.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {stats.map(({ value, label, kind }, i) => (
            <Reveal key={label} delay={i * 0.1}>
              <div data-testid={`stat-outcome-${i}`} className="group overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b0a11] transition-colors duration-500 hover:border-white/[.16]">
                <div className="px-8 pb-2 pt-10">
                  <StatVisual kind={kind} />
                </div>
                <div className="border-t border-white/[.06] px-8 py-8 text-center">
                  <div className="text-[44px] font-light leading-none tracking-[-0.03em] text-white lg:text-[52px]">{value}</div>
                  <div className="mt-3 font-mono-tech text-[10px] uppercase tracking-[.2em] text-[#8d8a9e]">{label}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Dealer tools — template's "Use cases" tabbed card, with the three VidaPay
   portal tools by their FULL names (always, everywhere). Positioned for the
   dealership's FRONT OFFICE (owner / office manager / admin staff) — these
   are back-office tools, not counter apps for sales reps. */
const TOOLS = [
  {
    id: 'extractor',
    tab: 'VidaPay Incentive Extractor',
    title: 'VidaPay Incentive Extractor',
    blurb: 'Every rebate, spiff, and incentive pulled straight out of the VidaPay portal into one clean sheet. No screenshots, no retyping, no missed dollars — built for the front office that reconciles VidaPay every week.',
    chips: [
      { icon: FileSpreadsheet, label: 'Rebate tracking' },
      { icon: ClipboardCheck, label: 'Claim matching' },
      { icon: TrendingUp, label: 'Spiff totals' },
      { icon: Database, label: 'Export ready' },
    ],
    tags: ['Rebates', 'Spiffs', 'Claims', 'One clean sheet'],
    visual: (
      <div className="rounded-xl border border-white/[.08] bg-white/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
          <span>Incentives · March</span><span className="rounded border border-[#6ee7ef]/30 px-1.5 py-0.5 text-[#6ee7ef]">EXTRACTED</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Vendor rebate — row 14', '$1,240.00'],
            ['Activation spiff — row 09', '$615.00'],
            ['Bundle bonus — row 22', '$890.00'],
          ].map(([row, amount], i) => (
            <motion.div key={row} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-white/[.07] bg-white/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-[#d8d5e8]">{row}</span>
              <span className="font-mono-tech text-[12px] text-[#6ee7ef]">{amount}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/[.07] pt-3.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">Total recovered</span>
          <span className="text-[20px] font-light tracking-tight text-white">$2,745.00</span>
        </div>
      </div>
    ),
  },
  {
    id: 'ordering',
    tab: 'VidaPay Device Ordering',
    title: 'VidaPay Device Ordering',
    blurb: 'Device orders for every branch, placed in minutes — pick the model, set per-store quantities, submit once. The front office stops babysitting the portal; wrong-SKU, wrong-store chaos is gone for good.',
    chips: [
      { icon: ShoppingCart, label: 'Bulk ordering' },
      { icon: Store, label: 'Per-store quantities' },
      { icon: History, label: 'Order history' },
      { icon: Package, label: 'Fewer errors' },
    ],
    tags: ['Bulk', 'All stores', 'One submit', 'Fewer mistakes'],
    visual: (
      <div className="rounded-xl border border-white/[.08] bg-white/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
          <span>Order · 45 stores</span><span className="rounded border border-[#e44bd7]/40 px-1.5 py-0.5 text-[#e44bd7]">DRAFT</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Galaxy S23 FE', '12 / store'],
            ['Moto G Play', '20 / store'],
            ['iPhone 13', '8 / store'],
          ].map(([device, qty], i) => (
            <motion.div key={device} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-white/[.07] bg-white/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-[#d8d5e8]">{device}</span>
              <span className="font-mono-tech text-[12px] text-[#e44bd7]">{qty}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/[.07] pt-3.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">1,340 units queued</span>
          <span className="rounded-lg bg-white px-4 py-1.5 text-[12px] font-semibold text-[#0b0a10]">Submit order</span>
        </div>
      </div>
    ),
  },
  {
    id: 'rebate',
    tab: 'VidaPay Rebate Filing',
    title: 'VidaPay Rebate Filing',
    blurb: 'Every eligible rebate filed in bulk — with per-claim status you can check any time. The money the front office used to leave on the table, now filed and tracked to the last claim.',
    chips: [
      { icon: FileSpreadsheet, label: 'Bulk filing' },
      { icon: ClipboardCheck, label: 'Templates + validation' },
      { icon: History, label: 'Per-claim status' },
      { icon: TrendingUp, label: 'Nothing missed' },
    ],
    tags: ['Rebates', 'Bulk', 'Status tracking', 'Validation'],
    visual: (
      <div className="rounded-xl border border-white/[.08] bg-white/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#8d8a9e]">
          <span>Rebate claims · Batch 12</span><span className="rounded border border-[#6ee7ef]/30 px-1.5 py-0.5 text-[#6ee7ef]">FILED</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Vendor rebates — 24 claims', 'PAID'],
            ['Activation spiffs — 41 claims', 'FILED'],
            ['Bundle bonuses — 18 claims', 'QUEUED'],
          ].map(([claim, status], i) => (
            <motion.div key={claim} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-white/[.07] bg-white/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-[#d8d5e8]">{claim}</span>
              <span className={`font-mono-tech text-[11px] ${status === 'PAID' ? 'text-[#c7ef70]' : status === 'FILED' ? 'text-[#6ee7ef]' : 'text-[#e44bd7]'}`}>{status}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/[.07] pt-3.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">83 claims this batch</span>
          <span className="text-[20px] font-light tracking-tight text-white">$9,140.00</span>
        </div>
      </div>
    ),
  },
];

function Tools() {
  const [active, setActive] = useState(0);
  const tool = TOOLS[active];
  return (
    <section id="tools" className="relative overflow-hidden py-28 lg:py-36">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-24 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[#6ee7ef]/[.05] blur-[130px]" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-12 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Kicker magenta>04 — Dealer tools</Kicker>
              <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">Built for the front office</h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              Born inside a real multi-store wireless operation — the owner&apos;s back office, not the sales counter. Commissions, ordering, and rebates run on these tools while your reps keep selling.
            </p>
          </div>
          <div className="mb-6 flex flex-wrap gap-3" role="tablist" aria-label="VidaPay tools">
            {TOOLS.map((t, i) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={active === i}
                data-testid={`tab-tool-${t.id}`}
                onClick={() => setActive(i)}
                className={`rounded-xl px-5 py-2.5 text-[14px] font-medium transition-all duration-300 ${
                  active === i
                    ? 'bg-white text-[#0b0a10] shadow-[0_10px_30px_rgba(255,255,255,.08)]'
                    : 'border border-white/20 text-[#d8d5e8] hover:border-white/50 hover:text-white'
                }`}
              >
                {t.tab}
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div data-testid="panel-tool" className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0a11] p-8 sm:p-12 lg:p-14">
            <AnimatePresence mode="wait">
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="grid items-center gap-12 lg:grid-cols-2"
              >
                <div>
                  <h3 className="text-[clamp(1.7rem,2.6vw,2.5rem)] font-light leading-[1.08] tracking-[-0.02em] text-white">{tool.title}</h3>
                  <p className="mt-5 max-w-lg text-[15px] font-light leading-7 text-[#b9b6c9]">{tool.blurb}</p>
                  <div className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4">
                    {tool.chips.map(({ icon: Icon, label }) => (
                      <span key={label} className="flex items-center gap-3 text-[13.5px] font-light text-[#d8d5e8]">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[.04] text-[#6ee7ef]"><Icon className="h-4 w-4" /></span>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  {tool.visual}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {tool.tags.map((tag) => (
                      <span key={tag} className="rounded-md border border-white/10 bg-white/[.04] px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[.16em] text-[#8d8a9e]">{tag}</span>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
        <DealerStore />
      </div>
    </section>
  );
}

/* Before/After — the manual grind vs the 3S Verse front office, side by side. */
const COMPARE_ROWS: Array<[string, string, string]> = [
  [
    'Incentive & rebate data',
    'Screenshots + retyping into Excel — hours every week, typos included',
    'One run — every rebate, spiff, and claim in a clean workbook',
  ],
  [
    'Missed money',
    'Unclaimed rebates quietly expire — $500–$2,000/month for a typical dealer',
    'Every eligible claim extracted, filed, and tracked to PAID',
  ],
  [
    'Device ordering',
    'Portal opened store by store — wrong SKU, wrong store, re-orders',
    'All branches in one guided submit — per-store quantities, zero guesswork',
  ],
  [
    'Growth',
    'More stores = proportionally more hours at the desk',
    'More stores, same minutes — the workload does not scale with the store count',
  ],
  [
    'Cost shape',
    'Labor hours you never invoice, month after month',
    'One-time license — no subscription, pays for itself within weeks',
  ],
];

function Compare() {
  return (
    <section id="compare" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-12 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Kicker>05 — Manual vs 3S Verse</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                The same week, <span className="text-[#6ee7ef]">two ways.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              Nothing theoretical — this is the exact work your front office does today, before and after the tools take it over.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0a11]">
            <div className="hidden grid-cols-[1.1fr_1.3fr_1.3fr] border-b border-white/[.07] font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e] md:grid">
              <div className="px-6 py-4">The work</div>
              <div className="border-x border-white/[.07] px-6 py-4 text-[#e44bd7]">Manual today</div>
              <div className="px-6 py-4 text-[#6ee7ef]">With 3S Verse</div>
            </div>
            {COMPARE_ROWS.map(([work, before, after], i) => (
              <div
                key={work}
                className={`grid gap-3 border-b border-white/[.05] px-6 py-5 last:border-b-0 md:grid-cols-[1.1fr_1.3fr_1.3fr] md:items-center md:gap-0 md:px-0 md:py-0 ${i % 2 ? 'bg-white/[.015]' : ''}`}
              >
                <div className="text-[14.5px] font-medium text-white md:border-r-0 md:px-6">{work}</div>
                <div className="flex items-start gap-2.5 border-white/[.07] text-[13.5px] font-light leading-6 text-[#b9b6c9] md:border-x md:border-b-0 md:px-6 md:py-5">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-[#e44bd7]" />{before}
                </div>
                <div className="flex items-start gap-2.5 text-[13.5px] font-light leading-6 text-[#d8d5e8] md:px-6 md:py-5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#6ee7ef]" />{after}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* FAQ — the questions dealers actually ask before they buy, answered in
   plain English. Native <details> accordion: zero JS cost, keyboard-safe. */
const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: 'Do the tools run under my own VidaPay login?',
    a: 'Yes. Everything runs on your own Windows PC under your own dealer login. Your VidaPay credentials stay on your machine — the tools never send them anywhere, and each license is machine-locked to the PC you activate it on.',
  },
  {
    q: 'I run multiple stores. Will it keep up?',
    a: 'That is exactly what they were built for. All three tools were born inside a real multi-store wireless operation — per-store dashboards, per-store ordering quantities, and bulk claim filing across every branch are the default, not an add-on. Pick exactly how many PCs you need when ordering: 2–4 PCs get 20% off per PC, 5–9 get 40%, and 10 or more get 50% off, applied automatically.',
  },
  {
    q: 'Is this a subscription?',
    a: 'No — and it never will be. A lifetime license is one payment and it is yours forever, updates included. There is no monthly rent, no renewal fee, no per-seat surprises. The only recurring thing here is the money you stop losing.',
  },
  {
    q: 'What is the difference between the free trial and lifetime?',
    a: 'The trial is the full software, free for 7 days on 1 PC — no card required, no feature locks. Lifetime is the same software with the clock removed: one payment, every future update, and support on WhatsApp and email.',
  },
  {
    q: 'What happens when VidaPay updates their portal?',
    a: 'Portals change — that is the reality of the job. Updates are included with every lifetime license, so when the portal moves, the tools move with it. The tools also handle the portal’s human-verification steps automatically instead of freezing mid-run.',
  },
  {
    q: 'What do I need to run it?',
    a: 'A Windows 10 or 11 PC, your VidaPay dealer login, and Excel for the outputs. That is the whole checklist — install, activate with the key we email you, and run.',
  },
  {
    q: 'How do payment and delivery work?',
    a: 'Place the order and a proper invoice opens in your browser instantly (PDF-ready, emailed to you). Pay by bank transfer, Wise, PayPal, or USDT, share the receipt, and your license keys plus download links arrive — usually within a few hours.',
  },
  {
    q: 'What if it does not work out for my dealership?',
    a: 'Every license carries a 30-day money-back guarantee. If a tool does not do what this page promises on your dealership’s data, tell us within 30 days of delivery and we refund you — no drama, no forms.',
  },
];

function Faq() {
  return (
    <section id="faq" className="relative overflow-hidden py-28 lg:py-36">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-16 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-[#e44bd7]/[.05] blur-[130px]" />
      <div className="relative mx-auto max-w-4xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-12 text-center">
            <Kicker>06 — Straight answers</Kicker>
            <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
              Questions dealers <span className="text-[#e44bd7]">actually ask.</span>
            </h2>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0b0a11]">
            {FAQ_ITEMS.map(({ q, a }, i) => (
              <details key={q} data-testid={`faq-item-${i}`} className="group border-b border-white/[.06] last:border-b-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-7 py-5 text-left transition-colors hover:bg-white/[.02] [&::-webkit-details-marker]:hidden">
                  <span className="text-[15.5px] font-medium leading-6 text-white">{q}</span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-[#6ee7ef] transition-transform duration-300 group-open:rotate-45">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                </summary>
                <p className="px-7 pb-6 pr-14 text-[14px] font-light leading-7 text-[#b9b6c9]">{a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* Reviews — template's testimonial card with highlighted phrases. */
function Reviews() {
  const reviews = [
    {
      quote: ['He rebuilt our ordering process end to end and cut the manual inventory busywork ', 'by more than half', '. Our buyers just work smarter now.'],
      name: 'Operations Director',
      org: 'Wireless Retail Group',
      initials: 'RD',
    },
    {
      quote: ['The dashboard changed how we run the business — for the first time, the whole team sees inventory, sales, and claims ', 'in one live view', '.'],
      name: 'Finance Lead',
      org: 'FMCG Distributor',
      initials: 'FK',
    },
    {
      quote: ['Fast, pragmatic, and genuinely invested. He understood our workflow before we finished explaining it and shipped something ', 'we use every day', '.'],
      name: 'General Manager',
      org: 'Multi-location Retail',
      initials: 'GM',
    },
  ];
  return (
    <section id="reviews" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>07 — Client reviews</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                People who run on <span className="text-[#6ee7ef]">3S Verse.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              From the operations leaders, finance teams, and managers who trusted us with their day-to-day.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {reviews.map((review, i) => (
            <Reveal key={review.name} delay={i * 0.1}>
              <figure data-testid={`review-${i}`} className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b0a11] p-8 transition-colors duration-500 hover:border-white/[.16] lg:p-9">
                <div>
                  <div className="flex items-center gap-1 text-[#e44bd7]" aria-label="5 out of 5 stars">
                    {Array.from({ length: 5 }).map((_, s) => <Star key={s} className="h-4 w-4 fill-current" />)}
                  </div>
                  <blockquote className="mt-6 text-[15px] font-light leading-8 text-[#c9c6d8]">
                    “{review.quote[0]}
                    <span className="rounded-md bg-white/[.1] px-1.5 py-0.5 text-white">{review.quote[1]}</span>
                    {review.quote[2]}”
                  </blockquote>
                </div>
                <figcaption className="mt-9 flex items-center gap-3.5 border-t border-white/[.07] pt-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#e44bd7]/40 bg-white/[.04] font-mono-tech text-[11px] text-[#6ee7ef]">{review.initials}</span>
                  <div>
                    <div className="text-[14px] font-medium text-white">{review.name}</div>
                    <div className="mt-0.5 font-mono-tech text-[10px] uppercase tracking-[.16em] text-[#8d8a9e]">{review.org}</div>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Project videos ────────────────────────────────────────────────────────
// PROJECT_VIDEOS — to show a project video on the page, add one entry to
// this list. `url` accepts a YouTube / YouTube Shorts / Vimeo link or a
// direct .mp4/.webm URL (local files go in public/videos/). While this list
// is empty the whole Work section (and its nav item) stays hidden. */
const PROJECT_VIDEOS: ProjectVideo[] = [];

type ProjectVideo = {
  title: string;
  blurb: string;
  tag: string;
  url: string;
  poster?: string;
};

function parseVideoSource(url: string): { kind: 'youtube' | 'vimeo' | 'file'; id?: string; src: string } {
  const trimmed = url.trim();
  let match = trimmed.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (match) return { kind: 'youtube', id: match[1], src: trimmed };
  match = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (match) return { kind: 'vimeo', id: match[1], src: trimmed };
  return { kind: 'file', src: trimmed };
}

function videoEmbedUrl(source: ReturnType<typeof parseVideoSource>): string {
  if (source.kind === 'youtube' && source.id) {
    return `https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1&rel=0&modestbranding=1`;
  }
  if (source.kind === 'vimeo' && source.id) {
    return `https://player.vimeo.com/video/${source.id}?autoplay=1&title=0&byline=0`;
  }
  return source.src;
}

function videoThumbUrl(video: ProjectVideo): string | undefined {
  if (video.poster) return video.poster;
  const source = parseVideoSource(video.url);
  return source.kind === 'youtube' && source.id ? `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg` : undefined;
}

function VideoLightbox({ video, onClose }: { video: ProjectVideo | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!video) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [video, onClose]);

  const source = video ? parseVideoSource(video.url) : null;

  return (
    <AnimatePresence>
      {video && source && (
        <motion.div
          key="video-lightbox"
          data-testid="video-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={video.title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[#060509]/95 p-4 backdrop-blur-md sm:p-8"
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="relative w-full max-w-5xl"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono-tech text-[9px] uppercase tracking-[.25em] text-[#6ee7ef]">{video.tag}</div>
                <h3 className="mt-1 truncate text-lg font-medium text-white">{video.title}</h3>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                data-testid="button-video-close"
                aria-label="Close video"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[.04] text-white transition-all duration-300 hover:border-[#6ee7ef]/60 hover:text-[#6ee7ef]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0a11] shadow-[0_36px_100px_rgba(0,0,0,.6)]">
              {source.kind === 'file' ? (
                <video key={video.url} src={source.src} controls autoPlay playsInline className="h-full w-full" />
              ) : (
                <iframe
                  key={video.url}
                  src={videoEmbedUrl(source)}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="h-full w-full"
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Work() {
  const [active, setActive] = useState<ProjectVideo | null>(null);
  if (PROJECT_VIDEOS.length === 0) return null;
  return (
    <section id="work" className="relative overflow-hidden py-28 lg:py-36">
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>See the work</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
                Watch the systems <span className="text-[#6ee7ef]">in action.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-[#b9b6c9]">
              Short walk-throughs of real builds — automation pipelines, dashboards, and tools doing their job. Click any card to play.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {PROJECT_VIDEOS.map((video, i) => {
            const thumb = videoThumbUrl(video);
            return (
              <Reveal key={video.title} delay={i * 0.1}>
                <motion.article
                  whileHover={{ y: -6 }}
                  data-testid={`video-card-${i}`}
                  className="group relative overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b0a11] transition-colors duration-500 hover:border-white/[.16]"
                >
                  <button type="button" onClick={() => setActive(video)} data-testid={`video-play-${i}`} aria-label={`Play video: ${video.title}`} className="block w-full cursor-pointer text-left">
                    <span className="relative block aspect-video overflow-hidden bg-[#0d0c14]">
                      {thumb ? (
                        <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Play className="h-8 w-8 text-[#6ee7ef]/50" />
                        </span>
                      )}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060509]/85 via-transparent to-transparent" />
                      <span className="absolute left-4 top-4 rounded-lg border border-white/15 bg-[#060509]/70 px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#6ee7ef] backdrop-blur-sm">{video.tag}</span>
                      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-[#060509]/70 text-white backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:border-[#6ee7ef]/70 group-hover:text-[#6ee7ef]">
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </span>
                      </span>
                    </span>
                  </button>
                  <div className="p-6 lg:p-7">
                    <h3 className="text-lg font-medium text-white">{video.title}</h3>
                    <p className="mt-2 text-[14px] font-light leading-6 text-[#b9b6c9]">{video.blurb}</p>
                  </div>
                </motion.article>
              </Reveal>
            );
          })}
        </div>
      </div>
      <VideoLightbox video={active} onClose={() => setActive(null)} />
    </section>
  );
}

/* ── Cloudflare Turnstile (contact-form bot protection) ──────────────────── */
type TurnstileRenderParams = {
  sitekey: string;
  theme?: 'light' | 'dark' | 'auto';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, params: TurnstileRenderParams) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      turnstileScriptPromise = null;
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || containerRef.current === null) return;
    let cancelled = false;
    let widgetId: string | null = null;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || containerRef.current === null || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        });
      })
      .catch(() => { /* widget unavailable — the honeypot still guards the form */ });
    return () => {
      cancelled = true;
      try {
        if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
      } catch { /* already gone */ }
    };
  }, []);

  return <div ref={containerRef} className="mt-5" data-testid="turnstile-widget" />;
}

function Contact() {
  const [form, setForm] = useState({ name: '', email: '', organization: '', locations: '2–5 stores', interest: 'Dealer tools (Extractor / Ordering / Rebate)', message: '', website: '' });
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [serverNote, setServerNote] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [cfResetCount, setCfResetCount] = useState(0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (TURNSTILE_SITE_KEY && !cfToken) {
      setSubmitStatus('error');
      setServerNote('complete the verification box first');
      return;
    }
    setSubmitStatus('sending');
    setServerNote('');

    // Static hosting (GitHub Pages) has no server functions, so the form
    // posts through FormSubmit, which emails the same inbox
    // (Connect@3SVerse.com) the old /api/contact Netlify function targeted.
    // First-ever submission sends a one-time activation link to that inbox.
    // Primary path is AJAX for an inline success state; if the relay's
    // edge blocks the cross-origin call for a visitor, we fall back to a
    // classic full-page POST (no CORS involved) that redirects back with
    // ?sent=1 so the UI can still show the success message.
    const oneline = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    const cleanName = oneline(form.name).slice(0, 120);
    const cleanOrganization = oneline(form.organization).slice(0, 160);
    const cleanEmail = form.email.trim().slice(0, 254);
    const cleanMessage = form.message.trim().slice(0, 5000);
    const fields: Record<string, string> = {
      name: cleanName,
      email: cleanEmail,
      organization: cleanOrganization,
      locations: form.locations,
      interest: form.interest,
      message: cleanMessage,
      _subject: `New inquiry — ${cleanName}${cleanOrganization ? ` (${cleanOrganization})` : ''} · ${form.locations}`,
      _template: 'table',
      _captcha: 'false',
      _replyto: cleanEmail,
      _honey: form.website,
      ...(cfToken ? { 'cf-turnstile-response': cfToken } : {}),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      let payload: { success?: string; message?: string } | null = null;
      try {
        response = await fetch('https://formsubmit.co/ajax/connect@3sverse.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
          signal: controller.signal,
        });
        payload = (await response.json().catch(() => null)) as { success?: string; message?: string } | null;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok || payload?.success !== 'true') {
        setServerNote(payload?.message ?? '');
        throw new Error('Contact submission failed');
      }

      setForm({ name: '', email: '', organization: '', locations: '2–5 stores', interest: 'Dealer tools (Extractor / Ordering / Rebate)', message: '', website: '' });
      setCfToken('');
      setCfResetCount((count) => count + 1);
      setSubmitStatus('success');
    } catch {
      // Relay unreachable — never lose the inquiry: hand it to the visitor's
      // own email client with the message pre-filled.
      try {
        const subject = encodeURIComponent(fields._subject);
        const body = encodeURIComponent(
          `Name: ${form.name}\nEmail: ${form.email}\nOrganization: ${form.organization || '—'}\nLocations: ${form.locations}\nInterested in: ${form.interest}\n\n${form.message}`,
        );
        window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
        setServerNote('your email app just opened with the message pre-filled — press send there');
        setCfToken('');
        setCfResetCount((count) => count + 1);
        setSubmitStatus('error');
      } catch {
        setSubmitStatus('error');
      }
    }
  };

  return (
    <section id="contact" className="relative overflow-hidden py-28 lg:py-40">
      {/* template CTA glow behind the heading */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-10 h-[380px] w-[680px] -translate-x-1/2 rounded-full bg-[#e44bd7]/[.07] blur-[120px]" />
      <Shape v={3} spin={140} floatY={12} floatDur={13} className="absolute -right-40 -top-24 hidden w-[460px] opacity-30 lg:block" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <div className="mb-6 flex items-center justify-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] text-[#6ee7ef]">
              <Sparkles className="h-3.5 w-3.5 text-[#e44bd7]" /> Ready when you are
            </div>
            <h2 className="text-[clamp(2.4rem,4.6vw,4rem)] font-light leading-[1.05] tracking-[-0.02em] text-white">
              Bring us the <span className="text-[#6ee7ef]">bottleneck.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-[16px] font-light leading-8 text-[#b9b6c9]">
              Dealer tools for your front office, a website, an app, an AI agent, or a workflow that should have been automated years ago — two clicks below tells us where the hours go, and we&apos;ll show you how to get them back.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <form onSubmit={handleSubmit} data-testid="form-contact" className="relative mx-auto max-w-2xl rounded-3xl border border-white/[.08] bg-[#0b0a11] p-7 shadow-[0_30px_100px_rgba(0,0,0,.5)] sm:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="contact-website">Leave this field empty</label>
              <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
                Name
                <input required maxLength={120} name="name" value={form.name} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-name" className="mt-2 w-full rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors placeholder:text-[#8d8a9e]/50 focus:border-[#6ee7ef]/70" placeholder="Your name" />
              </label>
              <label className="block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
                Email
                <input required maxLength={254} type="email" name="email" value={form.email} onChange={(event) => { setForm((current) => ({ ...current, email: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-email" autoComplete="email" className="mt-2 w-full rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors placeholder:text-[#8d8a9e]/50 focus:border-[#6ee7ef]/70" placeholder="you@company.com" />
              </label>
              <label className="block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e] sm:col-span-2">
                Organization
                <input required maxLength={160} name="organization" value={form.organization} onChange={(event) => { setForm((current) => ({ ...current, organization: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-organization" className="mt-2 w-full rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors placeholder:text-[#8d8a9e]/50 focus:border-[#6ee7ef]/70" placeholder="Company or organization" />
              </label>
              <label className="block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
                Locations you run
                <select name="locations" value={form.locations} onChange={(event) => { setForm((current) => ({ ...current, locations: event.target.value })); setSubmitStatus('idle'); }} data-testid="select-contact-locations" className="mt-2 w-full appearance-none rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors focus:border-[#6ee7ef]/70">
                  <option className="bg-[#0b0a11]">Just exploring</option>
                  <option className="bg-[#0b0a11]">1 store</option>
                  <option className="bg-[#0b0a11]">2–5 stores</option>
                  <option className="bg-[#0b0a11]">6–15 stores</option>
                  <option className="bg-[#0b0a11]">16+ stores</option>
                </select>
              </label>
              <label className="block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
                I&apos;m interested in
                <select name="interest" value={form.interest} onChange={(event) => { setForm((current) => ({ ...current, interest: event.target.value })); setSubmitStatus('idle'); }} data-testid="select-contact-interest" className="mt-2 w-full appearance-none rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors focus:border-[#6ee7ef]/70">
                  <option className="bg-[#0b0a11]">Dealer tools (Extractor / Ordering / Rebate)</option>
                  <option className="bg-[#0b0a11]">Custom software / automation</option>
                  <option className="bg-[#0b0a11]">Website or app</option>
                  <option className="bg-[#0b0a11]">Something else</option>
                </select>
              </label>
            </div>
            <label className="mt-5 block font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
              Message
              <textarea required maxLength={5000} name="message" value={form.message} onChange={(event) => { setForm((current) => ({ ...current, message: event.target.value })); setSubmitStatus('idle'); }} data-testid="textarea-contact-message" rows={5} className="mt-2 w-full resize-y rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-white outline-none transition-colors placeholder:text-[#8d8a9e]/50 focus:border-[#6ee7ef]/70" placeholder="What should we automate first?" />
            </label>
            {TURNSTILE_SITE_KEY && <TurnstileWidget key={cfResetCount} onToken={setCfToken} />}
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button type="submit" disabled={submitStatus === 'sending'} data-testid="button-contact-submit" className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8] disabled:cursor-wait disabled:opacity-70">
                {submitStatus === 'sending' ? 'Sending...' : 'Send message'}
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </button>
              <span aria-live="polite" className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-[#8d8a9e]">
                {submitStatus === 'success' ? 'Message sent — we’ll be in touch.' : submitStatus === 'error' ? `${serverNote || 'Couldn’t send'}. Email ${CONTACT_EMAIL} directly.` : 'We reply to every message.'}
              </span>
            </div>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  // Footer visit counter — static hosting has no server, so the count lives
  // on the free Abacus counter API (CountAPI-compatible). One GET /hit per
  // browser session (sessionStorage guard), read-only GET /get on revisits
  // so refreshes never inflate the count. Degrades gracefully — any failure
  // simply leaves the counter hidden.
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const counted = (() => {
      try { return window.sessionStorage.getItem('3s-verse-counted') === '1'; } catch { return false; }
    })();
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        let response: Response;
        try {
          response = await fetch(
            `https://abacus.jasoncameron.dev/${counted ? 'get' : 'hit'}/3sversecom/visits`,
            { method: 'GET', signal: controller.signal },
          );
        } finally {
          clearTimeout(timeoutId);
        }
        const payload = (await response.json().catch(() => null)) as { value?: unknown } | null;
        const count = typeof payload?.value === 'number' && Number.isFinite(payload.value) && payload.value >= 0 ? payload.value : null;
        if (!cancelled && count !== null) setVisits(count);
        if (!counted && response.ok) {
          try { window.sessionStorage.setItem('3s-verse-counted', '1'); } catch { /* storage unavailable */ }
        }
      } catch { /* counter is cosmetic — stay hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <footer className="border-t border-white/[.06] bg-[#060509]">
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-5 w-auto" />
            <p className="mt-5 text-[14px] font-light leading-7 text-[#b9b6c9]">
              Software, systems &amp; operations — apps, websites, AI agents, dashboards, and process automation, built by people who have run the operations themselves.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-14 gap-y-8">
            <div>
              <div className="font-mono-tech text-[10px] uppercase tracking-[.22em] text-[#8d8a9e]">Explore</div>
              <div className="mt-4 flex flex-col gap-2.5">
                {navItems.map((item) => (
                  <a key={item.href} href={item.href} className="text-[14px] font-light text-[#c9c6d8] transition-colors hover:text-[#6ee7ef]">{item.label}</a>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono-tech text-[10px] uppercase tracking-[.22em] text-[#8d8a9e]">Follow</div>
              <div className="mt-4 flex items-center gap-4">
                <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-linkedin" aria-label="3S Verse on LinkedIn" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-[#c9c6d8] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#6ee7ef]/60 hover:text-[#6ee7ef]"><Linkedin className="h-4 w-4" /></a>
                <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-instagram" aria-label="3S Verse on Instagram" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-[#c9c6d8] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#e44bd7]/60 hover:text-[#e44bd7]"><Instagram className="h-4 w-4" /></a>
                <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-facebook" aria-label="3S Verse on Facebook" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-[#c9c6d8] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#78a6ff]/60 hover:text-[#78a6ff]"><Facebook className="h-4 w-4" /></a>
              </div>
              <a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-footer-email" className="animate-jiggle mt-5 inline-block bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text font-mono-tech text-[11px] tracking-wider text-transparent">{CONTACT_EMAIL}</a>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/[.06] pt-7 font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#8d8a9e]">
          <span>3S Verse {new Date().getFullYear()} © — All rights reserved</span>
          <div className="flex items-center gap-6">
            {visits !== null && (
              <span data-testid="footer-visits" className="inline-flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-[#6ee7ef]" />{visits.toLocaleString('en-US')} visitors
              </span>
            )}
            <a href="#/invoice" data-testid="link-footer-invoice" className="transition-colors hover:text-white" title="Invoice Studio (seller)">Invoice</a>
            <a href="#top" data-testid="link-footer-top" className="transition-colors hover:text-white">Back to top ↑</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function Home() {
  // Safety net for "always start on the hero": some engines restore the
  // scroll position asynchronously after load, and a layout shift can also
  // move the viewport before the first paint settles. The pre-paint script
  // in index.html runs first; this re-asserts the same state after mount.
  //
  // Chrome additionally completes the initial fragment navigation
  // asynchronously: opening /#services directly scrolls to the section and
  // re-writes the hash AFTER mount. We neutralize that for a short window
  // after load. Real user navigation is untouched — a click/keypress is
  // required to reach an anchor link, and that interaction disables the
  // neutralizer before the hashchange event can fire.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const stripToHero = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    stripToHero();
    let userInteracted = false;
    const markInteraction = () => { userInteracted = true; };
    const onEarlyHashChange = () => { if (!userInteracted) stripToHero(); };
    window.addEventListener('pointerdown', markInteraction, { capture: true, once: true });
    window.addEventListener('keydown', markInteraction, { capture: true, once: true });
    window.addEventListener('hashchange', onEarlyHashChange);
    const stop = window.setTimeout(() => window.removeEventListener('hashchange', onEarlyHashChange), 2000);
    return () => {
      window.clearTimeout(stop);
      window.removeEventListener('hashchange', onEarlyHashChange);
      window.removeEventListener('pointerdown', markInteraction, { capture: true });
      window.removeEventListener('keydown', markInteraction, { capture: true });
    };
  }, []);

  // Mobile fix: native fragment navigation is unreliable on mobile browsers —
  // the hash updates but scrollY stays 0 (reproduced: Contact from the mobile
  // menu never reached the form), and where native scroll does work the
  // section lands beneath the fixed 76px header. All in-page anchor links are
  // now scrolled from JS with a header offset; CSS scroll-padding-top +
  // section scroll-margin-top (index.css) covers the remaining native paths.
  // Load/refresh behavior stays with the neutralizer above (always hero).
  useEffect(() => {
    const HEADER_OFFSET = 92;
    const scrollToHash = (hash: string): boolean => {
      const id = hash.replace(/^#/, '');
      if (!id) return false;
      const el = document.getElementById(id);
      if (!el) return false;
      const top = id === 'top' ? 0 : Math.max(0, el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET);
      window.scrollTo({ top, behavior: 'smooth' });
      return true;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const anchor = target && target.closest ? (target.closest('a[href^="#"]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      // Hash-routed app views (e.g. #/invoice) need native fragment
      // navigation so the hashchange event fires and App() can remount.
      if (href.startsWith('#/')) return;
      // A smooth scroll started in the same tick as the mobile menu's exit
      // animation gets canceled before it moves (reproduced: scrollY stayed
      // 0). Update the URL instantly, then scroll — immediately for normal
      // links, and only after the menu has closed for header (mobile menu)
      // links.
      e.preventDefault();
      if (window.history && history.replaceState) history.replaceState(null, '', href);
      if (anchor.closest('header')) {
        window.setTimeout(() => scrollToHash(href), 320);
      } else {
        scrollToHash(href);
      }
    };
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('click', onClick); };
  }, []);
  return (
    <div className="noise min-h-[100dvh] overflow-x-clip bg-[#060509]">
      <ScrollProgress />
      <Spotlight />
      <ScrollTop />
      <BrandCursor />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <IntegrateSection />
        <Services />
        <HowItWorks />
        <Outcomes />
        <Tools />
        <Compare />
        <Reviews />
        <Faq />
        <Work />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // #/invoice — seller-only Invoice Studio, hash-routed so it stays
  // static-safe on GitHub Pages (no SPA fallback needed for deep links).
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  if (hash.startsWith('#/invoice')) {
    return (
      <Suspense fallback={
        <div className="grid min-h-screen place-items-center bg-[#090D26] text-sm text-white/60" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          Loading Invoice Studio…
        </div>
      }>
        <InvoiceStudio />
      </Suspense>
    );
  }
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
