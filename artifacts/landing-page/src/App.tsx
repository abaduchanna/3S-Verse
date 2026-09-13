import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AnimatePresence, motion, useInView, useScroll, useSpring, type Variants } from 'framer-motion';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Check,
  Clock3,
  Code2,
  Command,
  Cpu,
  Database,
  Eye,
  Globe2,
  Layers3,
  Linkedin,
  Menu,
  Moon,
  ArrowUpRight,
  Network,
  Package,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Workflow,
  X,
  Zap,
  ArrowUp,
  Sun,
  Star,
  Quote,
} from 'lucide-react';

const queryClient = new QueryClient();
const CONTACT_EMAIL = 'Connect@3SVerse.com';
const LINKEDIN_URL = 'https://www.linkedin.com/company/3s-verse/';
const EXPERIENCE_START_YEAR = 2013;
const YEARS_EXPERIENCE = new Date().getFullYear() - EXPERIENCE_START_YEAR;
const refreshPage = () => window.location.reload();

type Theme = 'light' | 'dark';

// Viewport coords (px) + covering radius of the last theme-toggle press —
// the water-swipe reveal expands from this point.
let waterOrigin = { x: 0, y: 0, r: 0 };

// Theme choice: first-time visitors start light; once the toggle is used the
// choice is saved to localStorage and every reload restores it (see the
// pre-paint script in index.html, which applies the saved class before React
// boots so a saved dark theme never flashes light).
const THEME_STORAGE_KEY = '3s-verse-theme';

function getInitialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable (private mode etc.) — fall through */ }
  return 'light';
}

function ThemeToggle({ mobile = false }: { mobile?: boolean }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === 'dark';
    // Skip any transition on first mount / when the class already matches
    // (App() set it before paint).
    const alreadyApplied = root.classList.contains('dark') === isDark && root.classList.contains('light') !== isDark;
    const applyTheme = () => {
      root.classList.toggle('dark', isDark);
      root.classList.toggle('light', !isDark);
      root.style.colorScheme = theme;
    };
    if (!alreadyApplied) {
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => {
          ready?: Promise<void>;
          finished?: Promise<unknown>;
        };
      };
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (doc.startViewTransition && !reducedMotion) {
        try {
          const transition = doc.startViewTransition(applyTheme);
          // Browsers can intentionally skip a transition when another
          // navigation or transition is already in progress. That is
          // expected and should not reach Vite's runtime error overlay.
          transition.finished?.catch(() => undefined);
          // Water swipe: the new theme floods out from the toggle as a circle
          // with a soft feathered front. @property-capable browsers run the
          // feathered mask wavefront in CSS (index.css); older ones get a
          // hard-edged clip-path reveal driven here instead.
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
          applyTheme();
        }
      } else applyTheme();
    }
    // Persist the choice — the next load (and the pre-paint script in
    // index.html) restores it instead of snapping back to light.
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent('3s-verse-theme-change', { detail: theme }));
  }, [theme]);

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next === 'light' || next === 'dark') setTheme(next);
    };
    window.addEventListener('3s-verse-theme-change', syncTheme);
    return () => window.removeEventListener('3s-verse-theme-change', syncTheme);
  }, []);

  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={theme === 'dark'}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        waterOrigin = {
          x,
          y,
          r: Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)),
        };
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--water-x', `${Math.round(x)}px`);
        rootStyle.setProperty('--water-y', `${Math.round(y)}px`);
        setTheme((current) => current === 'dark' ? 'light' : 'dark');
      }}
      className={`group inline-flex items-center justify-center overflow-hidden border border-[#6ee7ef]/25 bg-[#211d38]/45 text-[#f7f3e8] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#e44bd7]/60 hover:text-[#e44bd7] ${mobile ? 'h-10 w-10' : 'h-9 w-9'}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          className="flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.4, rotate: -180 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.4, rotate: 180 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

// Full 3S wordmark that trails the mouse across the page, floating just to
// the RIGHT of the pointer (no chip/background). Driven by a
// requestAnimationFrame lerp loop that writes transforms straight to the
// DOM node — no re-renders per frame. Only rendered for non-touch pointers
// with motion allowed; hidden until the first pointer move and when the
// cursor leaves the window.
const CURSOR_OFFSET_X = 24;

function CursorLogo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip touch-only devices and users who opt out of motion. Checking the
    // negative (coarse) rather than requiring a fine pointer also keeps the
    // follower alive in environments that report no pointer at all.
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const target = { x: -200, y: -200 };
    const pos = { x: -200, y: -200 };
    let scale = 0.5;
    let targetScale = 0.9;
    let tilt = 0;
    let raf = 0;
    let idleTimer = 0;
    let shown = false;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      target.x = event.clientX;
      target.y = event.clientY;
      if (!shown) {
        shown = true;
        pos.x = target.x;
        pos.y = target.y;
        el.style.opacity = '1';
      }
      const speed = Math.min(1, Math.hypot(event.movementX || 0, event.movementY || 0) / 22);
      targetScale = 0.9 + speed * 0.25;
      tilt = Math.max(-9, Math.min(9, (event.movementX || 0) * 1.1));
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { targetScale = 0.9; }, 140);
    };

    const onLeave = () => { el.style.opacity = '0'; };
    const onEnter = () => { if (shown) el.style.opacity = '1'; };

    const tick = () => {
      pos.x += (target.x - pos.x) * 0.14;
      pos.y += (target.y - pos.y) * 0.14;
      scale += (targetScale - scale) * 0.1;
      tilt *= 0.88;
      // Floats to the RIGHT of the pointer: +24px gap, vertically centred on
      // the cursor line (translateY(-50%)); no -50% on X — the logo's left
      // edge starts where the offset ends.
      el.style.transform = `translate3d(${(pos.x + CURSOR_OFFSET_X).toFixed(1)}px, ${pos.y.toFixed(1)}px, 0) translateY(-50%) rotate(${tilt.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.documentElement.addEventListener('mouseenter', onEnter);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.documentElement.removeEventListener('mouseenter', onEnter);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[70] opacity-0 will-change-transform"
      style={{ transform: 'translate3d(-200px, -200px, 0)', transition: 'opacity 0.35s ease' }}
    >
      <img
        src="/logo.png"
        alt=""
        draggable={false}
        className="h-8 w-auto select-none drop-shadow-[0_2px_10px_rgba(4,3,15,.35)]"
      />
    </div>
  );
}

// PROJECT VIDEOS — to show a project video on the page, add one entry to
// this list. `url` accepts:
//   • a YouTube link        'https://www.youtube.com/watch?v=XXXXXXXXXXX'
//   • a YouTube Shorts link 'https://youtube.com/shorts/XXXXXXXXXXX'
//   • a Vimeo link          'https://vimeo.com/123456789'
//   • a direct video file   '/videos/my-demo.mp4' (drop the file into
//                           public/videos/) or any hosted .mp4/.webm URL
// `poster` (optional) is the card thumbnail; leave it out and YouTube links
// automatically use their own thumbnail, everything else gets a styled
// gradient placeholder until a poster is added.
// While this list is empty the whole Work section (and its nav item) stays
// hidden, so nothing unfinished ever shows on the live page.
const PROJECT_VIDEOS: ProjectVideo[] = [
  // Copy this shape for each of your own videos:
  // {
  //   title: 'Inventory automation demo',
  //   blurb: 'One-line description shown under the video title.',
  //   tag: 'Automation',
  //   url: 'https://www.youtube.com/watch?v=XXXXXXXXXXX',
  //   poster: '/videos/demo-poster.jpg',
  // },
];

type ProjectVideo = {
  title: string;
  blurb: string;
  tag: string;
  // YouTube watch/shorts link, Vimeo link, or a direct .mp4/.webm URL
  // (local files go in public/videos/ and are referenced as /videos/…).
  url: string;
  // Optional card thumbnail; YouTube links fall back to their own thumbnail.
  poster?: string;
};

// Accept a YouTube / Vimeo / direct-file URL and return what the card and
// the lightbox need. Anything that is not YouTube/Vimeo is treated as a
// direct media file URL.
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

const navItems = [
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'How it works', href: '#approach' },
  { label: 'Outcomes', href: '#outcomes' },
  // "Work" only appears once there is at least one project video to show.
  ...(PROJECT_VIDEOS.length > 0 ? [{ label: 'Work', href: '#work' }] : []),
];

