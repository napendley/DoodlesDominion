/* Tabletop Online: the game page. The server holds the game; this page draws it and sends what you do. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const PORTRAIT = innerWidth < innerHeight && innerWidth < 900;
const L = PORTRAIT ? { W: 940, H: 1355, board: [20, 20], bank: [20, 960, 900, 375, 3] }
                   : { W: 1190, H: 924, board: [270, 12], bank: [20, 12, 230, 900, 1] };
const W = L.W, H = L.H, stage = $('stage'), wrap = $('wrap');
const BOX = L.board[0], BOY = L.board[1], BSZ = 900, BCX = BOX + 450, BCY = BOY + 450, BHALF = 450;
const BC = 0.1537, BT = (1 - 2 * BC) / 9, PRICE_DEPTH = 0.021;
const F = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const KIND_COLOR = { roll: '#f2c244', move: '#00a6a8', buy: '#62b85a', auction: '#e865b3', money: '#4263d6', rent: '#e08a3c', card: '#6ca474' };

let cfg = null, ST = null, seat = -1, ws = null, code = '', myName = '', skew = 0, lastEv = 0, lastRoll = -1, built = false;
let rot = 0, S = 1, fs = 1, Z = 1, px = 0, py = 0, bankOpen = true, bankFilter = -1, uid = 0;
const els = {}, anim = {}, pending = {};
let drag = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, ms) { const s = $('status'); s.textContent = msg; s.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { s.hidden = true; }, ms || 3200); }

/* ------------------------------------------------------------------ connection */
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => send({ t: 'join', room: code, name: myName, token: store.get('tt:' + code) || undefined });
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'welcome') {
      seat = m.seat; cfg = m.cfg; store.set('tt:' + m.code, m.token); code = m.code; $('room').textContent = code;
      history.replaceState(null, '', '?room=' + code); $('join').hidden = true;
    } else if (m.t === 'state') onState(m);
    else if (m.t === 'mv') onMove(m);
    else if (m.t === 'err') {
      if (m.fatal) { $('join').hidden = false; $('jmsg').textContent = m.msg; ws.onclose = null; ws.close(); }
      else { toast(m.msg); if (/color|character|nickname/i.test(m.msg)) openLobby(); }
    }
  };
  ws.onclose = () => { if (!$('join').hidden) return; toast('Connection lost. Reconnecting…', 6000); setTimeout(connect, 1500); };
}

