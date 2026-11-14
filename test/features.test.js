import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import mock from '../providers/mock.js';
import { parseVintedLabel, bookmarkletCode } from '../public/vinted.js';
import { boardRssUrl, parseBoardRss, pinFromApi } from '../lib/pinterest.js';

test('parseVintedLabel lit titre, marque, état, taille et prix', () => {
  const f = parseVintedLabel('Jupe trapeze bleue marine, Marque: edc "since 98", État: Très bon état, Taille: XL, 4.00 €, 4.90 €');
  assert.deepEqual(f, { title: 'Jupe trapeze bleue marine', brand: 'edc "since 98"', condition: 'Très bon état', size: 'XL', price: 4 });
  const sansTaille = parseVintedLabel('Sac cabas, Marque: Zara, État: Neuf, 12.50 €, 13.40 €');
  assert.equal(sansTaille.size, '');
  assert.equal(sansTaille.price, 12.5);
  assert.equal(sansTaille.title, 'Sac cabas');
});

test('le favori pointe vers l’adresse de l’app', () => {
  const code = decodeURIComponent(bookmarkletCode('http://localhost:5180'));
  assert.ok(code.startsWith('javascript:'));
  assert.ok(code.includes('"http://localhost:5180"'));
  assert.doesNotThrow(() => new Function(code.slice('javascript:'.length)));
});

test('liens et flux RSS Pinterest', () => {
  assert.equal(boardRssUrl('https://www.pinterest.fr/elina/automne-2026/').rss, 'https://www.pinterest.com/elina/automne-2026.rss');
  assert.equal(boardRssUrl('https://pinterest.com/elina/').rss, 'https://www.pinterest.com/elina/feed.rss');
  assert.throws(() => boardRssUrl('https://example.com/a/b'));
  assert.throws(() => boardRssUrl('https://www.pinterest.fr/pin/123/'));

  const xml = `<rss><channel><title>Automne</title>
    <item><title>Veste</title><link>https://www.pinterest.com/pin/42/</link>
    <description>&lt;a href=&quot;x&quot;&gt;&lt;img src=&quot;https://i.pinimg.com/236x/aa/bb.jpg&quot;&gt;&lt;/a&gt;Veste</description></item>
  </channel></rss>`;
  const { title, pins } = parseBoardRss(xml);
  assert.equal(title, 'Automne');
  assert.deepEqual(pins[0], { pinId: '42', title: 'Veste', image: 'https://i.pinimg.com/736x/aa/bb.jpg', link: 'https://www.pinterest.com/pin/42/' });

  assert.equal(pinFromApi({ id: 7, title: 't', media: { images: { '600x': { url: 'u6' }, '1200x': { url: 'u12' } } } }).image, 'u12');
});

async function withServer(opts, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trouvaille-'));
  const fakeDownload = async (_url, dest) => { await writeFile(dest + '.jpg', 'x'); return '.jpg'; };
  const app = await createApp({ dataDir: dir, provider: mock, imageDownloader: fakeDownload, ...opts });
  const server = http.createServer(app.handle).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, location: res.headers.get('location'), data: await res.json().catch(() => null) };
  };
  try {
    await fn(call);
  } finally {
    server.close();
    await app.flush();
    await rm(dir, { recursive: true, force: true });
  }
}

const PIN = (id) => ({ pinId: String(id), title: `épingle ${id}`, image: `https://i.pinimg.com/736x/${id}.jpg`, link: `https://www.pinterest.com/pin/${id}/` });

