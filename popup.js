
// ── TIMINGS (ms) ──
const SPEED_PRESETS = {
  normal: { afterFilter: 2500, afterClear: 800,  afterQty: 600,  betweenItems: 400, afterSubFilter: 2500 },
  fast:   { afterFilter: 1600, afterClear: 600,  afterQty: 400,  betweenItems: 250, afterSubFilter: 1600 },
  warp:   { afterFilter: 600,  afterClear: 0,    afterQty: 100,  betweenItems: 100, afterSubFilter: 600, overwriteMode: true },
};
let _speed = 'normal';
let _overwriteMode = false;
function TIMINGS() {
  if (_speed === 'custom') {
    return {
      afterFilter:    parseInt(document.getElementById('ciFilter')?.value)    || 2500,
      afterClear:     parseInt(document.getElementById('ciClear')?.value)     || 800,
      afterQty:       parseInt(document.getElementById('ciQty')?.value)       || 600,
      betweenItems:   parseInt(document.getElementById('ciBetween')?.value)   || 400,
      afterSubFilter: parseInt(document.getElementById('ciSubFilter')?.value) || 2500,
      overwriteMode:  _overwriteMode,
    };
  }
  return { ...SPEED_PRESETS[_speed] || SPEED_PRESETS.normal, overwriteMode: false };
}
function isWarp()  { return _speed === 'warp'; }
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6jkcvoMrJ4XJUWAl_fUpv0bRNeHYTpUX64wCU534_HW7NxB3oJKLw9ogxP7-CwJno/exec';

let pollInterval = null;
let localState   = null;
let timerInterval = null;
let wakeLock      = null;

// ── STARTUP ──
function stepSet(id, iconClass, iconContent, subText) {
  const icon = document.getElementById(id + 'Icon');
  const sub  = document.getElementById(id + 'Sub');
  if (icon) { icon.className = 'step-icon ' + iconClass; icon.textContent = iconContent; }
  if (sub)  sub.textContent = subText;
}
function stepShow(id) {
  const el = document.getElementById(id);
  if (el) setTimeout(() => el.classList.add('visible'), 50);
}