$('jname').value = store.get('tt:name') || '';
{ const q = new URLSearchParams(location.search).get('room'); if (q) { $('jcode').value = q.toUpperCase(); $('jgo').textContent = 'Join room ' + q.toUpperCase(); } }
$('jcode').oninput = () => { $('jgo').textContent = $('jcode').value.trim() ? 'Join room' : 'Start a new room'; };
$('joinForm').onsubmit = e => {
  e.preventDefault();
  myName = $('jname').value.trim() || 'Player'; store.set('tt:name', myName);
  code = $('jcode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  $('jmsg').textContent = ''; connect();
};
{ const q = (new URLSearchParams(location.search).get('room') || '').toUpperCase(), nm = store.get('tt:name');
  if (q && nm && store.get('tt:' + q)) { myName = nm; code = q; connect(); } }
$('invite').onclick = () => {
  const url = location.origin + '/?room=' + code;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied: ' + url), () => toast('Share this link: ' + url, 8000));
};

/* ------------------------------------------------------------------ geometry */
function tileFrac(i) {
  if (i === 0) return [1 - BC / 2, 1 - BC / 2]; if (i === 10) return [BC / 2, 1 - BC / 2];
  if (i === 20) return [BC / 2, BC / 2]; if (i === 30) return [1 - BC / 2, BC / 2];
  if (i < 10) return [1 - BC - (i - 0.5) * BT, 1 - BC / 2];
  if (i < 20) return [BC / 2, 1 - BC - (i - 10 - 0.5) * BT];
  if (i < 30) return [BC + (i - 20 - 0.5) * BT, BC / 2];
  return [1 - BC / 2, BC + (i - 30 - 0.5) * BT];
}
const rotN = () => ((rot % 4) + 4) % 4;
function rotPt(x, y) { for (let k = 0; k < rotN(); k++) { const nx = BCX + (y - BCY), ny = BCY - (x - BCX); x = nx; y = ny; } return [x, y]; }
function unrotPt(x, y) { for (let k = 0; k < rotN(); k++) { const nx = BCX - (y - BCY), ny = BCY + (x - BCX); x = nx; y = ny; } return [x, y]; }
const inBoard = (x, y) => Math.abs(x - BCX) <= BHALF && Math.abs(y - BCY) <= BHALF;
const JAIL_F = [0.09, 0.905], VISIT_F = [0.022, 0.93];
function tileXY(i, jail) {
  const f = i === 10 ? (jail ? JAIL_F : VISIT_F) : tileFrac(i);
  return rotPt(BOX + f[0] * BSZ, BOY + f[1] * BSZ);
}
// board coordinates (top-left of an object of size w x h) -> screen position on the table for this viewer
function toScreen(bx, by, w, h) {
  let cx = BOX + bx + w / 2, cy = BOY + by + h / 2;
  if (inBoard(cx, cy)) [cx, cy] = rotPt(cx, cy);
  return [cx - w / 2, cy - h / 2];
}
function toBoard(left, top, w, h) {
  let cx = left + w / 2, cy = top + h / 2;
  if (inBoard(cx, cy)) [cx, cy] = unrotPt(cx, cy);
  return [cx - w / 2 - BOX, cy - h / 2 - BOY];
}

/* ------------------------------------------------------------------ camera */
const BX = 258;
const vx = () => bankOpen ? 0 : BX;
const baseX = s => (wrap.clientWidth - (W - vx()) * s) / 2 - vx() * s, GAP = 26;
function fit() {
  fs = Math.min((wrap.clientWidth - GAP) / (W - vx()), (wrap.clientHeight - GAP) / H); S = fs * Z;
  const ox = baseX(S) + px, oy = (wrap.clientHeight - H * S) / 2 + py;
  stage.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + S + ')';
  const g = Math.max(8, 26 * S); wrap.style.backgroundSize = g + 'px ' + g + 'px'; wrap.style.backgroundPosition = (ox % g) + 'px ' + (oy % g) + 'px';
}
function applyClip() { stage.style.clipPath = bankOpen ? '' : 'inset(-40px -40px -40px ' + BX + 'px)'; }
function setBank(open) {
  bankOpen = open; store.set('bankOpen', open ? '1' : '0'); applyClip();
  const b = $('bankBtn'); b.textContent = open ? 'Hide land bank' : 'Show land bank'; b.setAttribute('aria-pressed', open); fit();
}
function zoomAt(nz, cx, cy) {
  nz = Math.max(1, Math.min(5, nz));
  const ch = wrap.clientHeight, ox = baseX(S) + px, oy = (ch - H * S) / 2 + py, u = (cx - ox) / S, v = (cy - oy) / S;
  Z = nz; const s2 = fs * Z; px = cx - u * s2 - baseX(s2); py = cy - v * s2 - (ch - H * s2) / 2;
  if (Z === 1) { px = 0; py = 0; } fit();
}
addEventListener('resize', fit);
if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
wrap.addEventListener('wheel', e => { e.preventDefault(); const r = wrap.getBoundingClientRect(); zoomAt(Z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
const pts = new Map();
wrap.addEventListener('pointerdown', e => {
  if (e.target.closest('#deed,.offer,#money')) return;
  if (!e.target.closest('.obj')) { $('deed').hidden = true; $('money').hidden = true; }
  if (e.target.closest('.obj')) return;
  wrap.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
wrap.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId); if (!p) return;
  if (pts.size === 1) { px += e.clientX - p.x; py += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; fit(); }
  else if (pts.size === 2) {
    const o = [...pts.entries()].find(([id]) => id !== e.pointerId)[1], d0 = Math.hypot(p.x - o.x, p.y - o.y);
    p.x = e.clientX; p.y = e.clientY; const d1 = Math.hypot(p.x - o.x, p.y - o.y), r = wrap.getBoundingClientRect();
    if (d0 > 0) zoomAt(Z * d1 / d0, (p.x + o.x) / 2 - r.left, (p.y + o.y) / 2 - r.top);
  }
});
['pointerup', 'pointercancel'].forEach(t => wrap.addEventListener(t, e => pts.delete(e.pointerId)));
$('zin').onclick = () => zoomAt(Z * 1.25, wrap.clientWidth / 2, wrap.clientHeight / 2);
$('zout').onclick = () => zoomAt(Z / 1.25, wrap.clientWidth / 2, wrap.clientHeight / 2);
$('zfit').onclick = () => { Z = 1; px = 0; py = 0; fit(); };
$('bankBtn').onclick = () => { Z = 1; px = 0; py = 0; setBank(!bankOpen); };
if (PORTRAIT) $('bankBtn').style.display = 'none';

/* ------------------------------------------------------------------ small helpers on state */
const me = () => ST && ST.players[seat];
const P = i => ST && ST.players[i];
const landInfo = name => cfg.lands.find(l => l[0] === name);
const landOrder = name => cfg.lands.findIndex(l => l[0] === name);
const colorOrder = () => [...new Set(cfg.lands.map(l => l[1]))];
const nameOf = i => { const p = P(i); return p ? p.nick : 'Someone'; };
const colorOfSeat = i => { const p = P(i); return (p && p.color) || '#cccccc'; };
const money = () => ST.players[seat].money;
function myPurse() { return ST.me.purse; }
const COINS = ['5', '10', '50', '100', '500'];
const totalOf = m => COINS.reduce((s, c) => s + (+c) * (m[c] || 0), 0);
function greedy(a) { const out = {}; [...COINS].reverse().forEach(c => { const n = Math.floor(a / +c); if (n) { out[c] = n; a -= n * (+c); } }); return out; }
function planPayment(amount, purse) {
  const tot = totalOf(purse), best = new Array(tot / 5 + 1).fill(null); best[0] = { n: 0, use: {} };
  COINS.forEach(c => { const v = +c / 5; for (let k = 0; k < (purse[c] || 0); k++) for (let s = best.length - 1; s >= v; s--) {
    const pr = best[s - v]; if (pr && (!best[s] || pr.n + 1 < best[s].n)) best[s] = { n: pr.n + 1, use: { ...pr.use, [c]: (pr.use[c] || 0) + 1 } };
  } });
  for (let s = amount / 5; s < best.length; s++) if (best[s]) return { pay: best[s].use, change: s * 5 - amount };
  return null;
}
const coinWords = m => COINS.slice().reverse().filter(c => m[c]).map(c => m[c] + ' × $' + c).join(', ');

/* ------------------------------------------------------------------ building the table (once) */
function buildStatic() {
  built = true;
  const bd = $('board'); bd.style.left = BOX + 'px'; bd.style.top = BOY + 'px';
  stage.style.width = W + 'px'; stage.style.height = H + 'px';
  // card backs for the decks
  const st = document.createElement('style');
  st.textContent = cfg.decks.map(d => '.card.down.k-' + d.key + '{background-image:url(assets/back-' + d.key + '.jpg)}').join('\n');
  document.head.appendChild(st);
  cfg.decks.forEach(d => { const b = $('bdeck-' + d.key); b.style.backgroundImage = 'url(assets/back-' + d.key + '.jpg)'; b.style.setProperty('--c', d.color); b.onclick = () => send({ t: 'draw', deck: d.key }); });
  // land bank zone, tabs and strips
  const z = document.createElement('div'); z.className = 'zone obj-l'; const [x, y, w, h] = L.bank;
  z.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;--zc:#d1bd61'; stage.appendChild(z);
  const t = document.createElement('div'); t.className = 'lbl obj-l'; t.textContent = 'Land bank'; Object.assign(t.style, { left: (x + 8) + 'px', top: (y + 4) + 'px', color: 'var(--ink)', fontWeight: '700', fontSize: '11px' }); stage.appendChild(t);
  const groups = colorOrder();
  els.tabs = [-1, ...groups.map((_, i) => i)].map((g, k) => {
    const tab = document.createElement('div'); tab.className = 'ltab fixed obj'; tab.dataset.g = g;
    if (g < 0) tab.style.background = '#fff8e1'; else { tab.style.background = groups[g]; if (['#f2c244', '#d1bd61'].includes(groups[g])) tab.style.color = '#232a45'; tab.title = cfg.lands.filter(l => l[1] === groups[g]).map(l => l[0]).join(', '); }
    tab.style.left = (x + 7 + (k % 6) * 36.5) + 'px'; tab.style.top = (y + 26 + Math.floor(k / 6) * 30) + 'px';
    tab.onclick = () => { bankFilter = g; renderBank(); }; stage.appendChild(tab); return tab;
  });
  els.strips = {};
  cfg.lands.forEach(([name, col, price]) => {
    const c = document.createElement('div'); c.className = 'card k-land dk obj'; c.dataset.k = 'bank'; c.dataset.name = name; c.dataset.d = 'land';
    c.style.setProperty('--c', col); c.innerHTML = '<em>Land</em><span>' + esc(name) + '</span><i class="pr">$' + price + '</i>';
    c._tap = () => openDeed(name); stage.appendChild(c); els.strips[name] = c;
  });
  // price tags are drawn once per render
  setBank(PORTRAIT || store.get('bankOpen') !== '0'); fit();
}

/* ------------------------------------------------------------------ state arrives */
function onState(s) {
  const first = !ST;
  ST = s; seat = s.you; skew = s.now - Date.now();
  if (!built && cfg) buildStatic();
  if (!cfg) return;
  if (first) { lastEv = s.ev ? s.ev.n : 0; lastRoll = s.rollN; }
  if (s.ev && s.ev.n !== lastEv) { lastEv = s.ev.n; if (s.ev.steps && !first) animateMove(s.ev.seat, s.ev.from, s.ev.steps); }
  renderPieces(); renderObjs(); renderBank(); renderTags(); renderDice(first); renderBar(); renderPlist(); renderLog(); renderBoxes();
  if (!$('handPanel').hidden) renderHand();
  if (first && !me().char) openLobby();
  if (!$('lobby').hidden) refreshLobby();
}
function onMove(m) {
  if (!ST) return;
  const o = ST.objs.find(x => x.id === m.id); if (!o) return;
  o.bx = m.bx; o.by = m.by; o.z = m.z;
  const el = els[m.id]; if (el && !(drag && drag.el === el)) placeObj(el, o);
}

/* ------------------------------------------------------------------ pieces */
const SPREAD = [[0, 0], [15, 3], [-15, 3], [8, -4], [-8, -4]];
function tileOfPlayer(p) { return anim[p.seat] != null ? anim[p.seat] : p.tile; }
function renderPieces() {
  const seen = new Set(), groups = {};
  ST.players.forEach(p => {
    if (!p || !p.char || p.tile == null) return;
    const key = 'p' + p.seat; seen.add(key);
    let el = els[key];
    if (!el) {
      el = els[key] = document.createElement('div'); el.className = 'pawn char obj onb'; el.dataset.k = 'pawn'; el.dataset.seat = p.seat;
      el.innerHTML = '<div class="ntag"></div>'; stage.appendChild(el);
    }
    el.style.backgroundImage = 'url(assets/pieces/plain-' + p.char.toLowerCase() + '.png)';
    el.style.setProperty('--ring', p.color); el.title = p.nick + ' (' + p.char + ')';
    el.classList.toggle('sel', p.seat === seat); el.classList.toggle('hop', anim[p.seat] != null);
    el.querySelector('.ntag').textContent = p.nick;
    el.style.opacity = p.online ? '' : '.55';
    const t = tileOfPlayer(p), jail = p.jail && t === 10 && anim[p.seat] == null, gk = t + (jail ? 'j' : 'v');
    (groups[gk] = groups[gk] || []).push({ el, t, jail });
  });
  Object.keys(els).forEach(k => { if (/^p\d/.test(k) && !seen.has(k)) { els[k].remove(); delete els[k]; } });
  Object.values(groups).forEach(g => g.forEach(({ el, t, jail }, k) => {
    if (drag && drag.el === el) return;
    const [x, y] = tileXY(t, jail), o = SPREAD[k % SPREAD.length];
    el.style.left = (x - 22 + o[0]) + 'px'; el.style.top = (y - 44 + o[1]) + 'px'; el.style.zIndex = 40 + k;
  }));
}
function animateMove(who, from, steps) {
  let i = from, left = steps; anim[who] = i;
  const step = () => {
    if (left <= 0) { delete anim[who]; renderPieces(); return; }
    i = (i + 1) % 40; left--; anim[who] = i; renderPieces(); setTimeout(step, 190);
  };
  renderPieces(); setTimeout(step, 190);
}

/* ------------------------------------------------------------------ loose things on the table: Tavern/Keep tokens and cards */
function setN(el, n) {
  el._n = n; el.classList.toggle('s2', n === 2); el.classList.toggle('s3', n >= 3);
  let b = el.querySelector('.cnt');
  if (n > 1) { if (!b) { b = document.createElement('div'); b.className = 'cnt'; el.appendChild(b); } b.textContent = n; } else if (b) b.remove();
}
function placeObj(el, o) {
  const w = o.kind === 'card' ? 110 : 34, [x, y] = toScreen(o.bx, o.by, w, w);
  el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.zIndex = o.z;
}
function renderObjs() {
  const seen = new Set();
  ST.objs.forEach(o => {
    seen.add(o.id); let el = els[o.id];
    if (!el) {
      el = els[o.id] = document.createElement('div'); el.dataset.id = o.id; el.dataset.k = o.kind;
      if (o.kind === 'card') {
        const d = cfg.decks.find(x => x.key === o.deck); el.className = 'card k-' + o.deck + ' obj'; el.dataset.d = o.deck; el.style.setProperty('--c', d.color);
        el.innerHTML = '<em>' + esc(d.name) + '</em><span>' + esc(o.text) + '</span>';
      } else { el.className = 'tok obj t-' + o.tok; el.dataset.tok = o.tok; }
      stage.appendChild(el);
    }
    if (o.kind === 'tok') setN(el, o.n);
    delete pending[o.id];
    if (!(drag && drag.el === el)) placeObj(el, o);
  });
  Object.keys(els).forEach(k => { if (/^(c|u)/.test(k) && !seen.has(k) && els[k].dataset && els[k].dataset.id && !pending[k] && !(drag && drag.el === els[k])) { els[k].remove(); delete els[k]; } });
}

/* ------------------------------------------------------------------ land bank and price tags */
function renderBank() {
  const [x, , w, h] = L.bank, y = L.bank[1], cols = L.bank[4], pad = 92;
  const groups = colorOrder(), owned = ST.owner;
  const free = cfg.lands.map(l => l[0]).filter(n => owned[n] == null);
  const g = n => groups.indexOf(landInfo(n)[1]);
  free.sort((a, b) => g(a) - g(b) || landInfo(a)[2] - landInfo(b)[2] || landOrder(a) - landOrder(b));
  const shown = bankFilter >= 0 ? free.filter(n => g(n) === bankFilter) : free;
  Object.entries(els.strips).forEach(([n, c]) => { c.style.display = shown.includes(n) ? '' : 'none'; });
  const rows = Math.max(1, Math.ceil(shown.length / cols)), sh = Math.max(11, Math.min(26, Math.floor((h - pad - 6) / rows))), cw = (w - 8) / cols;
  shown.forEach((n, i) => {
    const c = els.strips[n], col = cols > 1 ? Math.floor(i / rows) : 0, row = cols > 1 ? i % rows : i;
    if (drag && drag.el === c) return;
    Object.assign(c.style, { left: (x + 4 + col * cw) + 'px', top: (y + pad + row * sh) + 'px', width: (cw - 2) + 'px', height: (sh - 1) + 'px', lineHeight: (sh - 1) + 'px', fontSize: (sh >= 20 ? 11 : sh >= 16 ? 9 : 8) + 'px' });
  });
  els.tabs.forEach(t => { const gi = +t.dataset.g; t.classList.toggle('on', gi === bankFilter); t.textContent = gi < 0 ? 'All' : free.filter(n => g(n) === gi).length; });
}
function renderTags() {
  stage.querySelectorAll('.ptag').forEach(t => t.remove());
  const after = $('board');
  for (let i = 1; i < 40; i++) {
    if (i % 10 === 0) continue;
    const name = cfg.tiles[i], info = landInfo(name); if (!info || /Monument/.test(name)) continue;
    const f = tileFrac(i); let fx = f[0], fy = f[1], ang = 0;
    if (i < 10) fy = 1 - PRICE_DEPTH; else if (i < 20) { fx = PRICE_DEPTH; ang = 90; } else if (i < 30) { fy = PRICE_DEPTH; ang = 180; } else { fx = 1 - PRICE_DEPTH; ang = -90; }
    const [x, y] = rotPt(BOX + fx * BSZ, BOY + fy * BSZ);
    const t = document.createElement('div'); t.className = 'ptag'; t.textContent = '$' + info[2]; t.title = name + ' costs ' + info[2] + ' Sovereigns';
    const ow = ST.owner[name]; if (ow != null && P(ow)) { t.classList.add('owned'); t.style.background = colorOfSeat(ow); t.title = name + ' is owned by ' + nameOf(ow); }
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.transform = 'translate(-50%,-50%) rotate(' + (ang - 90 * rot) + 'deg)';
    after.after(t);
  }
}

/* ------------------------------------------------------------------ dice */
function renderDice(first) {
  const dice = [...document.querySelectorAll('#inv .die')], total = ST.dice[0] + ST.dice[1] + 2;
  const settle = () => { dice.forEach((d, i) => { d.textContent = F[ST.dice[i]]; }); $('diceLbl').textContent = '= ' + (ST.dice[0] + ST.dice[1] + 2); };
  if (first || ST.rollN === lastRoll) { if (first || !renderDice.busy) settle(); lastRoll = ST.rollN; return; }
  lastRoll = ST.rollN; renderDice.busy = true; let n = 0;
  const iv = setInterval(() => { dice.forEach(d => { d.textContent = F[Math.floor(Math.random() * 6)]; }); if (++n > 8) { clearInterval(iv); renderDice.busy = false; settle(); } }, 60);
}
const rollNow = () => send({ t: 'roll' });
document.querySelectorAll('#inv .die').forEach(d => { d.onclick = rollNow; d.onkeydown = k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); rollNow(); } }; });
$('invRoll').onclick = rollNow;

