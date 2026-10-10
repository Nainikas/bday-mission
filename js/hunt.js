import { loadModel, embedHunt, calibrate, embed, maxSim, modelReady } from './vision.js';
import * as sfx from './sfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const CHARACTERS = ['🦖', '🐧', '🤖', '🦄', '👾', '🐙', '🦊', '🐸', '🐼', '🦜', '🐨', '🧙', '🐳', '🦁', '🐝'];
const CHEERS = ['Keep sweeping!', 'Ooh, nice moves!', 'Scanner is buzzing!', 'You\'ve got this!', 'Eyes like a hawk!', 'Smooth scanning!', 'Look high, look low!', 'Detective mode: ON'];
const WARM = ['Ooh, getting warmer!', 'Warmer… warmer…', 'Something good is near!', 'Ooh, I sense something!'];
const HOT = ['HOT HOT HOT! 🔥', 'Sooo close!', 'It\'s RIGHT there!', 'Burning up!'];
const COLD = ['Brrr, ice cold 🧊', 'Try another spot!', 'Nope, not here. Maybe another room?', 'Cold as a penguin\'s toes!'];
const ALREADY = ['You already got that one! 😄', 'Been there, found that!'];
const ORB_COLORS = ['#ff5ad1', '#5ad1ff', '#7dff5a', '#ffd25a', '#b45aff', '#ff8a5a', '#5affc8', '#ff5a5a'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let hunt, embs, calib, progressKey;
let found = new Set();
let scanning = false;

// ---------- Load hunt data ----------
async function loadHunt() {
  if (params.has('local')) {
    const raw = localStorage.getItem('arhunt.preview');
    if (raw) return JSON.parse(raw);
  }
  const r = await fetch('hunt.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('hunt.json missing');
  return r.json();
}

function saveProgress() {
  try { localStorage.setItem(progressKey, JSON.stringify([...found])); } catch {}
}
function loadProgress() {
  try {
    if (params.has('reset')) localStorage.removeItem(progressKey);
    found = new Set(JSON.parse(localStorage.getItem(progressKey) || '[]'));
  } catch { found = new Set(); }
}

// Treasures can be found in any order.
const remaining = () => hunt.targets.map((_, i) => i).filter((i) => !found.has(i));
let clueAt = 0; // which remaining clue the card shows

// ---------- Progress orbs ----------
function renderOrbs() {
  const el = $('orbs');
  el.innerHTML = '';
  hunt.targets.forEach((_, i) => {
    const o = document.createElement('div');
    o.className = 'orb' + (found.has(i) ? ' on' : '');
    o.style.setProperty('--c', ORB_COLORS[i % ORB_COLORS.length]);
    el.appendChild(o);
  });
}

function shownTarget() {
  const r = remaining();
  return r.length ? r[((clueAt % r.length) + r.length) % r.length] : -1;
}
function showClue() {
  const r = remaining();
  const i = shownTarget();
  if (i < 0) return;
  const t = hunt.targets[i];
  const pos = r.indexOf(i) + 1;
  $('clueLbl').textContent = r.length > 1
    ? `Clue ${pos} of ${r.length} · tap for another`
    : 'Final treasure!';
  $('clueTxt').textContent = t.clue || 'Find a hidden treasure!';
  $('hintBtn').classList.toggle('hidden', !t.hint && !hunt.stickers);
}
document.querySelector('.clue').addEventListener('click', () => { clueAt++; sfx.blip(); showClue(); });

// ---------- Pop-ups ----------
let lastPop = 0;
function pop(text, who = pick(CHARACTERS), force = false) {
  const now = performance.now();
  if (!force && now - lastPop < 3500) return;
  lastPop = now;
  const el = document.createElement('div');
  el.className = 'pop';
  const left = Math.random() < 0.5;
  el.style[left ? 'left' : 'right'] = '12px';
  el.style.top = `${28 + Math.random() * 30}%`;
  if (!left) el.style.flexDirection = 'row-reverse';
  el.innerHTML = `<div class="who"></div><div class="say"></div>`;
  el.querySelector('.who').textContent = who;
  el.querySelector('.say').textContent = text;
  document.body.appendChild(el);
  sfx.blip();
  sparks(left ? 60 : innerWidth - 60, el.getBoundingClientRect().top + 30, 6);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2600);
}

function sparks(x, y, n = 8, set = ['✨', '⭐', '💫', '🎉', '🎈']) {
  for (let k = 0; k < n; k++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.textContent = pick(set);
    s.style.left = `${x}px`; s.style.top = `${y}px`;
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

// ---------- Warmer / colder meter ----------
let warmth = 0, trail = [], coldSince = 0, band = 'none', hits = 0;
function resetMeter() {
  warmth = 0; trail = []; coldSince = performance.now(); band = 'none'; hits = 0;
  $('needle').style.left = '0%';
  $('hint').textContent = 'Point the camera around…';
  $('reticle').classList.remove('hot');
}

function warmthOf(raw, t) {
  const c = calib[t];
  return Math.max(0, Math.min(1, (raw - c.lo) / (c.threshold - c.lo)));
}

function updateMeter(w) {
  warmth = warmth * 0.55 + w * 0.45;
  const now = performance.now();
  trail.push([now, warmth]);
  while (trail.length && now - trail[0][0] > 4000) trail.shift();
  $('needle').style.left = `${(warmth * 100).toFixed(1)}%`;
  $('reticle').classList.toggle('hot', warmth > 0.75);

  const old = trail[0][1];
  const trend = warmth - old;
  let text;
  if (warmth > 0.8) text = 'HOT! 🔥🔥🔥';
  else if (warmth > 0.6) text = trend > 0.05 ? 'Warmer! Warmer! 🔥' : 'Getting hot… 🔥';
  else if (warmth > 0.4) text = trend > 0.05 ? 'Getting warmer ☀️' : trend < -0.05 ? 'Cooling off… 🌬️' : 'Lukewarm 🌤️';
  else if (warmth > 0.2) text = trend < -0.05 ? 'Colder… 🥶' : 'Chilly ❄️';
  else text = 'Ice cold 🧊';
  $('hint').textContent = text;

  if (warmth > 0.25) coldSince = now;
  const newBand = warmth > 0.8 ? 'hot' : warmth > 0.5 ? 'warm' : warmth < 0.2 ? 'cold' : 'mid';
  if (newBand !== band) {
    if (newBand === 'hot' && band !== 'hot') pop(pick(HOT));
    else if (newBand === 'warm' && (band === 'cold' || band === 'mid' || band === 'none')) pop(pick(WARM));
    band = newBand;
  }
  if (now - coldSince > 14000) {
    pop(pick(COLD), pick(['🐧', '⛄', '🦭', '🐻‍❄️']));
    coldSince = now;
  }
}

// ---------- Movement-triggered cheers ----------
const motionCanvas = document.createElement('canvas');
motionCanvas.width = 32; motionCanvas.height = 32;
let prevFrame = null, movement = 0;
function trackMotion(video) {
  if (!scanning) return;
  if (video.videoWidth) {
    const ctx = motionCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    if (prevFrame) {
      let diff = 0;
      for (let i = 0; i < d.length; i += 4) diff += Math.abs(d[i + 1] - prevFrame[i + 1]);
      const m = diff / (32 * 32 * 255);
      if (m > 0.04) movement += m;
      if (movement > 6) {
        movement = 0;
        if (band !== 'hot') {
          pop(pick(CHEERS));
          sparks(innerWidth / 2, innerHeight / 2, 10);
        }
      }
    }
    prevFrame = d;
  }
  setTimeout(() => trackMotion(video), 120);
}

// ---------- Scan loop ----------
const hitCount = {};
async function scanLoop(video) {
  while (scanning) {
    const left = remaining();
    if (!left.length) return;
    if (!video.videoWidth || !modelReady()) { await sleep(200); continue; }
    const v = await embed(video, 1);
    if (!scanning) return;

    // Warmth follows whichever unfound treasure the camera view is closest to.
    let best = 0, winner = -1;
    for (const t of left) {
      const e = embs[t];
      const sObj = maxSim(v, e.refs);
      const sArea = e.area.length ? maxSim(v, e.area) : -1;
      best = Math.max(best, warmthOf(Math.max(sObj, sArea * 0.95), t));
      hitCount[t] = sObj >= calib[t].threshold ? (hitCount[t] || 0) + 1 : 0;
      if (hitCount[t] >= 2 && (winner < 0 || sObj > maxSim(v, embs[winner].refs))) winner = t;
    }
    updateMeter(best);

    // Pointing at a treasure that's already been found.
    for (const j of found) {
      if (maxSim(v, embs[j].refs) >= calib[j].threshold) { pop(pick(ALREADY), '👀'); break; }
    }

    if (winner >= 0) { await onFound(winner); }
    await sleep(60);
  }
}

// ---------- Found ----------
async function onFound(t) {
  if (found.has(t)) return;
  found.add(t);
  saveProgress();
  scanning = false;
  renderOrbs();
  sfx.found();
  confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 } });

  if (!remaining().length) return finale();

  const left = hunt.targets.length - found.size;
  $('foundWho').textContent = pick(CHARACTERS);
  $('foundBig').textContent = pick(['FOUND IT!', 'NAILED IT!', 'BOOM!', 'YESSS!']);
  $('foundImg').src = hunt.targets[t].refs[0];
  $('foundText').textContent = `${hunt.targets[t].name ? hunt.targets[t].name + '! ' : ''}${left} more to go…`;
  $('found').classList.remove('hidden');
  setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0 } }), 300);
  setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1 } }), 500);
}

