/**
 * Packages the production build into a single self-contained HTML file for
 * SharePoint (and any other host that can only serve one file).
 *
 * - Inlines the JS bundle and CSS into index.html
 * - Inlines the favicon as a data URI
 * - Emits both .html and .aspx copies (some SharePoint document libraries
 *   force-download .html but render .aspx in the browser)
 *
 * Run after `vite build`:  node scripts/make-sharepoint-bundle.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const outDir = new URL('../sharepoint/', import.meta.url).pathname;

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// Inline the module script.
html = html.replace(
  /<script type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/,
  (_, src) => {
    const js = readFileSync(join(dist, src), 'utf8');
    return `<script type="module">\n${js}\n</script>`;
  }
);

// Inline the stylesheet.
html = html.replace(
  /<link rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/,
  (_, href) => {
    const css = readFileSync(join(dist, href), 'utf8');
    return `<style>\n${css}\n</style>`;
  }
);

// Inline the favicon as a data URI so no external request remains.
html = html.replace(
  /<link rel="icon"[^>]*href="\/?([^"]+\.svg)"[^>]*\/?>/,
  (_, href) => {
    const svg = readFileSync(join(dist, href), 'utf8');
    const encoded = Buffer.from(svg).toString('base64');
    return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${encoded}" />`;
  }
);

const leftovers = html.match(/(src|href)="\/(?!\/)[^"]*"/g);
if (leftovers) {
  throw new Error(`Bundle still references external paths: ${leftovers.join(', ')}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'ai-infra-simulator.html'), html);
writeFileSync(join(outDir, 'ai-infra-simulator.aspx'), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote sharepoint/ai-infra-simulator.html and .aspx (${kb} KB each)`);