// Work is section /04 when it renders; Reviews shifts back to /04 while the
// video list is empty so the visible numbering never skips.
const REVIEWS_SECTION_NO = PROJECT_VIDEOS.length > 0 ? '05' : '04';

const features = [
  {
    index: '01',
    title: 'Process automation',
    description: 'Cut manual work from your operations. I turn repeatable, error-prone workflows into fast, reliable pipelines — often with Python scripts and zero heavy tooling.',
    icon: Zap,
    color: 'cyan',
    detail: ['Workflow automation', 'Python scripts', 'Manual-work reduction'],
  },
  {
    index: '02',
    title: 'Web & mobile apps',
    description: 'Full-stack web and Android apps built to run your business — from internal tools to customer-facing products delivered on schedule and on budget.',
    icon: Smartphone,
    color: 'magenta',
    detail: ['Full-stack web apps', 'Android development', 'Product to rollout'],
  },
  {
    index: '03',
    title: 'Custom websites',
    description: 'High-performing, conversion-driven websites that make you look every bit as sharp as you operate — fast, responsive, and built to bring in business.',
    icon: Globe2,
    color: 'cyan',
    detail: ['Conversion-led design', 'Fast & responsive', 'Built to scale'],
  },
  {
    index: '04',
    title: 'AI agents & assistants',
    description: 'Practical AI applied where it saves real hours — agents that research, draft, reconcile, and handle the busywork so your team can focus on decisions.',
    icon: Bot,
    color: 'magenta',
    detail: ['Custom AI agents', 'Workflow copilots', 'Automation with AI'],
  },
  {
    index: '05',
    title: 'Dashboards & data',
    description: 'Live KPI dashboards and reporting that turn scattered data into a clear, daily operating picture for inventory, sales, procurement, and finance.',
    icon: BarChart3,
    color: 'cyan',
    detail: ['KPI dashboards', 'ERP & spreadsheet reporting', 'Live operational view'],
  },
  {
    index: '06',
    title: 'Supply chain & operations',
    description: `Deep real-world operations muscle — inventory planning, procurement, rebates and claims — backed by ${YEARS_EXPERIENCE}+ years across telecom, FMCG, and pharma.`,
    icon: Boxes,
    color: 'magenta',
    detail: ['Inventory & procurement', 'Claims & loss recovery', 'Multi-location operations'],
  },
];

const reveal: Variants = {
  hidden: { opacity: 0, y: 36, filter: 'blur(6px)' },
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

function TechnicalBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="grid-tech absolute inset-x-0 top-0 h-[740px] opacity-55 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="absolute -right-24 top-28 h-80 w-80 rounded-full bg-[#e44bd7]/20 blur-[90px]" />
      <div className="absolute left-[8%] top-[26%] h-64 w-64 rounded-full bg-[#6ee7ef]/15 blur-[90px]" />
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 55, repeat: Infinity, ease: 'linear' }} className="absolute right-[5%] top-36 h-[420px] w-[420px] rounded-full border border-[#6ee7ef]/15 border-dashed" />
      <motion.div animate={{ rotate: -360 }} transition={{ duration: 42, repeat: Infinity, ease: 'linear' }} className="absolute right-[10%] top-52 h-[310px] w-[310px] rounded-full border border-[#e44bd7]/15" />
      <div className="absolute left-[6%] top-[18%] h-2 w-2 bg-[#6ee7ef] shadow-[0_0_28px_#6ee7ef] animate-pulse-line" />
      <div className="absolute left-[11%] top-[57%] h-1.5 w-1.5 bg-[#ff9d66] shadow-[0_0_22px_#ff9d66]" />
      <div className="absolute right-[24%] top-[13%] h-1.5 w-1.5 bg-[#e44bd7] shadow-[0_0_22px_#e44bd7]" />
      <div className="absolute right-[14%] top-[66%] h-2 w-2 bg-[#c7ef70] shadow-[0_0_28px_#c7ef70]" />
      <motion.div animate={{ y: [0, 35, 0], opacity: [.2, .65, .2] }} transition={{ duration: 6, repeat: Infinity }} className="absolute right-[30%] top-0 h-[500px] w-px bg-gradient-to-b from-transparent via-[#6ee7ef] to-transparent" />
    </div>
  );
}

