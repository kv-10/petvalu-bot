
// ── TIMINGS (ms) ──
const SPEED_PRESETS = {
  normal: { afterFilter: 2500, afterClear: 800,  afterQty: 600,  betweenItems: 400, afterSubFilter: 2500 },
  fast:   { afterFilter: 1600, afterClear: 600,  afterQty: 400,  betweenItems: 250, afterSubFilter: 1600 },
  warp:   { afterFilter: 3000, afterClear: 0,    afterQty: 700,  betweenItems: 150, afterSubFilter: 3000 },
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
  // Show init step
  stepShow('stepInit');
  stepSet('stepInit', 'spinning-ring', '', 'Loading state...');
  await sleep(300);

  localState = await getState();
  stepSet('stepInit', 'done', '✓', 'Loaded');

  // If bot is mid-run, skip update check and go straight in
  if (localState.phase !== 'idle') {
    stepShow('stepUpdate');
    stepSet('stepUpdate', 'done', '✓', 'Skipped — bot is running');
    stepShow('stepReady');
    stepSet('stepReady', 'spinning-ring', '', 'Resuming session...');
    await sleep(400);
    stepSet('stepReady', 'done', '✓', 'Session restored');
    await sleep(300);
    hideStartup();
    renderState();
    if (localState.phase === 'running') { startPolling(); resumeTimer(); }
    return;
  }

  // Update check
  await sleep(200);
  stepShow('stepUpdate');
  stepSet('stepUpdate', 'spinning-ring', '', 'Checking for updates...');
  await sleep(400);

  try {
    const currentVersion = browser.runtime.getManifest().version;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      'https://petvalu-bot.vercel.app/update.xml?t=' + Date.now(),
      { cache: 'no-store', signal: controller.signal }
    );
    clearTimeout(fetchTimeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const match = xml.match(/<em:version>([^<]+)<\/em:version>/);
    if (!match) throw new Error('Could not parse update.xml');
    const remoteVersion = match[1];

    if (remoteVersion !== currentVersion) {
      stepSet('stepUpdate', 'update', '↑', 'v' + remoteVersion + ' available');
      await sleep(300);

      // Fade out startup screen, show update screen
      const secStartup = document.getElementById('secStartup');
      const secUpdate  = document.getElementById('secUpdate');
      secStartup.style.transition = 'opacity 0.3s ease';
      secStartup.style.opacity = '0';
      await sleep(300);
      secStartup.style.display = 'none';

      document.getElementById('updTitle').textContent = 'Update Available';
      document.getElementById('updVersion').textContent = currentVersion + ' → v' + remoteVersion;
      secUpdate.classList.add('show');
      return;

    } else {
      stepSet('stepUpdate', 'done', '✓', 'Up to date (v' + currentVersion + ')');
    }
  } catch(e) {
    const cv = browser.runtime.getManifest().version;
    stepSet('stepUpdate', 'warn', '!', 'Could not check — continuing (v' + cv + ')');
  }

  // Ready
  await sleep(200);
  stepShow('stepReady');
  stepSet('stepReady', 'spinning-ring', '', 'Loading orders...');
  await sleep(300);
  stepSet('stepReady', 'done', '✓', 'Ready');
  await sleep(350);
  hideStartup();
  renderState();
  loadDriveOrders();
}

function hideStartup() {
  const el = document.getElementById('secStartup');
  if (!el) return;
  // Show version number in header
  const vb = document.getElementById('versionBadge');
  if (vb) {
    browser.runtime.getManifest
      ? (vb.textContent = 'v' + browser.runtime.getManifest().version)
      : chrome.runtime.getManifest && (vb.textContent = 'v' + chrome.runtime.getManifest().version);
  }
  el.style.transition = 'opacity 0.3s ease';
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

function copyUpdateUrl() {
  const url = 'https://petvalu-bot.vercel.app';
  navigator.clipboard.writeText(url).then(() => {
    const hint = document.getElementById('updCopyHint');
    const box  = document.getElementById('updUrlBox');
    if (hint) { hint.textContent = '✓ copied!'; hint.classList.add('copied'); }
    if (box)  { box.style.borderColor = 'var(--accent)'; }
    setTimeout(() => {
      if (hint) { hint.textContent = 'tap to copy'; hint.classList.remove('copied'); }
    }, 2000);
  }).catch(() => {});
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── INIT ──

// ── SPEED PREFS PERSISTENCE ──
function updateOverwriteLabel() {
  const lbl = document.getElementById('ciOverwriteLabel');
  if (lbl) lbl.textContent = _overwriteMode ? 'On — select-all before typing' : 'Off — clear field first';
  const track = document.getElementById('ciOverwriteTrack');
  const thumb = document.getElementById('ciOverwriteThumb');
  if (track) track.style.background  = _overwriteMode ? 'var(--accent)' : 'var(--s3)';
  if (thumb) thumb.style.transform   = _overwriteMode ? 'translateX(16px)' : 'translateX(0)';
  // Grey out After Clear when overwrite mode is on — it has no effect
  const clearRow = document.getElementById('ciClearRow');
  if (clearRow) {
    clearRow.style.opacity      = _overwriteMode ? '0.35' : '1';
    clearRow.style.pointerEvents = _overwriteMode ? 'none' : '';
  }
}

function saveSpeedPrefs() {
  const prefs = {
    speed: _speed,
    filter:    document.getElementById('ciFilter')?.value    || '2500',
    clear:     document.getElementById('ciClear')?.value     || '800',
    qty:       document.getElementById('ciQty')?.value       || '600',
    between:   document.getElementById('ciBetween')?.value   || '400',
    subFilter: document.getElementById('ciSubFilter')?.value || '2500',
    overwrite: _overwriteMode,
  };
  chrome.storage.local.set({ speedPrefs: prefs });
}

function loadSpeedPrefs() {
  chrome.storage.local.get('speedPrefs', ({ speedPrefs }) => {
    if (!speedPrefs) return; // use defaults
    // Restore custom input values first
    const ci = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    ci('ciFilter',    speedPrefs.filter);
    ci('ciClear',     speedPrefs.clear);
    ci('ciQty',       speedPrefs.qty);
    ci('ciBetween',   speedPrefs.between);
    ci('ciSubFilter', speedPrefs.subFilter);
    // Restore overwrite toggle
    if (speedPrefs.overwrite != null) {
      _overwriteMode = speedPrefs.overwrite;
      const tog = document.getElementById('ciOverwriteToggle');
      if (tog) tog.checked = _overwriteMode;
      updateOverwriteLabel();
    }
    // Then apply the speed mode (which reads the inputs)
    setSpeed(speedPrefs.speed || 'normal');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pasteArea').addEventListener('input', onPasteAreaInput);
  document.getElementById('btnLoad').addEventListener('click', loadFromPasteArea);
  document.getElementById('btnRefresh').addEventListener('click', loadDriveOrders);
  document.getElementById('pasteToggle').addEventListener('click', togglePaste);



  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => setSpeed(btn.dataset.speed));
  });

  // Save custom values when inputs change
  ['ciFilter','ciClear','ciQty','ciBetween','ciSubFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', saveSpeedPrefs);
  });
  document.getElementById('ciOverwriteToggle')?.addEventListener('change', e => {
    _overwriteMode = e.target.checked;
    updateOverwriteLabel();
    saveSpeedPrefs();
  });

  // Restore last used speed
  loadSpeedPrefs();

  // Dev mode
  document.getElementById('devTriggerBtn').addEventListener('click', openDevMode);
  document.getElementById('devCloseBtn').addEventListener('click', closeDevMode);
  document.getElementById('devEmailBtn').addEventListener('click', devTestEmail);
  document.getElementById('devDriveBtn').addEventListener('click', devTestDrive);
  document.getElementById('devUpdateBtn').addEventListener('click', devTestUpdate);

  runStartup();
});

