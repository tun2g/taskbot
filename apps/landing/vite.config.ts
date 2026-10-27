import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Absolute site URL for canonical / Open Graph tags, robots.txt and sitemap.xml (no trailing slash).
// Vite exposes VITE_* from process.env and replaces %VITE_SITE_URL% in index.html.
process.env.VITE_SITE_URL = (process.env.VITE_SITE_URL || 'https://taskbot-landing.chamees.site').replace(/\/+$/, '');
const SITE_URL = process.env.VITE_SITE_URL;

/** Emits robots.txt and sitemap.xml for SITE_URL at build time. */
function seoFiles(): Plugin {
  return {
    name: 'seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoFiles()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
