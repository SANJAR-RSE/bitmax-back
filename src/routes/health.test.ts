import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { healthRoutes } from './health';

test('health aliases are public, uncached and compatible', async () => {
  const app = express();
  app.use(healthRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    for (const path of ['/health', '/healt']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { status: 'ok', service: 'bitmax-api', version: '1.0.0' });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
