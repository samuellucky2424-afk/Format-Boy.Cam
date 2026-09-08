import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export const DESKTOP_ORIGIN = 'http://localhost:5173';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

export function createDesktopHandler(distDirectory) {
  const root = path.resolve(distDirectory);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Bind to loopback and reject DNS rebinding/foreign browser origins.
    if (req.headers.host !== 'localhost:5173' ||
        (req.headers.origin && req.headers.origin !== DESKTOP_ORIGIN)) {
      res.writeHead(403).end();
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, DESKTOP_ORIGIN).pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + path.sep) || pathname.includes('\\') ||
          pathname.split('/').some((part) => part.startsWith('.')) || !types[path.extname(file)]) {
        res.writeHead(404).end();
        return;
      }
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404).end();
    }
  };
}

export async function startDesktopServer(distDirectory) {
  const server = http.createServer(createDesktopHandler(distDirectory));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5173, '127.0.0.1', resolve);
  });
  return server;
}
