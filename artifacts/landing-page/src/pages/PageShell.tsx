/**
 * PageShell — shared chrome for standalone hash-routed pages (About,
 * Pricing). Same visual language as the legal pages: sticky mini-header,
 * kicker + H1 + meta line, centered readable column.
 */
import { useEffect, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageShellProps {
  title: string;
  kicker: string;
  metaLine?: ReactNode;
  children: ReactNode;
  /** Max width of the content column (tailwind class). */
  width?: string;
}

export default function PageShell({ title, kicker, metaLine, children, width = 'max-w-3xl' }: PageShellProps) {
  useEffect(() => {
    document.title = `${title} — 3S Verse`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-4xl items-center justify-between px-5">
          <a href="#/" aria-label="3S Verse — home" className="flex items-center gap-2.5">
            <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-4 w-auto" />
          </a>
          <a
            href="#/"
            data-testid="page-back"
            className="inline-flex items-center gap-2 rounded-xl border border-input px-3.5 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </a>
        </div>
      </header>

      <main className={`mx-auto ${width} px-5 pb-24 pt-14`}>
        <div className="font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">{kicker}</div>
        <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] font-light leading-[1.08] tracking-[-0.02em]">
          {title}
        </h1>
        {metaLine && (
          <p className="mt-4 font-mono-tech text-[10px] uppercase tracking-[.2em] text-muted-foreground">{metaLine}</p>
        )}
        {children}
      </main>
    </div>
  );
}
