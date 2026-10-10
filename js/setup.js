import { loadModel, embedHunt, calibrate, embed, maxSim, loadImage, drawSquare } from './vision.js';

const $ = (id) => document.getElementById(id);
const DRAFT = 'arhunt.draft';
let hunt;
let embs = null, calib = null;

const blank = () => ({
  version: 1, id: Math.random().toString(16).slice(2, 10), recipient: '', intro: '', stickers: false, sensitivity: 0,
  targets: [], reveal: { headline: 'LIGHTS OUT!', count: 3, event: 'Formula 1 Las Vegas Grand Prix', when: 'November 2026', where: 'Las Vegas Strip Circuit', seats: ['Ticket 1 of 3', 'Ticket 2 of 3', 'Ticket 3 of 3'], message: '' },
});
const newCode = () => Math.random().toString(16).slice(2, 8);

async function load() {
  try { const d = localStorage.getItem(DRAFT); if (d) return JSON.parse(d); } catch {}
  try { const r = await fetch('hunt.json', { cache: 'no-store' }); if (r.ok) return await r.json(); } catch {}
  return blank();
}
function save() {
  embs = null; calib = null;
  try { localStorage.setItem(DRAFT, JSON.stringify(hunt)); } catch { /* too big for storage: still fine, just not remembered */ }
}

// ---------- Form <-> data ----------
const fields = ['recipient', 'intro'];
const rfields = ['headline', 'event', 'when', 'where', 'message'];
function fillForm() {
  fields.forEach((f) => { $(f).value = hunt[f] || ''; });
  rfields.forEach((f) => { $('r_' + f).value = hunt.reveal[f] || ''; });
  $('r_seats').value = (hunt.reveal.seats || []).join('\n');
  $('stickers').checked = !!hunt.stickers;
  $('sens').value = hunt.sensitivity || 0;
  $('sensVal').textContent = (+$('sens').value).toFixed(2);
  renderTargets();
}
fields.forEach((f) => $(f).addEventListener('input', () => { hunt[f] = $(f).value; save(); }));
rfields.forEach((f) => $('r_' + f).addEventListener('input', () => { hunt.reveal[f] = $('r_' + f).value; save(); }));
$('r_seats').addEventListener('input', () => {
  hunt.reveal.seats = $('r_seats').value.split('\n').map((s) => s.trim()).filter(Boolean);
  hunt.reveal.count = hunt.reveal.seats.length || 1;
  save();
});
$('stickers').addEventListener('change', () => { hunt.stickers = $('stickers').checked; save(); });
$('sens').addEventListener('input', () => {
  hunt.sensitivity = +$('sens').value;
  $('sensVal').textContent = hunt.sensitivity.toFixed(2);
  try { localStorage.setItem(DRAFT, JSON.stringify(hunt)); } catch {}
});

async function fileToSquare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = drawSquare(img, document.createElement('canvas'), 320);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

function thumbs(list, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'thumbs';
  list.forEach((src, k) => {
    const f = document.createElement('figure');
    f.innerHTML = `<img alt=""><button title="Remove">✕</button>`;
    f.querySelector('img').src = src;
    f.querySelector('button').onclick = () => { list.splice(k, 1); onChange(); };
    wrap.appendChild(f);
  });
  const add = document.createElement('label');
  add.className = 'add';
  add.innerHTML = `+<input type="file" accept="image/*" multiple>`;
  add.querySelector('input').onchange = async (e) => {
    for (const file of e.target.files) list.push(await fileToSquare(file));
    onChange();
  };
  wrap.appendChild(add);
  return wrap;
}