test('import d’un tableau public, analyse à la demande, pièces Vinted et classement', async () => {
  await withServer({ publicBoardFetcher: async () => ({ boardName: 'Automne', pins: [PIN(1), PIN(2)] }) }, async (call) => {
    const imp = await call('/api/pinterest/import-public', 'POST', { url: 'https://www.pinterest.fr/elina/automne/' });
    assert.deepEqual(imp.data, { added: 2, skipped: 0, failed: 0, board: 'Automne' });
    const again = await call('/api/pinterest/import-public', 'POST', { url: 'https://www.pinterest.fr/elina/automne/' });
    assert.equal(again.data.skipped, 2, 'pas de doublons');

    const [insp] = (await call('/api/inspirations')).data;
    assert.equal(insp.analysis, null);
    const analysed = (await call(`/api/inspirations/${insp.id}/analyze`, 'POST', {})).data;
    assert.equal(analysed.analysis.piece, 'veste harrington');

    assert.equal((await call(`/api/inspirations/${insp.id}/rank`, 'POST', {})).status, 400, 'rien à classer');

    const items = [
      { id: '1', url: 'https://www.vinted.fr/items/1-a', photo: 'https://images1.vinted.net/t/a.webp', label: 'Pull rouge, Marque: X, État: Bon état, Taille: M, 9.00 €, 9.90 €' },
      { id: '2', url: 'https://www.vinted.fr/items/2-b', photo: 'https://images1.vinted.net/t/b.webp', label: 'Veste harrington olive, Marque: Baracuta, État: Très bon état, Taille: S, 45.00 €, 47.95 €' },
      { id: '3', url: 'https://evil.example/items/3', photo: 'https://images1.vinted.net/t/c.webp', label: 'refusée' },
      { id: '4', url: 'https://www.vinted.fr/items/4', photo: 'javascript:alert(1)', label: 'refusée' },
    ];
    const finds = (await call(`/api/inspirations/${insp.id}/finds`, 'POST', { items })).data;
    assert.equal(finds.added, 2, 'seules les vraies annonces Vinted sont gardées');
    assert.equal(finds.inspiration.finds[0].brand, 'X');

    const ranked = (await call(`/api/inspirations/${insp.id}/rank`, 'POST', {})).data;
    assert.equal(ranked.finds[0].id, '2', 'la veste harrington arrive en tête');
    assert.equal(ranked.finds[0].score, 100);

    const removed = (await call(`/api/inspirations/${insp.id}/finds/1`, 'DELETE')).data;
    assert.equal(removed.finds.length, 1);
  });
});

test('Pinterest : configuration, connexion OAuth et import d’un tableau', async () => {
  const fakeClient = {
    me: async () => ({ username: 'elina' }),
    boards: async () => [{ id: 'b1', name: 'Y2K', pinCount: 3 }],
    boardPins: async () => [PIN(10), PIN(11), PIN(12)],
  };
  await withServer({ pinterest: fakeClient, publicOrigin: 'http://localhost:5180' }, async (call) => {
    let st = (await call('/api/pinterest/status')).data;
    assert.equal(st.configured, false);
    assert.equal(st.redirectUri, 'http://localhost:5180/auth/pinterest/callback');

    assert.equal((await call('/auth/pinterest')).location, '/?pinterest=config');
    assert.equal((await call('/api/pinterest/config', 'PUT', { clientId: 'abc', clientSecret: 'x' })).status, 400);
    await call('/api/pinterest/config', 'PUT', { clientId: '1234567', clientSecret: 'secret-secret' });
    st = (await call('/api/pinterest/status')).data;
    assert.equal(st.configured, true);
    assert.equal(st.clientSecret, undefined, 'la clé secrète n’est jamais renvoyée');

    const start = await call('/auth/pinterest');
    const auth = new URL(start.location);
    assert.equal(auth.origin + auth.pathname, 'https://www.pinterest.com/oauth/');
    assert.equal(auth.searchParams.get('client_id'), '1234567');
    assert.equal(auth.searchParams.get('redirect_uri'), 'http://localhost:5180/auth/pinterest/callback');
    assert.equal((await call('/auth/pinterest/callback?code=c&state=mauvais')).location, '/?pinterest=erreur', 'state vérifié');

    const boards = (await call('/api/pinterest/boards')).data;
    assert.equal(boards[0].name, 'Y2K');
    const imp = (await call('/api/pinterest/import', 'POST', { boardId: 'b1', boardName: 'Y2K' })).data;
    assert.equal(imp.added, 3);
    const insps = (await call('/api/inspirations')).data;
    assert.ok(insps.every((i) => i.board === 'Y2K' && i.source === 'pinterest'));

    await call('/api/pinterest/config', 'DELETE');
    assert.equal((await call('/api/pinterest/status')).data.configured, false);
  });
});
