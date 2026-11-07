import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { config } from '../config';
import { hamyonSign } from '../services/hamyonClient';
import { hamyonWebhook } from './hamyonWebhook';

test('callbacks are refused without the secret path, valid fields and this shop id', async () => {
  config.hamyon.callbackToken = 'path-secret';
  config.hamyon.shopId = '12';
  config.hamyon.shopKey = 'sk_x';

  const app = express();
  app.use(hamyonWebhook);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };

  const post = (token: string, fields: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/hamyon/complete/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });

  const fields = {
    payment_id: 'p1',
    order_id: '65f0000000000000000000aa',
    shop_id: '12',
    amount: '50000',
    status: 'paid',
    sign: hamyonSign('12', 'p1', '50000', 'sk_x'),
  };

  try {
    assert.equal((await post('wrong', fields)).status, 404);
    assert.equal((await post('path-secret', { ...fields, order_id: 'ORD-1' })).status, 200); // foreign order: acknowledged, ignored
    assert.equal((await post('path-secret', {})).status, 400);
    const otherShop = { ...fields, shop_id: '13', sign: hamyonSign('13', 'p1', '50000', 'sk_x') };
    assert.equal((await post('path-secret', otherShop)).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