async function runStartup() {
  stepShow('stepInit');
  stepSet('stepInit', 'spinning-ring', '', 'Loading state...');
  await sleep(300);
  localState = await getState();
  stepSet('stepInit', 'done', '\u2713', 'Loaded');
  if (localState.phase !== 'idle') {
    stepShow('stepUpdate');
    stepSet('stepUpdate', 'done', '\u2713', 'Skipped \u2014 bot is running');
    stepShow('stepReady');
    stepSet('stepReady', 'spinning-ring', '', 'Resuming session...');
    await sleep(400);
    stepSet('stepReady', 'done', '\u2713', 'Session restored');
    await sleep(300);
    hideStartup(); renderState();
    if (localState.phase === 'running') { startPolling(); resumeTimer(); }
    return;
  }
  await sleep(200);
  stepShow('stepUpdate');
  stepSet('stepUpdate', 'spinning-ring', '', 'Checking for updates...');
  await sleep(400);
  try {
    const currentVersion = browser.runtime.getManifest().version;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://petvalu-bot.vercel.app/update.xml?t=' + Date.now(), { cache: 'no-store', signal: controller.signal });
    clearTimeout(fetchTimeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const match = xml.match(/<em:version>([^<]+)<\/em:version>/);
    if (!match) throw new Error('Could not parse update.xml');
    const remoteVersion = match[1];
    if (remoteVersion !== currentVersion) {
      stepSet('stepUpdate', 'update', '\u2191', 'v' + remoteVersion + ' available');
      await sleep(300);
      const secStartup = document.getElementById('secStartup');
      const secUpdate  = document.getElementById('secUpdate');
      secStartup.style.transition = 'opacity 0.3s ease'; secStartup.style.opacity = '0';
      await sleep(300); secStartup.style.display = 'none';
      document.getElementById('updTitle').textContent = 'Update Available';
      document.getElementById('updVersion').textContent = currentVersion + ' \u2192 v' + remoteVersion;
      secUpdate.classList.add('show'); return;
    } else { stepSet('stepUpdate', 'done', '\u2713', 'Up to date (v' + currentVersion + ')'); }
  } catch(e) {
    const cv = browser.runtime.getManifest().version;
    stepSet('stepUpdate', 'warn', '!', 'Could not check \u2014 continuing (v' + cv + ')');
  }
  await sleep(200);
  stepShow('stepReady'); stepSet('stepReady', 'spinning-ring', '', 'Loading orders...'); await sleep(300);
  stepSet('stepReady', 'done', '\u2713', 'Ready'); await sleep(350);
  hideStartup(); renderState(); loadDriveOrders();
}

function hideStartup() {
  const el = document.getElementById('secStartup'); if (!el) return;
  const vb = document.getElementById('versionBadge');
  if (vb) { browser.runtime.getManifest ? (vb.textContent = 'v' + browser.runtime.getManifest().version) : chrome.runtime.getManifest && (vb.textContent = 'v' + chrome.runtime.getManifest().version); }
  el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function updateOverwriteLabel() {
  const lbl = document.getElementById('ciOverwriteLabel');
  if (lbl) lbl.textContent = _overwriteMode ? 'On \u2014 select-all before typing' : 'Off \u2014 clear field first';
  const track = document.getElementById('ciOverwriteTrack'); const thumb = document.getElementById('ciOverwriteThumb');
  if (track) track.style.background = _overwriteMode ? 'var(--accent)' : 'var(--s3)';
  if (thumb) thumb.style.transform  = _overwriteMode ? 'translateX(16px)' : 'translateX(0)';
  const clearRow = document.getElementById('ciClearRow');
  if (clearRow) { clearRow.style.opacity = _overwriteMode ? '0.35' : '1'; clearRow.style.pointerEvents = _overwriteMode ? 'none' : ''; }
}

function saveSpeedPrefs() {
  const prefs = { speed: _speed, filter: document.getElementById('ciFilter')?.value||'2500', clear: document.getElementById('ciClear')?.value||'800', qty: document.getElementById('ciQty')?.value||'600', between: document.getElementById('ciBetween')?.value||'400', subFilter: document.getElementById('ciSubFilter')?.value||'2500', overwrite: _overwriteMode };
  chrome.storage.local.set({ speedPrefs: prefs });
}

function loadSpeedPrefs() {
  chrome.storage.local.get('speedPrefs', ({ speedPrefs }) => {
    if (!speedPrefs) return;
    const ci = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    ci('ciFilter', speedPrefs.filter); ci('ciClear', speedPrefs.clear); ci('ciQty', speedPrefs.qty);
    ci('ciBetween', speedPrefs.between); ci('ciSubFilter', speedPrefs.subFilter);
    if (speedPrefs.overwrite != null) { _overwriteMode = speedPrefs.overwrite; const tog = document.getElementById('ciOverwriteToggle'); if (tog) tog.checked = _overwriteMode; updateOverwriteLabel(); }
    setSpeed(speedPrefs.speed || 'normal');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pasteArea').addEventListener('input', onPasteAreaInput);
  document.getElementById('btnLoad').addEventListener('click', loadFromPasteArea);
  document.getElementById('btnRefresh').addEventListener('click', loadDriveOrders);
  document.getElementById('pasteToggle').addEventListener('click', togglePaste);
  document.querySelectorAll('.speed-btn').forEach(btn => { btn.addEventListener('click', () => setSpeed(btn.dataset.speed)); });
  ['ciFilter','ciClear','ciQty','ciBetween','ciSubFilter'].forEach(id => { document.getElementById(id)?.addEventListener('change', saveSpeedPrefs); });
  document.getElementById('ciOverwriteToggle')?.addEventListener('change', e => { _overwriteMode = e.target.checked; updateOverwriteLabel(); saveSpeedPrefs(); });
  loadSpeedPrefs();
  document.getElementById('devTriggerBtn').addEventListener('click', openDevMode);
  document.getElementById('devCloseBtn').addEventListener('click', closeDevMode);
  document.getElementById('devEmailBtn').addEventListener('click', devTestEmail);
  document.getElementById('devDriveBtn').addEventListener('click', devTestDrive);
  document.getElementById('devUpdateBtn').addEventListener('click', devTestUpdate);
  runStartup();
});

const STORE_NAMES = ['Lakeshore Rd', 'Lambton Mall', 'Corunna', 'London'];
const STORE_NUMBERS = { 'Lakeshore Rd':'2087', 'Lambton Mall':'2356', 'Corunna':'2372', 'London':'2412' };
function storeLabel(name) { const num = STORE_NUMBERS[name]; return num ? `${name} <span style="font-size:11px;opacity:0.7;font-weight:600">#${num}</span>` : name; }
function storeLabelPlain(name) { return name; }

function parseFilename(name) {
  const base = name.replace('.json', ''); const parts = base.split('_');
  const operator = parts[0]; const dateStr = parts[parts.length - 1];
  const storeRaw = parts.slice(1, parts.length - 1).join('_');
  const store = STORE_NAMES.find(s => s.replace(/ /g, '_') === storeRaw) || storeRaw.replace(/_/g, ' ');
  return { operator, store, dateStr };
}

function groupOrders(files) {
  const parsed = files.map(f => ({ ...f, ...parseFilename(f.name) }));
  const byStore = {};
  parsed.forEach(f => { if (!byStore[f.store]) byStore[f.store] = []; byStore[f.store].push(f); });
  const groups = [];
  Object.entries(byStore).forEach(([store, orders]) => {
    orders.sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
    const used = new Set();
    orders.forEach((o, i) => {
      if (used.has(i)) return;
      const group = { store, orders: [o] }; used.add(i);
      orders.forEach((o2, j) => { if (used.has(j)) return; if (Math.abs(new Date(o.dateStr) - new Date(o2.dateStr)) / 86400000 <= 2) { group.orders.push(o2); used.add(j); } });
      group.orders.sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
      groups.push(group);
    });
  });
  groups.sort((a, b) => Math.max(...b.orders.map(o => new Date(o.dateStr))) - Math.max(...a.orders.map(o => new Date(o.dateStr))));
  return groups;
}

function formatDate(dateStr) { const d = new Date(dateStr + 'T12:00:00'); return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); }

function groupCard(g, gi) {
  const dates = [...new Set(g.orders.map(o => o.dateStr))].sort();
  const dateLabel = dates.length > 1 ? `${formatDate(dates[0])} \u2013 ${formatDate(dates[dates.length - 1])}` : formatDate(dates[0]);
  const storeNum = storeLabel(g.store).match(/#\d+/)?.[0] || '';
  const orderRows = g.orders.map((o, oi) => { const cntStr = o.itemCount != null ? ` &nbsp;\u00b7&nbsp; ${o.itemCount} items` : ''; return `<div class="sg-order" data-gi="${gi}" data-oi="${oi}"><div><div class="sg-op">${o.operator}</div><div class="sg-meta">${formatDate(o.dateStr)}${cntStr}</div></div><div class="sg-arr">\u203a</div></div>`; }).join('');
  const loadLabel = g.orders.length === 2 ? 'Load Both Together' : `Load All Together (${g.orders.length})`;
  const bothBtn = g.orders.length >= 2 ? `<div class="sg-both" data-gi="${gi}" data-both="1">${loadLabel}</div>` : '';
  return `<div class="store-group"><div class="sg-header"><div class="sg-store-name">${storeLabelPlain(g.store)}</div><div class="sg-store-sub" id="sg-sub-${gi}">${storeNum} &nbsp;\u00b7&nbsp; ${dateLabel}</div></div>${orderRows}${bothBtn}</div>`;
}

function renderGroups(groups) {
  const list = document.getElementById('driveOrderList');
  const recent = groups.slice(0, 3); const older = groups.slice(3);
  let html = recent.map((g, gi) => groupCard(g, gi)).join('');
  if (older.length > 0) { html += `<div id="olderToggle" style="text-align:center;padding:10px 0 4px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text2);user-select:none"><span id="olderToggleLabel">\u25be Show ${older.length} older order${older.length !== 1 ? 's' : ''}</span></div><div id="olderOrders" style="display:none">${older.map((g, i) => groupCard(g, 3 + i)).join('')}</div>`; }
  list.innerHTML = html;
  list.querySelector('#olderToggle')?.addEventListener('click', toggleOlderOrders);
  list.querySelectorAll('.sg-order').forEach(el => { el.addEventListener('click', () => { const g = groups[+el.dataset.gi]; loadFromDrive(g.orders[+el.dataset.oi].id, g.orders[+el.dataset.oi].name); }); });
  list.querySelectorAll('[data-both]').forEach(el => { el.addEventListener('click', () => { loadBothFromDrive(groups[+el.dataset.gi].orders, +el.dataset.gi); }); });
}

function toggleOlderOrders() {
  const el = document.getElementById('olderOrders'); const label = document.getElementById('olderToggleLabel');
  const count = document.querySelectorAll('#olderOrders .store-group').length; if (!el) return;
  const open = el.style.display === 'none'; el.style.display = open ? '' : 'none';
  if (label) label.textContent = open ? '\u25b4 Hide older orders' : `\u25be Show ${count} older order${count !== 1 ? 's' : ''}`;
}

async function backfillItemCounts(groups) {
  await Promise.all(groups.map(async (g, gi) => {
    const jsonOrders = g.orders.filter(o => o.name && o.name.endsWith('.json')); if (!jsonOrders.length) return;
    try {
      const contents = await Promise.all(jsonOrders.map(o => fetchOrder(o.id)));
      contents.forEach((content, ci) => { const o = jsonOrders[ci]; const oi = g.orders.indexOf(o); o.itemCount = content.items?.length ?? 0; const el = document.querySelector(`[data-gi="${gi}"][data-oi="${oi}"] .sg-meta`); if (el) el.innerHTML = `${formatDate(o.dateStr)} &nbsp;\u00b7&nbsp; ${o.itemCount} items`; });
      const itemMap = new Map(); contents.forEach(c => c.items?.forEach(i => itemMap.set(String(i.item), i)));
      const dates = [...new Set(g.orders.map(o => o.dateStr))].sort();
      const dateLabel = dates.length > 1 ? `${formatDate(dates[0])} \u2013 ${formatDate(dates[dates.length-1])}` : formatDate(dates[0]);
      const storeNum = storeLabel(g.store).match(/#\d+/)?.[0] || '';
      const subEl = document.getElementById(`sg-sub-${gi}`);
      if (subEl) subEl.innerHTML = `${storeNum} &nbsp;\u00b7&nbsp; ${dateLabel} &nbsp;\u00b7&nbsp; <span class="sg-total">${itemMap.size} items</span>`;
    } catch(e) {}
  }));
}

async function loadDriveOrders() {
  const list = document.getElementById('driveOrderList'); const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');
  list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px">Loading from Drive...</div>';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'DRIVE_FETCH', url: `${APPS_SCRIPT_URL}?action=list` });
    if (!resp.ok) throw new Error(resp.error);
    const data = resp.data;
    if (!data.success || !data.files?.length) { list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px">No orders found in Drive</div>'; return; }
    const groups = groupOrders(data.files.filter(f => !f.name.startsWith('CATALOG_')));
    renderGroups(groups); backfillItemCounts(groups.slice(0, 3));
  } catch(e) {
    console.error('[PV] loadDriveOrders error:', e);
    list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--red);font-size:12px">Error: ${e.message}</div>`;
  } finally { if (icon) icon.classList.remove('spinning'); }
}

async function fetchOrder(fileId) {
  const resp = await chrome.runtime.sendMessage({ type: 'DRIVE_FETCH', url: `${APPS_SCRIPT_URL}?action=get&id=${fileId}` });
  if (!resp.ok) throw new Error(resp.error);
  if (!resp.data.success || !resp.data.content) throw new Error('Bad response');
  return resp.data.content;
}

async function loadFromDrive(fileId, filename) {
  setStatus('yellow', 'Loading order...');
  try { const content = await fetchOrder(fileId); await loadOrder(content); setStatus('green', `Loaded: ${storeLabelPlain(content.store)} \u2014 ${content.items.length} items`); }
  catch(e) { setStatus('red', 'Failed to load order from Drive'); }
}

async function loadBothFromDrive(orders, gi) {
  setStatus('yellow', 'Loading orders...');
  try {
    const contents = await Promise.all(orders.map(o => fetchOrder(o.id)));
    const itemMap = new Map(); contents.forEach(content => { content.items.forEach(i => itemMap.set(String(i.item), i)); });
    const merged = { store: contents[0].store, date: contents[contents.length-1].date || contents[0].date, items: Array.from(itemMap.values()) };
    await loadOrder(merged);
    if (gi != null) { const subEl = document.getElementById(`sg-sub-${gi}`); if (subEl) { const span = subEl.querySelector('.sg-total'); if (span) span.textContent = merged.items.length + ' items'; } }
    setStatus('green', `Loaded: ${storeLabelPlain(merged.store)} \u2014 ${merged.items.length} items`);
  } catch(e) { setStatus('red', 'Failed to load orders from Drive'); }
}

async function loadOrder(data) {
  await setState({ phase:'loaded', orderData:data, results:{entered:[],skipped:[],notFound:[],flagged:[]}, log:[], progress:{current:0,total:data.items.length}, stopRequested:false });
  localState = await getState(); renderState();
}

function setSpeed(speed) {
  _speed = speed;
  const warpBtn = document.getElementById('speedWarp');
  if (speed === 'warp' && warpBtn) {
    warpBtn.querySelectorAll('.lightning-svg').forEach(el => el.remove());
    warpBtn.classList.remove('warp-lightning'); void warpBtn.offsetWidth; warpBtn.classList.add('warp-lightning');
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'lightning-svg'); svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:visible';
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    const defs = document.createElementNS(ns, 'defs'); const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id','bolt-glow'); filter.setAttribute('x','-80%'); filter.setAttribute('y','-80%'); filter.setAttribute('width','260%'); filter.setAttribute('height','260%');
    const blur = document.createElementNS(ns, 'feGaussianBlur'); blur.setAttribute('stdDeviation','2.5'); blur.setAttribute('result','blur');
    const merge = document.createElementNS(ns, 'feMerge'); ['blur','blur','SourceGraphic'].forEach(n => { const node = document.createElementNS(ns, 'feMergeNode'); node.setAttribute('in', n); merge.appendChild(node); });
    filter.appendChild(blur); filter.appendChild(merge); defs.appendChild(filter); svg.appendChild(defs);
    function makePath(d, stroke, width, dashLen, delay) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d',d); p.setAttribute('stroke',stroke); p.setAttribute('stroke-width',String(width)); p.setAttribute('fill','none'); p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round'); p.setAttribute('filter','url(#bolt-glow)'); const anim = delay ? `boltDraw 0.85s ease forwards ${delay}s,boltFlash 0.85s ease forwards ${delay}s` : 'boltDraw 0.85s ease forwards,boltFlash 0.85s ease forwards'; p.style.cssText = `stroke-dasharray:${dashLen};stroke-dashoffset:${dashLen};animation:${anim}`; return p; }
    function makeBranch(d, stroke, width, delay) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d',d); p.setAttribute('stroke',stroke); p.setAttribute('stroke-width',String(width)); p.setAttribute('fill','none'); p.setAttribute('stroke-linecap','round'); p.setAttribute('filter','url(#bolt-glow)'); p.style.cssText = `stroke-dasharray:70;stroke-dashoffset:70;animation:branchDraw 0.85s ease forwards ${delay}s,boltFlash 0.85s ease forwards ${delay}s`; return p; }
    svg.appendChild(makePath('M 55 2 L 38 38 L 60 44 L 28 98','rgba(237,233,254,1)',2.5,130,0)); svg.appendChild(makePath('M 55 2 L 38 38 L 60 44 L 28 98','rgba(255,255,255,0.9)',1,130,0));
    svg.appendChild(makeBranch('M 60 44 L 78 62 L 86 57','rgba(196,181,253,0.85)',1.5,0.08)); svg.appendChild(makeBranch('M 38 38 L 20 54 L 12 50','rgba(196,181,253,0.75)',1.2,0.12)); svg.appendChild(makeBranch('M 78 62 L 84 72','rgba(167,139,250,0.6)',1,0.14));
    warpBtn.appendChild(svg); setTimeout(() => { warpBtn.classList.remove('warp-lightning'); svg.remove(); }, 950);
  }
  document.querySelectorAll('.speed-btn').forEach(b => { b.classList.remove('active-normal','active-fast','active-custom','active-warp'); });
  const activeMap = { normal:'active-normal', fast:'active-fast', custom:'active-custom', warp:'active-warp' };
  const activeBtn = document.getElementById('speed' + speed.charAt(0).toUpperCase() + speed.slice(1));
  if (activeBtn && activeMap[speed]) activeBtn.classList.add(activeMap[speed]);
  document.getElementById('customInputs')?.classList.toggle('show', speed === 'custom');
  const notes = { normal:'Filter wait: 2500ms \u00b7 Clear: 800ms \u00b7 Qty: 600ms \u00b7 Between: 400ms', fast:'Filter wait: 1600ms \u00b7 Clear: 600ms \u00b7 Qty: 400ms \u00b7 Between: 250ms', custom:'Using your custom timing values below', warp:'Filter: 600ms \u00b7 Qty: 100ms \u00b7 Between: 100ms \u00b7 Overwrite on' };
  const note = document.getElementById('speedNote'); if (note) note.textContent = notes[speed] || '';
  saveSpeedPrefs();
}

function togglePaste() { const body = document.getElementById('pasteBody'); const toggle = document.getElementById('pasteToggle'); const open = body.classList.toggle('open'); toggle.textContent = open ? '\u25b4 Hide manual entry' : '\u25be Enter order manually'; }

function getState() { return new Promise(res => { const timer = setTimeout(() => res({ phase:'idle' }), 3000); chrome.runtime.sendMessage({ type:'GET_STATE' }, r => { clearTimeout(timer); res(r || { phase:'idle' }); }); }); }
function setState(patch) { return new Promise(res => chrome.runtime.sendMessage({ type:'SET_STATE', state:patch }, r => res(r))); }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'PUSH_PROGRESS') return;
  const pushed = msg.state;
  if (pushed.runId && localState?.runId && pushed.runId !== localState.runId) return;
  localState = pushed;
  if (localState.phase === 'complete') { stopPolling(); if (msg.state.wasStopped != null) localState.wasStopped = msg.state.wasStopped; renderState(); }
  else if (localState.phase === 'running') { updateProgressUI(); }
});