// ── DRIVE ORDER LIST ──
const STORE_NAMES = ['Lakeshore Rd', 'Lambton Mall', 'Corunna', 'London'];
const STORE_NUMBERS = {
  'Lakeshore Rd': '2087',
  'Lambton Mall': '2356',
  'Corunna':      '2372',
  'London':       '2412'
};
function storeLabel(name) {
  const num = STORE_NUMBERS[name];
  return num ? `${name} <span style="font-size:11px;opacity:0.7;font-weight:600">#${num}</span>` : name;
}
function storeLabelPlain(name) {
  return name; // store# shown only in sub-line, not the header title
}

function parseFilename(name) {
  // e.g. Nipun_Lakeshore_Rd_2026-03-08.json
  const base   = name.replace('.json', '');
  const parts  = base.split('_');
  const operator = parts[0];
  const dateStr  = parts[parts.length - 1];
  const storeRaw = parts.slice(1, parts.length - 1).join('_');
  const store    = STORE_NAMES.find(s => s.replace(/ /g, '_') === storeRaw) || storeRaw.replace(/_/g, ' ');
  return { operator, store, dateStr };
}

function groupOrders(files) {
  // Parse each file
  const parsed = files.map(f => ({ ...f, ...parseFilename(f.name) }));
  // Group by store
  const byStore = {};
  parsed.forEach(f => {
    if (!byStore[f.store]) byStore[f.store] = [];
    byStore[f.store].push(f);
  });
  // Within each store, pair files within 2 days
  const groups = [];
  Object.entries(byStore).forEach(([store, orders]) => {
    orders.sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
    const used = new Set();
    orders.forEach((o, i) => {
      if (used.has(i)) return;
      const group = { store, orders: [o] };
      // Look for a partner within 2 days
      orders.forEach((o2, j) => {
        if (j === i || used.has(j)) return;
        const diff = Math.abs(new Date(o.dateStr) - new Date(o2.dateStr)) / 86400000;
        if (diff <= 2 && o2.operator !== o.operator) {
          group.orders.push(o2);
          used.add(j);
        }
      });
      used.add(i);
      // Sort so older runs first (newer overwrites on conflicts)
      group.orders.sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
      groups.push(group);
    });
  });
  // Sort groups: most recent date first
  groups.sort((a, b) => {
    const aDate = Math.max(...a.orders.map(o => new Date(o.dateStr)));
    const bDate = Math.max(...b.orders.map(o => new Date(o.dateStr)));
    return bDate - aDate;
  });
  return groups;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderGroups(groups) {
  const list = document.getElementById('driveOrderList');
  list.innerHTML = groups.map((g, gi) => {
    const dateLabel = g.orders.length === 2 && g.orders[0].dateStr !== g.orders[1].dateStr
      ? `${formatDate(g.orders[0].dateStr)} – ${formatDate(g.orders[1].dateStr)}`
      : formatDate(g.orders[g.orders.length - 1].dateStr);
    // Store# only in sub-line, not in the heading
    const storeNum = storeLabel(g.store).match(/#\d+/)?.[0] || '';
    const totalItems = g.orders.reduce((s, o) => s + (o.itemCount ?? 0), 0);
    const hasCounts  = g.orders.some(o => o.itemCount != null);
    const totalStr   = hasCounts ? ` &nbsp;·&nbsp; <span class="sg-total">${totalItems} items</span>` : '';
    const orderRows = g.orders.map((o, oi) => {
      const cntStr = o.itemCount != null
        ? ` &nbsp;·&nbsp; ${o.itemCount} items` : '';
      return `<div class="sg-order" data-gi="${gi}" data-oi="${oi}">
        <div>
          <div class="sg-op">${o.operator}</div>
          <div class="sg-meta">${formatDate(o.dateStr)}${cntStr}</div>
        </div>
        <div class="sg-arr">›</div>
      </div>`;
    }).join('');
    const bothBtn = g.orders.length >= 2
      ? `<div class="sg-both" data-gi="${gi}" data-both="1">Load Both Together</div>`
      : '';
    return `<div class="store-group">
      <div class="sg-header">
        <div class="sg-store-name">${storeLabelPlain(g.store)}</div>
        <div class="sg-store-sub" id="sg-sub-${gi}">${storeNum} &nbsp;·&nbsp; ${dateLabel}${totalStr}</div>
      </div>
      ${orderRows}
      ${bothBtn}
    </div>`;
  }).join('');
  // Wire up listeners
  list.querySelectorAll('.sg-order').forEach(el => {
    el.addEventListener('click', () => {
      const g = groups[+el.dataset.gi];
      const o = g.orders[+el.dataset.oi];
      loadFromDrive(o.id, o.name);
    });
  });
  list.querySelectorAll('[data-both]').forEach(el => {
    el.addEventListener('click', () => {
      const g = groups[+el.dataset.gi];
      loadBothFromDrive(g.orders, +el.dataset.gi);
    });
  });
}

async function backfillItemCounts(groups) {
  // Fetch all JSON files in parallel, update counts in place
  const allOrders = groups.flatMap((g, gi) => g.orders.map((o, oi) => ({ g, gi, o, oi })));
  // Only fetch JSON files (not CSV duplicates)
  const jsonOrders = allOrders.filter(({ o }) => o.name && o.name.endsWith('.json'));
  await Promise.all(jsonOrders.map(async ({ g, gi, o, oi }) => {
    try {
      const content = await fetchOrder(o.id);
      o.itemCount = content.items?.length ?? 0;
      // Update the specific DOM node
      const el = document.querySelector(`[data-gi="${gi}"][data-oi="${oi}"] .sg-meta`);
      if (el) el.innerHTML = `${formatDate(o.dateStr)} &nbsp;·&nbsp; ${o.itemCount} items`;
      // Update header total
      const totalItems = g.orders.reduce((s, x) => s + (x.itemCount ?? 0), 0);
      const hasCounts  = g.orders.some(x => x.itemCount != null);
      if (hasCounts) {
        const storeNum   = storeLabel(g.store).match(/#\d+/)?.[0] || '';
        const dateLabel  = g.orders.length === 2 && g.orders[0].dateStr !== g.orders[1].dateStr
          ? `${formatDate(g.orders[0].dateStr)} – ${formatDate(g.orders[1].dateStr)}`
          : formatDate(g.orders[g.orders.length - 1].dateStr);
        const subEl = document.getElementById(`sg-sub-${gi}`);
        // Show ~ prefix when multiple orders (sum may overcount duplicates)
        const countPrefix = g.orders.length >= 2 ? '~' : '';
        if (subEl) subEl.innerHTML = `${storeNum} &nbsp;·&nbsp; ${dateLabel} &nbsp;·&nbsp; <span class="sg-total">${countPrefix}${totalItems} items</span>`;
      }
    } catch(e) { /* silent — counts just won't show */ }
  }));
}

async function loadDriveOrders() {
  const list = document.getElementById('driveOrderList');
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');
  list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px">Loading from Drive...</div>';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'DRIVE_FETCH', url: `${APPS_SCRIPT_URL}?action=list` });
    if (!resp.ok) throw new Error(resp.error);
    const data = resp.data;
    if (!data.success || !data.files?.length) {
      list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px">No orders found in Drive</div>';
      return;
    }
    const groups = groupOrders(data.files.filter(f => !f.name.startsWith('CATALOG_')));
    // Render immediately without item counts
    renderGroups(groups);
    // Then backfill item counts in background
    backfillItemCounts(groups);
  } catch(e) {
    console.error('[PV] loadDriveOrders error:', e);
    list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--red);font-size:12px">Error: ${e.message}</div>`;
  } finally {
    if (icon) icon.classList.remove('spinning');
  }
}

async function fetchOrder(fileId) {
  const resp = await chrome.runtime.sendMessage({ type: 'DRIVE_FETCH', url: `${APPS_SCRIPT_URL}?action=get&id=${fileId}` });
  if (!resp.ok) throw new Error(resp.error);
  if (!resp.data.success || !resp.data.content) throw new Error('Bad response');
  return resp.data.content;
}

async function loadFromDrive(fileId, filename) {
  setStatus('yellow', 'Loading order...');
  try {
    const content = await fetchOrder(fileId);
    await loadOrder(content);
    setStatus('green', `Loaded: ${storeLabelPlain(content.store)} — ${content.items.length} items`);
  } catch(e) {
    setStatus('red', 'Failed to load order from Drive');
  }
}

async function loadBothFromDrive(orders, gi) {
  setStatus('yellow', 'Loading orders...');
  try {
    const [a, b] = await Promise.all(orders.map(o => fetchOrder(o.id)));
    // Merge: combine items, b overwrites a on duplicate item numbers
    const itemMap = new Map();
    a.items.forEach(i => itemMap.set(String(i.item), i));
    b.items.forEach(i => itemMap.set(String(i.item), i)); // b wins on overlap
    const merged = {
      store: a.store,
      date: b.date || a.date,
      items: Array.from(itemMap.values())
    };
    await loadOrder(merged);
    // Correct the store group header to show deduplicated count
    if (gi != null) {
      const subEl = document.getElementById(`sg-sub-${gi}`);
      if (subEl) {
        const span = subEl.querySelector('.sg-total');
        if (span) span.textContent = merged.items.length + ' items'; // exact, no ~
      }
    }
    setStatus('green', `Loaded both: ${storeLabelPlain(merged.store)} — ${merged.items.length} items`);
  } catch(e) {
    setStatus('red', 'Failed to load orders from Drive');
  }
}

async function loadOrder(data) {
  await setState({
    phase: 'loaded',
    orderData: data,
    results: { entered:[], skipped:[], notFound:[], flagged:[] },
    log: [],
    progress: { current:0, total: data.items.length },
    stopRequested: false
  });
  localState = await getState();
  renderState();
}

function setSpeed(speed) {
  _speed = speed;

  // Flame sweep on warp
  const warpBtn = document.getElementById('speedWarp');
  if (speed === 'warp' && warpBtn) {
    warpBtn.classList.remove('flame-sweep');
    void warpBtn.offsetWidth; // reflow to restart animation
    warpBtn.classList.add('flame-sweep');
    setTimeout(() => warpBtn.classList.remove('flame-sweep'), 600);
  }

  // Update button states
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.remove('active-normal', 'active-fast', 'active-custom', 'active-warp');
  });
  const activeMap = { normal: 'active-normal', fast: 'active-fast', custom: 'active-custom', warp: 'active-warp' };
  const activeBtn = document.getElementById('speed' + speed.charAt(0).toUpperCase() + speed.slice(1));
  if (activeBtn && activeMap[speed]) activeBtn.classList.add(activeMap[speed]);

  // Show/hide custom inputs
  const customPanel = document.getElementById('customInputs');
  if (customPanel) { customPanel.classList.toggle('show', speed === 'custom'); }

  // Speed note
  const notes = {
    normal: 'Filter wait: 2500ms · Clear: 800ms · Qty: 600ms · Between: 400ms',
    fast:   'Filter wait: 1600ms · Clear: 600ms · Qty: 400ms · Between: 250ms',
    custom: 'Using your custom timing values below',
    warp:   'Smart polling · No clear step · Qty: 700ms · Beta'
  };
  const note = document.getElementById('speedNote');
  if (note) note.textContent = notes[speed] || '';

  // Persist speed choice
  saveSpeedPrefs();
}

