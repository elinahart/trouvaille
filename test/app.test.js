import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import mock from '../providers/mock.js';
import { vintedSearchUrl } from '../public/vinted.js';

// 1×1 px PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function withServer(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trouvaille-'));
  const app = await createApp({ dataDir: dir, provider: mock });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    await fn(call);
  } finally {
    server.close();
    await app.flush();
    await rm(dir, { recursive: true, force: true });
  }
}

test('lien Vinted : texte encodé et budget', () => {
  const url = new URL(vintedSearchUrl('veste harrington olive', { budget: 40 }));
  assert.equal(url.origin + url.pathname, 'https://www.vinted.fr/catalog');
  assert.equal(url.searchParams.get('search_text'), 'veste harrington olive');
  assert.equal(url.searchParams.get('price_to'), '40');
  assert.equal(new URL(vintedSearchUrl('x')).searchParams.get('price_to'), null);
});

test('analyse → mood board → wishlist', async () => {
  await withServer(async (call) => {
    assert.equal((await call('/api/status')).data.provider, 'mock');
    assert.equal((await call('/n-existe-pas.png')).status, 404, 'un 404 ne doit pas faire planter le serveur');
    assert.equal((await call('/images/absent.jpg')).status, 404);

    const bad = await call('/api/analyze', 'POST', { image: 'pas une image' });
    assert.equal(bad.status, 400);

    await call('/api/settings', 'PUT', { size: 'M', budget: '35 €' });
    const { status, data: insp } = await call('/api/analyze', 'POST', { image: PNG, board: 'Automne' });
    assert.equal(status, 200);
    assert.equal(insp.board, 'Automne');
    assert.equal(insp.recherches[0].proximite, 5, 'triées de la plus proche à la plus large');
    assert.match(insp.recherches[0].url, /price_to=35/);

    const moved = await call(`/api/inspirations/${insp.id}`, 'PATCH', { board: 'Hiver' });
    assert.equal(moved.data.board, 'Hiver');

    assert.equal((await call('/api/wishlist', 'POST', { url: 'javascript:alert(1)' })).status, 400);
    const item = (await call('/api/wishlist', 'POST', { url: 'https://www.vinted.fr/items/1', title: 'Veste', price: '12,50', inspirationId: insp.id })).data;
    assert.equal(item.price, 12.5);
    assert.equal((await call(`/api/wishlist/${item.id}`, 'PATCH', { status: 'achetée' })).data.status, 'achetée');

    await call(`/api/inspirations/${insp.id}`, 'DELETE');
    assert.equal((await call('/api/inspirations')).data.length, 0);
  });
});