function startPolling() { if (pollInterval) return; pollInterval = setInterval(async () => { if (localState?.phase === 'complete') { stopPolling(); renderState(); return; } if (localState?.phase !== 'running') { stopPolling(); renderState(); return; } localState = await getState(); updateProgressUI(); }, 2000); }
function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

function startTimer() { const start = Date.now(); setState({ timerStart: start }); _runTimerInterval(start); }
function resumeTimer() { const start = localState.timerStart; if (!start) return; _runTimerInterval(start); }
function _runTimerInterval(start) { if (timerInterval) clearInterval(timerInterval); timerInterval = setInterval(() => { const el = document.getElementById('timerDisplay'); if (el) el.textContent = _formatElapsed(start); }, 500); }
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } const final = document.getElementById('timerFinal'); if (final) final.textContent = _formatElapsed(localState?.timerStart); }
function _formatElapsed(start) { if (!start) return '0:00'; const s = Math.floor((Date.now()-start)/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function resetTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } setState({ timerStart:null }); const el = document.getElementById('timerDisplay'); if (el) el.textContent = '0:00'; const final = document.getElementById('timerFinal'); if (final) final.textContent = '0:00'; }

async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e) { console.log('[PV] Wake lock not available:', e.message); } }
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

function renderState() {
  const phase = localState?.phase || 'idle'; const isIdle = phase === 'idle';
  document.getElementById('driveLabelBar').style.display  = isIdle ? '' : 'none';
  document.getElementById('driveOrderList').style.display = isIdle ? '' : 'none';
  document.getElementById('driveBottom').style.display    = isIdle ? '' : 'none';
  document.getElementById('sectionScroll').style.display  = isIdle ? 'none' : 'flex';
  document.getElementById('secPreview').style.display  = phase==='loaded'   ? 'flex' : 'none';
  document.getElementById('secProgress').style.display = phase==='running'  ? 'flex' : 'none';
  document.getElementById('secComplete').style.display = phase==='complete' ? 'flex' : 'none';
  const store = document.getElementById('headerStore');
  if (localState?.orderData?.store) { store.textContent = storeLabelPlain(localState.orderData.store); store.style.display = 'block'; } else store.style.display = 'none';
  if (phase === 'idle')     { document.getElementById('pasteArea').value = ''; document.getElementById('btnLoad').disabled = true; }
  if (phase === 'loaded')   renderPreview();
  if (phase === 'running')  { renderLog(); updateProgressUI(); wireStopBtn(); }
  if (phase === 'complete') renderComplete();
  updateStatusBar();
}