function togglePaste() {
  const body   = document.getElementById('pasteBody');
  const toggle = document.getElementById('pasteToggle');
  const open   = body.classList.toggle('open');
  toggle.textContent = open ? '▴ Hide manual entry' : '▾ Enter order manually';
}

// ── GMAIL TAB DETECTION ──
// ── BACKGROUND COMMS ──
function getState() {
  return new Promise(res => {
    const timer = setTimeout(() => res({ phase: 'idle' }), 3000);
    chrome.runtime.sendMessage({ type:'GET_STATE' }, r => {
      clearTimeout(timer);
      res(r || { phase: 'idle' });
    });
  });
}
function setState(patch) {
  return new Promise(res => chrome.runtime.sendMessage({ type:'SET_STATE', state:patch }, r => res(r)));
}

// ── PUSH LISTENER — background forwards every PV_PROGRESS/PV_COMPLETE instantly ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'PUSH_PROGRESS') return;
  const pushed = msg.state;
  // Ignore pushes from a different run (stale bot still finishing up)
  if (pushed.runId && localState?.runId && pushed.runId !== localState.runId) return;
  localState = pushed;
  if (localState.phase === 'complete') {
    stopPolling();
    renderState();
  } else if (localState.phase === 'running') {
    updateProgressUI();
  }
});

