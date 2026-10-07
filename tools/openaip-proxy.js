#!/usr/bin/env node
/**
 * Tiny local relay for the OpenAIP API, because api.core.openaip.net sends no
 * CORS headers and a browser therefore refuses to read its answers:
 *
 *   node tools/openaip-proxy.js [port]            (default 5401)
 *
 * Then set Setup > Files and Transfer > Airspace > Proxy to http://localhost:5401
 * in the trainer. The proxy forwards GET /api/... to OpenAIP unchanged (including
 * the x-openaip-api-key header the trainer sends) and adds CORS headers to the
 * reply. It stores nothing and only listens on this computer (127.0.0.1).
 * OPENAIP_UPSTREAM overrides the target (used by the test).
 */
const http = require('http');

function createServer(upstream) {
  const target = (upstream || process.env.OPENAIP_UPSTREAM || 'https://api.core.openaip.net').replace(/\/$/, '');
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-openaip-api-key, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== 'GET' || !req.url.startsWith('/api/')) { res.writeHead(404, cors); res.end('only GET /api/...'); return; }
    try {
      const headers = {};
      if (req.headers['x-openaip-api-key']) headers['x-openaip-api-key'] = req.headers['x-openaip-api-key'];
      const r = await fetch(target + req.url, { headers });
      const out = { ...cors, 'Content-Type': r.headers.get('content-type') || 'application/json' };
      if (r.headers.get('retry-after')) out['Retry-After'] = r.headers.get('retry-after');
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, cors); res.end('proxy error: ' + e.message);
    }
  });
}

if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || 5401;
  createServer().listen(port, '127.0.0.1', () => console.log(`OpenAIP proxy on http://localhost:${port}`));
}
module.exports = { createServer };