function onPasteAreaInput() { document.getElementById('btnLoad').disabled = document.getElementById('pasteArea').value.trim().length === 0; }
async function loadFromPasteArea() {
  const text = document.getElementById('pasteArea').value.trim(); const start = text.indexOf('{');
  if (start === -1) { setStatus('red', 'No JSON found \u2014 copy from the phone app'); return; }
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  if (end === -1) { setStatus('red', 'No JSON found \u2014 copy from the phone app'); return; }
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!data.items || !Array.isArray(data.items)) throw new Error('bad');
    await setState({ phase:'loaded', orderData:data, results:{entered:[],skipped:[],notFound:[],flagged:[]}, log:[], progress:{current:0,total:data.items.length}, stopRequested:false });
    localState = await getState(); renderState();
  } catch(e) { setStatus('red', 'Invalid data \u2014 copy from the phone app first'); setTimeout(() => setStatus('', 'Ready'), 3000); }
}

function renderPreview() {
  const items = localState?.orderData?.items || [];
  document.getElementById('previewCount').textContent = items.length;
  document.getElementById('previewList').innerHTML = items.map(i => { const isCases = i.order<0||i.cases===true; const absOrder=Math.abs(i.order); const orderDisplay=isCases?absOrder+'<span style="color:var(--accent);font-size:9px;font-weight:700;display:block;line-height:1.2">'+(absOrder===1?'case':'cases')+'</span>':absOrder; return `<div class="preview-row"><div class="pr-item">${i.item}</div><div class="pr-order">${orderDisplay}</div><div class="pr-qoh">${i.qoh}</div></div>`; }).join('');
  const btnRun = document.getElementById('btnRun'); const btnClear = document.getElementById('btnClear');
  if (btnRun) btnRun.onclick = runBot; if (btnClear) btnClear.onclick = clearOrder;
}

async function clearOrder() { await setState({ phase:'idle', orderData:null, results:null, log:[], progress:{current:0,total:0} }); localState = await getState(); renderState(); }

async function runBot() {
  const orderData = localState?.orderData; if (!orderData) return;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await setState({ phase:'running', stopRequested:false, results:{entered:[],skipped:[],notFound:[],flagged:[]}, log:[], progress:{current:0,total:orderData.items.length}, runId });
  localState = await getState(); renderState(); startPolling(); startTimer(); requestWakeLock();
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab || !tab.url.includes('petvalu.com')) { setStatus('red', 'Switch to the Pet Valu portal tab first!'); await setState({ phase:'loaded' }); stopPolling(); localState = await getState(); renderState(); return; }
  try { await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:injectBridge }); await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:botScript, args:[orderData, TIMINGS(), runId] }); }
  catch(e) { setStatus('red', 'Inject failed: ' + e.message); await setState({ phase:'loaded' }); stopPolling(); localState = await getState(); renderState(); }
}

function wireStopBtn() { const btn = document.getElementById('btnStop'); if (btn) btn.onclick = stopBot; }
async function stopBot() {
  await setState({ stopRequested:true }); releaseWakeLock(); setStatus('yellow', 'Stopping after current item...');
  const btn = document.getElementById('btnStop'); if (btn) { btn.disabled = true; btn.textContent = 'Stopping...'; }
}

function updateProgressUI() {
  if (!localState) return;
  const { current=0, total=0 } = localState.progress || {};
  document.getElementById('progLabel').textContent = `${current} / ${total}`;
  document.getElementById('progBar').style.width = total ? `${(current/total)*100}%` : '0%';
  const r = localState.results || {};
  document.getElementById('statEntered').textContent  = (r.entered||[]).length;
  document.getElementById('statSkipped').textContent  = (r.skipped||[]).length;
  document.getElementById('statNotFound').textContent = (r.notFound||[]).length;
  document.getElementById('statFlagged').textContent  = (r.flagged||[]).length;
  renderLog(); setStatus('yellow', 'Bot running...');
}

function renderLog() {
  const wrap = document.getElementById('logWrap'); if (!wrap) return;
  const logs = localState?.log || []; const existing = wrap.children.length;
  if (logs.length < existing) { wrap.innerHTML = ''; logs.forEach(l => { const line = document.createElement('div'); line.className = 'log-line '+(l.kind||'info'); line.textContent = l.msg; wrap.appendChild(line); }); }
  else { logs.slice(existing).forEach(l => { const line = document.createElement('div'); line.className = 'log-line '+(l.kind||'info'); line.textContent = l.msg; wrap.appendChild(line); }); }
  wrap.scrollTop = wrap.scrollHeight;
}