// Polling kept only as reconnect fallback (popup reopened mid-run)
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    // Only fetch state if we haven't heard a push recently — avoids redundant GET_STATE calls
    if (localState?.phase === 'complete') { stopPolling(); renderState(); return; }
    if (localState?.phase !== 'running')  { stopPolling(); renderState(); return; }
    // Still running — do a single sync to catch up if popup was closed/reopened
    localState = await getState();
    updateProgressUI();
  }, 2000); // slow poll — pushes handle the real-time updates
}
function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── TIMER ──
function startTimer() {
  const start = Date.now();
  setState({ timerStart: start }); // persist in background
  _runTimerInterval(start);
}
function resumeTimer() {
  // Popup just reopened — read timerStart from background state and resume
  const start = localState.timerStart;
  if (!start) return;
  _runTimerInterval(start);
}
function _runTimerInterval(start) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const el = document.getElementById('timerDisplay');
    if (el) el.textContent = _formatElapsed(start);
  }, 500);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const start = localState?.timerStart;
  const final = document.getElementById('timerFinal');
  if (final) final.textContent = _formatElapsed(start);
}
function _formatElapsed(start) {
  if (!start) return '0:00';
  const s = Math.floor((Date.now() - start) / 1000);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}
function resetTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  setState({ timerStart: null });
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = '0:00';
  const final = document.getElementById('timerFinal');
  if (final) final.textContent = '0:00';
}

// ── WAKE LOCK ──
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch(e) {
    console.log('[PV] Wake lock not available:', e.message);
  }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// ── RENDER ──
function renderState() {
  const phase = localState?.phase || 'idle';
  // Drive label bar + order list: only visible on idle
  const isIdle = phase === 'idle';
  document.getElementById('driveLabelBar').style.display = isIdle ? '' : 'none';
  document.getElementById('driveOrderList').style.display = isIdle ? '' : 'none';
  document.getElementById('driveBottom').style.display    = isIdle ? '' : 'none';
  // Section scroll: flex when not idle
  const ss = document.getElementById('sectionScroll');
  ss.style.display = isIdle ? 'none' : 'flex';
  document.getElementById('secPreview').style.display  = phase === 'loaded'   ? 'flex' : 'none';
  document.getElementById('secProgress').style.display = phase === 'running'  ? 'flex' : 'none';
  document.getElementById('secComplete').style.display = phase === 'complete' ? 'flex' : 'none';

  const store = document.getElementById('headerStore');
  if (localState?.orderData?.store) {
    store.textContent  = storeLabelPlain(localState.orderData.store);
    store.style.display = 'block';
  } else {
    store.style.display = 'none';
  }

  if (phase === 'idle')     { document.getElementById('pasteArea').value = ''; document.getElementById('btnLoad').disabled = true; }
  if (phase === 'loaded')   renderPreview();
  if (phase === 'running')  { renderLog(); updateProgressUI(); wireStopBtn(); }
  if (phase === 'complete') renderComplete();

  updateStatusBar();
}

// ── PASTE / LOAD ──
function onPasteAreaInput() {
  document.getElementById('btnLoad').disabled = document.getElementById('pasteArea').value.trim().length === 0;
}
async function loadFromPasteArea() {
  const text = document.getElementById('pasteArea').value.trim();
  // Extract JSON robustly — match outermost braces
  const start = text.indexOf('{');
  if (start === -1) { setStatus('red', 'No JSON found — copy from the phone app'); return; }
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) { setStatus('red', 'No JSON found — copy from the phone app'); return; }
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!data.items || !Array.isArray(data.items)) throw new Error('bad');
    await setState({ phase:'loaded', orderData:data, results:{entered:[],skipped:[],notFound:[],flagged:[]}, log:[], progress:{current:0,total:data.items.length}, stopRequested:false });
    localState = await getState();
    renderState();
  } catch(e) {
    setStatus('red', 'Invalid data — copy from the phone app first');
    setTimeout(() => setStatus('', 'Ready'), 3000);
  }
}

