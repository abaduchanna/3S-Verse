import { createRoot } from 'react-dom/client';

import App from './App';

/* Self-hosted brand fonts (replaces render-blocking fonts.googleapis.com
   requests — Lighthouse render-blocking-insight was ~1.4s). @fontsource
   ships woff2 with font-display: swap; Vite fingerprints + bundles them. */
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
