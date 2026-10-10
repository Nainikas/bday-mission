// On-device image matching. Turns a camera frame or photo into an embedding
// (a list of numbers describing what it looks like) with DINOv2-small, then
// compares embeddings with cosine similarity. Nothing leaves the phone.

const MODEL_ID = 'Xenova/dinov2-small';
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
export const INPUT_SIZE = 224;

let model = null;
let TensorCls = null;
let loading = null;

async function hasLocalModel() {
  try {
    const r = await fetch(`models/${MODEL_ID}/config.json`, { method: 'GET', cache: 'no-store' });
    return r.ok && (r.headers.get('content-type') || '').includes('json');
  } catch { return false; }
}

// onProgress(fraction 0..1)
export function loadModel(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    const T = await import('../vendor/transformers.min.js');
    const { env, AutoModel, Tensor } = T;
    const base = new URL('./', location.href).href;
    env.allowLocalModels = await hasLocalModel();
    env.localModelPath = base + 'models/';
    env.backends.onnx.wasm.wasmPaths = base + 'vendor/';
    env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

    const files = {};
    model = await AutoModel.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.file && p.total) files[p.file] = [p.loaded || 0, p.total];
        const v = Object.values(files);
        if (v.length) onProgress(v.reduce((a, x) => a + x[0], 0) / v.reduce((a, x) => a + x[1], 0));
      },
    });
    TensorCls = Tensor;
    onProgress(1);
    return true;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export const modelReady = () => !!model;

// Draw a centered square crop of `source` (video, image or canvas) into `canvas`.
// zoom > 1 crops tighter around the centre.
export function drawSquare(source, canvas, size = INPUT_SIZE, zoom = 1) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(sw, sh) / zoom;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

function normalize(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

const scratch = document.createElement('canvas');

// Embedding of a square crop of `source`.
export async function embed(source, zoom = 1) {
  if (!model) throw new Error('model not loaded');
  const S = INPUT_SIZE;
  drawSquare(source, scratch, S, zoom);
  const { data } = scratch.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, S, S);
  const n = S * S;
  const px = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    px[i] = (data[4 * i] / 255 - MEAN[0]) / STD[0];
    px[n + i] = (data[4 * i + 1] / 255 - MEAN[1]) / STD[1];
    px[2 * n + i] = (data[4 * i + 2] / 255 - MEAN[2]) / STD[2];
  }
  const out = await model({ pixel_values: new TensorCls('float32', px, [1, 3, S, S]) });
  const hs = out.last_hidden_state;
  const [, tokens, dim] = hs.dims;
  const cls = normalize(Float32Array.from(out.pooler_output ? out.pooler_output.data : hs.data.subarray(0, dim)));
  if (tokens < 2) return cls;
  // Class token plus the average of the patch tokens, the usual DINOv2 recipe.
  const mean = new Float32Array(dim);
  for (let t = 1; t < tokens; t++) for (let d = 0; d < dim; d++) mean[d] += hs.data[t * dim + d];
  normalize(mean);
  const v = new Float32Array(2 * dim);
  v.set(cls); v.set(mean, dim);
  return normalize(v);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export const maxSim = (v, list) => list.reduce((m, r) => Math.max(m, cosine(v, r)), -1);

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// Embeddings for every photo in a hunt. Close-ups get an extra zoomed-in view
// so an object still matches when the camera is held closer than in the photo.
export async function embedHunt(hunt, onStep = () => {}) {
  const total = hunt.targets.reduce((a, t) => a + t.refs.length + (t.area || []).length, 0);
  let done = 0;
  const out = [];
  for (const t of hunt.targets) {
    const refs = [], area = [];
    for (const src of t.refs) {
      const img = await loadImage(src);
      refs.push(await embed(img, 1), await embed(img, 1.4));
      onStep(++done / total);
    }
    for (const src of t.area || []) {
      area.push(await embed(await loadImage(src), 1));
      onStep(++done / total);
    }
    out.push({ refs, area });
  }
  return out;
}

// Works out, per object, how similar a real match looks versus a non-match,
// and puts the "found it" line between them.
export function calibrate(embs) {
  const res = embs.map((e, i) => {
    // Same-object similarity: each photo against the other photos of that object
    // (skipping its own zoomed twin, which sits next to it in the list).
    const pos = [];
    for (let a = 0; a < e.refs.length; a++) {
      let best = -1;
      for (let b = 0; b < e.refs.length; b++) {
        if (Math.floor(a / 2) === Math.floor(b / 2)) continue;
        best = Math.max(best, cosine(e.refs[a], e.refs[b]));
      }
      if (best > -1) pos.push(best);
    }
    const neg = [];
    embs.forEach((o, j) => {
      if (j === i) return;
      for (const r of e.refs) for (const q of o.refs) neg.push(cosine(r, q));
    });
    neg.sort((x, y) => x - y);
    const posV = pos.length ? pos.reduce((a, x) => a + x, 0) / pos.length : 0.75;
    const negHi = neg.length ? neg[Math.floor(neg.length * 0.95)] : 0.3;
    const negMid = neg.length ? neg[Math.floor(neg.length / 2)] : 0.15;
    let threshold = negHi + 0.55 * (posV - negHi);
    threshold = Math.min(0.9, Math.max(0.35, threshold));
    return {
      pos: posV, negHi, lo: negMid, threshold,
      warning: posV - negHi < 0.06 ? 'looks a lot like another object, so add more distinctive close-ups' :
        pos.length === 0 ? 'has only one close-up, so add two or three more from other angles' : null,
    };
  });
  return res;
}
