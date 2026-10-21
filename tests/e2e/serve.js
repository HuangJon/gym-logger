/** Tiny static file server for local development and the end-to-end tests. `npm start` → http://localhost:8080 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Serve the app. `mode: 'down'` answers 404 for everything (simulates the site being offline). */
export function startServer({ port = 0, mode = 'up' } = {}) {
  const server = createServer(async (req, res) => {
    if (mode === 'down') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer({ port: Number(process.env.PORT) || 8080 }).then(({ url }) => console.log(`Lifting Log running at ${url}`));
}
