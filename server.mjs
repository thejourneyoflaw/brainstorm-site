import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, ROOT } from './lib/llm.mjs';

loadEnv();
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (p === '/') p = '/index.html';

  let file;
  if (p.startsWith('/data/')) {
    file = path.normalize(path.join(DATA, p.slice('/data/'.length)));
    if (!file.startsWith(DATA)) { res.writeHead(403).end(); return; }
  } else {
    file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB)) { res.writeHead(403).end(); return; }
  }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`头脑风暴已启动 → http://127.0.0.1:${PORT}`);
});