$('nextBtn').onclick = async () => {
  sfx.unlock();
  $('found').classList.add('hidden');
  clueAt = 0;
  showClue();
  resetMeter();
  Object.keys(hitCount).forEach((k) => { hitCount[k] = 0; });
  if (!stream) {
    try { await startCamera(); } catch { $('hint').textContent = 'Please allow the camera, then reload 📷'; return; }
  }
  if (embs) startScanning();
};

// ---------- Finale ----------
async function finale() {
  scanning = false;
  stopCamera();
  $('found').classList.add('hidden');
  $('scan').classList.add('hidden');
  const fin = $('finale');
  fin.classList.remove('hidden');
  const r = hunt.reveal || {};

  // The progress orbs come back as start lights: on one by one, then lights out.
  const lights = $('lights');
  lights.innerHTML = '';
  const orbs = [...Array(5)].map(() => { const o = document.createElement('div'); o.className = 'orb'; lights.appendChild(o); return o; });
  $('finaleTitle').textContent = '';
  await sleep(900);
  for (const o of orbs) { o.classList.add('red'); sfx.beep(440); await sleep(850); }
  await sleep(700 + Math.random() * 1500);
  orbs.forEach((o) => { o.classList.remove('red'); o.classList.add('out'); });
  sfx.go();
  $('finaleTitle').textContent = r.headline || 'LIGHTS OUT!';
  fireworks();
  await sleep(1200);

  const tickets = $('tickets');
  tickets.innerHTML = '';
  const count = r.count || 3;
  for (let i = 0; i < count; i++) {
    const tk = document.createElement('div');
    tk.className = 'ticket';
    tk.innerHTML = `<div class="main"><div class="ev"></div><div class="sub when"></div><div class="sub where"></div><div class="flag"></div></div>
      <div class="stub"><div>ADMIT</div><div class="n">ONE</div><div class="seat"></div></div>`;
    tk.querySelector('.ev').textContent = r.event || 'Formula 1 Las Vegas Grand Prix';
    tk.querySelector('.when').textContent = r.when || 'November 2026';
    tk.querySelector('.where').textContent = r.where || 'Las Vegas Strip Circuit';
    tk.querySelector('.seat').textContent = (r.seats && r.seats[i]) || `Ticket ${i + 1}/${count}`;
    tickets.appendChild(tk);
    await sleep(500);
    tk.classList.add('in');
    sfx.whoosh();
    await sleep(500);
  }
  $('finaleMsg').textContent = r.message || 'Pack your bags, we\'re going to Vegas! 🏁';
  $('againBtn').classList.remove('hidden');
}