// ── PREVIEW ──
function renderPreview() {
  const items = localState?.orderData?.items || [];
  document.getElementById('previewCount').textContent = items.length;
  document.getElementById('previewList').innerHTML = items.map(i => {
    const isCases = i.order < 0 || i.cases === true;
    const absOrder = Math.abs(i.order);
    const orderDisplay = isCases
      ? absOrder + '<span style="color:var(--accent);font-size:9px;font-weight:700;display:block;line-height:1.2">' + (absOrder===1?'case':'cases') + '</span>'
      : absOrder;
    return `<div class="preview-row">
      <div class="pr-item">${i.item}</div>
      <div class="pr-order">${orderDisplay}</div>
      <div class="pr-qoh">${i.qoh}</div>
    </div>`;
  }).join('');
  const btnRun   = document.getElementById('btnRun');
  const btnClear = document.getElementById('btnClear');
  if (btnRun)   btnRun.onclick   = runBot;
  if (btnClear) btnClear.onclick = clearOrder;
}

async function clearOrder() {
  await setState({ phase:'idle', orderData:null, results:null, log:[], progress:{current:0,total:0} });
  localState = await getState();
  renderState();
}

// ── RUN BOT ──
async function runBot() {
  const orderData = localState?.orderData;
  if (!orderData) return;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await setState({ phase:'running', stopRequested:false, results:{entered:[],skipped:[],notFound:[],flagged:[]}, log:[], progress:{current:0, total:orderData.items.length}, runId });
  localState = await getState(); // sync local immediately — clears old log before any push arrives
  renderState(); startPolling(); startTimer(); requestWakeLock();

  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab || !tab.url.includes('petvalu.com')) {
    setStatus('red', 'Switch to the Pet Valu portal tab first!');
    await setState({ phase:'loaded' });
    stopPolling(); localState = await getState(); renderState(); return;
  }
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func: injectBridge });
    await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func: botScript, args:[orderData, TIMINGS(), runId] });
  } catch(e) {
    setStatus('red', 'Inject failed: ' + e.message);
    await setState({ phase:'loaded' });
    stopPolling(); localState = await getState(); renderState();
  }
}

function wireStopBtn() {
  const btn = document.getElementById('btnStop');
  if (btn) btn.onclick = stopBot;
}
async function stopBot() {
  await setState({ stopRequested:true });
  releaseWakeLock();
  setStatus('yellow', 'Stopping after current item...');
  const btn = document.getElementById('btnStop');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping...'; }
}

// ── PROGRESS UI ──
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
  renderLog();
  setStatus('yellow', 'Bot running...');
}

function renderLog() {
  const wrap = document.getElementById('logWrap');
  if (!wrap) return;
  const logs = localState?.log || [];
  const existing = wrap.children.length;
  // If log shrank (e.g. trimmed or cleared), wipe DOM and re-render from scratch
  if (logs.length < existing) {
    wrap.innerHTML = '';
    logs.forEach(l => {
      const line = document.createElement('div');
      line.className = 'log-line ' + (l.kind || 'info');
      line.textContent = l.msg;
      wrap.appendChild(line);
    });
  } else {
    logs.slice(existing).forEach(l => {
      const line = document.createElement('div');
      line.className = 'log-line ' + (l.kind || 'info');
      line.textContent = l.msg;
      wrap.appendChild(line);
    });
  }
  wrap.scrollTop = wrap.scrollHeight;
}

// ── COMPLETE ──
function renderComplete() {
  stopTimer(); releaseWakeLock();
  const r = localState?.results || {};
  document.getElementById('doneEntered').textContent  = (r.entered||[]).length;
  document.getElementById('doneSkipped').textContent  = (r.skipped||[]).length;
  document.getElementById('doneNotFound').textContent = (r.notFound||[]).length;
  document.getElementById('doneFlagged').textContent  = (r.flagged||[]).length;
  const nfBtn = document.getElementById('btnDownloadNF');
  if ((r.notFound||[]).length > 0 || (r.flagged||[]).length > 0 || (r.skipped||[]).length > 0) {
    nfBtn.style.display = 'block'; nfBtn.onclick = downloadNotFound;
  }
  const resetBtn = document.getElementById('btnReset');
  if (resetBtn) resetBtn.onclick = resetToStart;
  setStatus('green', `Done — ${(r.entered||[]).length} entered, ${(r.notFound||[]).length} not found`);
  sendCompletionEmail();
}

async function sendCompletionEmail() {
  const r = localState?.results || {};
  const od = localState?.orderData || {};
  const store    = od.store    || 'Unknown Store';
  const operator = od.operator || 'Unknown';
  const date     = new Date().toLocaleDateString('en-CA');

  // Show sending state
  setEmailStatus('sending');

  // Compute runtime from timerStart
  const timerStart = localState?.timerStart;
  let runtimeStr = 'N/A';
  if (timerStart) {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    runtimeStr = `${m}m ${sec}s`;
  }

  // Build full order CSV
  const entered  = r.entered  || [];
  const skipped  = r.skipped  || [];
  const notFound = r.notFound || [];
  const flagged  = r.flagged  || [];

  let csv = 'Item #,Order Qty,On Hand,Reason\n';
  notFound.forEach(i => { csv += `"${i.item}",${i.order||''},${i.qoh||''},"${i.reason||'Not found'}"\n`; });
  skipped.forEach(i  => { csv += `"${i.item}",,,\"${i.reason||'Skipped'}\"\n`; });
  flagged.forEach(i  => { csv += `"${i.item}",${i.qty||''},,\"${i.reason||'Could not enter qty'}\"\n`; });

  const payload = {
    action:    'sendEmail',
    store,
    operator,
    date,
    runtime:   runtimeStr,
    entered:   entered.length,
    skipped:   skipped.length,
    notFound:  notFound.length,
    flagged:   flagged.length,
    total:     entered.length + skipped.length + notFound.length + flagged.length,
    csvContent: csv,
    filename:  `petvalu_issues_${store.replace(/ /g,'_')}_${date}.csv`
  };

  try {
    await chrome.runtime.sendMessage({ type: 'APPS_POST', payload });
    setEmailStatus('sent');
  } catch(e) {
    console.warn('[PV] Email send failed:', e.message);
    setEmailStatus('failed');
  }
}