function Spotlight() {
  const [pos, setPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  useEffect(() => {
    const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY, visible: true });
    const onLeave = () => setPos((p) => ({ ...p, visible: false }));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[30] h-[620px] w-[620px] rounded-full"
      animate={{
        x: pos.x - 310,
        y: pos.y - 310,
        opacity: pos.visible ? 1 : 0,
        scale: pos.visible ? 1 : .6,
      }}
      transition={{ type: 'spring', stiffness: 80, damping: 24, mass: 1 }}
      aria-hidden="true"
      style={{
        background:
          'radial-gradient(circle, rgba(110,231,239,.17) 0%, rgba(228,75,215,.10) 42%, transparent 70%)',
        filter: 'blur(5px)',
      }}
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
          className="group fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center overflow-hidden border border-[#6ee7ef]/30 bg-[#211d38]/80 text-[#6ee7ef] shadow-[0_10px_30px_rgba(4,3,15,.4)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-[#e44bd7]/60 hover:text-[#e44bd7] hover:shadow-[0_18px_44px_rgba(4,3,15,.55),0_0_18px_rgba(110,231,239,.25)]"
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 animate-glass-shine bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <ArrowUp className="relative z-20 h-5 w-5 transition-transform duration-300 group-hover:-translate-y-0.5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] shadow-[0_0_14px_rgba(110,231,239,.5)]"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

function Button({ children, href = '#contact', variant = 'red', testId }: { children: ReactNode; href?: string; variant?: 'red' | 'outline'; testId: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      className={`group inline-flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold tracking-tight transition-transform duration-300 hover:-translate-y-0.5 ${
        variant === 'red'
          ? 'bg-[#e44bd7] text-[#17121c] shadow-[0_14px_32px_rgba(228,75,215,.28)] hover:bg-[#f06ae4] hover:shadow-[0_18px_40px_rgba(228,75,215,.38)]'
          : 'border border-[#6ee7ef]/30 bg-[#211d38]/45 text-[#f7f3e8] hover:border-[#6ee7ef]/70 hover:bg-[#2c2446]'
      }`}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
    </a>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-[#6ee7ef]/15 bg-[#11101c]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[74px] max-w-7xl items-center justify-between px-5 lg:px-8">
        <a href="#" data-testid="link-brand" onClick={(e) => { e.preventDefault(); refreshPage(); }} className="shrink-0">
          <img src="/logo.png" alt="3S Verse" className="animate-logo-glow h-10 w-auto object-contain" />
        </a>
        <nav className="group hidden items-center gap-8 bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text transition-all duration-300 group-hover:drop-shadow-[0_0_10px_rgba(110,231,239,.7)] md:flex">
            {navItems.map((item) => (
            <a key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase().replace(' ', '-')}`} className="font-mono-tech text-[11px] font-medium uppercase tracking-wider text-transparent">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button href="#contact" testId="button-nav-get-started">Get started</Button>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle mobile />
          <button data-testid="button-mobile-menu" onClick={() => setOpen(!open)} className="border border-[#6ee7ef]/25 p-2 text-[#f7f3e8]" aria-label={open ? 'Close menu' : 'Open menu'}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="border-t border-[#6ee7ef]/15 bg-[#171528] px-5 py-4 md:hidden">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} data-testid={`link-mobile-${item.label.toLowerCase().replace(' ', '-')}`} className="block border-b border-[#6ee7ef]/15 py-3 bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text text-sm text-transparent">
                {item.label}
              </a>
            ))}
            <div className="mt-4 flex items-center justify-between border-t border-[#6ee7ef]/15 pt-4">
              <span className="font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#aaa7be]/60">Appearance</span>
              <ThemeToggle mobile />
            </div>
            <a href="#contact" onClick={() => setOpen(false)} data-testid="button-mobile-get-started" className="mt-4 block bg-[#e44bd7] px-4 py-3 text-center text-sm font-semibold text-[#17121c]">Get started</a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function CommandVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[520px] [perspective:1200px]">
      <motion.div initial={{ opacity: 0, y: 40, rotateY: -12, rotateX: 5 }} animate={{ opacity: 1, y: 0, rotateY: -7, rotateX: 2 }} transition={{ duration: 1, delay: .35, ease: [0.22, 1, .36, 1] }} className="relative overflow-hidden border border-cyan-100/25 bg-[#102d91]/90 shadow-[0_32px_90px_rgba(1,17,92,.55)] [transform-style:preserve-3d]">
        <div className="flex items-center justify-between border-b border-[#6ee7ef]/15 px-4 py-3">
          <div className="flex items-center gap-2"><Command className="h-3.5 w-3.5 text-[#6ee7ef]" /><span className="font-mono-tech text-[10px] tracking-[.2em] text-[#d8d5e8]/70">OPERATIONS / LIVE</span></div>
          <div className="flex items-center gap-1.5 font-mono-tech text-[10px] text-[#6ee7ef]"><span className="h-1.5 w-1.5 bg-[#c7ef70]" /> SYNCED</div>
        </div>
        <div className="relative grid grid-cols-[1fr_1.15fr] gap-4 p-4">
          <div className="space-y-3">
            <div className="border border-[#6ee7ef]/15 bg-[#1a1830] p-3">
              <div className="font-mono-tech text-[9px] uppercase tracking-wider text-[#aaa7be]/60">Throughput</div>
              <div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-tight text-[#f7f3e8]">84.7<span className="text-sm text-[#6ee7ef]">%</span></strong><span className="font-mono-tech text-[10px] text-[#c7ef70]">+12.4%</span></div>
              <div className="mt-3 flex h-12 items-end gap-1">
                {[35, 48, 40, 58, 52, 67, 61, 76, 72, 88, 82, 95].map((height, i) => <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${height}%` }} transition={{ delay: .8 + i * .04, duration: .45 }} className={`w-full ${i > 8 ? 'bg-[#6ee7ef]' : 'bg-[#7162d9]'}`} />)}
              </div>
            </div>
            <div className="border border-[#6ee7ef]/15 bg-[#1a1830] p-3">
              <div className="flex items-center justify-between font-mono-tech text-[9px] uppercase tracking-wider text-[#aaa7be]/60"><span>Queue health</span><span className="text-[#c7ef70]">nominal</span></div>
              <div className="mt-3 h-1.5 bg-[#0f0e1b]"><motion.div initial={{ width: 0 }} animate={{ width: '72%' }} transition={{ delay: 1, duration: 1 }} className="h-full bg-gradient-to-r from-[#6ee7ef] to-[#e44bd7]" /></div>
            </div>
          </div>
          <div className="relative border border-[#e44bd7]/25 bg-[#211b3b] p-3">
            <div className="flex items-center justify-between"><span className="font-mono-tech text-[9px] uppercase tracking-wider text-[#aaa7be]/60">Flow map</span><Network className="h-3.5 w-3.5 text-[#e44bd7]" /></div>
            <svg viewBox="0 0 210 160" className="mt-3 h-[160px] w-full">
              <path d="M19 93 C48 93 41 45 73 45 S100 120 130 113 149 47 189 47" fill="none" stroke="#6ee7ef" strokeWidth="1.5" strokeDasharray="4 4" />
              <path d="M30 21 C58 21 57 75 89 75 S124 24 158 24" fill="none" stroke="#e44bd7" strokeWidth="1" opacity=".8" />
              {[[19,93],[73,45],[130,113],[189,47],[30,21],[89,75],[158,24]].map(([cx, cy], i) => <g key={i}><circle cx={cx} cy={cy} r="5" fill="#211b3b" stroke={i % 2 ? '#e44bd7' : '#6ee7ef'} strokeWidth="1.5" /><circle cx={cx} cy={cy} r="1.7" fill={i % 2 ? '#e44bd7' : '#6ee7ef'} /></g>)}
            </svg>
            <div className="absolute bottom-3 left-3 right-3 flex justify-between border-t border-[#6ee7ef]/10 pt-2 font-mono-tech text-[9px] text-[#aaa7be]/50"><span>7 active paths</span><span className="text-[#6ee7ef]">0 blocked</span></div>
          </div>
          <div className="absolute -bottom-5 -left-7 border border-[#ff9d66]/40 bg-[#2a203b] px-3 py-2 shadow-xl">
            <div className="flex items-center gap-2"><Bell className="h-3.5 w-3.5 text-[#ff9d66]" /><span className="font-mono-tech text-[9px] text-[#ffe0cf]">2 rules executed</span></div>
          </div>
        </div>
        <div className="animate-scan absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-transparent via-cyan-200/10 to-transparent" />
      </motion.div>
      <div className="absolute -right-5 -top-7 hidden border border-[#e44bd7]/25 bg-[#211b3b]/85 p-3 backdrop-blur md:block animate-drift-slow">
        <div className="font-mono-tech text-[9px] uppercase tracking-widest text-[#e9a8e5]/70">latency</div>
        <div className="mt-1 text-xl text-[#f7f3e8]">42<span className="text-xs text-[#6ee7ef]">ms</span></div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative flex min-h-[780px] items-center overflow-hidden border-b border-[#6ee7ef]/10 bg-[#11101c] pt-24">
      <TechnicalBackdrop />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-16 px-5 py-24 lg:grid-cols-[1.06fr_.94fr] lg:px-8 lg:py-28">
        <div>
          <Reveal><div className="mb-7 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]"><span className="h-px w-8 bg-[#6ee7ef]" />Software & operations, delivered end to end</div></Reveal>
          <Reveal delay={.1}><h1 className="max-w-3xl text-balance text-[clamp(3.4rem,7vw,6.5rem)] font-semibold leading-[.9] tracking-[-.07em] text-[#f7f3e8]">I build the tech<br /><span className="bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text text-transparent">your business runs on.</span></h1></Reveal>
          <Reveal delay={.2}><p className="mt-8 max-w-xl text-lg leading-8 text-[#d8d5e8]/75">3S Verse — apps, websites, AI agents, dashboards, and process automation that cut the manual work and keep your operation moving. Backed by {YEARS_EXPERIENCE}+ years of real operations experience.</p></Reveal>
          <Reveal delay={.3}><div className="mt-9 flex flex-wrap items-center gap-4"><Button href="#contact" testId="button-hero-get-started">Let's build something</Button><a href="#capabilities" data-testid="link-hero-explore" className="group inline-flex items-center gap-2 px-2 py-3 text-sm font-medium text-[#d8d5e8]/80 hover:text-[#f7f3e8]"><Play className="h-4 w-4 fill-current text-[#6ee7ef]" /> See what I build <ArrowDownRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:translate-y-1" /></a></div></Reveal>
          <Reveal delay={.4}><div className="mt-16 flex flex-wrap gap-x-8 gap-y-4 border-t border-[#6ee7ef]/15 pt-5 font-mono-tech text-[10px] uppercase tracking-[.15em] text-[#aaa7be]/55"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 bg-[#c7ef70]" /> {YEARS_EXPERIENCE}+ years operations</span><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#6ee7ef]" /> Processes automated</span><span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#e44bd7]" /> Cost recovered</span></div></Reveal>
        </div>
        <CommandVisual />
      </div>
      <div className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 items-center gap-3 font-mono-tech text-[9px] uppercase tracking-[.3em] text-[#aaa7be]/45 md:flex"><span className="h-8 w-px bg-gradient-to-b from-transparent to-[#6ee7ef]/60" /> Scroll to inspect system</div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="capabilities" className="relative overflow-hidden bg-[#18152a] py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
         <Reveal><div className="flex flex-col justify-between gap-8 border-b border-[#6ee7ef]/15 pb-12 md:flex-row md:items-end"><div><div className="mb-5 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]"><span className="mr-3 text-[#e44bd7]">/</span>01 — What I can build</div><h2 className="max-w-2xl text-4xl font-semibold tracking-[-.05em] text-[#f7f3e8] sm:text-5xl lg:text-6xl">Everything your business needs to <span className="text-[#6ee7ef]">run and grow.</span></h2></div><p className="max-w-sm text-sm leading-7 text-[#d8d5e8]/65">Not one tool — a full spectrum: from a new website to automated operations, AI to dashboards. Built to cut the manual work that slows you down.</p></div></Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {features.map((feature, i) => {
            const Icon = feature.icon;
             const accent = feature.color === 'magenta' ? '#e44bd7' : '#6ee7ef';
             return <Reveal key={feature.title} delay={i * .08}><motion.article whileHover={{ y: -8, scale: 1.01 }} data-testid={`card-service-${feature.index}`} className="group relative min-h-[330px] overflow-hidden border border-[#6ee7ef]/15 bg-[#211d38]/80 p-7 shadow-[0_16px_45px_rgba(4,3,15,.2)] transition-colors duration-500 hover:border-[#6ee7ef]/45 hover:bg-[#2a2447] lg:p-9">
              <div className="absolute right-0 top-0 h-36 w-36 opacity-20 transition-all duration-500 group-hover:scale-125 group-hover:opacity-40" style={{ background: `radial-gradient(circle at top right, ${accent}, transparent 67%)` }} />
               <div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center border border-[#6ee7ef]/20 bg-[#302953]" style={{ color: accent }}><Icon className="h-5 w-5" /></div><span className="font-mono-tech text-[10px] text-[#d8d5e8]/40">{feature.index}</span></div>
               <h3 className="mt-14 text-2xl font-semibold tracking-[-.03em] text-[#f7f3e8]">{feature.title}</h3>
               <p className="mt-3 max-w-md text-sm leading-6 text-[#d8d5e8]/65">{feature.description}</p>
               <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">{feature.detail.map((item) => <span key={item} className="flex items-center gap-2 font-mono-tech text-[9px] uppercase tracking-wide text-[#d8d5e8]/50"><Check className="h-3 w-3 text-[#6ee7ef]" /> {item}</span>)}</div>
                <ArrowUpRight className="absolute bottom-8 right-8 h-5 w-5 -translate-x-2 translate-y-2 text-[#d8d5e8]/20 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-[#6ee7ef] group-hover:opacity-100" />
             </motion.article></Reveal>;
          })}
        </div>
      </div>
    </section>
  );
}

function Approach() {
  return (
    <section id="approach" className="relative overflow-hidden border-y border-[#6ee7ef]/10 bg-[#11101c] py-28 lg:py-36">
      <div className="absolute inset-y-0 right-0 w-1/2 grid-tech opacity-25 [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid gap-16 lg:grid-cols-[.8fr_1.2fr]">
           <Reveal><div><div className="mb-5 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]"><span className="mr-3 text-[#e44bd7]">/</span>02 — How I work</div><h2 className="text-4xl font-semibold leading-[.98] tracking-[-.05em] text-[#f7f3e8] sm:text-5xl">From <span className="text-[#e44bd7]">problem</span> to shipped, fast.</h2><p className="mt-7 max-w-sm text-sm leading-7 text-[#d8d5e8]/65">I don't hand you a tool and disappear. I understand your operation, build exactly what removes the friction, and keep it running as you grow.</p><a href="#contact" data-testid="link-approach-talk" className="mt-8 inline-flex items-center gap-3 border-b border-[#6ee7ef]/40 pb-2 text-sm font-semibold text-[#6ee7ef] hover:text-[#f7f3e8]">Tell me what's slowing you down <ArrowRight className="h-4 w-4" /></a></div></Reveal>
          <div className="space-y-0">
            {[
              ['01', 'Understand your work', 'I dig into how your business actually operates — the manual loops, the bottlenecks, the time sinks nobody tracks.'],
              ['02', 'Build the solution', 'Apps, websites, AI, dashboards, or automation — the right build to remove the friction, shipped cleanly and on time.'],
              ['03', 'Keep it moving', 'I stay close as your business evolves, tuning and extending the system so it never becomes the next bottleneck.'],
             ].map(([number, title, copy], i) => <Reveal key={number} delay={i * .12}><div className="group flex gap-6 border-t border-[#6ee7ef]/15 py-8"><span className="font-mono-tech text-[10px] text-[#6ee7ef]">{number}</span><div><h3 className="text-xl font-medium text-[#f7f3e8] transition-colors group-hover:text-[#6ee7ef]">{title}</h3><p className="mt-2 max-w-lg text-sm leading-6 text-[#d8d5e8]/60">{copy}</p></div><ArrowRight className="ml-auto mt-1 h-4 w-4 text-[#d8d5e8]/30 transition-transform group-hover:translate-x-2 group-hover:text-[#6ee7ef]" /></div></Reveal>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  return (
    <section id="outcomes" className="relative overflow-hidden bg-[#241b39] py-28 lg:py-36">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
         <Reveal><div className="mb-14 flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><div className="mb-5 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#d8d5e8]"><span className="mr-3 text-[#e44bd7]">/</span>03 — Real results</div><h2 className="max-w-3xl text-4xl font-semibold tracking-[-.05em] text-[#f7f3e8] sm:text-5xl lg:text-6xl">Operations and builds that <span className="bg-gradient-to-r from-[#6ee7ef] to-[#e44bd7] bg-clip-text text-transparent">recover real money.</span></h2></div><div className="flex items-center gap-2 font-mono-tech text-[10px] uppercase tracking-widest text-[#d8d5e8]/60"><span className="h-2 w-2 bg-[#c7ef70]" /> {YEARS_EXPERIENCE}+ years delivered</div></div></Reveal>
         <div className="grid gap-px overflow-hidden border border-[#6ee7ef]/15 bg-[#6ee7ef]/15 sm:grid-cols-3">
          {[
            { value: '$265K+', label: 'recovered in claims & losses', icon: BarChart3 },
            { value: '$121K', label: 'vendor savings in one year', icon: Cpu },
            { value: '15%', label: 'inventory turnover lift', icon: Database },
           ].map(({ value, label, icon: Icon }, i) => <Reveal key={label} delay={i * .1}><div data-testid={`stat-outcome-${i}`} className="relative bg-[#302249] p-7 lg:p-10"><Icon className="h-5 w-5 text-[#6ee7ef]/70" /><div className="mt-16 text-5xl font-semibold tracking-[-.07em] text-[#f7f3e8] lg:text-6xl">{value}</div><div className="mt-3 font-mono-tech text-[10px] uppercase tracking-[.18em] text-[#d8d5e8]/60">{label}</div></div></Reveal>)}
        </div>
      </div>
    </section>
  );
}

// Full-screen player for a project video. Esc, backdrop click, or the close
// button dismiss it; body scroll is locked while open. YouTube/Vimeo play in
// a privacy-minded iframe, direct files in a native <video> element.
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
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0c0b14]/92 p-4 backdrop-blur-md sm:p-8"
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
                <h3 className="mt-1 truncate text-lg font-semibold tracking-[-.02em] text-[#f7f3e8]">{video.title}</h3>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                data-testid="button-video-close"
                aria-label="Close video"
                className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#6ee7ef]/30 bg-[#211d38]/80 text-[#f7f3e8] transition-all duration-300 hover:border-[#e44bd7]/60 hover:text-[#e44bd7]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full overflow-hidden border border-[#6ee7ef]/25 bg-[#11101c] shadow-[0_36px_100px_rgba(4,3,15,.56)]">
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
  // Nothing to show yet — the section (and its nav item) stays hidden until
  // at least one video is added to PROJECT_VIDEOS. The condition is a module
  // constant, so this branch never flips between renders.
  if (PROJECT_VIDEOS.length === 0) return null;
  return (
    <section id="work" className="relative overflow-hidden border-y border-[#6ee7ef]/10 bg-[#11101c] py-28 lg:py-36">
      <div className="absolute inset-x-0 bottom-0 h-[420px] grid-tech opacity-20 [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal><div className="mb-14 flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><div className="mb-5 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]"><span className="mr-3 text-[#e44bd7]">/</span>04 — See the work</div><h2 className="max-w-3xl text-4xl font-semibold tracking-[-.05em] text-[#f7f3e8] sm:text-5xl lg:text-6xl">Watch the systems <span className="bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text text-transparent">in action.</span></h2></div><p className="max-w-sm text-sm leading-7 text-[#d8d5e8]/60">Short walk-throughs of real builds — automation pipelines, dashboards, and tools doing their job. Click any card to play.</p></div></Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {PROJECT_VIDEOS.map((video, i) => {
            const thumb = videoThumbUrl(video);
            return (
              <Reveal key={video.title} delay={i * 0.1}>
                <motion.article
                  whileHover={{ y: -8, scale: 1.01 }}
                  data-testid={`video-card-${i}`}
                  className="group relative overflow-hidden border border-[#6ee7ef]/15 bg-[#211d38]/80 shadow-[0_16px_45px_rgba(4,3,15,.2)] transition-colors duration-500 hover:border-[#6ee7ef]/45 hover:bg-[#2a2447]"
                >
                  <button type="button" onClick={() => setActive(video)} data-testid={`video-play-${i}`} aria-label={`Play video: ${video.title}`} className="block w-full cursor-pointer text-left">
                    <span className="relative block aspect-video overflow-hidden bg-[#1a1830]">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                          onError={(event) => { event.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#211d38] via-[#302953] to-[#211b3b]">
                          <Play className="h-8 w-8 text-[#6ee7ef]/50" />
                        </span>
                      )}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#11101c]/85 via-[#11101c]/10 to-transparent" />
                      <span className="absolute left-4 top-4 border border-[#6ee7ef]/30 bg-[#11101c]/70 px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[.18em] text-[#6ee7ef] backdrop-blur-sm">{video.tag}</span>
                      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[#6ee7ef]/40 bg-[#211d38]/70 text-[#6ee7ef] backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:border-[#e44bd7]/70 group-hover:text-[#e44bd7] group-hover:shadow-[0_0_28px_rgba(228,75,215,.35)]">
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </span>
                      </span>
                      <span className="absolute bottom-3 right-4 font-mono-tech text-[9px] uppercase tracking-[.2em] text-[#d8d5e8]/60">▶ Watch</span>
                    </span>
                  </button>
                  <div className="p-6 lg:p-7">
                    <h3 className="text-lg font-semibold tracking-[-.02em] text-[#f7f3e8] transition-colors duration-300 group-hover:text-[#6ee7ef]">{video.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#d8d5e8]/65">{video.blurb}</p>
                    <button type="button" onClick={() => setActive(video)} data-testid={`video-open-${i}`} className="mt-4 inline-flex cursor-pointer items-center gap-2 font-mono-tech text-[10px] uppercase tracking-wider text-[#6ee7ef] transition-colors duration-300 hover:text-[#e44bd7]">
                      Watch it in action <Play className="h-3 w-3 fill-current" />
                    </button>
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

function Reviews() {
  const reviews = [
    {
      quote: 'He rebuilt our ordering process end to end — cut the manual inventory busywork by more than half. Our buyers just work smarter now.',
      name: 'Operations Director',
      org: 'Wireless Retail Group',
      initials: 'RD',
      highlight: true,
    },
    {
      quote: 'The dashboard he built changed how we run the business. For the first time the whole team sees inventory, sales, and claims in one live view.',
      name: 'Finance Lead',
      org: 'FMCG Distributor',
      initials: 'FK',
    },
    {
      quote: 'Fast, pragmatic, and genuinely invested. He understood our workflow before we finished explaining it and shipped something we use every day.',
      name: 'General Manager',
      org: 'Multi-location Retail',
      initials: 'GM',
    },
  ];
  return (
    <section id="reviews" className="relative overflow-hidden border-y border-[#6ee7ef]/10 bg-[#18152a] py-28 lg:py-36">
      <div className="absolute inset-x-0 top-0 h-[420px] grid-tech opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal><div className="mb-14 flex flex-col justify-between gap-7 md:flex-row md:items-end"><div><div className="mb-5 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]"><span className="mr-3 text-[#e44bd7]">/</span>{REVIEWS_SECTION_NO} — Client reviews</div><h2 className="max-w-3xl text-4xl font-semibold tracking-[-.05em] text-[#f7f3e8] sm:text-5xl lg:text-6xl">People who run on <span className="bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text text-transparent">3S Verse.</span></h2></div><p className="max-w-sm text-sm leading-7 text-[#d8d5e8]/60">Feedback from the operations leaders, finance teams, and managers who trusted us with their day-to-day.</p></div></Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {reviews.map((review, i) => (
            <Reveal key={review.name} delay={i * .1}>
              <figure className="group relative flex h-full flex-col justify-between overflow-hidden border border-[#6ee7ef]/15 bg-[#211d38]/75 p-7 shadow-[0_16px_45px_rgba(4,3,15,.2)] transition-colors duration-500 hover:border-[#6ee7ef]/40 hover:bg-[#2a2447] lg:p-8">
                <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-36 w-36 opacity-15 transition-opacity duration-500 group-hover:opacity-30 bg-[radial-gradient(circle_at_top_right,rgba(228,75,215,.6),transparent_67%)]" />
                <div>
                  <div className="flex items-center gap-1 text-[#e44bd7]" aria-label="5 out of 5 stars">
                    {Array.from({ length: 5 }).map((_, s) => <Star key={s} className="h-4 w-4 fill-current" />)}
                  </div>
                  <Quote className="mt-6 h-7 w-7 text-[#6ee7ef]/45" />
                  <blockquote className="mt-4 text-[15px] leading-7 text-[#d8d5e8]/85">“{review.quote}”</blockquote>
                </div>
                <figcaption className="mt-8 flex items-center gap-3 border-t border-[#6ee7ef]/12 pt-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e44bd7]/40 bg-[#302953] font-mono-tech text-[11px] font-medium text-[#6ee7ef]">{review.initials}</span>
                  <div><div className="text-sm font-medium text-[#f7f3e8]">{review.name}</div><div className="mt-0.5 font-mono-tech text-[10px] uppercase tracking-[.15em] text-[#aaa7be]/70">{review.org}</div></div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  const [form, setForm] = useState({ name: '', email: '', organization: '', message: '', website: '' });
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [serverNote, setServerNote] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    const fields: Record<string, string> = {
      name: form.name,
      email: form.email,
      organization: form.organization,
      message: form.message,
      _subject: `New project inquiry — ${form.name}${form.organization ? ` (${form.organization})` : ''}`,
      _template: 'table',
      _captcha: 'false',
      _replyto: form.email,
      _honey: form.website,
    };

    try {
      // Challenged visitors would otherwise hang at "Sending..." forever —
      // cap the relay call at 8s and let the mailto handoff take over.
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
        // Surface the relay's specific reason so a misconfiguration is
        // visible in the UI, not swallowed by a generic message.
        setServerNote(payload?.message ?? '');
        throw new Error('Contact submission failed');
      }

      setForm({ name: '', email: '', organization: '', message: '', website: '' });
      setSubmitStatus('success');
    } catch {
      // Relay unreachable (edge/CORS block or network error) — never lose
      // the inquiry: hand it to the visitor's own email client with the
      // message pre-filled. No third-party interstitial, works everywhere.
      try {
        const subject = encodeURIComponent(fields._subject);
        const body = encodeURIComponent(
          `Name: ${form.name}\nEmail: ${form.email}\nOrganization: ${form.organization || '—'}\n\n${form.message}`,
        );
        window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
        setServerNote('your email app just opened with the message pre-filled — press send there');
      } catch {
        setSubmitStatus('error');
      }
    }
  };

  return (
    <section id="contact" className="relative overflow-hidden bg-[#11101c] py-24 lg:py-32">
      <div className="absolute inset-0 grid-tech opacity-20" />
      <motion.div animate={{ x: [0, 30, 0], y: [0, -20, 0] }} transition={{ duration: 10, repeat: Infinity }} className="absolute -right-20 top-10 h-64 w-64 rotate-45 border border-[#e44bd7]/25" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="border border-[#e44bd7]/25 bg-gradient-to-br from-[#3b1d63] via-[#4a2a7a] to-[#8a2a9e] p-8 shadow-[0_24px_80px_rgba(138,42,158,.28)] sm:p-12 lg:p-20">
          <div className="grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
            <div>
              <div className="mb-6 flex items-center gap-3 font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#d8d5e8]"><Sparkles className="h-4 w-4 text-[#6ee7ef]" /> Ready when you are</div>
              <h2 className="max-w-3xl text-4xl font-semibold leading-[.95] tracking-[-.06em] text-[#f7f3e8] sm:text-6xl">Tell me what's slowing your business down.</h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#d8d5e8]/70">A website, an app, an AI agent, or a workflow that should be automated — bring me the bottleneck and I'll bring you the solution.</p>
              <div className="mt-8 flex flex-col items-start gap-4">
                <Button href={`mailto:${CONTACT_EMAIL}`} testId="button-contact-start">Start a project</Button>
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono-tech text-[10px] uppercase tracking-widest text-[#d8d5e8]/55 transition-colors hover:text-[#6ee7ef]">{CONTACT_EMAIL}</a>
              </div>
            </div>
            <form onSubmit={handleSubmit} data-testid="form-contact" className="border border-[#6ee7ef]/20 bg-[#211d38]/50 p-5 backdrop-blur-sm sm:p-7">
              <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="contact-website">Leave this field empty</label>
                <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
              </div>
              <div className="mb-6">
                <div className="font-mono-tech text-[10px] uppercase tracking-[.25em] text-[#6ee7ef]">Contact us</div>
                <p className="mt-2 text-sm leading-6 text-[#d8d5e8]/65">Tell us a little about what you want to build.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#d8d5e8]/75">
                  Name
                  <input required name="name" value={form.name} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-name" className="mt-2 w-full border border-[#6ee7ef]/20 bg-[#11101c]/55 px-3 py-3 font-sans text-sm normal-case tracking-normal text-[#f7f3e8] outline-none transition-colors placeholder:text-[#d8d5e8]/35 focus:border-[#6ee7ef]/70" placeholder="Your name" />
                </label>
                <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#d8d5e8]/75">
                  Email
                  <input required type="email" name="email" value={form.email} onChange={(event) => { setForm((current) => ({ ...current, email: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-email" autoComplete="email" className="mt-2 w-full border border-[#6ee7ef]/20 bg-[#11101c]/55 px-3 py-3 font-sans text-sm normal-case tracking-normal text-[#f7f3e8] outline-none transition-colors placeholder:text-[#d8d5e8]/35 focus:border-[#6ee7ef]/70" placeholder="you@company.com" />
                </label>
                <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#d8d5e8]/75 sm:col-span-2">
                  Organization
                  <input required name="organization" value={form.organization} onChange={(event) => { setForm((current) => ({ ...current, organization: event.target.value })); setSubmitStatus('idle'); }} data-testid="input-contact-organization" className="mt-2 w-full border border-[#6ee7ef]/20 bg-[#11101c]/55 px-3 py-3 font-sans text-sm normal-case tracking-normal text-[#f7f3e8] outline-none transition-colors placeholder:text-[#d8d5e8]/35 focus:border-[#6ee7ef]/70" placeholder="Company or organization" />
                </label>
              </div>
              <label className="mt-4 block font-mono-tech text-[10px] uppercase tracking-wider text-[#d8d5e8]/75">
                Message
                <textarea required name="message" value={form.message} onChange={(event) => { setForm((current) => ({ ...current, message: event.target.value })); setSubmitStatus('idle'); }} data-testid="textarea-contact-message" rows={5} className="mt-2 w-full resize-y border border-[#6ee7ef]/20 bg-[#11101c]/55 px-3 py-3 font-sans text-sm normal-case tracking-normal text-[#f7f3e8] outline-none transition-colors placeholder:text-[#d8d5e8]/35 focus:border-[#6ee7ef]/70" placeholder="What would you like to solve?" />
              </label>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button type="submit" disabled={submitStatus === 'sending'} data-testid="button-contact-submit" className="group inline-flex items-center justify-center gap-3 bg-[#e44bd7] px-5 py-3 text-sm font-semibold tracking-tight text-[#17121c] shadow-[0_14px_32px_rgba(228,75,215,.28)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f06ae4] hover:shadow-[0_18px_40px_rgba(228,75,215,.38)] disabled:cursor-wait disabled:opacity-70">
                  {submitStatus === 'sending' ? 'Sending...' : 'Send message'}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
                <span aria-live="polite" className="font-mono-tech text-[10px] uppercase tracking-wider text-[#d8d5e8]/60">
                  {submitStatus === 'success' ? 'Message sent — we’ll be in touch.' : submitStatus === 'error' ? `${serverNote || 'Couldn’t send'}. Email ${CONTACT_EMAIL} directly.` : 'We reply to every message.'}
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  // Footer visit counter — one POST per browser session (sessionStorage
  // guard), read-only GET on revisits so refreshes never inflate the
  // count. The endpoint degrades gracefully, so any failure simply
  // leaves the counter hidden instead of breaking the footer.
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const counted = (() => {
      try { return window.sessionStorage.getItem('3s-verse-counted') === '1'; } catch { return false; }
    })();
    (async () => {
      try {
        const response = await fetch('/api/visits', { method: counted ? 'GET' : 'POST' });
        const payload = (await response.json().catch(() => null)) as { count?: unknown } | null;
        const count = typeof payload?.count === 'number' && Number.isFinite(payload.count) && payload.count >= 0 ? payload.count : null;
        if (!cancelled && count !== null) setVisits(count);
        if (!counted && response.ok) {
          try { window.sessionStorage.setItem('3s-verse-counted', '1'); } catch { /* storage unavailable */ }
        }
      } catch { /* counter is cosmetic — stay hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return <footer className="border-t border-[#6ee7ef]/10 bg-[#0c0b14]"><div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-8"><div className="flex items-center gap-5"><span data-testid="link-brand-footer" className="shrink-0"><span className="relative inline-block overflow-hidden"><img src="/logo.png" alt="3S Verse" className="h-8 w-auto" /><span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="animate-logo-glass block h-[300px] w-[120px] bg-gradient-to-br from-transparent via-white/40 to-transparent" /></span></span></span><span className="h-5 w-px bg-[#6ee7ef]/20" /><span className="bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text font-mono-tech text-[10px] uppercase tracking-wider text-transparent">Software, systems & operations</span></div><div className="group flex flex-wrap items-center gap-6 bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text font-mono-tech text-[10px] uppercase tracking-wider text-transparent transition-all duration-300 group-hover:drop-shadow-[0_0_10px_rgba(110,231,239,.7)]"><a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" data-testid="link-footer-linkedin" aria-label="3S Verse on LinkedIn" className="inline-flex items-center text-[#d8d5e8]/70 transition-colors hover:text-[#6ee7ef]"><Linkedin aria-hidden="true" className="h-3.5 w-3.5" /></a><a href={`mailto:${CONTACT_EMAIL}`} data-testid="link-footer-email" className="animate-jiggle inline-block bg-gradient-to-r from-[#6ee7ef] via-[#78a6ff] to-[#e44bd7] bg-clip-text text-transparent">{CONTACT_EMAIL}</a>{visits !== null && <span data-testid="footer-visits" className="inline-flex items-center gap-1.5 text-[#d8d5e8]/70"><Eye aria-hidden="true" className="h-3.5 w-3.5 text-[#6ee7ef]" />{visits.toLocaleString('en-US')} visitors</span>}<a href="#top" data-testid="link-footer-top">Back to top ↑</a><span>3S Verse {new Date().getFullYear()} ©</span></div></div></footer>;
}

function Home() {
  return <div className="noise min-h-[100dvh] overflow-hidden bg-[#11101c]"><ScrollProgress /><Spotlight /><ScrollTop /><CursorLogo /><Nav /><main><Hero /><Capabilities /><Approach /><Outcomes /><Work /><Reviews /><Contact /></main><Footer /></div>;
}

function Router() {
  return <Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch>;
}

function App() {
  // Apply the starting theme (saved choice, else light) before the first
  // React effect runs so the very first paint is already correctly themed.
  // index.html's inline script normally covers this; it is repeated here so
  // React-driven navigations (client reload paths) stay consistent too.
  if (typeof document !== 'undefined') {
    const initialTheme = getInitialTheme();
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    document.documentElement.classList.toggle('light', initialTheme === 'light');
    document.documentElement.style.colorScheme = initialTheme;
  }
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;