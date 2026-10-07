// Run: node tests/openaip-proxy.test.js   (local fake upstream; no network)
const assert = require('assert');
const http = require('http');
const { createServer } = require('../tools/openaip-proxy.js');

(async () => {
  let seen = null;
  const up = http.createServer((req, res) => {
    seen = { url: req.url, key: req.headers['x-openaip-api-key'] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"items":[1,2]}');
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const proxy = createServer(`http://127.0.0.1:${up.address().port}`);
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;

  const pre = await fetch(base + '/api/airspaces', { method: 'OPTIONS' });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), '*');
  assert.ok(/x-openaip-api-key/.test(pre.headers.get('access-control-allow-headers')));

  const r = await fetch(base + '/api/airspaces?page=1&limit=200', { headers: { 'x-openaip-api-key': 'K' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
  assert.deepStrictEqual(await r.json(), { items: [1, 2] });
  assert.deepStrictEqual(seen, { url: '/api/airspaces?page=1&limit=200', key: 'K' });

  assert.strictEqual((await fetch(base + '/secret')).status, 404);
  proxy.close(); up.close();
  console.log('openaip proxy tests passed');
})();