function renderComplete() {
  stopTimer(); releaseWakeLock();
  const r = localState?.results || {};
  document.getElementById('doneEntered').textContent  = (r.entered||[]).length;
  document.getElementById('doneSkipped').textContent  = (r.skipped||[]).length;
  document.getElementById('doneNotFound').textContent = (r.notFound||[]).length;
  document.getElementById('doneFlagged').textContent  = (r.flagged||[]).length;
  const nfBtn = document.getElementById('btnDownloadNF');
  if ((r.notFound||[]).length>0||(r.flagged||[]).length>0||(r.skipped||[]).length>0) { nfBtn.style.display='block'; nfBtn.onclick=downloadNotFound; }
  const resetBtn = document.getElementById('btnReset'); if (resetBtn) resetBtn.onclick = resetToStart;
  setStatus('green', `Done \u2014 ${(r.entered||[]).length} entered, ${(r.notFound||[]).length} not found`);
  if (localState?.wasStopped) showEmailPrompt(); else sendCompletionEmail();
}

function showEmailPrompt() {
  const el = document.getElementById('emailStatusBadge'); if (!el) return;
  el.style.display='flex'; el.className='email-badge'; el.style.background='var(--yd)'; el.style.borderColor='rgba(146,64,14,0.3)'; el.style.color='var(--yellow)'; el.style.flexDirection='column'; el.style.alignItems='flex-start'; el.style.gap='8px';
  el.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--yellow)">Bot was stopped \u2014 send completion email?</div><div style="display:flex;gap:6px;width:100%"><button id="emailPromptYes" style="flex:1;padding:6px;background:var(--accent);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif">Send Email</button><button id="emailPromptNo" style="flex:1;padding:6px;background:var(--s2);color:var(--text2);border:1px solid var(--border);border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif">Skip</button></div>`;
  document.getElementById('emailPromptYes').addEventListener('click', () => { el.innerHTML=''; el.style.display='none'; sendCompletionEmail(); });
  document.getElementById('emailPromptNo').addEventListener('click',  () => { el.innerHTML=''; el.style.display='none'; });
}

// ── PDF GENERATOR ──
function pdfSafe(s) {
  return String(s).replace(/\u2014/g,' - ').replace(/\u2013/g,' - ').replace(/\u2019/g,"'").replace(/\u2018/g,"'").replace(/\u201c/g,'"').replace(/\u201d/g,'"').replace(/\u2264/g,'<=').replace(/\u2265/g,'>=').replace(/[^\x00-\x7F]/g,'?');
}

