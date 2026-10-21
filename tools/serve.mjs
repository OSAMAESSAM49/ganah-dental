#!/usr/bin/env node
/**
 * Zero-dependency static dev server (plain Node — no npm install).
 *   node tools/serve.mjs                 → http://localhost:5173/
 *   node tools/serve.mjs --base /ganah/  → http://localhost:5173/ganah/  (mimics a GitHub Pages sub-path)
 *   node tools/serve.mjs --port 8080
 * Like GitHub Pages, unknown paths return 404.html.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', process.env.PORT || 5173));
const BASE = ('/' + arg('--base', '/').replace(/^\/|\/$/g, '') + '/').replace('//', '/');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

async function send(res, status, file) {
  const body = await readFile(file);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (!path.startsWith(BASE)) {
      if (path === '/' && BASE !== '/') { res.writeHead(302, { Location: BASE }); res.end(); return; }
      await send(res, 404, join(ROOT, '404.html')); return;
    }
    path = path.slice(BASE.length - 1);
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT)) || file.split(sep).some((p) => p === '.git')) { res.writeHead(403); res.end(); return; }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) { await send(res, 200, join(file, 'index.html')).catch(() => send(res, 404, join(ROOT, '404.html'))); return; }
    if (info) { await send(res, 200, file); return; }
    await send(res, 404, join(ROOT, '404.html'));
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
}).listen(PORT, () => console.log(`Ganah Dental dev server → http://localhost:${PORT}${BASE}`));
