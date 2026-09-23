/* Shared Cloudflare Turnstile widget (explicit render).
 *
 * Rendered by the contact form, the dealer-review form and the store's
 * order flow whenever TURNSTILE_SITE_KEY (src/lib/catalog.ts) is set.
 * The resulting token is verified SERVER-SIDE by the download-gateway
 * worker (POST /contact, /order) — a static site has no server of its
 * own, so the worker is the actual gate. While the site key is empty
 * nothing renders and the forms keep working through the honeypot.
 */
import { useEffect, useRef } from 'react';
import { TURNSTILE_SITE_KEY } from '@/lib/catalog';

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

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
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
          theme: 'auto',
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
