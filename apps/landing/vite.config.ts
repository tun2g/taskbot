import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs/promises';
import path from 'path';
import { createServer, defineConfig, type Plugin } from 'vite';

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

/**
 * Renders the React app into dist/index.html after the build, so search engines and link-preview bots that don't run
 * JS still see the full page (headings, copy, FAQ). The client then hydrates it (see src/main.tsx).
 */
function prerender(): Plugin {
  let outDir = '';
  return {
    name: 'prerender',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const server = await createServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
        logLevel: 'error',
      });
      try {
        const { render } = (await server.ssrLoadModule('/src/entry-server.tsx')) as { render: () => string };
        const file = path.join(outDir, 'index.html');
        const html = await fs.readFile(file, 'utf8');
        const marker = '<div id="root"></div>';
        if (!html.includes(marker)) throw new Error(`prerender: ${marker} not found in ${file}`);
        await fs.writeFile(file, html.replace(marker, `<div id="root">${render()}</div>`));
      } finally {
        await server.close();
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoFiles(), prerender()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