/* ------------------------------------------------------------------ bottom bar, players strip, log */
function renderBar() {
  const p = me(); $('invDot').style.background = p.color || '#cccccc';
  $('invName').textContent = p.char ? p.nick + ' · ' + p.char : p.nick;
  $('purseTotal').textContent = '$' + p.money;
  const order = colorOrder(), box = $('invLands'); box.innerHTML = '';
  if (!p.lands.length) box.innerHTML = '<span class="inone">None yet</span>';
  order.forEach(col => {
    const mine = p.lands.filter(n => landInfo(n)[1] === col); if (!mine.length) return;
    const of = cfg.lands.filter(l => l[1] === col).length, s = document.createElement('button');
    s.type = 'button'; s.className = 'iland' + (mine.length === of ? ' full' : ''); s.style.setProperty('--c', col); s.textContent = mine.length + '/' + of;
    s.title = (mine.length === of ? 'Full set: ' : '') + mine.join(', '); s.onclick = () => setHand(true); box.appendChild(s);
  });
  const qb = $('invQuests'); qb.textContent = p.nQuests; qb.dataset.n = p.nQuests;
  document.querySelectorAll('.bdeck').forEach(b => { const k = b.id.replace('bdeck-', ''); b.classList.toggle('empty', !ST.decks[k]); });
}
function renderPlist() {
  const bar = $('plist'); bar.innerHTML = '';
  ST.players.forEach(p => {
    if (!p) return;
    const c = document.createElement('div'); c.className = 'pc' + (p.seat === seat ? ' me' : '') + (p.online ? '' : ' off');
    const bits = ['$' + p.money]; if (p.lands.length) bits.push(p.lands.length + (p.lands.length === 1 ? ' Land' : ' Lands'));
    if (p.nQuests) bits.push(p.nQuests + (p.nQuests === 1 ? ' Quest' : ' Quests') + ' hidden'); if (p.kept.length) bits.push(p.kept.length + ' kept');
    c.innerHTML = '<i></i><span></span><b></b>'; c.querySelector('i').style.background = p.color || '#ccc';
    c.querySelector('span').textContent = p.nick + (p.char ? ' (' + p.char + ')' : '') + (p.online ? '' : ' · away'); c.querySelector('b').textContent = bits.join(', ');
    if (p.kept.length) c.title = 'Kept: ' + p.kept.map(k => k.text).join(' | ');
    bar.appendChild(c);
  });
  if (ST.pot > 0) { const b = document.createElement('button'); b.type = 'button'; b.className = 'potbtn'; b.textContent = 'On the board: $' + ST.pot + ' · Take'; b.onclick = () => send({ t: 'takePot' }); bar.appendChild(b); }
}
function renderLog() {
  const last = ST.logs[ST.logs.length - 1]; $('total').textContent = last ? last.t : '';
  const Lg = $('logList'); if ($('logPanel').hidden) return;
  Lg.innerHTML = '';
  if (!ST.logs.length) { Lg.innerHTML = '<li class="lgempty">No moves yet. Roll the dice to start.</li>'; return; }
  ST.logs.slice().reverse().forEach((m, i) => {
    const li = document.createElement('li'); li.style.setProperty('--c', KIND_COLOR[m.k] || '#999'); if (i === 0) li.className = 'new';
    li.innerHTML = '<small></small><span></span>'; li.querySelector('small').textContent = '#' + m.n; li.querySelector('span').textContent = m.t; Lg.appendChild(li);
  });
}
{
  const T = $('total'), LP = $('logPanel'), SP = $('settingsPanel'), B = $('setBtn');
  const placeLog = () => { LP.style.top = ($('bar').getBoundingClientRect().bottom + 6) + 'px'; };
  const showLog = o => { LP.hidden = !o; T.setAttribute('aria-expanded', o); if (o) { SP.hidden = true; B.setAttribute('aria-expanded', 'false'); placeLog(); renderLog(); } };
  T.onclick = () => showLog(LP.hidden); T.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showLog(LP.hidden); } };
  LP.querySelector('.lgx').onclick = () => showLog(false);
  const placeSet = () => { const b = $('bar').getBoundingClientRect(), r = B.getBoundingClientRect(); SP.style.top = (b.bottom + 6) + 'px'; SP.style.left = Math.max(12, Math.min(r.left, innerWidth - SP.offsetWidth - 12)) + 'px'; };
  const showSet = o => { SP.hidden = !o; B.setAttribute('aria-expanded', o); if (o) { showLog(false); placeSet(); } };
  B.onclick = e => { e.stopPropagation(); showSet(SP.hidden); };
  SP.querySelector('.stx').onclick = () => showSet(false);
  document.addEventListener('pointerdown', e => { if (!SP.hidden && !e.target.closest('#settingsPanel,#setBtn')) showSet(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { if (!SP.hidden) showSet(false); $('deed').hidden = true; $('money').hidden = true; } });
  addEventListener('resize', () => { if (!SP.hidden) placeSet(); if (!LP.hidden) placeLog(); });
  // reset needs a second tap
  const rb = $('reset'); let armed = 0;
  const disarm = () => { armed = 0; clearTimeout(rb._t); rb.firstChild.textContent = 'Reset table'; rb.classList.remove('armed'); };
  rb.onclick = () => { if (!armed) { armed = 1; rb.firstChild.textContent = 'Tap again to reset the game for everyone'; rb.classList.add('armed'); rb._t = setTimeout(disarm, 3500); return; } disarm(); send({ t: 'reset' }); showSet(false); };
}
$('shuf').onclick = () => send({ t: 'shuffle' });

