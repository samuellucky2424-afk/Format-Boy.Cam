import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopHandler } from '../electron/desktop-server.js';
import path from 'node:path';

test('desktop serves only built public assets and rejects foreign hosts, origins, and traversal', async () => {
  const handler = createDesktopHandler(path.resolve('dist'));
  for (const [url, host, origin, expected] of [
    ['/', 'localhost:5173', undefined, 200],
    ['/', 'attacker.test', undefined, 403],
    ['/', 'localhost:5173', 'https://attacker.test', 403],
    ['/.env', 'localhost:5173', undefined, 404],
    ['/..%2f..%2f.env', 'localhost:5173', undefined, 404],
    ['/..%5c.env', 'localhost:5173', undefined, 404],
  ] as const) {
    const res = { status: 0, headers: {} as Record<string, string>, setHeader(key: string, value: string) { this.headers[key] = value; }, writeHead(status: number) { this.status = status; return this; }, end() {} };
    await handler({ url, method: 'GET', headers: { host, origin } }, res);
    assert.equal(res.status, expected, url); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
