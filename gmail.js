// Runs automatically on mail.google.com
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'GMAIL_GET_ORDER') return;
  sendResponse(extractOrder());
  return true;
});

function extractOrder() {
  const selectors = [
    '.a3s.aiL', '.a3s', '.tVu25', '.ii.gt .a3s', '.ii.gt',
    '[data-message-id] .a3s', '.gs .a3s', '.adP.adO', '.y2'
  ];
  let bodyText = '';
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const t = el.innerText || el.textContent || '';
      if (t.includes('"items"') || t.includes('"store"')) { bodyText = t; break; }
    }
    if (bodyText) break;
  }
  if (!bodyText) {
    const all = document.querySelectorAll('div');
    for (const el of all) {
      const t = el.innerText || el.textContent || '';
      if (t.includes('"items"') && t.includes('"store"') && t.includes('"order"')) { bodyText = t; break; }
    }
  }
  if (!bodyText) return { ok: false };
  return parseOrderFromText(bodyText);
}

function parseOrderFromText(bodyText) {
  const start = bodyText.indexOf('{');
  if (start === -1) return { ok: false };
  let depth = 0, end = -1;
  for (let i = start; i < bodyText.length; i++) {
    if (bodyText[i] === '{') depth++;
    else if (bodyText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { ok: false };
  const jsonStr = bodyText.slice(start, end + 1)
    .replace(/:\s*True\b/g, ': true')
    .replace(/:\s*False\b/g, ': false');
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch(e) { return { ok: false, err: e.message }; }
  if (!parsed.items || !Array.isArray(parsed.items)) return { ok: false };
  const subject = document.querySelector('h2.hP')?.textContent || 'Pet Valu Order';
  const from    = document.querySelector('.gD')?.getAttribute('email') || '';
  return { ok: true, json: parsed, subject, from };
}