function buildReportPDF({ store, operator, date, runtimeStr, entered, skipped, notFound, flagged }) {
  const esc = s => pdfSafe(String(s)).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const hex = (r,g,b) => `${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)}`;

  const PW=595, PH=842, ML=44, MR=44; const contentW=PW-ML-MR;

  const C_INK=hex(15,23,42), C_INK2=hex(22,34,56), C_TEXT=hex(30,41,59), C_MUTED=hex(100,116,139), C_BORDER=hex(226,232,240), ACCENT=hex(0,180,130);
  const C_GREEN=hex(22,163,74), C_GREEN_BG=hex(220,252,231), C_GREEN_BAR=hex(22,163,74);
  const C_AMBER=hex(161,80,0), C_AMBER_BG=hex(254,243,199), C_AMBER_BAR=hex(200,120,0);
  const C_RED=hex(185,28,28), C_RED_BG=hex(254,226,226), C_RED_BAR=hex(220,38,38);
  const C_BLUE=hex(29,78,216), C_BLUE_BG=hex(219,234,254), C_BLUE_BAR=hex(37,99,235);
  const C_WHITE=hex(255,255,255);

  const FOOTER_H=26, FIRST_HDR_H=108, CONT_HDR_H=28;
  const PAGE_BOTTOM=PH-FOOTER_H-6;
  const ROW_H=24, HDR_ROW=18, SEC_H=24;
  const COL1=ML+6, COL2=ML+132, COL3=ML+198, COL4=ML+262;

  const pages = []; let cmds = [];
  const c = s => cmds.push(s);
  const py = yy => PH-yy;
  const newPage = () => { pages.push(cmds); cmds = []; };

  const dRect = (x,yt,w,h,fill,stroke) => {
    const yb=py(yt+h);
    if(fill)   c(`${fill} rg ${x.toFixed(2)} ${yb.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    if(stroke) c(`${stroke} RG 0.5 w ${x.toFixed(2)} ${yb.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };
  const dLine = (x1,yt1,x2,yt2,col,lw=0.5) => c(`${col} RG ${lw} w ${x1.toFixed(2)} ${py(yt1).toFixed(2)} m ${x2.toFixed(2)} ${py(yt2).toFixed(2)} l S`);
  const dText = (txt,x,yt,sz,col,bold) => { const bl=py(yt+sz*0.85); c(`BT /${bold?'Helvetica-Bold':'Helvetica'} ${sz} Tf ${col} rg ${x.toFixed(2)} ${bl.toFixed(2)} Td (${esc(String(txt))}) Tj ET`); };
  const dTextR = (txt,x,rt,rh,sz,col,bold) => { const bl=py(rt+rh/2+sz*0.35); c(`BT /${bold?'Helvetica-Bold':'Helvetica'} ${sz} Tf ${col} rg ${x.toFixed(2)} ${bl.toFixed(2)} Td (${esc(String(txt))}) Tj ET`); };

  const total = entered.length+skipped.length+notFound.length+flagged.length;

  const drawFooter = (pgNum) => {
    dRect(0,PH-FOOTER_H,PW,FOOTER_H,hex(248,250,252));
    dLine(0,PH-FOOTER_H,PW,PH-FOOTER_H,C_BORDER,0.5);
    dText('Project: Herald',ML,PH-FOOTER_H+5,7.5,C_MUTED,false);
    dText(`${pdfSafe(store)}  /  ${date}`,PW/2-50,PH-FOOTER_H+5,7.5,C_MUTED,false);
    dText(`Page ${pgNum}`,PW-MR-36,PH-FOOTER_H+5,7.5,C_MUTED,false);
  };

  const drawFirstHeader = () => {
    dRect(0,0,PW,FIRST_HDR_H,C_INK);
    dRect(0,0,4,FIRST_HDR_H,ACCENT);
    const TOP_H=58;
    dText('Project: Herald',ML+12,9,19,hex(255,255,255),true);
    dText(`${total} items`,ML+12,34,11,hex(200,220,210),true);
    dText(`Runtime: ${pdfSafe(runtimeStr)}`,ML+90,34,11,hex(160,190,180),false);
    dLine(0,TOP_H,PW,TOP_H,hex(32,50,70),0.8);
    const RX=ML+contentW-200;
    dText(pdfSafe(store),RX,8,15,hex(255,255,255),true);
    dText(date,RX,29,10,hex(140,170,160),true);
    const card_y=TOP_H+6, card_h=FIRST_HDR_H-TOP_H-10, card_gap=6;
    const card_w=(contentW-3*card_gap)/4;
    const stats=[['Entered',entered.length,C_GREEN_BAR,hex(230,255,240),C_GREEN],['Skipped',skipped.length,C_AMBER_BAR,hex(255,248,220),C_AMBER],['Not Found',notFound.length,C_RED_BAR,hex(255,235,235),C_RED],['Flagged',flagged.length,C_BLUE_BAR,hex(230,238,255),C_BLUE]];
    stats.forEach(([label,val,bar,bg,fg],i) => {
      const cx=ML+i*(card_w+card_gap);
      dRect(cx,card_y,card_w,card_h,bg);
      dRect(cx,card_y,4,card_h,bar);
      dText(String(val),cx+12,card_y+3,18,fg,true);
      dText(label,cx+12,card_y+card_h-13,8,fg,false);
    });
  };

  const drawContHeader = (pgNum) => {
    dRect(0,0,PW,CONT_HDR_H,C_INK); dRect(0,0,4,CONT_HDR_H,ACCENT);
    dTextR('Project: Herald',ML+10,0,CONT_HDR_H,9,hex(200,215,230),true);
    dTextR(`${pdfSafe(store)}  /  ${date}`,PW/2-40,0,CONT_HDR_H,8.5,hex(100,130,150),false);
    dTextR('continued',PW-MR-55,0,CONT_HDR_H,8,hex(80,110,130),false);
  };

  let cy=[FIRST_HDR_H+16], pgNum=[1];

  const checkBreak = (needed) => {
    if (cy[0]+needed > PAGE_BOTTOM) {
      drawFooter(pgNum[0]); newPage(); pgNum[0]++;
      drawContHeader(pgNum[0]); drawFooter(pgNum[0]); cy[0]=CONT_HDR_H+14;
    }
  };

  const drawSection = (title, items, rowFn, color, bgColor) => {
    if (!items.length) return;
    checkBreak(SEC_H+HDR_ROW+ROW_H); cy[0]+=12;
    dRect(ML,cy[0],contentW,SEC_H,bgColor); dRect(ML,cy[0],4,SEC_H,color);
    dTextR(title,ML+12,cy[0],SEC_H,11,color,true);
    dTextR(`${items.length} item${items.length!==1?'s':''}`,ML+contentW-68,cy[0],SEC_H,9.5,color,false);
    cy[0]+=SEC_H;
    dRect(ML,cy[0],contentW,HDR_ROW,hex(226,232,240));
    dTextR('Item #',COL1,cy[0],HDR_ROW,8.5,C_MUTED,true); dTextR('Order Qty',COL2,cy[0],HDR_ROW,8.5,C_MUTED,true); dTextR('On Hand',COL3,cy[0],HDR_ROW,8.5,C_MUTED,true); dTextR('Reason',COL4,cy[0],HDR_ROW,8.5,C_MUTED,true);
    cy[0]+=HDR_ROW;
    items.forEach((item,idx) => {
      checkBreak(ROW_H);
      dRect(ML,cy[0],contentW,ROW_H,idx%2===0?C_WHITE:hex(248,250,252));
      rowFn(item,cy[0],ROW_H); cy[0]+=ROW_H;
    });
    dLine(ML,cy[0],ML+contentW,cy[0],C_BORDER); cy[0]+=6;
  };

  drawFirstHeader(); drawFooter(1);

  drawSection('Skipped',skipped,(item,ry,rh)=>{dTextR(item.item||'',COL1,ry,rh,9.5,C_TEXT,true);dTextR('',COL2,ry,rh,9.5,C_TEXT,false);dTextR('',COL3,ry,rh,9.5,C_TEXT,false);dTextR((item.reason||'Skipped').slice(0,54),COL4,ry,rh,9,C_AMBER,false);},C_AMBER_BAR,C_AMBER_BG);
  drawSection('Not Found',notFound,(item,ry,rh)=>{dTextR(item.item||'',COL1,ry,rh,9.5,C_TEXT,true);dTextR(item.order!=null?String(item.order):'',COL2,ry,rh,9.5,C_TEXT,false);dTextR(item.qoh!=null?String(item.qoh):'',COL3,ry,rh,9.5,C_TEXT,false);dTextR((item.reason||'Not found').slice(0,54),COL4,ry,rh,9,C_RED,false);},C_RED_BAR,C_RED_BG);
  drawSection('Flagged - Enter Manually',flagged,(item,ry,rh)=>{dTextR(item.item||'',COL1,ry,rh,9.5,C_TEXT,true);dTextR(item.qty!=null?String(item.qty):'',COL2,ry,rh,9.5,C_TEXT,false);dTextR('',COL3,ry,rh,9.5,C_TEXT,false);dTextR((item.reason||'').slice(0,54),COL4,ry,rh,9,C_BLUE,false);},C_BLUE_BAR,C_BLUE_BG);

  if (!notFound.length&&!flagged.length&&!skipped.length) {
    checkBreak(50); cy[0]+=20;
    dRect(ML,cy[0],contentW,38,C_GREEN_BG);
    dTextR(`All ${entered.length} items entered successfully - no issues.`,ML+14,cy[0],38,12,C_GREEN,true);
    cy[0]+=38;
  }
  newPage();

  // ── BUILD MULTI-PAGE PDF ──
  const totalPages = pages.length;
  const parts = []; const offsets = {};
  const addObj = (n,body) => { offsets[n]=parts.reduce((s,p)=>s+p.length,0); parts.push(`${n} 0 obj\n`.encode?`${n} 0 obj\n${body}\nendobj\n`:`${n} 0 obj\n${body}\nendobj\n`); };

  // Build as string then convert once
  let pdfStr = '%PDF-1.4\n';
  const objOff = {};
  const addO = (n,body) => { objOff[n]=pdfStr.length; pdfStr+=`${n} 0 obj\n${body}\nendobj\n`; };

  addO(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addO(5,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const base=6;
  for(let pi=0;pi<totalPages;pi++) {
    const stream=pages[pi].join('\n');
    addO(base+pi,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  const pagesId=base+totalPages;
  const pageIds=[];
  for(let pi=0;pi<totalPages;pi++) {
    const oid=pagesId+1+pi; pageIds.push(oid);
    addO(oid,`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${base+pi} 0 R /Resources << /Font << /Helvetica 4 0 R /Helvetica-Bold 5 0 R >> >> >>`);
  }
  const catalogId=pagesId+1+totalPages;
  addO(pagesId,`<< /Type /Pages /Kids [${pageIds.map(o=>`${o} 0 R`).join(' ')}] /Count ${totalPages} >>`);
  addO(catalogId,`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const xrefOff=pdfStr.length;
  pdfStr+=`xref\n0 ${catalogId+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=catalogId;i++) pdfStr+=String(objOff[i]||0).padStart(10,'0')+' 00000 n \n';
  pdfStr+=`trailer\n<< /Size ${catalogId+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOff}\n%%EOF`;

  // Base64 encode
  const bytes=unescape(encodeURIComponent(pdfStr));
  let b64=''; const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for(let i=0;i<bytes.length;i+=3){const b=[bytes.charCodeAt(i),bytes.charCodeAt(i+1)||0,bytes.charCodeAt(i+2)||0];const chunk=(b[0]<<16)|(b[1]<<8)|b[2];b64+=chars[(chunk>>18)&63]+chars[(chunk>>12)&63]+(i+1<bytes.length?chars[(chunk>>6)&63]:'=')+(i+2<bytes.length?chars[chunk&63]:'=');}
  return b64;
}

async function sendCompletionEmail() {
  const r=localState?.results||{}, od=localState?.orderData||{};
  const store=od.store||'Unknown Store', operator=od.operator||'Unknown', date=new Date().toLocaleDateString('en-CA');
  setEmailStatus('sending');
  const timerStart=localState?.timerStart; let runtimeStr='N/A';
  if(timerStart){const s=Math.floor((Date.now()-timerStart)/1000);runtimeStr=`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;}
  const entered=r.entered||[], skipped=r.skipped||[], notFound=r.notFound||[], flagged=r.flagged||[];
  const pdfBase64=buildReportPDF({store,operator,date,runtimeStr,entered,skipped,notFound,flagged});
  const payload={action:'sendEmail',store,operator,date,runtime:runtimeStr,entered:entered.length,skipped:skipped.length,notFound:notFound.length,flagged:flagged.length,total:entered.length+skipped.length+notFound.length+flagged.length,pdfBase64,filename:`petvalu_report_${store.replace(/ /g,'_')}_${date}.pdf`};
  try{await chrome.runtime.sendMessage({type:'APPS_POST',payload});setEmailStatus('sent');}
  catch(e){console.warn('[PV] Email send failed:',e.message);setEmailStatus('failed');}
}

function setEmailStatus(state) {
  const el=document.getElementById('emailStatusBadge'); if(!el) return;
  el.style.display='flex'; el.style.animation='none'; void el.offsetWidth;
  if(state==='sending'){el.className='email-badge email-sending';el.innerHTML='<span class="email-dot-spin"></span> Sending receipt...';}
  else if(state==='sent'){el.className='email-badge email-sent';el.innerHTML='\u2713 Receipt sent to sarniapetvalu@gmail.com';el.style.animation='badgePop 0.4s cubic-bezier(0.22,1,0.36,1) forwards';}
  else if(state==='failed'){el.className='email-badge email-failed';el.innerHTML='\u2717 Receipt failed to send';el.style.animation='badgePop 0.4s cubic-bezier(0.22,1,0.36,1) forwards';}
}

function downloadNotFound() {
  const r=localState?.results; if(!r) return;
  const od=localState?.orderData||{}, store=od.store||'order', operator=od.operator||'', date=new Date().toLocaleDateString('en-CA');
  const timerStart=localState?.timerStart; let runtimeStr='N/A';
  if(timerStart){const s=Math.floor((Date.now()-timerStart)/1000);runtimeStr=`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;}
  const pdfBase64=buildReportPDF({store,operator,date,runtimeStr,entered:r.entered||[],skipped:r.skipped||[],notFound:r.notFound||[],flagged:r.flagged||[]});
  const bytes=atob(pdfBase64), buf=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) buf[i]=bytes.charCodeAt(i);
  const blob=new Blob([buf],{type:'application/pdf'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`petvalu_report_${store.replace(/ /g,'_')}_${date}.pdf`; a.click();
}

async function resetToStart() {
  await setState({phase:'idle',orderData:null,results:null,log:[],progress:{current:0,total:0},stopRequested:false,timerStart:null});
  localState=await getState(); renderState(); resetTimer(); releaseWakeLock(); loadDriveOrders();
}

function updateStatusBar() {
  const phase=localState?.phase||'idle';
  const map={idle:['','Select an order from Drive or open the portal'],loaded:['green',`Loaded: ${localState?.orderData?.store} \u2014 ${localState?.orderData?.items?.length} items`],running:['yellow','Bot running...'],complete:['green',`Done \u2014 ${(localState?.results?.entered||[]).length} entered, ${(localState?.results?.notFound||[]).length} not found`]};
  const [type,text]=map[phase]||['','']; setStatus(type,text);
}
function setStatus(type,text) { document.getElementById('statusDot').className='status-dot'+(type?' '+type:''); document.getElementById('statusText').textContent=text; }

function injectBridge() { if(window.__pvBridgeReady)return; window.__pvBridgeReady=true; }

async function botScript(orderData, timings, runId) {
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function checkStop(){return new Promise(res=>{chrome.runtime.sendMessage({type:'PV_STOP_CHECK'},resp=>res(resp?.stop===true));});}
  function sendProgress(msg,current,total,kind,results){chrome.runtime.sendMessage({type:'PV_PROGRESS',msg,current,total,kind:kind||'info',results,runId});}
  function getFilterInput(label){return document.querySelector(`input[aria-label="${label}"]`);}
  async function setFilter(label,value){const input=getFilterInput(label);if(!input)return false;input.focus();input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));await sleep(100);input.value=String(value).toUpperCase();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));return true;}
  async function clearFilter(label,forceReal){const input=getFilterInput(label);if(!input)return;if(timings.overwriteMode&&!forceReal){input.focus();input.select();}else{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));if(timings.afterClear>0)await sleep(timings.afterClear);}}
  function getVisibleRows(){return Array.from(document.querySelectorAll('.ag-row[role="row"]')).filter(r=>!r.classList.contains('ag-row-loading')&&!r.classList.contains('ag-row-stub'));}
  function findExactRow(rows,id){return rows.find(r=>{const c=r.querySelector('[col-id="item_no"]');return c&&c.textContent.trim().toLowerCase()===String(id).trim().toLowerCase();})||null;}
  function getCellText(row,colId){let c=row.querySelector(`[col-id="${colId}"]`);if(c)return c.textContent.trim();const rowId=row.getAttribute('row-id');if(rowId!==null){c=document.querySelector(`.ag-center-cols-container [row-id="${rowId}"] [col-id="${colId}"]`)||document.querySelector(`.ag-pinned-left-cols-container [row-id="${rowId}"] [col-id="${colId}"]`)||document.querySelector(`[row-id="${rowId}"] [col-id="${colId}"]`);if(c)return c.textContent.trim();}return '';}
  function getAgApi(){try{const agGridEl=document.querySelector('ag-grid-angular');if(!agGridEl)return null;const inst=agGridEl['__ag_grid_instance'];if(inst?.api?.forEachNodeAfterFilter)return inst.api;if(inst?.forEachNodeAfterFilter)return inst;if(inst?.gridOptions?.api?.forEachNodeAfterFilter)return inst.gridOptions.api;}catch(e){console.log('[PV Bot] getAgApi error:',e);}return null;}
  function getRowDataFromGrid(itemId){try{const api=getAgApi();if(!api)return null;let found=null;api.forEachNodeAfterFilter(node=>{if(found)return;const d=node.data;if(d&&String(d.item_no||'').trim().toLowerCase()===String(itemId).trim().toLowerCase())found=d;});return found;}catch(e){return null;}}
  function calcQty(appOrder,appQoh,avgSales,multiple,isCases){let order=appOrder;if(isCases&&order>0)order=order*multiple;let qty;if(order===0){if(avgSales===0)return{qty:null,reason:'Skipped \u2014 avg sales is 0'};qty=Math.ceil(avgSales*4-appQoh);if(qty<=0)return{qty:null,reason:`Skipped \u2014 already have enough on hand (avg=${avgSales}, qoh=${appQoh})`};}else{qty=order;if(qty<=0)return{qty:null,reason:'Skipped \u2014 order qty \u2264 0'};}if(multiple>1){const rem=qty%multiple;if(rem!==0)qty+=(multiple-rem);}return{qty};}
  async function enterQty(row,qty){const cell=row.querySelector('[col-id="unit_qty_chg"]');if(!cell)return false;cell.click();await sleep(250);cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window}));await sleep(400);let input=cell.querySelector('input[aria-label="Input Editor"]')||cell.querySelector('input')||document.querySelector('.ag-cell-inline-editing input');if(!input){cell.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',keyCode:113,bubbles:true}));await sleep(350);input=cell.querySelector('input')||document.querySelector('.ag-cell-inline-editing input');}if(!input)return false;input.focus();input.select();input.value=String(qty);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',keyCode:9,bubbles:true}));await sleep(timings.afterQty);return true;}

  const items=orderData.items, results={entered:[],skipped:[],notFound:[],flagged:[]};
  for(let i=0;i<items.length;i++){
    const item=items[i],id=String(item.item).trim();
    if(await checkStop()){sendProgress(`Stopped by user after ${i} items`,i,items.length,'skip',results);results._stopped=true;break;}
    sendProgress(`[${i+1}/${items.length}] Searching ${id}...`,i,items.length,'info',results);
    await setFilter('Item No Filter Input',id); await sleep(timings.afterFilter);
    let rows=getVisibleRows(),targetRow=findExactRow(rows,id),usedSub=false;
    if(!targetRow){sendProgress(`${id} \u2014 not in Item No, trying Substituted Item...`,i,items.length,'info',results);await clearFilter('Item No Filter Input',true);await setFilter('Substituted Item Filter Input',id);await sleep(timings.afterSubFilter??timings.afterFilter);rows=getVisibleRows();targetRow=rows.length>0?rows[0]:null;usedSub=true;}
    if(!targetRow){results.notFound.push({item:id,order:item.order,qoh:item.qoh,reason:'Not found (checked Item No + Substituted Item)'});sendProgress(`${id} \u2014 NOT FOUND`,i+1,items.length,'notfound',results);await clearFilter(usedSub?'Substituted Item Filter Input':'Item No Filter Input',true);await sleep(timings.betweenItems);continue;}
    const lifecycle=getCellText(targetRow,'life_cycle_status');
    const lifecycleReasons={'OOS':'OOS \u2014 Out of Stock','ROS':'ROS \u2014 Ranged Out of Store','INOT':'INOT \u2014 Inactive / Not On Tag'};
    if(lifecycleReasons[lifecycle]){results.skipped.push({item:id,reason:lifecycleReasons[lifecycle]});sendProgress(`${id} \u2014 skipped (${lifecycleReasons[lifecycle]})`,i+1,items.length,'skip',results);await clearFilter(usedSub?'Substituted Item Filter Input':'Item No Filter Input',true);await sleep(timings.betweenItems);continue;}
    const gridData=getRowDataFromGrid(id);
    const avgSales=parseFloat(gridData?.average_sales_last_4_weeks??getCellText(targetRow,'average_sales_last_4_weeks'))||0;
    const multiple=parseInt(gridData?.order_multiple??getCellText(targetRow,'order_multiple'))||1;
    const isCases=item.order<0||item.cases===true,absOrder=Math.abs(item.order);
    const calcResult=calcQty(absOrder,item.qoh,avgSales,multiple,isCases);
    if(calcResult.qty===null){results.skipped.push({item:id,reason:calcResult.reason});sendProgress(`${id} \u2014 ${calcResult.reason}`,i+1,items.length,'skip',results);await clearFilter(usedSub?'Substituted Item Filter Input':'Item No Filter Input',true);await sleep(timings.betweenItems);continue;}
    const qty=calcResult.qty, ok=await enterQty(targetRow,qty);
    if(ok){results.entered.push({item:id,qty,usedSub});sendProgress(`${id} \u2014 entered ${qty}${usedSub?' [via substitute]':''}`,i+1,items.length,'ok',results);}
    else{results.flagged.push({item:id,qty,reason:'Could not click/edit Qty cell'});sendProgress(`${id} \u2014 FLAGGED (enter ${qty} manually)`,i+1,items.length,'flag',results);}
    await clearFilter(usedSub?'Substituted Item Filter Input':'Item No Filter Input',true); await sleep(timings.betweenItems);
  }
  chrome.runtime.sendMessage({type:'PV_COMPLETE',results,runId,wasStopped:results._stopped||false});
}

