import { Card, CardContent } from '@/components/ui/card';
import { Compass } from 'lucide-react';

/* Customer-facing 404 — the previous copy ("Did you forget to add the page
   to the router?") was a developer-facing question that leaked onto the
   public site. Customers land here from broken/mistyped links, so the page
   now explains what happened in plain language and offers the three routes
   a dealer most likely wants: home, the download page, and contact. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-5">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-2">
            <Compass className="h-8 w-8 text-brand-cyan" />
            <h1 className="text-2xl font-bold text-foreground">
              Page not found
            </h1>
          </div>

          <p className="mt-4 text-sm leading-6 text-foreground/75">
            The page you were looking for doesn&apos;t exist or has moved. It
            was probably our fault, not yours — a link we changed or retired.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#/"
              className="inline-flex items-center rounded-xl border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
            >
              Go to the home page
            </a>
            <a
              href="#/download"
              className="inline-flex items-center rounded-xl border border-input px-4 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan"
            >
              Download the tools
            </a>
            <a
              href="mailto:Connect@3SVerse.com"
              className="inline-flex items-center rounded-xl border border-input px-4 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan"
            >
              Email us
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