function setEmailStatus(state) {
  const el = document.getElementById('emailStatusBadge');
  if (!el) return;
  el.style.display = 'flex';
  el.style.animation = 'none';
  void el.offsetWidth; // reflow to restart animation
  if (state === 'sending') {
    el.className = 'email-badge email-sending';
    el.innerHTML = '<span class="email-dot-spin"></span> Sending receipt...';
  } else if (state === 'sent') {
    el.className = 'email-badge email-sent';
    el.innerHTML = '✓ Receipt sent to sarniapetvalu@gmail.com';
    el.style.animation = 'badgePop 0.4s cubic-bezier(0.22,1,0.36,1) forwards';
  } else if (state === 'failed') {
    el.className = 'email-badge email-failed';
    el.innerHTML = '✗ Receipt failed to send';
    el.style.animation = 'badgePop 0.4s cubic-bezier(0.22,1,0.36,1) forwards';
  }
}

function downloadNotFound() {
  const r = localState?.results; if (!r) return;
  let csv = 'Item #,Order Qty,On Hand,Reason\n';
  (r.notFound||[]).forEach(i => { csv += `"${i.item}",${i.order},${i.qoh},"${i.reason||'Not found'}"\n`; });
  (r.skipped||[]).forEach(i => { csv += `"${i.item}",,, "${i.reason||'Skipped'}"\n`; });
  (r.flagged||[]).forEach(i => { csv += `"${i.item}",${i.qty||''},,"${i.reason||'Could not enter qty'}"\n`; });
  const store = localState?.orderData?.store || 'order';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  a.download = `petvalu_issues_${store.replace(/ /g,'_')}_${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
}

async function resetToStart() {
  await setState({ phase:'idle', orderData:null, results:null, log:[], progress:{current:0,total:0}, stopRequested:false, timerStart:null });
  localState = await getState();
  renderState();
  resetTimer();
  releaseWakeLock();
  loadDriveOrders();
}

// ── STATUS BAR ──
function updateStatusBar() {
  const phase = localState?.phase || 'idle';
  const map = {
    idle:     ['', 'Select an order from Drive or open the portal'],
    loaded:   ['green', `Loaded: ${localState?.orderData?.store} — ${localState?.orderData?.items?.length} items`],
    running:  ['yellow', 'Bot running...'],
    complete: ['green', `Done — ${(localState?.results?.entered||[]).length} entered, ${(localState?.results?.notFound||[]).length} not found`]
  };
  const [type, text] = map[phase] || ['',''];
  setStatus(type, text);
}
function setStatus(type, text) {
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot' + (type ? ' ' + type : '');
  document.getElementById('statusText').textContent = text;
}

// ══════════════════════════════════════════════
// INJECTED: bridge
// ══════════════════════════════════════════════

function injectBridge() {
  if (window.__pvBridgeReady) return;
  window.__pvBridgeReady = true;
}

// ══════════════════════════════════════════════
// INJECTED: bot
// ══════════════════════════════════════════════
async function botScript(orderData, timings, runId) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function checkStop() {
    return new Promise(res => {
      chrome.runtime.sendMessage({ type:'PV_STOP_CHECK' }, resp => res(resp?.stop === true));
    });
  }
  function sendProgress(msg, current, total, kind, results) {
    chrome.runtime.sendMessage({ type:'PV_PROGRESS', msg, current, total, kind:kind||'info', results, runId });
  }
  function getFilterInput(label) {
    return document.querySelector(`input[aria-label="${label}"]`);
  }
  async function setFilter(label, value) {
    const input = getFilterInput(label); if (!input) return false;
    input.focus(); input.value = '';
    input.dispatchEvent(new Event('input', { bubbles:true })); await sleep(100);
    input.value = String(value).toUpperCase();
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true }));
    return true;
  }
  async function waitForRows(timeoutMs) {
    // Warp mode: poll every 100ms until rows appear, up to timeoutMs
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = getVisibleRows();
      if (rows.length > 0) return rows;
      await sleep(100);
    }
    return getVisibleRows();
  }
  async function clearFilter(label, forceReal) {
    const input = getFilterInput(label); if (!input) return;
    // Overwrite mode only skips the clear when staying on the SAME field for the next item.
    // Any cross-field clear (switching Item No → Sub, or end-of-item reset) must always be real.
    if (timings.overwriteMode && !forceReal) {
      // Select-all so next setFilter overwrites instead of appending — no dispatch needed
      input.focus();
      input.select();
    } else {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('change', { bubbles:true }));
      if (timings.afterClear > 0) await sleep(timings.afterClear);
    }
  }
  function getVisibleRows() {
    return Array.from(document.querySelectorAll('.ag-row[role="row"]'))
      .filter(r => !r.classList.contains('ag-row-loading') && !r.classList.contains('ag-row-stub'));
  }
  function findExactRow(rows, id) {
    return rows.find(r => {
      const c = r.querySelector('[col-id="item_no"]');
      return c && c.textContent.trim().toLowerCase() === String(id).trim().toLowerCase();
    }) || null;
  }
  function getCellText(row, colId) {
    // Try on the row first
    let c = row.querySelector(`[col-id="${colId}"]`);
    if (c) return c.textContent.trim();
    // AG Grid splits rows across containers (pinned vs center)
    // Find the row index and look in the other container
    const rowId = row.getAttribute('row-id');
    if (rowId !== null) {
      c = document.querySelector(`.ag-center-cols-container [row-id="${rowId}"] [col-id="${colId}"]`)
       || document.querySelector(`.ag-pinned-left-cols-container [row-id="${rowId}"] [col-id="${colId}"]`)
       || document.querySelector(`[row-id="${rowId}"] [col-id="${colId}"]`);
      if (c) return c.textContent.trim();
    }
    return '';
  }
  function getGridApi() {
    // AG Grid stores its API on the grid div
    const gridDiv = document.querySelector('.ag-root-wrapper');
    if (!gridDiv) return null;
    const key = Object.keys(gridDiv).find(k => k.startsWith('__agComponent') || k.startsWith('__AG'));
    if (key) return gridDiv[key]?.gridOptions?.api || gridDiv[key]?.api || null;
    // Try Angular component
    const ngKey = Object.keys(gridDiv).find(k => k.startsWith('__ngContext') || k.includes('ng'));
    return null;
  }
  function getAgApi() {
    try {
      const agGridEl = document.querySelector('ag-grid-angular');
      if (!agGridEl) return null;
      // Direct AG Grid instance key (confirmed on this portal)
      const inst = agGridEl['__ag_grid_instance'];
      if (inst?.api?.forEachNodeAfterFilter) return inst.api;
      if (inst?.forEachNodeAfterFilter) return inst;
      if (inst?.gridOptions?.api?.forEachNodeAfterFilter) return inst.gridOptions.api;
    } catch(e) { console.log('[PV Bot] getAgApi error:', e); }
    return null;
  }
  function getRowDataFromGrid(itemId) {
    try {
      const api = getAgApi();
      if (!api) return null;
      let found = null;
      api.forEachNodeAfterFilter(node => {
        if (found) return;
        const d = node.data;
        if (d && String(d.item_no || '').trim().toLowerCase() === String(itemId).trim().toLowerCase()) {
          found = d;
        }
      });
      return found;
    } catch(e) { return null; }
  }
  function calcQty(appOrder, appQoh, avgSales, multiple, isCases) {
    // Cases mode: multiply entered qty by order multiple first, then treat as normal
    let order = appOrder;
    if (isCases && order > 0) order = order * multiple;
    let qty;
    if (order === 0) {
      // Auto-calculate: ceil(avgSales × 4 - QOH), skip if ≤ 0
      if (avgSales === 0) return { qty: null, reason: 'Skipped — avg sales is 0' };
      qty = Math.ceil(avgSales * 4 - appQoh);
      if (qty <= 0) return { qty: null, reason: `Skipped — already have enough on hand (avg=${avgSales}, qoh=${appQoh})` };
    } else {
      qty = order;
      if (qty <= 0) return { qty: null, reason: 'Skipped — order qty ≤ 0' };
    }
    if (multiple > 1) { const rem = qty % multiple; if (rem !== 0) qty += (multiple - rem); }
    return { qty };
  }
  async function enterQty(row, qty) {
    const cell = row.querySelector('[col-id="unit_qty_chg"]'); if (!cell) return false;
    cell.click(); await sleep(250);
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, cancelable:true, view:window }));
    await sleep(400);
    let input = cell.querySelector('input[aria-label="Input Editor"]')
              || cell.querySelector('input')
              || document.querySelector('.ag-cell-inline-editing input');
    if (!input) {
      cell.dispatchEvent(new KeyboardEvent('keydown', { key:'F2', keyCode:113, bubbles:true }));
      await sleep(350);
      input = cell.querySelector('input') || document.querySelector('.ag-cell-inline-editing input');
    }
    if (!input) return false;
    input.focus(); input.select();
    input.value = String(qty);
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', keyCode:9, bubbles:true }));
    await sleep(timings.afterQty);
    return true;
  }

  const items = orderData.items;
  const results = { entered:[], skipped:[], notFound:[], flagged:[] };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = String(item.item).trim();
    if (await checkStop()) { sendProgress(`Stopped by user after ${i} items`, i, items.length, 'skip', results); break; }
    sendProgress(`[${i+1}/${items.length}] Searching ${id}...`, i, items.length, 'info', results);
    const warp = timings.afterClear === 0; // warp mode flag
    await setFilter('Item No Filter Input', id);
    let rows = warp ? await waitForRows(timings.afterFilter) : (await sleep(timings.afterFilter), getVisibleRows());
    if (warp && rows.length > 0) await sleep(250); // let ag-Grid finish rendering cells
    let targetRow = findExactRow(rows, id);
    let usedSub = false;
    if (!targetRow) {
      sendProgress(`${id} — not in Item No, trying Substituted Item...`, i, items.length, 'info', results);
      if (!warp) await clearFilter('Item No Filter Input', true);
      await setFilter('Substituted Item Filter Input', id);
      rows = warp ? await waitForRows(timings.afterSubFilter || timings.afterFilter) : (await sleep(timings.afterSubFilter ?? timings.afterFilter), getVisibleRows());
      if (warp && rows.length > 0) await sleep(250);
      targetRow = rows.length > 0 ? rows[0] : null;
      usedSub = true;
    }
    if (!targetRow) {
      results.notFound.push({ item:id, order:item.order, qoh:item.qoh, reason:'Not found (checked Item No + Substituted Item)' });
      sendProgress(`${id} — NOT FOUND`, i+1, items.length, 'notfound', results);
      await clearFilter(usedSub ? 'Substituted Item Filter Input' : 'Item No Filter Input', true);
      await sleep(timings.betweenItems); continue;
    }
    // Check Life Cycle Status — skip ROS, INOT, OOS
    const lifecycle = getCellText(targetRow, 'life_cycle_status');
    const lifecycleReasons = {
      'OOS':  'OOS — Out of Stock',
      'ROS':  'ROS — Ranged Out of Store',
      'INOT': 'INOT — Inactive / Not On Tag'
    };
    if (lifecycleReasons[lifecycle]) {
      results.skipped.push({ item:id, reason: lifecycleReasons[lifecycle] });
      sendProgress(`${id} — skipped (${lifecycleReasons[lifecycle]})`, i+1, items.length, 'skip', results);
      await clearFilter(usedSub ? 'Substituted Item Filter Input' : 'Item No Filter Input', true);
      await sleep(timings.betweenItems); continue;
    }
    // Try AG Grid internal data first (bypasses column virtualization), fall back to DOM
    const gridData = getRowDataFromGrid(id);
    console.log('[PV Bot] gridData for', id, gridData);
    let avgSales = parseFloat(gridData?.average_sales_last_4_weeks ?? getCellText(targetRow, 'average_sales_last_4_weeks')) || 0;
    let multiple = parseInt(gridData?.order_multiple ?? getCellText(targetRow, 'order_multiple')) || 1;
    console.log('[PV Bot]', id, '— avgSales:', avgSales, 'multiple:', multiple);
    // Negative order = cases encoding
    const isCases  = item.order < 0 || item.cases === true;
    const absOrder = Math.abs(item.order);
    const calcResult = calcQty(absOrder, item.qoh, avgSales, multiple, isCases);
    if (calcResult.qty === null) {
      results.skipped.push({ item:id, reason: calcResult.reason });
      sendProgress(`${id} — ${calcResult.reason}`, i+1, items.length, 'skip', results);
      await clearFilter(usedSub ? 'Substituted Item Filter Input' : 'Item No Filter Input', true);
      await sleep(timings.betweenItems); continue;
    }
    const qty = calcResult.qty;
    const ok = await enterQty(targetRow, qty);
    if (warp) await sleep(200); // let cell fully commit before moving on
    if (ok) {
      results.entered.push({ item:id, qty, usedSub });
      sendProgress(`${id} — entered ${qty}${usedSub?' [via substitute]':''}`, i+1, items.length, 'ok', results);
    } else {
      results.flagged.push({ item:id, qty, reason:'Could not click/edit Qty cell' });
      sendProgress(`${id} — FLAGGED (enter ${qty} manually)`, i+1, items.length, 'flag', results);
    }
    await clearFilter(usedSub ? 'Substituted Item Filter Input' : 'Item No Filter Input', true);
    await sleep(timings.betweenItems);
  }

  chrome.runtime.sendMessage({ type:'PV_COMPLETE', results, runId });
}

// ── DEV MODE ──
let _devClicks = 0, _devClickTimer = null;
function devTriggerClick() {
  _devClicks++;
  clearTimeout(_devClickTimer);
  _devClickTimer = setTimeout(() => { _devClicks = 0; }, 1200);
  if (_devClicks >= 3) {
    _devClicks = 0;
    openDevMode();
  }
}
function openDevMode() {
  const ov = document.getElementById('devOverlay');
  if (!ov) return;
  // Move to body to escape any clipping containers
  document.body.appendChild(ov);
  ov.style.display = 'flex';
}
function closeDevMode() {
  const ov = document.getElementById('devOverlay');
  if (ov) { ov.style.display = 'none'; }
}

async function devTestEmail() {
  const statusEl = document.getElementById('devEmailStatus');
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Injecting state and calling sendCompletionEmail()...';

  // Inject realistic fake state — same shape as a real completed run
  const fakeTimerStart = Date.now() - (4 * 60 * 1000 + 17 * 1000); // 4m 17s ago
  await setState({
    phase: 'complete',
    timerStart: fakeTimerStart,
    orderData: { store: 'Lakeshore Rd', operator: 'Nipun' },
    results: {
      entered:  [
        { item: '10045231', qty: 6,  usedSub: false },
        { item: '10078432', qty: 12, usedSub: false },
        { item: '10091234', qty: 3,  usedSub: true  },
        { item: '10056789', qty: 8,  usedSub: false },
        { item: '10034567', qty: 2,  usedSub: false },
      ],
      skipped:  [
        { item: '10011111', reason: 'OOS' },
        { item: '10022222', reason: 'ROS' },
      ],
      notFound: [
        { item: '10099999', order: 4, qoh: 1, reason: 'Not found in portal' },
      ],
      flagged:  [
        { item: '10088888', qty: 5, reason: 'Could not click/edit Qty cell' },
      ]
    }
  });
  localState = await getState();

  try {
    await sendCompletionEmail();
    statusEl.style.color = 'var(--accent)';
    statusEl.textContent = '✓ Sent — check sarniapetvalu@gmail.com';
  } catch(e) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = '✗ Error: ' + e.message;
  }
}

async function devTestDrive() {
  const statusEl = document.getElementById('devDriveStatus');
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Uploading test files via real upload path...';

  const date = new Date().toLocaleDateString('en-CA');
  const base = `DEV_TEST_Lakeshore_Rd_${date}`;
  const jsonContent = JSON.stringify({ store:'Lakeshore Rd', date, _devTest: true, items:[{item:'10045231',order:6,qoh:10}] }, null, 2);
  const csvContent  = `Store,Date,Item #,Order Qty,On Hand,Status,Notes\n"Lakeshore Rd","${date}","10045231",6,10,Entered,\n`;

  try {
    const results = await Promise.all([
      chrome.runtime.sendMessage({ type:'APPS_POST', payload:{ filename: base+'.json', content: jsonContent }}),
      chrome.runtime.sendMessage({ type:'APPS_POST', payload:{ filename: base+'.csv',  content: csvContent  }})
    ]);
    const allOk = results.every(r => r?.ok);
    statusEl.style.color = allOk ? 'var(--accent)' : 'var(--red)';
    statusEl.textContent = allOk ? '✓ Uploaded — check Google Drive' : '✗ Upload failed';
  } catch(e) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = '✗ Error: ' + e.message;
  }
}

async function devTestUpdate() {
  const statusEl = document.getElementById('devUpdateStatus');
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Fetching update.xml from Vercel...';
  try {
    const res = await fetch('https://petvalu-bot.vercel.app/update.xml?t=' + Date.now(), { cache:'no-store' });
    const text = await res.text();
    const match = text.match(/<version>(.*?)<\/version>/);
    const latest = match ? match[1] : '?';
    const current = browser.runtime.getManifest().version;
    statusEl.style.color = 'var(--accent)';
    statusEl.textContent = `✓ Current: v${current} — Latest: v${latest} — ${latest === current ? 'Up to date' : 'Update available'}`;
  } catch(e) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = '✗ Could not reach Vercel: ' + e.message;
  }
}