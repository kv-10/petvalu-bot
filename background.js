// Background service worker - persists bot state across popup open/close
// v2.2.10
let botState = {
  phase: 'idle',
  orderData: null,
  results: null,
  log: [],
  progress: { current: 0, total: 0 },
  stopRequested: false,
  timerStart: null,
  runId: null,
  wasStopped: false
};

chrome.action.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATE') { sendResponse(botState); return true; }
  if (msg.type === 'SET_STATE') { Object.assign(botState, msg.state); sendResponse({ ok: true }); return true; }
  if (msg.type === 'APPEND_LOG') { botState.log.push({ msg: msg.msg, kind: msg.kind }); sendResponse({ ok: true }); return true; }
  if (msg.type === 'PV_STOP_CHECK') { sendResponse({ stop: botState.stopRequested }); return true; }
  if (msg.type === 'PV_PROGRESS') {
    if (msg.runId && botState.runId && msg.runId !== botState.runId) { sendResponse({ ok: true }); return true; }
    botState.progress = { current: msg.current, total: msg.total };
    if (msg.results) botState.results = msg.results;
    botState.log.push({ msg: msg.msg, kind: msg.kind || 'info' });
    chrome.runtime.sendMessage({ type: 'PUSH_PROGRESS', state: { ...botState } }).catch(() => {});
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'PV_COMPLETE') {
    if (msg.runId && botState.runId && msg.runId !== botState.runId) { sendResponse({ ok: true }); return true; }
    botState.phase = 'complete';
    botState.results = msg.results;
    botState.wasStopped = msg.wasStopped || false;
    botState.log.push({ msg: '\u2713 Bot finished', kind: 'ok' });
    chrome.runtime.sendMessage({ type: 'PUSH_PROGRESS', state: { ...botState } }).catch(() => {});
    sendResponse({ ok: true }); return true;
  }
  if (msg.type === 'APPS_POST') {
    fetch('https://script.google.com/macros/s/AKfycbw6jkcvoMrJ4XJUWAl_fUpv0bRNeHYTpUX64wCU534_HW7NxB3oJKLw9ogxP7-CwJno/exec', { method: 'POST', body: JSON.stringify(msg.payload) })
      .then(r => r.text()).then(text => sendResponse({ ok: true, text })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'DRIVE_FETCH') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(msg.url, { redirect: 'follow', credentials: 'omit', signal: controller.signal })
      .then(r => { clearTimeout(timeout); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => { sendResponse({ ok: true, data: JSON.parse(text) }); })
      .catch(e => { clearTimeout(timeout); sendResponse({ ok: false, error: e.message }); });
    return true;
  }
});
