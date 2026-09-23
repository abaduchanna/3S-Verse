import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
/* Invoice Studio is a separate hash-route (#/invoice) used only when a
   seller opens it — landing visitors should never pay its JS cost, so it
   is code-split and fetched on demand. */
const InvoiceStudio = lazy(() => import('@/pages/InvoiceStudio'));
const OrderStatusPage = lazy(() => import('@/pages/OrderStatus'));
/* Policy, security and download pages — same hash-routing pattern so they
   stay static-safe on GitHub Pages; deep links like /privacy redirect
   via the inline script in index.html (404.html SPA fallback). */
const LegalPage = lazy(() => import('@/pages/Legal'));
const DownloadPage = lazy(() => import('@/pages/DownloadPage'));
import DealerStore from '@/components/DealerStore';
// NOTE: /order/:id + /admin routes were removed — they depended on the
// Netlify server functions, which are dormant since the GitHub Pages deploy.
// Orders now flow through FormSubmit inside DealerStore.tsx (static-safe).
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AnimatePresence, motion, useInView, useScroll, useSpring, type Variants } from 'framer-motion';
import { useEffect, useRef, useState, lazy, Suspense, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Calculator,
  Check,
  Clock,
  Database,
  Download,
  Facebook,
  Globe2,
  Instagram,
  Linkedin,
  Menu,
  MessageCircle,
  Network,
  Package,
  Play,
  PlayCircle,
  Plus,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Moon,
  Workflow,
  X,
  Youtube,
  Zap,
  ArrowUp,
  Star,
  FileSpreadsheet,
  ShoppingCart,
  Store,
  History,
  TrendingUp,
  ClipboardCheck,
  BookOpen,
  MonitorSmartphone,
  Undo2,
  KeyRound,
  CreditCard,
  UserCheck,
} from 'lucide-react';
import {
  PRODUCTS,
  REVIEWS,
  VIDEO_DEMO,
  YOUTUBE_URL,
  formatUSD,
  perPcPrice,
  whatsappLink,
  PAID_DOWNLOAD,
  TURNSTILE_SITE_KEY,
  type DealerReview,
} from '@/lib/catalog';
import { trialDownloadUrl } from '@/lib/catalog';
import { TurnstileWidget } from '@/components/TurnstileWidget';

const queryClient = new QueryClient();
const CONTACT_EMAIL = 'Connect@3SVerse.com';
// Canonical LinkedIn company URL — /company/3s-verse 301-redirects here.
// Keep the canonical form so auditors/crawlers never see a redirect chain.
const LINKEDIN_URL = 'https://www.linkedin.com/company/3sverse';
const INSTAGRAM_URL = 'https://www.instagram.com/3s.verse/';
const FACEBOOK_URL = 'https://www.facebook.com/3sverse/';
// Cloudflare Turnstile site key lives in src/lib/catalog.ts (single source
// of truth — the download/trial routing switches on it too). While it is
// empty the contact form renders no widget and still relies on the honeypot
// field, and posts straight to FormSubmit instead of the worker relay.
const EXPERIENCE_START_YEAR = 2013;
const YEARS_EXPERIENCE = new Date().getFullYear() - EXPERIENCE_START_YEAR;

/* ─────────────────────────── shared bits ─────────────────────────── */

/* ── Theme (light/dark) — default dark, persisted in localStorage.
   The inline boot script in index.html applies the stored choice before
   first paint by toggling the `dark` class on <html>; the toggle below
   keeps React state in sync with that class and writes the choice back. */