let _devClicks=0,_devClickTimer=null;
function openDevMode()  { const ov=document.getElementById('devOverlay');if(!ov)return;document.body.appendChild(ov);ov.style.display='flex'; }
function closeDevMode() { const ov=document.getElementById('devOverlay');if(ov)ov.style.display='none'; }

async function devTestEmail() {
  const statusEl=document.getElementById('devEmailStatus');
  statusEl.style.color='var(--muted)';statusEl.textContent='Injecting state and calling sendCompletionEmail()...';
  const fakeTimerStart=Date.now()-(4*60*1000+17*1000);
  await setState({phase:'complete',timerStart:fakeTimerStart,orderData:{store:'Lakeshore Rd',operator:'Nipun'},results:{entered:[{item:'10045231',qty:6,usedSub:false},{item:'10078432',qty:12,usedSub:false},{item:'10091234',qty:3,usedSub:true},{item:'10056789',qty:8,usedSub:false},{item:'10034567',qty:2,usedSub:false}],skipped:[{item:'10011111',reason:'OOS \u2014 Out of Stock'},{item:'10022222',reason:'ROS \u2014 Ranged Out of Store'}],notFound:[{item:'10099999',order:4,qoh:1,reason:'Not found in portal'}],flagged:[{item:'10088888',qty:5,reason:'Could not click/edit Qty cell'}]}});
  localState=await getState();
  try{await sendCompletionEmail();statusEl.style.color='var(--accent)';statusEl.textContent='\u2713 Sent \u2014 check sarniapetvalu@gmail.com';}
  catch(e){statusEl.style.color='var(--red)';statusEl.textContent='\u2717 Error: '+e.message;}
}

