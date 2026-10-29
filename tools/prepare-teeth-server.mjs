/**
 * Helper for tools/prepare-teeth.html (run once when the tooth pictures change):
 *   node tools/prepare-teeth-server.mjs
 * Accepts the prepared pictures and the description file from that page and writes them
 * into assets/teeth/ and js/core/tooth-art.js — nothing else. Listens on localhost only.
 */
import http from 'node:http';
import fs from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = [/^assets\/teeth\/[a-z0-9-]+\.webp$/, /^js\/core\/tooth-art\.js$/];

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
  if (req.method !== 'PUT' || !ALLOWED.some((re) => re.test(path)) || normalize(path).includes('..')) { res.statusCode = 403; res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const target = join(ROOT, path);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.concat(chunks));
    console.log('wrote', path);
    res.end('ok');
  });
}).listen(5198, '127.0.0.1', () => console.log('prepare-teeth server on 127.0.0.1:5198'));