type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = '3sv-theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#060509', light: '#fcfbfe' };

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch { /* private mode — choice stays session-only */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/* ── Theme water-swipe — the toggle press floods the NEW theme out of the
   button as a soft-feathered circle of water (View Transitions API — the
   effect from the original 3S Verse site, restored). The wavefront is pure
   CSS (index.css): a 2.5s feathered radial mask expanding from
   --water-x/--water-y, the exact center of the toggle button (top right).
   Browsers with View Transitions but without @property get a hard-edged
   clip-path reveal driven here; browsers without the API (or reduced-motion
   users) flip instantly. */
let waterOrigin = { x: 0, y: 0, r: 0 };

function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const root = document.documentElement;
    // Skip when the class already matches (first mount / external sync).
    if (root.classList.contains('dark') === (theme === 'dark')) return;
    const apply = () => applyTheme(theme);
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => {
        ready?: Promise<void>;
        finished?: Promise<unknown>;
      };
    };
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (doc.startViewTransition && !reducedMotion) {
      try {
        const transition = doc.startViewTransition(apply);
        // Browsers can intentionally skip a transition when another one is
        // already in progress — expected, must not hit the error overlay.
        transition.finished?.catch(() => undefined);
        // @property-capable browsers run the feathered mask wavefront in
        // CSS (index.css); older ones get this hard-edged clip-path reveal.
        if (transition.ready && !('CSSPropertyRule' in window)) {
          transition.ready
            .then(() =>
              document.documentElement.animate(
                {
                  clipPath: [
                    `circle(0px at ${waterOrigin.x}px ${waterOrigin.y}px)`,
                    `circle(${waterOrigin.r}px at ${waterOrigin.x}px ${waterOrigin.y}px)`,
                  ],
                },
                {
                  duration: 2500,
                  easing: 'cubic-bezier(0.3, 0, 0.15, 1)',
                  pseudoElement: '::view-transition-new(root)',
                },
              ),
            )
            .catch(() => undefined);
        }
      } catch {
        apply();
      }
    } else apply();
  }, [theme]);
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // The water bursts from the toggle button itself (top right): its
    // center feeds --water-x/--water-y and the wavefront grows from there.
    waterOrigin = {
      x, y,
      r: Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)),
    };
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--water-x', `${Math.round(x)}px`);
    rootStyle.setProperty('--water-y', `${Math.round(y)}px`);
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      data-testid="button-theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={className}
    >
      {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </button>
  );
}

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
  /* Same electric render in both themes — but v1/v2 carry thin transparent
     tears inside the trail body that blend into the dark canvas yet read
     as torn holes ("cheed") on the white one. The light theme therefore
     uses the -solid variants (tears diffusion-filled + boundary
     solidified — scripts/solidify.py); v3 is already fully solid so both
     themes share the original. CSS swaps the pair via html.dark.
     ?v busts caches. */
  const solid = v === 1 || v === 2;
  const img = (variant: 'dark' | 'light') => (
    <motion.img
      src={`/shapes/shape-v${v}${variant === 'light' && solid ? '-solid' : ''}.webp${variant === 'light' && solid ? '?v=7' : ''}`}
      alt=""
      width={w}
      height={h}
      draggable={false}
      loading={v === 1 ? 'eager' : 'lazy'}
      fetchPriority={v === 1 ? 'high' : undefined}
      decoding="async"
      className={`shape-img shape-img-${variant} h-auto w-full will-change-transform`}
      animate={spin ? { rotate: 360 * dir } : undefined}
      transition={spin ? { duration: spin, repeat: Infinity, ease: 'linear' } : undefined}
    />
  );
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none select-none ${className}`}
      style={style}
      animate={floatY ? { y: [-floatY, floatY, -floatY] } : undefined}
      transition={floatY ? { duration: floatDur, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {img('dark')}
      {img('light')}
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
          <img src="/shapes/shape-v1.webp" alt="" width={900} height={932} draggable={false} className="shape-img-dark" />
          <img src="/shapes/shape-v1-solid.webp?v=7" alt="" width={900} height={932} draggable={false} className="shape-img-light" />
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
          className="fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-input bg-card/85 text-foreground shadow-[0_10px_30px_rgba(0,0,0,.18)] dark:shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-brand-cyan/60 hover:text-brand-cyan"
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
      className={`group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] shadow-[0_10px_30px_rgba(255,255,255,.07)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8] hover:shadow-[0_16px_40px_rgba(247,243,232,.13)] ${className}`}
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
      className={`group inline-flex items-center justify-center gap-2.5 rounded-xl border border-input bg-foreground/[.03] px-6 py-3.5 text-[15px] font-medium tracking-tight text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-cyan/70 hover:text-brand-cyan ${className}`}
    >
      {children}
    </a>
  );
}

/* Small uppercase mono kicker used above every section heading. */
function Kicker({ children, magenta = false }: { children: ReactNode; magenta?: boolean }) {
  return (
    <div className={`mb-6 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] ${magenta ? 'text-brand-magenta' : 'text-brand-cyan'}`}>
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
    <div className="relative overflow-hidden border-y border-border bg-background py-9">
      <div className="flex w-max animate-marquee items-center gap-20">
        {items.map((item, i) => (
          <span key={i} className="whitespace-nowrap text-[16px] font-medium uppercase tracking-[.24em] text-muted-foreground sm:text-[19px]">
            {item}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-36 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-36 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

const navItems = [
  { label: 'What we offer', href: '#services' },
  { label: 'How it works', href: '#how' },
  { label: 'Dealer tools', href: '#tools' },
  { label: 'Guides', href: '#guides' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Trust & Guarantees', href: '#reviews' },
];

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-border bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 lg:px-8">
        <a href="#top" data-testid="link-brand" aria-label="3S Verse — back to top" className="shrink-0">
          <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-5 w-auto object-contain" />
        </a>
        <nav className="hidden items-center gap-9 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
              className="text-[14px] font-medium text-foreground/75 transition-colors duration-300 hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle className="flex h-10 w-10 items-center justify-center rounded-xl border border-input text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan" />
          <BtnGhost href="#contact" testId="button-nav-contact" className="px-5 py-2.5 text-[14px]">Contact</BtnGhost>
          <BtnWhite href="#contact" testId="button-nav-get-started" className="px-5 py-2.5 text-[14px]">Let&apos;s build</BtnWhite>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle className="flex h-10 w-10 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan" />
          <button
            data-testid="button-mobile-menu"
            onClick={() => setOpen(!open)}
            className="rounded-lg border border-input p-2 text-foreground md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-border bg-card px-5 py-4 md:hidden">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} data-testid={`link-mobile-${item.label.toLowerCase().replace(/ /g, '-')}`} className="block border-b border-border py-3.5 text-[15px] font-medium text-foreground">
                {item.label}
              </a>
            ))}
            <div className="flex items-center justify-between py-3.5">
              <span className="font-mono-tech text-[10px] uppercase tracking-[.2em] text-muted-foreground">Theme</span>
              <ThemeToggle className="flex h-10 w-10 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan" />
            </div>
            <a href="#contact" onClick={() => setOpen(false)} data-testid="button-mobile-get-started" className="mt-4 block rounded-xl border bg-white px-4 py-3 text-center text-[15px] font-semibold text-[#0b0a10]">Let&apos;s build</a>
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
      className="relative overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_40px_120px_rgba(0,0,0,.16)] dark:shadow-[0_40px_120px_rgba(0,0,0,.6)]"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-3">
          <img src="/logo-240.png" alt="" width={240} height={57} className="h-3 w-auto opacity-90" />
          <span className="font-mono-tech text-[10px] tracking-[.22em] text-muted-foreground">OPERATIONS / LIVE</span>
        </div>
        <div className="flex items-center gap-3 font-mono-tech text-[10px] text-brand-cyan">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70] shadow-[0_0_8px_#c7ef70]" /> SYNCED</span>
          <span className="hidden rounded-md border border-border bg-foreground/[.04] px-2 py-0.5 text-foreground sm:inline">42ms</span>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-foreground/[.02] p-4">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
              <span>Throughput</span><span className="text-brand-lime">+12.4%</span>
            </div>
            <div className="mt-2 flex items-end justify-between">
              <strong className="text-[26px] font-light tracking-tight text-foreground">84.7<span className="text-sm text-brand-cyan">%</span></strong>
            </div>
            <div className="mt-3 flex h-14 items-end gap-1">
              {[35, 48, 40, 58, 52, 67, 61, 76, 72, 88, 82, 95].map((height, i) => (
                <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${height}%` }} transition={{ delay: 0.9 + i * 0.04, duration: 0.45 }} className={`w-full rounded-t-[2px] ${i > 8 ? 'bg-[#6ee7ef]' : 'bg-[#78a6ff]/40'}`} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-foreground/[.02] p-4">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
              <span>Queue health</span><span className="rounded border border-brand-lime/30 px-1.5 py-0.5 text-brand-lime">NORMAL</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[.06]">
              <motion.div initial={{ width: 0 }} animate={{ width: '72%' }} transition={{ delay: 1.1, duration: 1 }} className="h-full rounded-full bg-gradient-to-r from-[#6ee7ef] to-[#e44bd7]" />
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono-tech text-[9px] text-muted-foreground">
              <Bell className="h-3 w-3 text-[#ff9d66]" /> 2 rules executed automatically
            </div>
          </div>
        </div>
        <div className="relative rounded-xl border border-border bg-foreground/[.02] p-4">
          <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
            <span>Flow map</span><Network className="h-3.5 w-3.5 text-brand-magenta" />
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
          <div className="flex justify-between border-t border-border pt-2.5 font-mono-tech text-[9px] text-muted-foreground">
            <span>7 active paths</span><span className="text-brand-cyan">0 blocked</span>
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
              <div className="mb-7 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">
                <Sparkles className="h-3.5 w-3.5 text-brand-magenta" /> Software · Systems · Operations
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="text-[clamp(2.4rem,8.5vw,4.6rem)] font-light leading-[1.06] tracking-[-0.03em] text-foreground">
                The systems your
                <br />
                business runs on —
                <br />
                <span className="font-normal text-brand-cyan">built by operators.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-8 max-w-xl text-[17px] font-light leading-8 text-foreground/75">
                3S Verse builds dealer tools, custom applications and workflow automation for businesses that run on spreadsheets, portals and repetitive processes. Start with a 7-day VidaPay tool trial — or bring us the bottleneck your team needs removed.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <BtnWhite href="#tools" testId="button-hero-get-started">Start a dealer tool trial</BtnWhite>
                <a href="#contact" data-testid="link-hero-explore" className="group inline-flex items-center gap-2 px-2 py-3 text-[15px] font-medium text-foreground transition-colors hover:text-foreground">
                  Discuss a custom system
                  <ArrowDownRight className="h-4 w-4 text-brand-cyan transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1" />
                </a>
              </div>
            </Reveal>
            <Reveal delay={0.32}>
              <div className="mt-14 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-5 font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70]" /> {YEARS_EXPERIENCE}+ years in real operations</span>
                <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-brand-cyan" /> $265K+ identified or recovered across prior programs</span>
                <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-brand-magenta" /> Running in dealerships daily</span>
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
        <div aria-hidden="true" className="hidden w-px self-stretch bg-gradient-to-b from-transparent via-foreground/10 to-transparent lg:block" />
        <div className="lg:pl-20">
          <Reveal>
            <Kicker>Power your business</Kicker>
            <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
              Automation that meets the work <span className="text-brand-cyan">where it happens.</span>
            </h2>
            <p className="mt-7 max-w-lg text-[16px] font-light leading-8 text-foreground/75">
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
    description: 'Full-stack web and Android apps that carry real operational weight — internal tools, customer-facing products, everything in between — built to fit the operation you already run.',
    icon: Smartphone,
    color: 'magenta',
    detail: ['Full-stack web apps', 'Android development', 'Documented delivery scope'],
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
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                Every system your business needs — <span className="text-brand-cyan">under one roof.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
              One partner across the whole spectrum: a website that sells, apps that run your day, AI that clears the busywork, dashboards that keep score, and automation that never sleeps. Scoped in weeks, not quarters, by people who have actually run these operations. We specialize in operational software — internal applications, data workflows, reporting systems, AI-assisted processes and dealer tools; marketing websites are available when they support the same operating system or sales journey.
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
                  className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-8 transition-colors duration-500 hover:border-input lg:p-10"
                >
                  <div className="absolute right-0 top-0 h-40 w-40 opacity-[.13] transition-opacity duration-500 group-hover:opacity-30" style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 68%)` }} />
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-foreground/[.04]" style={{ color: accent }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="font-mono-tech text-[10px] text-muted-foreground/60">{feature.index}</span>
                  </div>
                  <h3 className="mt-12 text-[26px] font-light tracking-[-0.02em] text-foreground">{feature.title}</h3>
                  <p className="mt-4 max-w-md text-[14px] font-light leading-7 text-foreground/75">{feature.description}</p>
                  <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
                    {feature.detail.map((item) => (
                      <span key={item} className="flex items-center gap-2 font-mono-tech text-[9px] uppercase tracking-[.14em] text-muted-foreground">
                        <Check className="h-3 w-3" style={{ color: accent }} /> {item}
                      </span>
                    ))}
                  </div>
                  <ArrowUpRight className="absolute bottom-9 right-9 h-5 w-5 -translate-x-2 translate-y-2 text-foreground/20 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-brand-cyan group-hover:opacity-100" />
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
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[0_30px_90px_rgba(0,0,0,.14)] dark:shadow-[0_30px_90px_rgba(0,0,0,.45)] sm:p-8">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-foreground/[.04] text-brand-cyan"><Workflow className="h-4 w-4" /></span>
          <span className="text-[15px] font-medium text-foreground">Automate a workflow</span>
        </div>
        <div className="mt-5 space-y-4">
          {[
            ['Process', 'Rebates & claims intake'],
            ['Tools', 'VidaPay portal → Sheets'],
            ['Owner', 'Ops team · runs daily'],
          ].map(([label, value], i) => (
            <motion.div key={label} initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.12 }}>
              <div className="font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">{label}</div>
              <div className="mt-1.5 rounded-lg border border-border bg-foreground/[.03] px-3.5 py-2.5 text-[13px] text-foreground">{value}</div>
            </motion.div>
          ))}
          <div className="rounded-lg border border-border bg-foreground/[.03] px-3.5 py-2.5">
            <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
              <span>Status</span>
              <span className="flex items-center gap-1.5 text-brand-lime"><span className="h-1.5 w-1.5 rounded-full bg-[#c7ef70] shadow-[0_0_8px_#c7ef70]" /> running</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/[.06]">
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
        className="absolute -bottom-10 -right-3 w-[240px] rounded-2xl border border-border bg-card p-5 shadow-[0_30px_80px_rgba(0,0,0,.16)] dark:shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:-right-8"
      >
        <div className="text-[14px] font-medium text-foreground">Results</div>
        <svg viewBox="0 0 200 90" className="mt-3 w-full">
          <polyline points="0,78 28,66 56,70 84,48 112,52 140,30 168,34 200,14" fill="none" stroke="#6ee7ef" strokeWidth="1.8" strokeLinejoin="round" />
          <polyline points="0,82 28,76 56,72 84,64 112,60 140,50 168,44 200,38" fill="none" stroke="#e44bd7" strokeWidth="1.2" strokeDasharray="3 3" opacity=".7" />
          <line x1="0" y1="88" x2="200" y2="88" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        </svg>
        <div className="mt-2 flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.16em] text-muted-foreground">
          <span>hours saved / wk</span>
          <span className="text-brand-lime">+38%</span>
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
              <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                From bottleneck
                <br />
                to <span className="text-brand-magenta">live system</span>
                <br />
                in three moves.
              </h2>
              <div className="mt-12 space-y-10">
                {steps.map(([number, title, copy], i) => (
                  <Reveal key={number} delay={i * 0.1}>
                    <div className="border-l border-border pl-6">
                      <h3 className="text-[22px] font-light tracking-[-0.01em] text-foreground transition-colors duration-300 hover:text-brand-cyan">
                        {number}. {title}
                      </h3>
                      <p className="mt-2.5 max-w-md text-[14px] font-light leading-7 text-foreground/75">{copy}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>
          </div>
          <div aria-hidden="true" className="hidden w-px self-stretch bg-gradient-to-b from-transparent via-foreground/10 to-transparent lg:block" />
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
          <motion.span key={i} initial={{ height: 0 }} whileInView={{ height: `${height}%` }} viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.5 }} className={`w-3 rounded-t-[3px] ${i > 7 ? 'bg-[#e44bd7]' : 'bg-foreground/[.16]'}`} />
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
    { value: '$265K+', label: 'identified or recovered across prior operator programs', kind: 'bars' as const },
    { value: '$100K+', label: 'annual vendor savings — one prior sourcing program', kind: 'line' as const },
    { value: 'Double-digit', label: 'inventory turnover improvement — a prior program', kind: 'rings' as const },
  ];
  return (
    <section id="outcomes" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>03 — Real results</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                Builds that <span className="text-brand-magenta">recover real money.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
              Operator-experience figures from 13+ years across retail operations, distribution and multi-store programs — stated as experienced, and published as verified case studies as clients approve them.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {stats.map(({ value, label, kind }, i) => (
            <Reveal key={label} delay={i * 0.1}>
              <div data-testid={`stat-outcome-${i}`} className="group overflow-hidden rounded-2xl border border-border bg-card transition-colors duration-500 hover:border-input">
                <div className="px-8 pb-2 pt-10">
                  <StatVisual kind={kind} />
                </div>
                <div className="border-t border-border px-8 py-8 text-center">
                  <div className="text-[44px] font-light leading-none tracking-[-0.03em] text-foreground lg:text-[52px]">{value}</div>
                  <div className="mt-3 font-mono-tech text-[10px] uppercase tracking-[.2em] text-muted-foreground">{label}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 max-w-3xl text-[12.5px] font-light leading-5 text-muted-foreground">
          These are operator-career outcomes from prior telecom, FMCG and pharmaceutical programs — not 3SVerse client results. Every future client case study publishes with its method, measurement period and verification.
        </p>
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
    blurb: 'Every rebate, spiff, and incentive pulled straight out of the VidaPay portal into one clean sheet. No screenshots, no retyping — built to reduce missed incentives and manual transcription for the front office that reconciles VidaPay every week.',
    chips: [
      { icon: FileSpreadsheet, label: 'Rebate tracking' },
      { icon: ClipboardCheck, label: 'Claim matching' },
      { icon: TrendingUp, label: 'Spiff totals' },
      { icon: Database, label: 'Export ready' },
    ],
    tags: ['Rebates', 'Spiffs', 'Claims', 'One clean sheet'],
    visual: (
      <div className="rounded-xl border border-border bg-foreground/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
          <span>Incentives · March</span><span className="rounded border border-brand-cyan/30 px-1.5 py-0.5 text-brand-cyan">EXTRACTED</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Vendor rebate — row 14', '$1,240.00'],
            ['Activation spiff — row 09', '$615.00'],
            ['Bundle bonus — row 22', '$890.00'],
          ].map(([row, amount], i) => (
            <motion.div key={row} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-border bg-foreground/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-foreground">{row}</span>
              <span className="font-mono-tech text-[12px] text-brand-cyan">{amount}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">Total recovered</span>
          <span className="text-[20px] font-light tracking-tight text-foreground">$2,745.00</span>
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
      <div className="rounded-xl border border-border bg-foreground/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
          <span>Order · 45 stores</span><span className="rounded border border-brand-magenta/40 px-1.5 py-0.5 text-brand-magenta">DRAFT</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Galaxy S23 FE', '12 / store'],
            ['Moto G Play', '20 / store'],
            ['iPhone 13', '8 / store'],
          ].map(([device, qty], i) => (
            <motion.div key={device} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-border bg-foreground/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-foreground">{device}</span>
              <span className="font-mono-tech text-[12px] text-brand-magenta">{qty}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">1,340 units queued</span>
          <span className="rounded-lg border bg-white px-4 py-1.5 text-[12px] font-semibold text-[#0b0a10]">Submit order</span>
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
      <div className="rounded-xl border border-border bg-foreground/[.02] p-5">
        <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
          <span>Rebate claims · Batch 12</span><span className="rounded border border-brand-cyan/30 px-1.5 py-0.5 text-brand-cyan">FILED</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            ['Vendor rebates — 24 claims', 'PAID'],
            ['Activation spiffs — 41 claims', 'FILED'],
            ['Bundle bonuses — 18 claims', 'QUEUED'],
          ].map(([claim, status], i) => (
            <motion.div key={claim} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + i * 0.12 }} className="flex items-center justify-between rounded-lg border border-border bg-foreground/[.02] px-3.5 py-2.5">
              <span className="text-[13px] text-foreground">{claim}</span>
              <span className={`font-mono-tech text-[11px] ${status === 'PAID' ? 'text-brand-lime' : status === 'FILED' ? 'text-brand-cyan' : 'text-brand-magenta'}`}>{status}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">83 claims this batch</span>
          <span className="text-[20px] font-light tracking-tight text-foreground">$9,140.00</span>
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
              <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">Built for the front office</h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
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
                    ? 'border bg-white text-[#0b0a10] shadow-[0_10px_30px_rgba(255,255,255,.08)]'
                    : 'border border-input text-foreground hover:border-foreground/50 hover:text-foreground'
                }`}
              >
                {t.tab}
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div data-testid="panel-tool" className="overflow-hidden rounded-3xl border border-border bg-card p-8 sm:p-12 lg:p-14">
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
                  <h3 className="text-[clamp(1.7rem,2.6vw,2.5rem)] font-light leading-[1.08] tracking-[-0.02em] text-foreground">{tool.title}</h3>
                  <p className="mt-5 max-w-lg text-[15px] font-light leading-7 text-foreground/75">{tool.blurb}</p>
                  <div className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4">
                    {tool.chips.map(({ icon: Icon, label }) => (
                      <span key={label} className="flex items-center gap-3 text-[13.5px] font-light text-foreground">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-foreground/[.04] text-brand-cyan"><Icon className="h-4 w-4" /></span>
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <a
                      href={trialDownloadUrl(tool.id)}
                      data-testid={`button-download-${tool.id}`}
                      className="inline-flex items-center gap-2.5 rounded-xl border bg-white px-6 py-3 text-[14.5px] font-semibold text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8]"
                    >
                      <Download className="h-4 w-4" /> Download free trial (.exe)
                    </a>
                    <a
                      href="/order"
                      data-testid="link-order-status"
                      className="text-[13.5px] font-medium text-brand-cyan transition-colors hover:text-foreground"
                    >
                      Already purchased? Free re-download →
                    </a>
                  </div>
                  <p className="mt-3 text-[12.5px] font-light leading-5 text-muted-foreground">
                    Windows 10/11 · the download always serves the newest build ·
                    7-day trial built in, activate with your license key.
                  </p>
                </div>
                <div>
                  {tool.visual}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {tool.tags.map((tag) => (
                      <span key={tag} className="rounded-md border border-border bg-foreground/[.04] px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[.16em] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
        <RoiCalculator />
        <DealerStore />
        <DemoStrip />
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
    'Unclaimed rebates quietly expire — $500–$2,000/month a typical dealer can miss',
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
    'License that fits your cash flow — monthly, annual, or one-time lifetime; pays for itself within weeks',
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
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                The same week, <span className="text-brand-cyan">two ways.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
              Nothing theoretical — this is the exact work your front office does today, before and after the tools take it over.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="hidden grid-cols-[1.1fr_1.3fr_1.3fr] border-b border-border font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground md:grid">
              <div className="px-6 py-4">The work</div>
              <div className="border-x border-border px-6 py-4 text-brand-magenta">Manual today</div>
              <div className="px-6 py-4 text-brand-cyan">With 3S Verse</div>
            </div>
            {COMPARE_ROWS.map(([work, before, after], i) => (
              <div
                key={work}
                className={`grid gap-3 border-b border-border px-6 py-5 last:border-b-0 md:grid-cols-[1.1fr_1.3fr_1.3fr] md:items-center md:gap-0 md:px-0 md:py-0 ${i % 2 ? 'bg-foreground/[.015]' : ''}`}
              >
                <div className="text-[14.5px] font-medium text-foreground md:border-r-0 md:px-6">{work}</div>
                <div className="flex items-start gap-2.5 border-border text-[13.5px] font-light leading-6 text-foreground/75 md:border-x md:border-b-0 md:px-6 md:py-5">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-brand-magenta" />{before}
                </div>
                <div className="flex items-start gap-2.5 text-[13.5px] font-light leading-6 text-foreground md:px-6 md:py-5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />{after}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.14}>
          {/* audit fix: show the transformation, not just the table — the
              money the manual process burns vs the same month after */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-brand-magenta/25 bg-[#e44bd7]/[.05] p-7">
              <p className="flex items-center gap-2.5 font-mono-tech text-[10px] uppercase tracking-[.2em] text-brand-magenta"><X className="h-3.5 w-3.5" /> Before — manual front office</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px] font-light leading-6 text-foreground">
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#e44bd7]" />Scenario range: $500–$2,000 in missed rebates — per store, every month</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#e44bd7]" />15–30 staff hours a week on screenshots and retyping</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#e44bd7]" />Claims filed once and forgotten — no status, no proof, no follow-up</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-brand-cyan/25 bg-[#6ee7ef]/[.05] p-7">
              <p className="flex items-center gap-2.5 font-mono-tech text-[10px] uppercase tracking-[.2em] text-brand-cyan"><Check className="h-3.5 w-3.5" /> After — the 3S Verse front office</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px] font-light leading-6 text-foreground">
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#6ee7ef]" />Every eligible claim extracted, filed, and tracked to PAID</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#6ee7ef]" />Minutes per run — every store in one pass, zero retyping</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#6ee7ef]" />A live workbook the whole team trusts — and audited numbers to prove it</li>
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ROI calculator — audit action #7: "Enter your stores → see how much
   you're losing → see the payback period." Uses the real bundle pricing
   from the catalog (volume tiers included) so the numbers match the store. */
function RoiCalculator() {
  const bundle = PRODUCTS.find((p) => p.id === 'bundle')!;
  const [stores, setStores] = useState(3);
  const [lossPerStore, setLossPerStore] = useState(1000);

  const monthlyLoss = stores * lossPerStore;
  const lifetimePrice = perPcPrice(bundle, 'lifetime', stores) * stores;
  const monthlyPrice = perPcPrice(bundle, 'monthly', stores) * stores;
  const paybackDays = Math.max(1, Math.ceil((lifetimePrice / monthlyLoss) * 30));
  const savedYear = Math.max(0, monthlyLoss * 12 - lifetimePrice);

  return (
    <div data-testid="roi-calculator" className="mt-14 rounded-3xl border border-border bg-gradient-to-br from-card via-card to-card p-7 sm:p-10">
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="flex items-center gap-2 font-mono-tech text-[10px] uppercase tracking-[.22em] text-brand-cyan"><Calculator className="h-3.5 w-3.5" /> ROI calculator</p>
          <h3 className="mt-3 text-[clamp(1.6rem,2.4vw,2.2rem)] font-light leading-[1.1] tracking-[-0.02em] text-foreground">
            What is the manual process <span className="text-brand-magenta">costing you?</span>
          </h3>
          <p className="mt-4 max-w-md text-[14px] font-light leading-6 text-foreground/75">
            A scenario range based on observed dealer workflows: $500–$2,000 in unclaimed rebates and spiffs per store every month, plus hours of retyping. Set your reality below — the payback math uses real catalog pricing, volume discounts included.
          </p>
          <div className="mt-7 space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-foreground/75">Stores you run</span>
                <span className="font-mono-tech text-[15px] font-semibold text-foreground" data-testid="roi-stores-value">{stores}</span>
              </div>
              <input
                type="range"
                min={1}
                max={9}
                value={stores}
                onChange={(e) => setStores(Number(e.target.value))}
                aria-label="Number of stores"
                data-testid="roi-stores-slider"
                className="w-full accent-brand-cyan"
              />
            </div>
            <div>
              <span className="mb-2 block text-[13px] font-medium text-foreground/75">Missed rebates &amp; incentives per store / month</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { v: 500, label: '$500 — careful' },
                  { v: 1000, label: '$1,000 — typical' },
                  { v: 2000, label: '$2,000 — manual & busy' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setLossPerStore(o.v)}
                    className={lossPerStore === o.v
                      ? 'rounded-lg border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#0b0a10]'
                      : 'rounded-lg border border-input px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:border-foreground/40 hover:text-foreground'}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[12px] font-light leading-5 text-muted-foreground">
              Running 10 or more stores? Message us — district pricing with central billing and
              priority support. Results vary by dealership: the presets are a conservative /
              typical / upside scenario range, and payback = bundle price ÷ your estimated
              monthly recovery.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-brand-magenta/25 bg-[#e44bd7]/[.06] p-5">
            <p className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-brand-magenta">Losing today</p>
            <p className="mt-2 text-[clamp(1.6rem,2.4vw,2.1rem)] font-light leading-none text-foreground" data-testid="roi-monthly-loss">{formatUSD(monthlyLoss)}<span className="text-[14px] text-muted-foreground">/mo</span></p>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{formatUSD(monthlyLoss * 12)} a year in missed money and wasted hours</p>
          </div>
          <div className="rounded-2xl border border-brand-cyan/25 bg-[#6ee7ef]/[.06] p-5">
            <p className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-brand-cyan">Full bundle — {stores} PC{stores === 1 ? '' : 's'}</p>
            <p className="mt-2 text-[clamp(1.6rem,2.4vw,2.1rem)] font-light leading-none text-foreground" data-testid="roi-bundle-price">{formatUSD(lifetimePrice)}</p>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">one-time lifetime · or {formatUSD(monthlyPrice)}/mo cancel-anytime</p>
          </div>
          <div className="rounded-2xl border border-border bg-foreground/[.03] p-5 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-brand-cyan">Payback period</p>
                <p className="mt-1.5 text-[clamp(1.6rem,2.4vw,2.1rem)] font-light leading-none text-foreground" data-testid="roi-payback">{paybackDays} days</p>
              </div>
              <p className="max-w-[240px] text-[12.5px] leading-5 text-foreground/75">
                Then it keeps everything it finds — <span className="text-brand-cyan">{formatUSD(savedYear)}+ net in year one</span> at these settings.
              </p>
            </div>
          </div>
          <a
            href="#tools"
            data-testid="roi-cta"
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-5 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] sm:col-span-2"
          >
            Compare plans and licenses <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

/* Demo strip — audit action #3: dealers need to SEE the tools working.
   Paste a YouTube/Loom embed into VIDEO_DEMO.url in catalog.ts and the
   iframe replaces the placeholder automatically. */
function DemoStrip() {
  const wa = whatsappLink();
  return (
    <div data-testid="demo-strip" className="mt-14 overflow-hidden rounded-3xl border border-border bg-card">
      <div className="grid items-stretch lg:grid-cols-[1.05fr_1fr]">
        <div className="p-8 sm:p-12">
          <p className="flex items-center gap-2 font-mono-tech text-[10px] uppercase tracking-[.22em] text-brand-cyan"><PlayCircle className="h-3.5 w-3.5" /> {VIDEO_DEMO.kicker}</p>
          <h3 className="mt-3 text-[clamp(1.6rem,2.4vw,2.2rem)] font-light leading-[1.1] tracking-[-0.02em] text-foreground">{VIDEO_DEMO.title}</h3>
          <p className="mt-4 max-w-md text-[14px] font-light leading-7 text-foreground/75">{VIDEO_DEMO.note}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Send me the raw tool walkthrough')}`}
              data-testid="demo-cta"
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
            >
              <PlayCircle className="h-4 w-4" /> Get the raw walkthrough now
            </a>
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-input px-5 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan"
            >
              <Linkedin className="h-4 w-4" /> Follow on LinkedIn — demos post there first
            </a>
            {YOUTUBE_URL ? (
              <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" aria-label="3S Verse on YouTube" className="inline-flex items-center gap-2 rounded-xl border border-input px-5 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan"><Youtube className="h-4 w-4" /> YouTube</a>
            ) : null}
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-input px-5 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:border-brand-wa/60 hover:text-brand-wa"><MessageCircle className="h-4 w-4" /> WhatsApp us</a>
            ) : null}
          </div>
        </div>
        <div className="relative min-h-[280px] border-t border-border bg-gradient-to-br from-card to-card lg:border-l lg:border-t-0">
          {VIDEO_DEMO.url ? (
            <iframe
              src={VIDEO_DEMO.url}
              title="3S Verse tool demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-10 text-center">
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-brand-cyan/40 bg-[#6ee7ef]/[.07]">
                <PlayCircle className="h-9 w-9 text-brand-cyan" />
                <span className="absolute -right-1 -top-1 flex h-4 w-4">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e44bd7] opacity-60" />
                  <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-card bg-[#e44bd7]" />
                </span>
              </span>
              <p className="max-w-[260px] font-mono-tech text-[10px] uppercase tracking-[.2em] leading-5 text-muted-foreground">
                Full product demo in production — meanwhile the field guides below walk the exact workflows
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* WhatsApp float — audit action #10: dealers want a quick answer before
   spending $899. Renders only when WHATSAPP_NUMBER is set in catalog.ts. */
function WhatsAppFloat() {
  const wa = whatsappLink();
  if (!wa) return null;
  return (
    <motion.a
      href={wa}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="whatsapp-float"
      aria-label="Chat with 3S Verse on WhatsApp"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.2, duration: 0.35 }}
      className="fixed bottom-24 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#25d366] text-foreground shadow-[0_12px_32px_rgba(37,211,102,.4)] transition-transform duration-300 hover:scale-110"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
      </svg>
    </motion.a>
  );
}

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: 'Do the tools run under my own VidaPay login?',
    a: 'Yes. Everything runs on your own Windows PC under your own dealer login. Your VidaPay credentials stay on your machine — the tools never send them anywhere, and each license is machine-locked to the PC you activate it on.',
  },
  {
    q: 'My laptop died or was replaced — do I have to buy the license again?',
    a: 'No, never. A license is locked to one PC at a time, not to one PC forever. Every tool has a built-in "Deactivate this PC" link (bottom-right of the window): click it there, then activate the same key on the new machine. If the old PC is dead and cannot be deactivated, just contact us — we release the seat from our side, usually within minutes. Either way you never pay twice for the same license.',
  },
  {
    q: 'Can I move my license to a new PC myself?',
    a: 'Yes — that is exactly what deactivation is for, and it is free. Deactivate on the old PC (or ask us to release the seat), then activate with the same key on the new one. Every move is logged for your protection: a genuine upgrade never gets questioned, but a key that keeps hopping between different PCs every week gets a friendly check-in, because that pattern usually means the key is being shared.',
  },
  {
    q: 'I run multiple stores. Will it keep up?',
    a: 'That is exactly what they were built for. All three tools were born inside a real multi-store wireless operation — per-store dashboards, per-store ordering quantities, and bulk claim filing across every branch are the default, not an add-on. Pick exactly how many PCs you need when ordering: 2–4 PCs get 10% off per PC and 5–9 get 20%, applied automatically. For 10 or more PCs we quote district pricing with central billing.',
  },
  {
    q: 'Is this a subscription?',
    a: 'Only if you want it to be. Monthly is the cancel-anytime plan — $89/mo per tool. Annual is the same software billed yearly at a 44% discount. Lifetime is one payment and it is yours forever — no renewals, ever. Every plan includes every update; pick per tool, mix and match, and switch anytime by replying to your invoice email.',
  },
  {
    q: 'What is the difference between the free trial and lifetime?',
    a: 'The trial is the full software, free for 7 days on 1 PC — no card required, no feature locks. Lifetime is the same software with the clock removed: one payment, every future update, and support on WhatsApp and email.',
  },
  {
    q: 'What happens when VidaPay updates their portal?',
    a: 'Portals change — that is the reality of the job. Updates are included with every license, so when the portal moves, the tools move with it. When the portal shows a security or verification step, the tool pauses and hands it to you to approve, then continues the run instead of freezing mid-flow.',
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
    a: 'Every license carries a 30-day money-back guarantee. If a tool does not do what this page promises on your dealership’s data, tell us within 30 days of delivery and we refund you in full — processed within 5 business days. The precise terms live in our refund policy.',
  },
  {
    q: 'Where does my dealership’s data end up?',
    a: 'On your machine. The tools run on your own Windows PC under your own VidaPay login — credentials, portal sessions, and extracted data never leave your machine. There is no 3S Verse server holding your dealership’s numbers, and each license is machine-locked to the PC you activate it on.',
  },
  {
    q: 'How fast is support, and who answers?',
    a: 'WhatsApp and email, answered by the people who built the tools — same-day on business days (US Central time), next business day worst case. If a VidaPay portal update ever breaks something, the fix ships as a normal update, already included with every plan. You are never billed for fixes.',
  },
];

function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`faq-item-${index}`} className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((c) => !c)}
        className="flex w-full cursor-pointer items-center justify-between gap-6 px-7 py-5 text-left transition-colors hover:bg-foreground/[.02]"
      >
        <span className="text-[15.5px] font-medium leading-6 text-foreground">{q}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-input text-brand-cyan transition-transform duration-300 ${open ? 'rotate-45' : ''}`}>
          <Plus className="h-3.5 w-3.5" />
        </span>
      </button>
      {open && <p className="px-7 pb-6 pr-14 text-[14px] font-light leading-7 text-foreground/75">{a}</p>}
    </div>
  );
}

function Faq() {
  return (
    <section id="faq" className="relative overflow-hidden py-28 lg:py-36">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-16 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-[#e44bd7]/[.05] blur-[130px]" />
      <div className="relative mx-auto max-w-4xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-12 text-center">
            <Kicker>07 — Straight answers</Kicker>
            <h2 className="text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
              Questions dealers <span className="text-brand-magenta">actually ask.</span>
            </h2>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            {FAQ_ITEMS.map(({ q, a }, i) => (
              <FaqItem key={q} q={q} a={a} index={i} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Dealer field guides (audit: zero educational content = invisible to
   Google; dealers search these exact problems every day) ───────────────── */
const GUIDES = [
  {
    tag: 'Rebate recovery',
    title: 'Where VidaPay rebates leak — and how to plug every hole',
    read: '4 min read',
    icon: ClipboardCheck,
    body: [
      'Every Total Wireless dealer files rebates — almost none recover all of them. The money doesn’t disappear in one dramatic failure; it leaks in small, boring places: a claim filed outside the promo window, a screenshot that missed one IMEI, a rejection nobody followed up on because “the portal says pending” and nobody rechecks pending claims on a Saturday.',
      'The first leak is capture. If your rebate list starts life as a staff member reading the portal and retyping lines into Excel, some claims never make the list at all. A bulk extraction straight from VidaPay — IMEI-level, per store, in one run — means the claim list starts complete instead of approximate.',
      'The second leak is status. VidaPay claims move through states (submitted, pending, approved, rejected), and rejected claims don’t scream for attention. Dealers who recheck non-approved claims weekly recover a meaningful share of “lost” rebates; dealers who file and forget, don’t. Set a fixed weekly slot — same day, same time — and work the pending list before filing anything new.',
      'The third leak is proof. When a claim disputes, the dealer with an extracted, timestamped workbook wins the argument; the dealer with a screenshot folder doesn’t. Keep one clean workbook per month per store, exported from the portal itself, and every future dispute is a five-minute email instead of an afternoon of scrolling.',
    ],
  },
  {
    tag: 'Incentives & spiffs',
    title: 'Spiffs and incentives: capture every dollar your stores earned',
    read: '4 min read',
    icon: FileSpreadsheet,
    body: [
      'Spiffs are the money your stores earn by accident — a bonus on a specific device this week, a flash incentive on a plan, a volume kicker buried three screens deep in the portal. Manufacturer and carrier incentives change fast, and the dealers who lose them aren’t lazy; they just reconcile monthly in one giant painful sitting, after some spiffs have already expired.',
      'The fix is cadence, not effort. Pull incentives per store weekly, not monthly. A weekly IMEI-level extraction takes minutes and answers the only two questions that matter: what did each store actually earn, and what hasn’t been paid yet. When the answer is visible every week, staff behavior changes on its own — they file while the promo is still live.',
      'Reconciliation is the second half. Compare the extracted incentive rows against what actually landed in payments, line by line. Every mismatch is either a claim that never got filed or a payment that never got chased — both are recoverable, but only if you can see them. One dealer-facing rule of thumb: if you can’t produce last month’s incentive totals per store in under five minutes, you’re leaking money you’ll never be able to audit later.',
      'Multi-store owners feel this hardest: totals per location drive which store gets coaching, which gets staff, and which quietly underperforms. IMEI-level extraction per store turns that from a monthly guessing game into a weekly one-page answer.',
    ],
  },
  {
    tag: 'Front-office math',
    title: 'The real cost of manual VidaPay work at a 3-store dealership',
    read: '5 min read',
    icon: TrendingUp,
    body: [
      'Manual VidaPay work doesn’t show up as a line item, which is exactly why it survives every budget review. So price it out. A three-store dealership running screenshots, retyping, and manual claim filing spends roughly fifteen to thirty staff-hours a week on portal busywork. At even a modest loaded labor rate, that’s hundreds of dollars a month in wages doing work a machine should do.',
      'Then add the error tax. Retyped IMEIs get one digit wrong. Screenshots miss the one row that mattered. Claims go in past the window because nobody saw the promo until it ended. Across the industry this shows up as several hundred to a couple thousand dollars a month in rebates and incentives that were earned, owed — and never collected. That is not a rounding error; at the low end it is a staff wage, at the high end it is a store’s rent.',
      'Finally add the focus cost. The owner or office manager doing portal work at 9 PM is not training staff, walking the floor, or opening store number four. Automation’s biggest return is rarely the hours it saves — it’s the decisions the operator finally gets to make because the extraction, ordering, and claim tracking run themselves.',
      'The payback math is one line: if the tools recover even the low end of the leakage — a few hundred dollars a month — they can pay for themselves inside the first month, and everything after that is recovered margin. Run your own numbers for two minutes in the ROI calculator above and the manual process stops looking free.',
    ],
  },
];

function GuideCard({ g, index }: { g: (typeof GUIDES)[number]; index: number }) {
  const Icon = g.icon;
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid={`guide-${index}`}
      className={`overflow-hidden rounded-2xl border bg-card transition-colors duration-300 ${open ? 'border-brand-cyan/25' : 'border-border hover:border-input'}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((c) => !c)}
        className="flex w-full cursor-pointer items-center gap-4 px-7 py-6 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-foreground/[.03]">
          <Icon className="h-4.5 w-4.5 text-brand-cyan" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono-tech text-[9.5px] uppercase tracking-[.18em] text-brand-magenta">{g.tag}</span>
          <span className="mt-1 block text-[17px] font-medium leading-snug text-foreground md:text-[19px]">{g.title}</span>
        </span>
        <span className="hidden shrink-0 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground sm:block">{g.read}</span>
        <ArrowDownRight className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-7 py-6">
          {g.body.map((para, k) => (
            <p key={k} className="max-w-3xl text-[14.5px] font-light leading-7.5 text-foreground/75">{para}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Guides() {
  return (
    <section id="guides" className="relative overflow-hidden py-28 lg:py-36">
      <Shape v={1} className="shape-subtle pointer-events-none absolute -left-44 top-24 hidden w-[420px] opacity-25 lg:block" spin={90} floatY={10} floatDur={14} />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-14 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker magenta>06 — Dealer field guides</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                Written for the <span className="text-brand-cyan">front office,</span> not the boardroom.
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
              The same playbooks we built the tools around — rebate recovery, incentive capture, and what manual VidaPay work really costs. Free, no email wall.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="space-y-4">
            {GUIDES.map((g, i) => (
              <GuideCard key={g.title} g={g} index={i} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Reviews & trust (audit: anonymous testimonials read as fabricated and
   Trust Signals scored 4/10) — the site ships with ZERO invented reviews:
   a verified review program + submission box + an explicit trust panel. ── */

const TRUST_CARDS = [
  {
    icon: MonitorSmartphone,
    title: 'Runs on your machine',
    text: 'The tools log into VidaPay from your own store PC. Your portal credentials never touch our servers — there are no servers holding them.',
  },
  {
    icon: Undo2,
    title: '30-day money-back',
    text: 'A full refund within 30 days of delivery if a tool does not do what this page promises on your dealership’s data — processed within 5 business days. Precise terms in the refund policy.',
  },
  {
    icon: KeyRound,
    title: 'Machine-locked licenses',
    text: 'Keys are locked to the PCs you licensed. No leaked key files, no gray-market resales — the price you see stays worth paying.',
  },
  {
    icon: MessageCircle,
    title: 'Human support',
    text: 'WhatsApp and email, answered by the person who built the tools — same business day (US Central, business days only), next business day worst case.',
  },
  {
    icon: UserCheck,
    title: 'Founder-operated',
    text: '13+ years of wireless retail operations stand behind every workflow. You are dealing with an operator, not a reseller.',
  },
  {
    icon: CreditCard,
    title: 'Pay your way',
    text: 'Bank transfer, Wise, PayPal, or USDT — with a proper invoice and receipt for your records. No card required for the 7-day trial.',
  },
];

const REVIEW_TOOLS = [
  'VidaPay Incentive Extractor',
  'VidaPay Device Ordering',
  'VidaPay Rebate Filing',
  'VidaPay Full Bundle',
];

function ReviewCard({ review }: { review: DealerReview }) {
  return (
    <figure data-testid={`review-${review.initials}`} className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-8 transition-colors duration-500 hover:border-input lg:p-9">
      <div>
        <div className="flex items-center gap-1 text-brand-magenta" aria-label={`${review.stars} out of 5 stars`}>
          {Array.from({ length: 5 }).map((_, s) => (
            <Star key={s} className={`h-4 w-4 ${s < review.stars ? 'fill-current' : 'opacity-25'}`} />
          ))}
        </div>
        <blockquote className="mt-6 text-[15px] font-light leading-8 text-foreground/85">“{review.quote}”</blockquote>
      </div>
      <figcaption className="mt-9 flex items-center gap-3.5 border-t border-border pt-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-magenta/40 bg-foreground/[.04] font-mono-tech text-[11px] text-brand-cyan">{review.initials}</span>
        <div>
          <div className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
            {review.name}
            <span className="inline-flex items-center gap-1 rounded-md border border-brand-cyan/30 bg-[#6ee7ef]/[.08] px-1.5 py-0.5 font-mono-tech text-[8.5px] uppercase tracking-[.12em] text-brand-cyan" title="License verified against purchase records">
              <ShieldCheck className="h-2.5 w-2.5" /> Verified purchase
            </span>
          </div>
          <div className="mt-0.5 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">{review.org} · {review.date}</div>
        </div>
      </figcaption>
    </figure>
  );
}

function Reviews() {
  const [form, setForm] = useState({ name: '', email: '', store: '', tool: REVIEW_TOOLS[0], rating: '5', text: '', website: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [note, setNote] = useState('');
  const [cfToken, setCfToken] = useState('');
  const [cfResetCount, setCfResetCount] = useState(0);

  const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = clean(form.name);
    const store = clean(form.store);
    const text = clean(form.text);
    const email = clean(form.email);
    if (!name || !email || !store || !text) return;
    if (TURNSTILE_SITE_KEY && !cfToken) {
      setStatus('error');
      setNote('complete the verification box first');
      return;
    }
    setStatus('sending');
    setNote('');
    const fields = {
      name,
      email,
      store,
      tool: form.tool,
      rating: `${form.rating} / 5`,
      review: text,
      _subject: `New dealer review — ${form.tool} — ${store} — ${form.rating}/5`,
      _template: 'table',
      _captcha: 'false',
      _replyto: email,
      _autoresponse: 'Thanks for your 3S Verse review! We verify every review against license records before publishing. We may reply here to confirm a detail or two.',
      _honey: form.website,
      ...(cfToken ? { 'cf-turnstile-response': cfToken, turnstileToken: cfToken } : {}),
    };
    // Same protected chain as the contact form: worker /contact (Turnstile
    // verified server-side) → FormSubmit direct → mailto fallback.
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let delivered = false;
      try {
        const res = await fetch(PAID_DOWNLOAD.contactRelayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
          signal: controller.signal,
        });
        const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        delivered = res.ok && Boolean(payload?.ok);
      } catch {
        delivered = false;
      }
      if (!delivered) {
        const response = await fetch('https://formsubmit.co/ajax/connect@3sverse.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as { success?: string } | null;
        if (!response.ok || payload?.success !== 'true') throw new Error('review submit failed');
      }
      clearTimeout(timeoutId);
      setForm({ name: '', email: '', store: '', tool: REVIEW_TOOLS[0], rating: '5', text: '', website: '' });
      setCfToken('');
      setCfResetCount((count) => count + 1);
      setStatus('success');
    } catch {
      // Relay unreachable — hand the review to the dealer's own email client
      const subject = encodeURIComponent(fields._subject);
      const body = encodeURIComponent(
        `Name: ${name}\nEmail: ${email}\nStore / city: ${store}\nTool: ${form.tool}\nRating: ${form.rating}/5\n\n${text}`,
      );
      window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
      setNote('your email app just opened with the review pre-filled — press send there');
      setStatus('error');
    }
  };

  return (
    <section id="reviews" className="relative overflow-hidden py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mb-14 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Kicker>08 — Trust &amp; guarantees</Kicker>
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                No invented praise. <span className="text-brand-cyan">Verified dealers</span> only.
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
              We publish zero anonymous quotes and zero paid testimonials. Every review below comes from a license holder we can point to in our records.
            </p>
          </div>
        </Reveal>

        {/* trust panel — audit scored Trust Signals 4/10; these are the
            commitments we can actually keep, stated up front */}
        <Reveal delay={0.05}>
          <div className="mb-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="trust-grid">
            {TRUST_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-2xl border border-border bg-card p-6 transition-colors duration-300 hover:border-brand-cyan/25">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-cyan/25 bg-[#6ee7ef]/[.06]">
                      <Icon className="h-4 w-4 text-brand-cyan" />
                    </span>
                    <h3 className="text-[15px] font-medium text-foreground">{card.title}</h3>
                  </div>
                  <p className="mt-3 text-[13.5px] font-light leading-6.5 text-foreground/75">{card.text}</p>
                </div>
              );
            })}
          </div>
        </Reveal>

        {/* published reviews — or the honest empty state */}
        {REVIEWS.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            {REVIEWS.map((review) => (
              <Reveal key={review.initials + review.date} delay={0.06}>
                <ReviewCard review={review} />
              </Reveal>
            ))}
          </div>
        ) : (
          <Reveal delay={0.06}>
            <div className="mb-14 rounded-2xl border border-dashed border-input bg-foreground/[.015] p-7 text-center" data-testid="reviews-empty">
              <p className="text-[15px] font-light leading-7 text-foreground/75">
                <span className="font-medium text-foreground">No published reviews yet.</span>{' '}
                We would rather show an empty wall than a fake one. The first verified dealer reviews go up here the moment they clear verification — good or bad.
              </p>
            </div>
          </Reveal>
        )}

        {/* the review box — submissions land in the 3S Verse inbox, get
            verified against license records, then get published */}
        <Reveal delay={0.08}>
          <div className="grid gap-10 rounded-3xl border border-border bg-card p-7 shadow-[0_30px_100px_rgba(0,0,0,.15)] dark:shadow-[0_30px_100px_rgba(0,0,0,.5)] sm:p-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h3 className="text-[24px] font-light leading-tight tracking-[-0.01em] text-foreground">Running a tool? <span className="text-brand-cyan">Leave a review.</span></h3>
              <ol className="mt-6 space-y-4">
                {[
                  'Submit the form — takes a minute.',
                  'We verify you against license records (your email is never published).',
                  'Your review goes live with your name, store, and city. Critical reviews publish too.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-3.5 text-[14px] font-light leading-6.5 text-foreground/75">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-magenta/40 font-mono-tech text-[10px] text-brand-cyan">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-6 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                Verified purchase badge · moderated by a human
              </p>
            </div>
            <form onSubmit={submit} data-testid="form-review" className="min-w-0">
              <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="review-website">Leave this field empty</label>
                <input id="review-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm((c) => ({ ...c, website: event.target.value }))} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                  Name
                  <input required maxLength={120} value={form.name} onChange={(e) => { setForm((c) => ({ ...c, name: e.target.value })); setStatus('idle'); }} data-testid="input-review-name" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="First and last name" />
                </label>
                <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                  Email <span className="normal-case text-muted-foreground/70">(not published)</span>
                  <input required maxLength={254} type="email" value={form.email} onChange={(e) => { setForm((c) => ({ ...c, email: e.target.value })); setStatus('idle'); }} data-testid="input-review-email" autoComplete="email" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="Used only for verification" />
                </label>
                <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                  Store / city
                  <input required maxLength={160} value={form.store} onChange={(e) => { setForm((c) => ({ ...c, store: e.target.value })); setStatus('idle'); }} data-testid="input-review-store" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="e.g. Total Wireless · Dallas, TX" />
                </label>
                <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                  Tool you use
                  <select value={form.tool} onChange={(e) => { setForm((c) => ({ ...c, tool: e.target.value })); setStatus('idle'); }} data-testid="select-review-tool" className="mt-2 w-full appearance-none rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-brand-cyan/70">
                    {REVIEW_TOOLS.map((t) => <option key={t} className="bg-card">{t}</option>)}
                  </select>
                </label>
                <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground sm:col-span-2">
                  Rating
                  <div className="mt-2 flex gap-2">
                    {[['5', '5 — excellent'], ['4', '4 — good'], ['3', '3 — okay'], ['2', '2 — poor'], ['1', '1 — bad']].map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setForm((c) => ({ ...c, rating: v }))} data-testid={`review-rating-${v}`} aria-label={label} className={`flex h-10 flex-1 items-center justify-center rounded-xl border font-mono-tech text-[12px] transition-colors ${form.rating === v ? 'border-brand-cyan/70 bg-[#6ee7ef]/10 text-brand-cyan' : 'border-border bg-foreground/[.03] text-muted-foreground hover:border-foreground/25'}`}>
                        {v}★
                      </button>
                    ))}
                  </div>
                </label>
              </div>
              <label className="mt-4 block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                Your experience
                <textarea required maxLength={2000} rows={4} value={form.text} onChange={(e) => { setForm((c) => ({ ...c, text: e.target.value })); setStatus('idle'); }} data-testid="textarea-review-text" className="mt-2 w-full resize-y rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="What did the tool change for your stores? Real numbers beat adjectives." />
              </label>
              {TURNSTILE_SITE_KEY && <TurnstileWidget key={cfResetCount} onToken={setCfToken} />}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button type="submit" disabled={status === 'sending'} data-testid="button-review-submit" className="group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8] disabled:cursor-wait disabled:opacity-70">
                  {status === 'sending' ? 'Sending...' : 'Submit review'}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
                <span aria-live="polite" className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  {status === 'success' ? 'Review received — thank you. It goes up after verification.' : status === 'error' ? `${note || 'Couldn’t send'}. Email ${CONTACT_EMAIL} directly.` : 'Verified against purchase records before publishing.'}
                </span>
              </div>
            </form>
          </div>
        </Reveal>
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
          className="fixed inset-0 z-[90] flex items-center justify-center bg-background/95 p-4 backdrop-blur-md sm:p-8"
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
                <div className="font-mono-tech text-[9px] uppercase tracking-[.25em] text-brand-cyan">{video.tag}</div>
                <h3 className="mt-1 truncate text-lg font-medium text-foreground">{video.title}</h3>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                data-testid="button-video-close"
                aria-label="Close video"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-input bg-foreground/[.04] text-foreground transition-all duration-300 hover:border-brand-cyan/60 hover:text-brand-cyan"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[0_36px_100px_rgba(0,0,0,.16)] dark:shadow-[0_36px_100px_rgba(0,0,0,.6)]">
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
              <h2 className="max-w-2xl text-[clamp(2.2rem,4vw,3.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
                Watch the systems <span className="text-brand-cyan">in action.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[15px] font-light leading-7 text-foreground/75">
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
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-colors duration-500 hover:border-input"
                >
                  <button type="button" onClick={() => setActive(video)} data-testid={`video-play-${i}`} aria-label={`Play video: ${video.title}`} className="block w-full cursor-pointer text-left">
                    <span className="relative block aspect-video overflow-hidden bg-card">
                      {thumb ? (
                        <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Play className="h-8 w-8 text-brand-cyan/50" />
                        </span>
                      )}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/85 via-transparent to-transparent" />
                      <span className="absolute left-4 top-4 rounded-lg border border-input bg-background/70 px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[.18em] text-brand-cyan backdrop-blur-sm">{video.tag}</span>
                      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-input bg-background/70 text-foreground backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:border-brand-cyan/70 group-hover:text-brand-cyan">
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </span>
                      </span>
                    </span>
                  </button>
                  <div className="p-6 lg:p-7">
                    <h3 className="text-lg font-medium text-foreground">{video.title}</h3>
                    <p className="mt-2 text-[14px] font-light leading-6 text-foreground/75">{video.blurb}</p>
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
      ...(cfToken ? { 'cf-turnstile-response': cfToken, turnstileToken: cfToken } : {}),
    };

    // POST chain, most-protected first:
    //   1. worker /contact — verifies the Turnstile token server-side
    //      before relaying (the static site has no server of its own)
    //   2. FormSubmit AJAX — direct fallback when the worker is unreachable
    //   3. mailto — never lose the inquiry
    const postJson = async (url: string, signal: AbortSignal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
        signal,
      });
      return { res, payload: await res.json().catch(() => null) as { success?: string; ok?: boolean } | null };
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let delivered = false;
      let relayNote = '';
      try {
        const { res, payload } = await postJson(PAID_DOWNLOAD.contactRelayUrl, controller.signal);
        if (res.ok && payload?.ok) delivered = true;
        else relayNote = 'relay';
      } catch {
        relayNote = 'relay';
      }
      if (!delivered) {
        // Worker unreachable (or its env not live yet) — go direct.
        const { res, payload } = await postJson('https://formsubmit.co/ajax/connect@3sverse.com', controller.signal);
        if (!res.ok || payload?.success !== 'true') {
          setServerNote(payload?.message ?? '');
          throw new Error('Contact submission failed');
        }
      }
      clearTimeout(timeoutId);

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
      <Shape v={3} spin={140} floatY={12} floatDur={13} className="shape-subtle absolute -right-40 -top-24 hidden w-[460px] opacity-30 lg:block" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <div className="mb-6 flex items-center justify-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">
              <Sparkles className="h-3.5 w-3.5 text-brand-magenta" /> Ready when you are
            </div>
            <h2 className="text-[clamp(2.4rem,4.6vw,4rem)] font-light leading-[1.05] tracking-[-0.02em] text-foreground">
              Bring us the <span className="text-brand-cyan">bottleneck.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-[16px] font-light leading-8 text-foreground/75">
              Dealer tools for your front office, a website, an app, an AI agent, or a workflow that should have been automated years ago — two clicks below tells us where the hours go, and we&apos;ll show you how to get them back.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <form onSubmit={handleSubmit} data-testid="form-contact" className="relative mx-auto max-w-2xl rounded-3xl border border-border bg-card p-7 shadow-[0_30px_100px_rgba(0,0,0,.15)] dark:shadow-[0_30px_100px_rgba(0,0,0,.5)] sm:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="contact-website">Leave this field empty</label>
              <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                Name
                <input required maxLength={120} name="name" value={form.name} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-name" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="Your name" />
              </label>
              <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                Email
                <input required maxLength={254} type="email" name="email" value={form.email} onChange={(event) => { setForm((current) => ({ ...current, email: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-email" autoComplete="email" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="you@company.com" />
              </label>
              <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground sm:col-span-2">
                Organization
                <input required maxLength={160} name="organization" value={form.organization} onChange={(event) => { setForm((current) => ({ ...current, organization: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-organization" className="mt-2 w-full rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="Company or organization" />
              </label>
              <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                Locations you run
                <select name="locations" value={form.locations} onChange={(event) => { setForm((current) => ({ ...current, locations: event.target.value })); setSubmitStatus('idle'); }} data-testid="select-contact-locations" className="mt-2 w-full appearance-none rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-brand-cyan/70">
                  <option className="bg-card">Just exploring</option>
                  <option className="bg-card">1 store</option>
                  <option className="bg-card">2–5 stores</option>
                  <option className="bg-card">6–15 stores</option>
                  <option className="bg-card">16+ stores</option>
                </select>
              </label>
              <label className="block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
                I&apos;m interested in
                <select name="interest" value={form.interest} onChange={(event) => { setForm((current) => ({ ...current, interest: event.target.value })); setSubmitStatus('idle'); }} data-testid="select-contact-interest" className="mt-2 w-full appearance-none rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-brand-cyan/70">
                  <option className="bg-card">Dealer tools (Extractor / Ordering / Rebate)</option>
                  <option className="bg-card">Custom software / automation</option>
                  <option className="bg-card">Website or app</option>
                  <option className="bg-card">Something else</option>
                </select>
              </label>
            </div>
            <label className="mt-5 block font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
              Message
              <textarea required maxLength={5000} name="message" value={form.message} onChange={(event) => { setForm((current) => ({ ...current, message: event.target.value })); setSubmitStatus('idle'); }} data-testid="textarea-contact-message" rows={5} className="mt-2 w-full resize-y rounded-xl border border-border bg-foreground/[.03] px-4 py-3 font-sans text-[14px] normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand-cyan/70" placeholder="What should we automate first?" />
            </label>
            {TURNSTILE_SITE_KEY && <TurnstileWidget key={cfResetCount} onToken={setCfToken} />}
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button type="submit" disabled={submitStatus === 'sending'} data-testid="button-contact-submit" className="group inline-flex items-center justify-center gap-2.5 rounded-xl border bg-white px-6 py-3.5 text-[15px] font-semibold tracking-tight text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8] disabled:cursor-wait disabled:opacity-70">
                {submitStatus === 'sending' ? 'Sending...' : 'Send message'}
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </button>
              <span aria-live="polite" className="font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                {submitStatus === 'success' ? 'Message sent — we’ll be in touch.' : submitStatus === 'error' ? `${serverNote || 'Couldn’t send'}. Email ${CONTACT_EMAIL} directly.` : 'We reply within one US Central business day.'}
              </span>
            </div>
            <p className="mt-5 text-[12.5px] font-light leading-5 text-muted-foreground">
              By sending you agree to our <a href="#/privacy" data-testid="link-contact-privacy" className="underline decoration-foreground/30 underline-offset-2 hover:text-foreground">Privacy Policy</a> — your details are used only to answer this enquiry and are never sold.
            </p>
          </form>
        </Reveal>
        <Reveal delay={0.16}>
          <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-7 gap-y-3" data-testid="contact-socials">
            <span className="font-mono-tech text-[10px] uppercase tracking-[.2em] text-muted-foreground">Prefer social? Follow the build —</span>
            <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" data-testid="link-contact-linkedin" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-foreground/85 transition-colors hover:text-brand-cyan"><Linkedin className="h-4 w-4" /> LinkedIn</a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-foreground/85 transition-colors hover:text-brand-magenta"><Instagram className="h-4 w-4" /> Instagram</a>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-foreground/85 transition-colors hover:text-brand-periwinkle"><Facebook className="h-4 w-4" /> Facebook</a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-5 w-auto" />
            <p className="mt-5 text-[14px] font-light leading-7 text-foreground/75">
              Software, systems &amp; operations — apps, websites, AI agents, dashboards, and process automation, built by people who have run the operations themselves.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-14 gap-y-8">
            <div>
              <div className="font-mono-tech text-[10px] uppercase tracking-[.22em] text-muted-foreground">Explore</div>
              <div className="mt-4 flex flex-col gap-2.5">
                {navItems.map((item) => (
                  <a key={item.href} href={item.href} className="text-[14px] font-light text-foreground/85 transition-colors hover:text-brand-cyan">{item.label}</a>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono-tech text-[10px] uppercase tracking-[.22em] text-muted-foreground">Follow</div>
              <div className="mt-4 flex items-center gap-4">
                <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-linkedin" aria-label="3S Verse on LinkedIn" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground/85 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-cyan/60 hover:text-brand-cyan"><Linkedin className="h-4 w-4" /></a>
                <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-instagram" aria-label="3S Verse on Instagram" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground/85 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-magenta/60 hover:text-brand-magenta"><Instagram className="h-4 w-4" /></a>
                <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-facebook" aria-label="3S Verse on Facebook" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground/85 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-periwinkle/60 hover:text-brand-periwinkle"><Facebook className="h-4 w-4" /></a>
              </div>
              <a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-footer-email" className="animate-jiggle mt-5 inline-block font-mono-tech text-[12px] tracking-wider text-brand-cyan dark:bg-none dark:bg-gradient-to-r dark:from-[#6ee7ef] dark:via-[#78a6ff] dark:to-[#e44bd7] dark:bg-clip-text dark:text-transparent">{CONTACT_EMAIL}</a>
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-border pt-7 text-[12.5px] font-light leading-5 text-muted-foreground">
          3S Verse is an independent software provider and is not affiliated with, endorsed by, or sponsored by VidaPay, T-CETRA, Total Wireless, or their parent companies. Product names and trademarks belong to their respective owners. Use of the tools remains subject to the dealer’s applicable agreements and policies.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 font-mono-tech text-[11px] uppercase tracking-[.18em] text-muted-foreground">
          <span>3S Verse {new Date().getFullYear()} © — All rights reserved</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="#/download" data-testid="link-footer-download" className="transition-colors hover:text-foreground">Download</a>
            <a href="#/security" data-testid="link-footer-security" className="transition-colors hover:text-foreground">Security</a>
            <a href="#/privacy" data-testid="link-footer-privacy" className="transition-colors hover:text-foreground">Privacy</a>
            <a href="#/terms" data-testid="link-footer-terms" className="transition-colors hover:text-foreground">Terms</a>
            <a href="#/refund" data-testid="link-footer-refund" className="transition-colors hover:text-foreground">Refund</a>
            <a href="#/eula" data-testid="link-footer-eula" className="transition-colors hover:text-foreground">EULA</a>
            {/* Invoice Studio removed from the footer on purpose — it is the
                seller's tool and must have zero public footprint. It stays
                reachable only by typing the direct URL (#/invoice), which is
                additionally passcode-gated (see src/pages/InvoiceStudio.tsx). */}
            <a href="#top" data-testid="link-footer-top" className="transition-colors hover:text-foreground">Back to top ↑</a>
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
    <div className="noise min-h-[100dvh] overflow-x-clip bg-background">
      <ScrollProgress />
      <Spotlight />
      <ScrollTop />
      <WhatsAppFloat />
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
        <Guides />
        <Faq />
        <Reviews />
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
      <Route path="/order" component={OrderStatusPage} />
      <Route path="/order/:id" component={OrderStatusPage} />
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
        <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          Loading Invoice Studio…
        </div>
      }>
        <InvoiceStudio />
      </Suspense>
    );
  }
  const legalMatch = hash.match(/^#\/(privacy|terms|refund|eula|security)$/);
  if (legalMatch) {
    return (
      <Suspense fallback={
        <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          Loading…
        </div>
      }>
        <LegalPage kind={legalMatch[1] as 'privacy' | 'terms' | 'refund' | 'eula' | 'security'} />
      </Suspense>
    );
  }
  if (hash.startsWith('#/download')) {
    return (
      <Suspense fallback={
        <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground" style={{ fontFamily: 'Montserrat, sans-serif' }}>
          Loading…
        </div>
      }>
        <DownloadPage />
      </Suspense>
    );
  }
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