async function devTestDrive() {
  const statusEl=document.getElementById('devDriveStatus');
  statusEl.style.color='var(--muted)';statusEl.textContent='Uploading test files via real upload path...';
  const date=new Date().toLocaleDateString('en-CA'),base=`DEV_TEST_Lakeshore_Rd_${date}`;
  const jsonContent=JSON.stringify({store:'Lakeshore Rd',date,_devTest:true,items:[{item:'10045231',order:6,qoh:10}]},null,2);
  const csvContent=`Store,Date,Item #,Order Qty,On Hand,Status,Notes\n"Lakeshore Rd","${date}","10045231",6,10,Entered,\n`;
  try{const results=await Promise.all([chrome.runtime.sendMessage({type:'APPS_POST',payload:{filename:base+'.json',content:jsonContent}}),chrome.runtime.sendMessage({type:'APPS_POST',payload:{filename:base+'.csv',content:csvContent}})]);const allOk=results.every(r=>r?.ok);statusEl.style.color=allOk?'var(--accent)':'var(--red)';statusEl.textContent=allOk?'\u2713 Uploaded \u2014 check Google Drive':'\u2717 Upload failed';}
  catch(e){statusEl.style.color='var(--red)';statusEl.textContent='\u2717 Error: '+e.message;}
}

async function devTestUpdate() {
  const statusEl=document.getElementById('devUpdateStatus');
  statusEl.style.color='var(--muted)';statusEl.textContent='Fetching update.xml from Vercel...';
  try{const res=await fetch('https://petvalu-bot.vercel.app/update.xml?t='+Date.now(),{cache:'no-store'});const text=await res.text();const match=text.match(/<version>(.*?)<\/version>/);const latest=match?match[1]:'?',current=browser.runtime.getManifest().version;statusEl.style.color='var(--accent)';statusEl.textContent=`\u2713 Current: v${current} \u2014 Latest: v${latest} \u2014 ${latest===current?'Up to date':'Update available'}`;}
  catch(e){statusEl.style.color='var(--red)';statusEl.textContent='\u2717 Could not reach Vercel: '+e.message;}
}