function fireworks() {
  const end = Date.now() + 6000;
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: ['#ff2bd6', '#ffcc00', '#ffffff', '#e10600'] });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: ['#ff2bd6', '#ffcc00', '#ffffff', '#e10600'] });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  setTimeout(() => confetti({ particleCount: 300, spread: 160, origin: { y: 0.4 }, scalar: 1.2 }), 400);
}

// ---------- Camera ----------
let stream = null;
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const video = $('cam');
  video.srcObject = stream;
  await video.play().catch(() => {});
  return video;
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function startScanning() {
  scanning = true;
  const video = $('cam');
  scanLoop(video).catch((e) => { console.error(e); $('hint').textContent = 'Scanner hiccup, tap Hint for help'; });
  trackMotion(video);
}

// ---------- Backup sticker codes (#t=<index>.<code>) ----------
function checkSticker() {
  const m = location.hash.match(/t=(\d+)\.(\w+)/);
  if (!m) return false;
  const i = +m[1];
  window.history.replaceState(null, '', location.pathname + location.search);
  if (hunt.targets[i] && hunt.targets[i].code === m[2] && !found.has(i)) {
    $('intro').classList.add('hidden');
    $('scan').classList.remove('hidden');
    scanning = false;
    onFound(i);
    return true;
  }
  return false;
}
window.addEventListener('hashchange', () => { if (hunt) checkSticker(); });