function renderTargets() {
  const root = $('targets');
  root.innerHTML = '';
  hunt.targets.forEach((t, i) => {
    t.area = t.area || [];
    t.code = t.code || newCode();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="head"><input type="text" class="name" placeholder="Treasure name"><button class="btn ghost del">Remove</button></div>
      <label>Clue the birthday person sees</label><textarea class="clue"></textarea>
      <label>Hint (when they tap 💡)</label><input type="text" class="hint">
      <label>Close-ups</label><div class="refs"></div>
      <label>Wider shots of the spot (optional)</label><div class="area"></div>
      <div class="note"></div>`;
    const bind = (sel, key) => { const el = card.querySelector(sel); el.value = t[key] || ''; el.oninput = () => { t[key] = el.value; save(); }; };
    bind('.name', 'name'); bind('.clue', 'clue'); bind('.hint', 'hint');
    const rerender = () => { save(); renderTargets(); };
    card.querySelector('.refs').appendChild(thumbs(t.refs, rerender));
    card.querySelector('.area').appendChild(thumbs(t.area, rerender));
    card.querySelector('.del').onclick = () => { if (confirm(`Remove "${t.name || 'this treasure'}"?`)) { hunt.targets.splice(i, 1); rerender(); } };
    if (calib && calib[i]) {
      const c = calib[i];
      card.querySelector('.note').innerHTML = c.warning
        ? `<div class="warn">⚠️ This treasure ${c.warning}.</div>`
        : `<div class="okc">✓ Looks distinctive (match ${c.pos.toFixed(2)} vs others ${c.negHi.toFixed(2)}).</div>`;
    }
    root.appendChild(card);
  });
}
$('addTarget').onclick = () => {
  hunt.targets.push({ name: '', clue: '', hint: '', code: newCode(), refs: [], area: [] });
  save(); renderTargets();
};

// ---------- Analysis & live test ----------
async function ensureEmbeddings() {
  if (embs) return;
  const bad = hunt.targets.findIndex((t) => !t.refs.length);
  if (bad >= 0) throw new Error(`Treasure ${bad + 1} needs at least one close-up`);
  $('anaStatus').textContent = 'Loading the scanner…';
  await loadModel((f) => { $('anaStatus').textContent = `Loading the scanner… ${Math.round(f * 100)}%`; });
  embs = await embedHunt(hunt, (f) => { $('anaStatus').textContent = `Studying photos… ${Math.round(f * 100)}%`; });
  calib = calibrate(embs);
}

$('analyze').onclick = async () => {
  try {
    await ensureEmbeddings();
    $('anaStatus').textContent = calib.some((c) => c.warning) ? 'Some treasures need attention (see notes on each).' : 'All treasures look distinctive.';
    renderTargets();
  } catch (e) { $('anaStatus').textContent = '⚠️ ' + e.message; }
};

let liveOn = false;
$('liveBtn').onclick = async () => {
  if (liveOn) { liveOn = false; $('liveCam').srcObject?.getTracks().forEach((t) => t.stop()); $('live').classList.add('hidden'); return; }
  try {
    await ensureEmbeddings();
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const v = $('liveCam');
    v.srcObject = s; await v.play();
    $('live').classList.remove('hidden');
    liveOn = true;
    const bars = $('liveBars');
    while (liveOn) {
      if (!v.videoWidth) { await new Promise((r) => setTimeout(r, 200)); continue; }
      const e = await embed(v);
      bars.innerHTML = '';
      hunt.targets.forEach((t, i) => {
        const s = maxSim(e, embs[i].refs);
        const thr = calib[i].threshold + (hunt.sensitivity || 0);
        const row = document.createElement('div');
        const hit = s >= thr;
        row.innerHTML = `<div class="small">${hit ? '✅' : '·'} ${t.name || 'Treasure ' + (i + 1)} <span>${s.toFixed(2)} / ${thr.toFixed(2)}</span></div>
          <div class="bar"><i style="width:${Math.max(0, s) * 100}%;background:${hit ? 'var(--ok)' : 'var(--cold)'}"></i><b style="left:${thr * 100}%"></b></div>`;
        bars.appendChild(row);
      });
    }
  } catch (e) { $('anaStatus').textContent = '⚠️ ' + e.message; }
};

$('preview').onclick = () => {
  try {
    localStorage.setItem('arhunt.preview', JSON.stringify(hunt));
    location.href = 'index.html?local=1&reset=1';
  } catch {
    alert('This browser couldn\'t store the preview. Download hunt.json and put it next to index.html instead.');
  }
};

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(hunt)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hunt.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// ---------- QR codes ----------
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
function baseUrl() {
  let u = $('url').value.trim();
  if (!u) return null;
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  return u.replace(/(setup|index)\.html.*$/, '').replace(/\/?$/, '/');
}
$('makeQr').onclick = () => {
  const base = baseUrl();
  if (!base) { alert('Paste the hunt\'s public link first.'); return; }
  const area = $('printArea');
  area.innerHTML = `
    <div class="placard"><h3>Scan me! 🎂</h3><div class="qr">${qrSvg(base)}</div>
    <div>A birthday mission for <b></b></div></div>
    <h2 style="color:#888">Backup stickers (hide one on each treasure)</h2>
    <div class="stickers"></div>`;
  area.querySelector('.placard b').textContent = hunt.recipient || 'you';
  const st = area.querySelector('.stickers');
  hunt.targets.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'sticker';
    d.innerHTML = qrSvg(`${base}#t=${i}.${t.code}`) + `<div></div>`;
    d.querySelector('div').textContent = t.name || `Treasure ${i + 1}`;
    st.appendChild(d);
  });
};
$('print').onclick = () => { if (!$('printArea').innerHTML) $('makeQr').click(); window.print(); };

hunt = await load();
hunt.reveal = { ...blank().reveal, ...(hunt.reveal || {}) };
$('url').value = location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.host)
  ? location.href.replace(/setup\.html.*$/, '') : '';
fillForm();
