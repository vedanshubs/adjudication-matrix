/*
 * api-server.ts — tiny local API so the UI can use the RAG tier.
 *
 * Why a server at all: AWS credentials must never reach the browser, and the embedding index
 * (bge-large, 1024-dim) is far too heavy to ship client-side. This is the same split you'd
 * have in production — the browser asks, the server classifies.
 *
 * POST /api/classify  { description, state? }  ->  full cascade + RAG result
 * GET  /api/health
 *
 * Run: npm run api     (then `npm run dev` proxies /api to it)
 */
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// load credentials BEFORE importing the RAG module (it reads env at init)
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* rely on real env vars */ }
const { ragClassify } = await import('../src/core/rag.ts');

const PORT = Number(process.env.API_PORT ?? '5174');

function json(res: http.ServerResponse, code: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.url === '/api/health') return json(res, 200, { ok: true, model: process.env.BEDROCK_MODEL_ID ?? 'openai.gpt-oss-120b-1:0' });

  if (req.method === 'POST' && req.url === '/api/classify') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { description, state } = JSON.parse(body || '{}');
        if (!description || !String(description).trim()) return json(res, 400, { error: 'description is required' });
        const t0 = Date.now();
        const r = await ragClassify(String(description), state ? String(state) : undefined);
        json(res, 200, {
          charge: r.charge,
          resolvedBy: r.det.resolvedBy,
          usedRag: r.usedRag,
          trace: r.det.trace,
          category: r.category,
          subcategory: r.subcategory,
          abstained: r.abstained,
          choice: r.choice,
          options: r.options.map((c) => ({ phrase: c.phrase, category: c.category, subcategory: c.subcategory, cos: c.cos })),
          model: r.model,
          tokens: { input: r.inTok, output: r.outTok },
          ms: r.ms,
          totalMs: Date.now() - t0,
        });
      } catch (e) {
        console.error(e);
        json(res, 500, { error: (e as Error).message });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}  (POST /api/classify)`);
  console.log(`model: ${process.env.BEDROCK_MODEL_ID ?? 'openai.gpt-oss-120b-1:0'} · region: ${process.env.AWS_REGION ?? 'us-east-2'}`);
  console.log('first request loads the embedder — expect a few seconds.');
});