$('hintBtn').onclick = () => {
  const t = hunt.targets[shownTarget()];
  if (!t) return;
  const extra = hunt.stickers ? ' Found it but the scanner is shy? Scan its little sticker with your Camera app.' : '';
  pop((t.hint || 'Look closely!') + extra, '🧙', true);
};
$('soundBtn').onclick = () => { $('soundBtn').textContent = sfx.toggle() ? '🔊' : '🔇'; };

// ---------- Boot ----------
async function boot() {
  try {
    hunt = await loadHunt();
  } catch {
    $('introTitle').textContent = 'Mission not set up yet';
    $('introText').textContent = 'The organizer still needs to add hunt.json (made on the setup page).';
    $('loadText').textContent = '';
    return;
  }
  progressKey = 'arhunt.progress.' + (hunt.id || 'default');
  loadProgress();
  if (hunt.recipient) $('introTitle').textContent = `Happy Birthday, ${hunt.recipient}!`;
  if (hunt.intro) $('introText').textContent = hunt.intro;
  if (found.size) $('startBtn').textContent = 'Continue the mission';

  // A finished hunt never jumps straight to the reveal: offer a replay or a fresh start instead.
  if (!remaining().length) {
    $('introTitle').textContent = 'Mission complete! 🏁';
    $('introText').textContent = 'All treasures were found on this phone.';
    $('startBtn').classList.add('hidden');
    $('loadText').textContent = '';
    $('doneRow').classList.remove('hidden');
  }
  if (checkSticker()) renderOrbs();

  const fill = $('loadFill');
  try {
    await loadModel((f) => { fill.style.width = `${Math.round(f * 70)}%`; });
    $('loadText').textContent = 'Memorizing the treasures…';
    embs = await embedHunt(hunt, (f) => { fill.style.width = `${70 + Math.round(f * 30)}%`; });
    calib = calibrate(embs).map((c, i) => {
      const o = (hunt.targets[i].tune || 0) + (hunt.sensitivity || 0);
      return { ...c, threshold: c.threshold + o };
    });
    $('loadText').textContent = 'Scanner ready!';
    // Arrived via a sticker link and already scanning? Start matching now.
    if (stream && !scanning && $('found').classList.contains('hidden') && !$('scan').classList.contains('hidden')) startScanning();
  } catch (e) {
    console.error(e);
    $('loadText').textContent = hunt.stickers
      ? 'The scanner couldn\'t start, so look for little stickers on the treasures and scan them with your Camera app.'
      : 'The scanner couldn\'t start. Check the internet connection and reload.';
    if (!hunt.stickers) return;
  }
  $('startBtn').disabled = false;
}

function restart() {
  found = new Set();
  saveProgress();
  location.replace(location.pathname + location.search.replace(/[?&]reset=1/, ''));
}
$('restartBtn').onclick = restart;
$('againBtn').onclick = restart;
$('replayBtn').onclick = () => { sfx.unlock(); $('intro').classList.add('hidden'); finale(); };

$('startBtn').onclick = async () => {
  sfx.unlock();
  $('intro').classList.add('hidden');
  $('scan').classList.remove('hidden');
  renderOrbs();
  showClue();
  resetMeter();
  try {
    await startCamera();
  } catch (e) {
    $('hint').textContent = 'Please allow the camera, then reload 📷';
    return;
  }
  pop('Let\'s gooo! Follow the clue and sweep the camera around.', '🤖', true);
  if (embs) startScanning();
};

boot();
