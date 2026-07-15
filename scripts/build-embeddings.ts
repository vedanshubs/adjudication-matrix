/*
 * build-embeddings.ts — precompute anchor embeddings ONCE, offline (per the architecture:
 * "anchors are embedded once, offline"). The browser then only embeds the query at runtime.
 *
 * Output: src/core/generated/anchor-embeddings.json
 *   { model, dim, count, vectors }  where vectors = base64 of a Float32Array [count * dim],
 *   aligned index-for-index with anchors.json.
 *
 * Run: npm run build:embeddings   (slow — loads the model + embeds ~1.4k phrases)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import type { AnchorSet } from '../src/core/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'src', 'core', 'generated');
const MODEL = 'Xenova/bge-small-en-v1.5';

env.allowLocalModels = false; // pull ONNX from the HF hub

async function main() {
  const anchors = (JSON.parse(fs.readFileSync(path.join(GEN, 'anchors.json'), 'utf8')) as AnchorSet).anchors;
  console.log(`embedding ${anchors.length} anchors with ${MODEL} (q8)...`);
  const t0 = Date.now();
  const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

  const dim = 384;
  const out = new Float32Array(anchors.length * dim);
  const BATCH = 64;
  for (let i = 0; i < anchors.length; i += BATCH) {
    const batch = anchors.slice(i, i + BATCH).map((a) => a.phrase);
    const res = await embed(batch, { pooling: 'mean', normalize: true });
    const data = res.data as Float32Array; // [batch * dim]
    out.set(data.subarray(0, batch.length * dim), i * dim);
    if (i % 320 === 0) process.stdout.write(`  ${i}/${anchors.length}\r`);
  }

  const vectors = Buffer.from(out.buffer).toString('base64');
  const payload = { model: MODEL, dim, count: anchors.length, vectors };
  fs.writeFileSync(path.join(GEN, 'anchor-embeddings.json'), JSON.stringify(payload));
  const mb = (Buffer.byteLength(JSON.stringify(payload)) / 1e6).toFixed(1);
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s -> anchor-embeddings.json (${mb} MB, dim ${dim})`);
}

main();
