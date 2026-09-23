/**
 * Download page (#/download, deep link /download) — the branded download
 * destination for the public 7-day trial installers (audit: replace the
 * raw GitHub release URL as the main public download destination).
 *
 * Checksums are fetched LIVE from the public downloads repository's
 * latest release (GitHub provides sha256 digests on release assets), so
 * the values shown always match the file a visitor downloads right now —
 * the trial builds re-publish on a fixed sync schedule.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, FileDown, Loader2, ShieldCheck } from 'lucide-react';
import { TRIAL_DOWNLOADS } from '@/lib/catalog';

const RELEASES_API = 'https://api.github.com/repos/abaduchanna/3sverse-downloads/releases/latest';
const RELEASES_PAGE = 'https://github.com/abaduchanna/3sverse-downloads/releases/latest';

const LABELS: Record<string, string> = {
  'VidaPay_Incentive_Extractor_TRIAL.exe': 'VidaPay Incentive Extractor — 7-day trial',
  'VidaPay_Device_Ordering_TRIAL.exe': 'VidaPay Device Ordering — 7-day trial',
  'VidaPay_Rebate_Filing_TRIAL.exe': 'VidaPay Rebate Filing — 7-day trial',
};

interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function DownloadPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [publishedAt, setPublishedAt] = useState('');

  useEffect(() => {
    document.title = 'Download — 3S Verse';
    window.scrollTo(0, 0);
    (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error('release fetch failed');
        const data = (await res.json()) as { assets?: Asset[]; published_at?: string };
        const list = (data.assets ?? []).filter((a) => a.name.endsWith('.exe'));
        setAssets(list);
        if (data.published_at) setPublishedAt(new Date(data.published_at).toUTCString());
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const bundle = TRIAL_DOWNLOADS['bundle'] ?? RELEASES_PAGE;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-4xl items-center justify-between px-5">
          <a href="#/" aria-label="3S Verse — home" className="flex items-center gap-2.5">
            <img src="/logo-240.png" alt="3S Verse" width={240} height={57} className="h-4 w-auto" />
          </a>
          <a
            href="#/"
            data-testid="download-back"
            className="inline-flex items-center gap-2 rounded-xl border border-input px-3.5 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-14">
        <div className="font-mono-tech text-[10px] uppercase tracking-[.3em] text-brand-cyan">
          Free 7-day trials — full software, no card needed
        </div>
        <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.2rem)] font-light leading-[1.08] tracking-[-0.02em]">
          Download the VidaPay tools.
        </h1>
        <p className="mt-5 text-[15px] font-light leading-7 text-foreground/75">
          Windows 10/11, your VidaPay dealer login, and Excel for the outputs — that is the whole checklist.
          Each trial is the full software for 7 days on one PC. Installers are hosted in our controlled public
          repository and re-published on a fixed sync schedule.
        </p>

        {failed && (
          <div className="mt-8 rounded-2xl border border-amber-400/30 bg-amber-400/[.06] p-5 text-[13.5px] leading-6 text-foreground">
            Could not load the live file list. Get the installers directly from the{' '}
            <a className="text-brand-cyan hover:underline" href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer">
              releases page
            </a>.
          </div>
        )}

        {assets === null && !failed && (
          <div className="mt-10 flex items-center gap-3 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current builds and checksums…
          </div>
        )}

        {assets !== null && (
          <div className="mt-10 space-y-4" data-testid="download-list">
            {assets.map((asset) => {
              const sha = (asset.digest ?? '').replace(/^sha256:/, '');
              return (
                <div
                  key={asset.name}
                  data-testid={`dl-${asset.name}`}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[15.5px] font-medium text-foreground">
                        {LABELS[asset.name] ?? asset.name}
                      </div>
                      <div className="mt-1 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                        {asset.name} · {formatMB(asset.size)}
                      </div>
                    </div>
                    <a
                      href={asset.browser_download_url}
                      data-testid={`dl-button-${asset.name}`}
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#f7f3e8]"
                    >
                      <FileDown className="h-4 w-4" /> Download (.exe)
                    </a>
                  </div>
                  {sha ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="font-mono-tech text-[9px] uppercase tracking-[.18em] text-muted-foreground">
                        SHA-256 — verify before running
                      </div>
                      <code
                        data-testid={`sha-${asset.name}`}
                        className="mt-1 block break-all font-mono-tech text-[11px] leading-5 text-foreground/85"
                      >
                        {sha}
                      </code>
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[15.5px] font-medium text-foreground">All three tools — the Full Bundle</div>
                  <div className="mt-1 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    Grab each installer from the release list
                  </div>
                </div>
                <a
                  href={bundle}
                  data-testid="dl-button-bundle"
                  className="inline-flex items-center gap-2 rounded-xl border border-input px-5 py-3 text-[13.5px] font-semibold text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <FileDown className="h-4 w-4" /> Release list
                </a>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 rounded-2xl border border-brand-cyan/20 bg-[#6ee7ef]/[.04] p-6" data-testid="download-security">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-brand-cyan" />
            <h2 className="text-[15px] font-medium text-foreground">Before you run the installer</h2>
          </div>
          <ul className="mt-3 space-y-2.5 text-[13.5px] font-light leading-6 text-foreground/75">
            {[
              'Verify the SHA-256 checksum shown above against the file you downloaded (Windows: certutil -hashfile <file> SHA256).',
              'The tools run on your own PC under your own VidaPay login — credentials and extracted data never leave your machine.',
              'No telemetry, no analytics. Network calls go to the VidaPay portal and the license ledger only.',
              'Paid (FULL) builds are never public — they are delivered through your order number.',
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-cyan" /> {line}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] leading-5 text-muted-foreground">
            More detail:{' '}
            <a href="#/security" className="text-brand-cyan hover:underline">Security</a> ·{' '}
            <a href="#/eula" className="text-brand-cyan hover:underline">License terms</a> ·{' '}
            <a href="#/privacy" className="text-brand-cyan hover:underline">Privacy</a>
            {publishedAt ? ` · Builds published ${publishedAt}` : ''}
          </p>
        </div>
      </main>
    </div>
  );
}