/* ------------------------------------------------------------------ deed, hand panel */
function rentList(name, col) {
  const row = (a, b, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '><span>' + a + '</span><b>' + b + '</b></li>';
  const r = cfg.rents[name];
  if (r) { const tc = cfg.tavernCost[col] || 0;
    return '<ul class="olist">' + row('Rent', '$' + r[0]) + row('Full color set', '$' + (r[0] * 2), 'sub') + row('<i class="tv t-tavern"></i>1 Tavern', '$' + r[1]) + row('<i class="tv t-tavern"></i><i class="tv t-tavern"></i>2 Taverns', '$' + r[2]) + row('<i class="tv t-tavern"></i><i class="tv t-tavern"></i><i class="tv t-tavern"></i>3 Taverns', '$' + r[3]) + row('<i class="kp t-keep"></i>Keep', '$' + r[4], 'keep') + '</ul><div class="orent">Taverns cost $' + tc + ' each. A Keep costs $' + tc + ' more and replaces 3 Taverns.</div>'; }
  if (/Checkpoint/.test(name)) return '<ul class="olist">' + cfg.checkpointRent.map((v, i) => row((i + 1) + (i ? ' Checkpoints owned' : ' Checkpoint owned'), '$' + v)).join('') + '</ul>';
  return '<ul class="olist">' + row('One Monument owned', '4× dice') + row('Both Monuments owned', '10× dice') + '</ul>';
}
function openDeed(name, anchor) {
  const info = landInfo(name); if (!info) return;
  const col = info[1], pr = info[2], D = $('deed'), row = (a, b, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + a + '</td><td>$' + b + '</td></tr>';
  let body = '';
  if (cfg.rents[name]) { const r = cfg.rents[name], tc = cfg.tavernCost[col] || 0;
    body = '<table>' + row('Rent', r[0]) + row('Rent with the full color set', r[0] * 2, 'sub') + row('With 1 Tavern', r[1]) + row('With 2 Taverns', r[2]) + row('With 3 Taverns', r[3]) + row('With a Keep', r[4], 'keep') + '</table>'
      + '<p>Taverns cost <b>$' + tc + '</b> each. A Keep needs 3 Taverns first and costs <b>$' + tc + '</b> more; the 3 Taverns go back to the supply.</p>'; }
  else if (/Checkpoint/.test(name)) body = '<table>' + cfg.checkpointRent.map((v, i) => row('If ' + (i + 1) + (i ? ' Checkpoints are' : ' Checkpoint is') + ' owned', v)).join('') + '</table><p>Checkpoints can’t hold Taverns or Keeps.</p>';
  else body = '<p class="big">Rent is <b>4×</b> the dice roll if one Monument is owned, or <b>10×</b> the dice roll if both are.</p><p>Monuments can’t hold Taverns or Keeps.</p>';
  D.innerHTML = '<div class="dhead"><span></span><button type="button" aria-label="Close">✕</button></div><div class="dprice">Price <b>$' + pr + '</b>' + (ST.owner[name] != null ? ' · owned by ' + esc(nameOf(ST.owner[name])) : '') + '</div>' + body;
  D.querySelector('.dhead').style.background = col; D.querySelector('.dhead span').textContent = name;
  if (['#f2c244', '#d1bd61'].includes(col)) D.querySelector('.dhead').style.color = '#232a45';
  const HP = $('handPanel');
  D.querySelector('button').onclick = () => { D.hidden = true; HP.style.maxHeight = ''; };
  D.hidden = false; D.classList.toggle('up', !!anchor);
  if (anchor) {
    HP.style.maxHeight = ''; const pr2 = HP.getBoundingClientRect();
    D.style.width = pr2.width + 'px'; D.style.right = (innerWidth - pr2.right) + 'px';
    const place = () => { D.style.bottom = (innerHeight - HP.getBoundingClientRect().top + 8) + 'px'; }; place();
    if (D.getBoundingClientRect().top < 8) { HP.style.maxHeight = Math.max(150, innerHeight - 86 - D.getBoundingClientRect().height - 24) + 'px'; place(); }
  } else { D.style.width = D.style.right = D.style.bottom = ''; HP.style.maxHeight = ''; }
  D.querySelector('button').focus();
}
function setHand(open) {
  const HP = $('handPanel'); HP.hidden = !open; if (!open) { $('deed').hidden = true; HP.style.maxHeight = ''; }
  $('invHandTxt').textContent = open ? 'Hide hand' : 'Show hand'; $('invHand').setAttribute('aria-pressed', open);
  if (open) renderHand();
}
function renderHand() {
  const HP = $('handPanel'), p = me(), groups = colorOrder();
  const lands = p.lands.slice().sort((a, b) => groups.indexOf(landInfo(a)[1]) - groups.indexOf(landInfo(b)[1]) || landInfo(a)[2] - landInfo(b)[2] || landOrder(a) - landOrder(b));
  HP.innerHTML = '<div class="hphead"><span>Your hand</span><button type="button" class="hpx" aria-label="Close">✕</button></div>';
  const sec = (title, list, empty, mk) => { const s = document.createElement('section'); s.innerHTML = '<h3></h3>'; s.querySelector('h3').textContent = title + (list.length ? ' (' + list.length + ')' : '');
    if (!list.length) { const q = document.createElement('p'); q.className = 'hpempty'; q.textContent = empty; s.appendChild(q); } else list.forEach(c => s.appendChild(mk(c))); HP.appendChild(s); };
  const row = (color, label, price, acts, deed) => {
    const r = document.createElement('div'); r.className = 'hprow'; r.style.setProperty('--c', color);
    const n = document.createElement('button'); n.type = 'button'; n.className = 'hpname'; n.textContent = label; if (deed) { n.title = 'Open the deed'; n.onclick = () => openDeed(deed, true); } else n.disabled = true; r.appendChild(n);
    if (price) { const b = document.createElement('b'); b.textContent = price; r.appendChild(b); }
    acts.forEach(([t, fn]) => { const a = document.createElement('button'); a.type = 'button'; a.className = 'hpact'; a.textContent = t; a.onclick = fn; r.appendChild(a); }); return r; };
  const dcol = k => cfg.decks.find(d => d.key === k).color;
  sec('Lands', lands, 'No Lands yet.', n => row(landInfo(n)[1], n, '$' + landInfo(n)[2], [], n));
  sec('Quests', ST.me.quests, 'No Quests. Draw one from the Quest deck.', c => row(dcol('quest'), c.text, '', [['Play', () => send({ t: 'play', card: c.id })]]));
  if (p.kept.length) sec('Kept cards', p.kept, '', c => row(dcol(c.deck), c.text, '', [['Bottom of deck', () => send({ t: 'toBottom', card: c.id })], ['Play', () => send({ t: 'play', card: c.id })]]));
  const note = document.createElement('p'); note.className = 'hpnote'; note.textContent = 'Only you can see your Quests. Drag a card from the table onto the bar below to keep it.'; HP.appendChild(note);
  HP.querySelector('.hpx').onclick = () => setHand(false);
}
$('invHand').onclick = () => setHand($('handPanel').hidden);
$('invWho').onclick = () => openLobby();
$('invPay').onclick = () => openMoney('pay');
$('invCollect').onclick = () => openMoney('collect');

/* ------------------------------------------------------------------ pay / collect panel */
function openMoney(kind) {
  const M = $('money'), others = ST.players.filter(p => p && p.seat !== seat && p.char);
  M.innerHTML = '<div class="mhead"><span>' + (kind === 'pay' ? 'Pay' : 'Collect from the bank') + '</span><button type="button" aria-label="Close">✕</button></div>'
    + '<label for="mamt">Amount</label><div class="mrow"><span class="dollar">$</span><input id="mamt" type="number" inputmode="numeric" min="5" step="5" placeholder="0"></div>'
    + '<div class="mquick">' + [5, 10, 50, 100, 500].map(v => '<button type="button" data-v="' + v + '">+' + v + '</button>').join('') + '<button type="button" data-v="0">Clear</button></div>'
    + (kind === 'pay' ? '<div class="mto">Pay to</div><div class="mdest" role="radiogroup" aria-label="Pay to">' + others.map((p, i) => '<label class="pchip"><input type="radio" name="mdest" value="p' + p.seat + '"' + (i === 0 ? ' checked' : '') + '><i style="background:' + p.color + '"></i>' + esc(p.nick) + '</label>').join('')
      + '<label class="pchip"><input type="radio" name="mdest" value="board"' + (others.length ? '' : ' checked') + '><i style="background:#fff8e1"></i>The board</label><label class="pchip"><input type="radio" name="mdest" value="bank"><i style="background:var(--ink)"></i>The bank</label></div>' : '')
    + '<p class="mnote" aria-live="polite"></p><button type="button" class="mgo">' + (kind === 'pay' ? 'Pay' : 'Collect') + '</button>';
  const amt = M.querySelector('#mamt'), note = M.querySelector('.mnote'), go = M.querySelector('.mgo');
  const preview = () => { const a = +amt.value || 0; go.disabled = !(a > 0 && a % 5 === 0);
    if (!a) { note.textContent = kind === 'pay' ? 'You have $' + money() + '.' : ''; go.textContent = kind === 'pay' ? 'Pay' : 'Collect'; return; }
    if (a % 5) { note.textContent = 'Amounts go up in 5s.'; return; }
    if (kind === 'collect') { note.textContent = 'The bank gives you ' + coinWords(greedy(a)) + '.'; go.textContent = 'Collect $' + a; return; }
    const pl = planPayment(a, myPurse()); if (!pl) { note.textContent = 'Not enough Sovereigns: you have $' + money() + '.'; go.disabled = true; return; }
    note.textContent = 'You hand over ' + coinWords(pl.pay) + (pl.change ? ' and get $' + pl.change + ' change (' + coinWords(greedy(pl.change)) + ').' : '.'); go.textContent = 'Pay $' + a; };
  amt.oninput = preview;
  M.querySelectorAll('.mquick button').forEach(b => b.onclick = () => { amt.value = +b.dataset.v ? (+amt.value || 0) + (+b.dataset.v) : ''; preview(); amt.focus(); });
  M.querySelector('.mhead button').onclick = () => { M.hidden = true; };
  amt.onkeydown = e => { if (e.key === 'Enter' && !go.disabled) go.click(); };
  go.onclick = () => { const a = +amt.value; if (kind === 'collect') send({ t: 'collect', amt: a }); else send({ t: 'pay', amt: a, to: (M.querySelector('input[name=mdest]:checked') || {}).value }); M.hidden = true; };
  M.hidden = false; preview(); setTimeout(() => amt.focus(), 30);
}

/* ------------------------------------------------------------------ cards in the middle of the board: buy / auction, rent, bidding */
let boxSig = {};
function mkBox(key, name, col) {
  const box = document.createElement('div'); box.className = 'offer'; box.dataset.key = key; box.setAttribute('role', 'dialog');
  Object.assign(box.style, { left: BCX + 'px', top: BCY + 'px' }); stage.appendChild(box); return box;
}
function head(box, text, col) {
  box.querySelector('.ohead').style.background = col; box.querySelector('.ohead span').textContent = text;
  if (col === '#f2c244') box.querySelector('.ohead').style.color = '#232a45';
}
function renderBoxes() {
  const want = {};
  const o = ST.me && ST.me.offer, rent = ST.me && ST.me.rent, au = ST.auction;
  const inAuction = au && au.people.includes(seat);
  if (o && !au) want.offer = JSON.stringify([o.name, o.price, money() >= o.price]);
  if (rent) want.rent = JSON.stringify([rent.name, rent.amt, money()]);
  if (inAuction) want.auction = JSON.stringify([au.name, au.high, au.leader, au.turn === seat, au.turn, au.log, money() >= au.high + 5, au.active.includes(seat)]);
  ['offer', 'rent', 'auction'].forEach(k => {
    const ex = stage.querySelector('.offer[data-key="' + k + '"]');
    if (!want[k]) { if (ex) ex.remove(); delete boxSig[k]; return; }
    if (ex && boxSig[k] === want[k]) return;
    if (ex) ex.remove(); boxSig[k] = want[k];
    if (k === 'offer') buildOffer(o); else if (k === 'rent') buildRent(rent); else buildAuction(au);
  });
}
function buildOffer(o) {
  const col = landInfo(o.name)[1], box = mkBox('offer'), can = money() >= o.price;
  box.setAttribute('aria-label', o.name + ' is for sale');
  box.innerHTML = '<div class="ohead"><span></span></div><div class="oprice">Price <b>$' + o.price + '</b></div>' + rentList(o.name, col)
    + '<div class="obody"><p>' + esc(me().nick) + ' landed on ' + esc(o.name) + '. Buy it for full price, or put it up for auction.</p>'
    + '<div class="obtns"><button type="button" class="obuy"' + (can ? '' : ' disabled') + '>Buy for $' + o.price + '</button><button type="button" class="oauc">Auction</button></div>'
    + (can ? '' : '<p class="owarn">You need $' + o.price + ' to buy it. You have $' + money() + '.</p>') + '</div>';
  head(box, o.name, col);
  box.querySelector('.obuy').onclick = () => send({ t: 'buy' }); box.querySelector('.oauc').onclick = () => send({ t: 'auction' });
  const b = box.querySelector('.obuy:not([disabled])'); if (b) b.focus();
}
function buildRent(r) {
  const col = landInfo(r.name)[1], box = mkBox('rent'), have = money(), pay = Math.min(r.amt, have);
  box.classList.add('rent'); box.setAttribute('aria-label', 'Rent due on ' + r.name);
  box.innerHTML = '<div class="ohead"><span></span></div><div class="oprice">Rent due <b>$' + r.amt + '</b></div>'
    + '<div class="orent">Owned by <b>' + esc(nameOf(r.owner)) + '</b>. ' + esc(r.why) + (r.rounded ? ' (rounded up to the nearest $5)' : '') + '.</div>' + rentList(r.name, col)
    + '<div class="obody"><div class="obtns"><button type="button" class="obuy">' + (pay < r.amt ? 'Pay $' + pay + ' (all you have)' : 'Pay $' + r.amt) + '</button></div>'
    + (pay < r.amt ? '<p class="owarn">You are $' + (r.amt - pay) + ' short. You have $' + have + '.</p>' : '') + '</div>';
  head(box, r.name + ' · rent', col);
  box.querySelector('.obuy').onclick = () => send({ t: 'payRent' }); box.querySelector('.obuy').focus();
}
function buildAuction(a) {
  const col = landInfo(a.name)[1], box = mkBox('auction'), mine = a.turn === seat, myMax = money();
  box.setAttribute('aria-label', 'Auction for ' + a.name);
  box.innerHTML = '<div class="ohead"><span></span></div><div class="oprice">Price <b>$' + a.price + '</b></div>' + rentList(a.name, col)
    + '<div class="obody"><div class="ohigh">' + (a.leader != null ? 'High bid <b>$' + a.high + '</b> by ' + esc(nameOf(a.leader)) : 'No bids yet') + '</div>'
    + '<ul class="olog">' + a.log.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>'
    + (mine ? '<div class="obids">' + [5, 10, 50].map(d => { const v = a.high + d; return '<button type="button" data-v="' + v + '"' + (v > myMax ? ' disabled' : '') + '>Bid $' + v + '</button>'; }).join('')
      + '</div><div class="ocustom"><span>$</span><input type="number" min="' + (a.high + 5) + '" step="5" placeholder="' + (a.high + 5) + '" aria-label="Your bid"><button type="button" class="obid">Bid</button></div><button type="button" class="opass">Pass</button><p class="owait otimer"></p>'
      : '<p class="owait">' + (a.active.includes(seat) ? 'Waiting for ' + esc(nameOf(a.turn)) + '…' : 'You passed. Waiting for the auction to finish…') + '</p>') + '</div>';
  head(box, a.name + ' auction', col);
  if (mine) {
    const bid = v => { v = +v; if (!(v > a.high) || v % 5 || v > money()) return; send({ t: 'bid', amt: v }); };
    box.querySelectorAll('.obids button').forEach(b => b.onclick = () => bid(b.dataset.v));
    const inp = box.querySelector('.ocustom input'); box.querySelector('.obid').onclick = () => bid(inp.value); inp.onkeydown = e => { if (e.key === 'Enter') bid(inp.value); };
    box.querySelector('.opass').onclick = () => send({ t: 'pass' });
    const f = box.querySelector('.obids button:not([disabled])'); if (f) f.focus();
  }
}
setInterval(() => {
  const t = document.querySelector('.offer .otimer'); if (!t || !ST || !ST.auction) return;
  const s = Math.max(0, Math.ceil((ST.auction.deadline - (Date.now() + skew)) / 1000)); t.textContent = s + 's left to bid or pass';
}, 500);

/* ------------------------------------------------------------------ character page */
let pickChar = null, pickCol = '';
function openLobby() {
  const p = me(); if (!p || !cfg) return;
  pickChar = p.char; pickCol = p.color || ''; $('nick').value = p.nick || ''; $('lobby').hidden = false; refreshLobby(true);
  setTimeout(() => (pickChar ? $('nick') : document.querySelector('#charGrid .cpick:not(.taken)')).focus(), 50);
}
function refreshLobby(rebuild) {
  const taken = ch => ST.players.some(p => p && p.seat !== seat && p.char === ch), takenCol = c => ST.players.some(p => p && p.seat !== seat && p.color === c);
  const grid = $('charGrid'), cg = $('colorGrid'), go = $('startBtn'), nick = $('nick');
  if (pickChar && taken(pickChar)) pickChar = null; if (pickCol && takenCol(pickCol)) pickCol = '';
  const paint = () => {
    grid.querySelectorAll('.cpick').forEach(x => { x.style.setProperty('--ring', pickCol || '#c9c3ad'); x.setAttribute('aria-pressed', x.dataset.n === pickChar); x.classList.toggle('taken', taken(x.dataset.n)); x.disabled = taken(x.dataset.n); });
    cg.querySelectorAll('.swatch').forEach(s => { s.setAttribute('aria-checked', s.dataset.c === pickCol); s.classList.toggle('taken', takenCol(s.dataset.c)); s.disabled = takenCol(s.dataset.c); });
    go.disabled = !(pickChar && pickCol && nick.value.trim()); go.textContent = !pickCol ? 'Choose a color' : !pickChar ? 'Choose a character' : 'Play as ' + pickChar;
  };
  if (rebuild || !grid.children.length) {
    grid.innerHTML = ''; cg.innerHTML = '';
    cfg.ringColors.forEach(([nm, c]) => { const s = document.createElement('button'); s.type = 'button'; s.className = 'swatch'; s.setAttribute('role', 'radio'); s.dataset.c = c; s.title = nm; s.setAttribute('aria-label', nm); s.style.background = c; s.onclick = () => { pickCol = c; paint(); }; cg.appendChild(s); });
    cfg.characters.forEach(n => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cpick'; b.dataset.n = n; b.innerHTML = '<img alt=""><span></span>'; b.querySelector('img').src = 'assets/pieces/plain-' + n.toLowerCase() + '.png'; b.querySelector('span').textContent = n; b.onclick = () => { pickChar = n; paint(); }; grid.appendChild(b); });
    nick.oninput = paint;
    $('lobbyForm').onsubmit = e => { e.preventDefault(); if (go.disabled) return; send({ t: 'pick', char: pickChar, color: pickCol, nick: nick.value.trim() }); $('lobby').hidden = true; };
  }
  paint();
}

/* ------------------------------------------------------------------ dragging things on the table */
const overBar = d => { const r = $('inv').getBoundingClientRect(); return d && d.cy != null && d.cy >= r.top - 6 && d.cx >= r.left && d.cx <= r.right; };
function railDeck(d) {
  if (!d) return null;
  for (const k of ['quest', 'fate', 'chest']) { const r = $('bdeck-' + k).getBoundingClientRect(); if (d.cx > r.left - 12 && d.cx < r.right + 12 && d.cy > r.top - 12 && d.cy < r.bottom + 12) return k; }
  return null;
}
function elCenter(el) { return [parseFloat(el.style.left) + el.offsetWidth / 2, parseFloat(el.style.top) + el.offsetHeight / 2]; }
const bndSend = (() => { let last = 0; return (id, el, force) => {
  const now = Date.now(); if (!force && now - last < 50) return; last = now;
  const [bx, by] = toBoard(parseFloat(el.style.left), parseFloat(el.style.top), el.offsetWidth, el.offsetHeight); send({ t: 'move', id, bx, by });
}; })();
stage.addEventListener('pointerdown', e => {
  const el = e.target.closest('.obj'); if (!el || el.classList.contains('fixed')) return;
  const kind = el.dataset.k;
  if (kind === 'pawn' && +el.dataset.seat !== seat) return;
  let target = el, id = el.dataset.id;
  if (kind === 'tok' && el._n > 1 && !e.shiftKey) {
    id = 'u' + seat + '_' + (++uid) + '_' + Date.now().toString(36); pending[id] = 1;
    const c = document.createElement('div'); c.className = 'tok obj t-' + el.dataset.tok; c.dataset.id = id; c.dataset.k = 'tok'; c.dataset.tok = el.dataset.tok;
    c.style.left = el.style.left; c.style.top = el.style.top; setN(c, 1); setN(el, el._n - 1); stage.appendChild(c); els[id] = c; target = c;
    send({ t: 'split', id: el.dataset.id, newId: id });
  }
  target.setPointerCapture(e.pointerId);
  drag = { el: target, id, kind, sx: e.clientX, sy: e.clientY, ox: parseFloat(target.style.left), oy: parseFloat(target.style.top), moved: false, tap: el._tap, cx: e.clientX, cy: e.clientY, ghost: null, name: el.dataset.name };
  target.style.zIndex = 9000; if (id) send({ t: 'lift', id });
});
stage.addEventListener('pointermove', e => {
  if (!drag) return; drag.cx = e.clientX; drag.cy = e.clientY;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    drag.moved = true;
    if (drag.kind === 'bank') { // pull a Land out of the bank as a card that follows the pointer
      const g = document.createElement('div'); g.className = 'card k-land ghostcard'; g.style.setProperty('--c', landInfo(drag.name)[1]);
      g.innerHTML = '<em>Land</em><span>' + esc(drag.name) + '</span><i class="pr">$' + landInfo(drag.name)[2] + '</i>'; stage.appendChild(g); drag.ghost = g;
    } else drag.el.classList.add('lift');
  }
  if (!drag.moved) return;
  const r = stage.getBoundingClientRect(), o = drag.ghost || drag.el;
  if (drag.ghost) { o.style.left = ((e.clientX - r.left) / S - 55) + 'px'; o.style.top = ((e.clientY - r.top) / S - 55) + 'px'; }
  else { o.style.left = Math.max(vx(), Math.min(W - o.offsetWidth, drag.ox + dx / S)) + 'px'; o.style.top = Math.max(0, Math.min(H - o.offsetHeight, drag.oy + dy / S)) + 'px'; }
  const dk = drag.kind === 'card' && drag.el.dataset.d !== 'quest' ? railDeck(drag) : null;
  document.querySelectorAll('.bdeck').forEach(b => b.classList.toggle('hot', b.id === 'bdeck-' + dk));
  $('inv').classList.toggle('hot', !dk && overBar(drag) && (drag.kind === 'card' || drag.kind === 'tok' || drag.kind === 'bank'));
  if (drag.kind === 'tok' || drag.kind === 'card') bndSend(drag.id, drag.el);
});
function endDrag(e) {
  if (!drag) return; const d = drag; drag = null;
  document.querySelectorAll('.bdeck').forEach(b => b.classList.remove('hot')); $('inv').classList.remove('hot');
  d.el.classList.remove('lift'); if (d.ghost) d.ghost.remove();
  if (!d.moved) { if (d.tap) d.tap(); if (ST) { renderPieces(); renderObjs(); renderBank(); } return; }
  if (d.kind === 'bank') { if (overBar(d)) send({ t: 'bankTake', name: d.name }); renderBank(); return; }
  if (d.kind === 'pawn') {
    const [cx, cy] = elCenter(d.el); let best = -1, bd = 1e9, jail = false;
    if (inBoard(cx, cy)) { for (let i = 0; i < 40; i++) { const [x, y] = tileXY(i), dd = Math.hypot(x - cx, y - cy + 0); if (dd < bd) { bd = dd; best = i; } }
      const [jx, jy] = tileXY(10, true), jd = Math.hypot(jx - cx, jy - cy); if (jd < bd) { best = 10; jail = true; } }
    if (best >= 0) send({ t: 'place', tile: best, jail }); else renderPieces();
    return;
  }
  const dk = d.kind === 'card' && d.el.dataset.d !== 'quest' ? railDeck(d) : null;
  if (d.kind === 'card') {
    if (dk && dk === d.el.dataset.d) { send({ t: 'toBottom', id: d.id }); return; }
    if (overBar(d)) { send({ t: 'take', id: d.id }); return; }
    bndSend(d.id, d.el, true); return;
  }
  if (d.kind === 'tok') {
    if (overBar(d)) { send({ t: 'del', id: d.id }); d.el.remove(); delete els[d.id]; return; }
    const [cx, cy] = elCenter(d.el); let best = null, bd = 26;
    stage.querySelectorAll('.tok.obj[data-tok="' + d.el.dataset.tok + '"]').forEach(t => { if (t === d.el) return; const [tx, ty] = elCenter(t), dd = Math.hypot(tx - cx, ty - cy); if (dd < bd) { bd = dd; best = t; } });
    if (best) { send({ t: 'merge', id: d.id, into: best.dataset.id }); d.el.remove(); delete els[d.id]; return; }
    bndSend(d.id, d.el, true);
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', () => { if (drag) { drag.el.classList.remove('lift'); if (drag.ghost) drag.ghost.remove(); drag = null; if (ST) { renderPieces(); renderObjs(); renderBank(); } } });
// Taverns and Keeps from the bar
document.querySelectorAll('#inv .btok').forEach(src => src.addEventListener('pointerdown', e => {
  e.preventDefault(); if (!ST) return;
  const r = stage.getBoundingClientRect(), id = 'u' + seat + '_' + (++uid) + '_' + Date.now().toString(36); pending[id] = 1;
  const c = document.createElement('div'); c.className = 'tok obj t-' + src.dataset.src; c.dataset.id = id; c.dataset.k = 'tok'; c.dataset.tok = src.dataset.src; setN(c, 1);
  const x = (e.clientX - r.left) / S - 17, y = (e.clientY - r.top) / S - 17; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.zIndex = 9000; stage.appendChild(c); els[id] = c;
  const [bx, by] = toBoard(x, y, 34, 34); send({ t: 'spawn', id, tok: src.dataset.src, bx, by });
  c.setPointerCapture(e.pointerId);
  drag = { el: c, id, kind: 'tok', sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false, cx: e.clientX, cy: e.clientY, ghost: null };
}));

/* ------------------------------------------------------------------ board rotation, bar toggle, full screen, tutorial */
$('rotBtn').onclick = () => {
  rot++; stage.classList.add('turning'); $('board').style.transform = 'rotate(' + (-rot * 90) + 'deg)';
  if (ST) { renderPieces(); renderObjs(); renderTags(); }
  clearTimeout(stage._turn); stage._turn = setTimeout(() => stage.classList.remove('turning'), 450);
};
{
  const bar = $('bar'), bt = $('barToggle');
  const setBar = mini => { bar.classList.toggle('mini', mini); bt.textContent = mini ? '☰' : '▴'; bt.setAttribute('aria-expanded', !mini); bt.title = mini ? 'Show the toolbar buttons' : 'Hide the toolbar buttons'; store.set('barMini', mini ? '1' : '0'); };
  let m = PORTRAIT || innerWidth < 700; const s = store.get('barMini'); if (s != null) m = s === '1';
  setBar(m); bt.onclick = () => setBar(!bar.classList.contains('mini'));
}
{
  const fb = $('fsBtn'), de = document.documentElement;
  if (!(de.requestFullscreen || de.webkitRequestFullscreen) || document.fullscreenEnabled === false) fb.style.display = 'none';
  fb.onclick = () => { const on = document.fullscreenElement || document.webkitFullscreenElement;
    try { const r = on ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (de.requestFullscreen || de.webkitRequestFullscreen).call(de); if (r && r.catch) r.catch(() => { fb.style.display = 'none'; }); } catch (e) { fb.style.display = 'none'; } };
  const sync = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); fb.firstChild.textContent = on ? 'Exit full screen' : 'Full screen'; fb.classList.toggle('on', on); setTimeout(fit, 60); };
  document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
}
try { const ib = $('inv'), sync = () => document.documentElement.style.setProperty('--invh', ib.getBoundingClientRect().height + 'px'); new ResizeObserver(sync).observe(ib); sync(); } catch (e) {}

const TUTORIAL = [
  { h: 'Playing together', items: [
    'Share the room link (the Invite button) with your friends. Everyone opens it, types a name, and picks a color and a character. The room code is next to the Invite button.',
    'The server keeps the game fair: money, lands, rent and auctions are tracked for everyone, and only you can see your own Quest cards. Everyone else just sees how many you hold.',
    'Refreshing the page or losing your connection is safe: you rejoin the same seat with your hand and money.',
    'The top-right line shows the latest move. Click it to open the Move log, a numbered history of everything that happened, so you can check the board whenever things get confusing.'] },
  { h: 'Taking a turn', items: [
    'There are no enforced turns, so the table decides who goes next. Press Roll (or tap a die) to roll both dice. Your character hops that many spaces clockwise from Avalon Gate.',
    'Land on a Land nobody owns and a card appears in the middle of the board: buy it for full price, or auction it. Everyone connected bids in turn (+5, +10, +50 or a typed amount) or passes, and the highest bidder pays the bank. Bidders have 40 seconds per turn.',
    'Land on a Land another player owns and a Rent card appears. Rent counts the Taverns and Keeps on the space, a full color set doubles bare rent, Checkpoints count how many are owned, and Monuments pay 4× or 10× the roll. Press Pay to hand it over. You have to settle a card before you roll again.',
    'Land on To the Dungeon and you go straight to the Dungeon. Your next roll moves you out.',
    'You can drag your own character to any space if the table agrees to move it.'] },
  { h: 'Money, lands and cards', items: [
    'Everyone starts with $1500 in Sovereigns. Pay hands money to another player, the board, or the bank, and makes change automatically. Collect takes money from the bank. Money paid to the board sits in a pot anyone can take.',
    'Your Lands and money are in the bottom bar. Show hand opens your Lands, Quests and any cards you kept. Tap a Land for its deed.',
    'The decks are on the right edge. Tap one to draw. Quests go straight to your hand and stay secret. Fate and Treasure Chest cards land face up in the middle of the board for everyone to read.',
    'Drag a Fate or Treasure Chest card back onto its deck to put it on the bottom. Drag any card from the table onto the bottom bar to keep it.',
    'Drag Taverns and Keeps from Build in the bar onto the board. Drop one on another of the same kind to stack them. Drop one back on the bar to remove it.',
    'Drag a Land out of the Land bank onto the bottom bar to take it without paying.'] },
  { h: 'Getting around', items: [
    'Zoom with the scroll wheel or by pinching, and drag the empty table to pan. Fit view resets the camera. Rotate board turns your view a quarter turn so you can follow your piece; it only changes your own screen.',
    'Settings holds Tutorial mode, Full screen and Reset table. Reset starts the whole game over for everyone, so it asks for a second tap.'] }
];
{
  const tut = $('tutorial'), tb = $('tut');
  tut.innerHTML = TUTORIAL.map(s => '<h2>' + s.h + '</h2><ul>' + s.items.map(i => '<li>' + i + '</li>').join('') + '</ul>').join('');
  tut.addEventListener('pointerdown', e => e.stopPropagation()); tut.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  tb.onclick = () => { const on = tut.hidden; tut.hidden = !on; tb.classList.toggle('on', on); tb.setAttribute('aria-pressed', on); };
}
fit();
})();
