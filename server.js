// Tabletop Online: a small multiplayer server for the board game.
// Serves the game from /public and keeps every room's game in memory.
// The server owns the money, lands, positions, rent, auctions and secret Quest cards,
// so every player sees the same fair game. Rooms reset when the server restarts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./cards');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_SEATS = 8;
const MAX_OBJS = 600;
const COINS = ['5', '10', '50', '100', '500'];
const AUCTION_MS = 40000;
const HOP_MS = 190;

const LAND = Object.fromEntries(G.lands.map(([name, color, price], i) => [name, { name, color, price, i }]));
const SET_OF = color => G.lands.filter(l => l[1] === color).map(l => l[0]);

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400'
    });
    fs.createReadStream(file).pipe(res);
  });
});

/* ---------- small helpers ---------- */
const rooms = new Map();
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const okId = id => typeof id === 'string' && /^[a-z0-9_-]{1,24}$/i.test(id);

/* ---------- board geometry (board coordinates: 0..900 from the board's top-left) ---------- */
const BC = 0.1537, BT = (1 - 2 * BC) / 9, BS = 900;
function tileFrac(i) {
  if (i === 0) return [1 - BC / 2, 1 - BC / 2]; if (i === 10) return [BC / 2, 1 - BC / 2];
  if (i === 20) return [BC / 2, BC / 2]; if (i === 30) return [1 - BC / 2, BC / 2];
  if (i < 10) return [1 - BC - (i - 0.5) * BT, 1 - BC / 2];
  if (i < 20) return [BC / 2, 1 - BC - (i - 10 - 0.5) * BT];
  if (i < 30) return [BC + (i - 20 - 0.5) * BT, BC / 2];
  return [1 - BC / 2, BC + (i - 30 - 0.5) * BT];
}
const TILE_XY = Array.from({ length: 40 }, (_, i) => tileFrac(i).map(v => v * BS));

/* ---------- money (coins are counted per denomination) ---------- */
const total = p => COINS.reduce((s, c) => s + (+c) * (p.purse[c] || 0), 0);
const totalOf = m => COINS.reduce((s, c) => s + (+c) * (m[c] || 0), 0);
function greedy(amount) {
  const out = {}; [...COINS].reverse().forEach(c => { const n = Math.floor(amount / +c); if (n) { out[c] = n; amount -= n * (+c); } });
  return out;
}
// the fewest coins from this purse that cover the amount; change comes back if it can't be exact
function planPayment(amount, purse) {
  const tot = totalOf(purse), best = new Array(tot / 5 + 1).fill(null); best[0] = { n: 0, use: {} };
  COINS.forEach(c => { const v = +c / 5; for (let k = 0; k < (purse[c] || 0); k++) for (let s = best.length - 1; s >= v; s--) {
    const pr = best[s - v]; if (pr && (!best[s] || pr.n + 1 < best[s].n)) best[s] = { n: pr.n + 1, use: { ...pr.use, [c]: (pr.use[c] || 0) + 1 } };
  } });
  for (let s = amount / 5; s < best.length; s++) if (best[s]) return { pay: best[s].use, change: s * 5 - amount };
  return null;
}
function addCoins(purse, m) { COINS.forEach(c => { purse[c] = (purse[c] || 0) + (m[c] || 0); }); }
// take `amount` out of a purse (with change back to the same purse). Returns false if it can't be paid.
function payFrom(purse, amount) {
  const pl = planPayment(amount, purse); if (!pl) return false;
  COINS.forEach(c => { purse[c] -= (pl.pay[c] || 0); });
  addCoins(purse, greedy(pl.change)); return true;
}

/* ---------- rooms and game state ---------- */
function newRoom(code) {
  const r = { code, seats: Array(MAX_SEATS).fill(null), clients: new Set(), emptySince: null, logs: [], logN: 0, evN: 0, rollN: 0, nextId: 1 };
  resetGame(r);
  rooms.set(code, r);
  return r;
}

function resetGame(r) {
  r.z = 10; r.objs = {}; r.cards = {}; r.decks = {}; r.owner = {}; r.pot = {}; r.auction = null; r.busyUntil = 0;
  r.dice = [0, 2]; r.ev = null; r.logs = []; r.logN = 0;
  let n = 0;
  G.decks.forEach(d => { r.decks[d.key] = shuffle(d.cards.map(text => { const id = 'k' + (n++); r.cards[id] = { id, deck: d.key, text }; return id; })); });
  r.seats.forEach(s => { if (s) { s.purse = { ...G.startPurse }; s.quests = []; s.kept = []; s.offer = null; s.rent = null; s.tile = s.char ? 0 : null; s.jail = false; } });
}

function put(r, o) { o.z = ++r.z; r.objs[o.id] = o; return o; }
function log(r, text, kind) { r.logs.push({ n: ++r.logN, t: text, k: kind || '' }); if (r.logs.length > 400) r.logs.shift(); }
const who = s => (s && (s.nick || s.name)) || 'Someone';
const deckName = key => G.decks.find(d => d.key === key).name;

function ownedBy(r, seat) { return Object.keys(r.owner).filter(n => r.owner[n] === seat); }

// Taverns and Keeps sitting on a space (a stack counts its number)
function buildingsOn(r, tile) {
  let t = 0, k = 0;
  for (const o of Object.values(r.objs)) {
    if (o.kind !== 'tok') continue;
    let best = -1, bd = 1e9;
    TILE_XY.forEach((p, j) => { const d = Math.hypot(p[0] - (o.bx + 17), p[1] - (o.by + 17)); if (d < bd) { bd = d; best = j; } });
    if (best !== tile || bd > 110) continue;
    if (o.tok === 'keep') k += o.n; else t += o.n;
  }
  return { t, k };
}

function rentFor(r, name, ownerSeat) {
  const mine = ownedBy(r, ownerSeat), dice = r.dice[0] + r.dice[1] + 2, L = LAND[name];
  if (/Monument/.test(name)) { const n = mine.filter(x => /Monument/.test(x)).length; return { amt: (n > 1 ? 10 : 4) * dice, why: (n > 1 ? 'Both Monuments owned: 10' : 'One Monument owned: 4') + ' × the roll of ' + dice }; }
  if (/Checkpoint/.test(name)) { const n = mine.filter(x => /Checkpoint/.test(x)).length; return { amt: G.CHECKPOINT_RENT[n - 1], why: n + (n > 1 ? ' Checkpoints' : ' Checkpoint') + ' owned' }; }
  const rent = G.RENTS[name]; if (!rent) return null;
  const b = buildingsOn(r, G.TILE_NAMES.indexOf(name));
  if (b.k) return { amt: rent[4], why: 'With a Keep' };
  if (b.t) return { amt: rent[Math.min(b.t, 3)], why: 'With ' + b.t + (b.t > 1 ? ' Taverns' : ' Tavern') };
  return SET_OF(L.color).every(n => mine.includes(n)) ? { amt: rent[0] * 2, why: 'No buildings, and they own the full color set (double)' } : { amt: rent[0], why: 'No buildings' };
}

/* ---------- what one seat is allowed to see ---------- */
function viewFor(r, seat) {
  const me = r.seats[seat];
  const cardText = id => ({ id, deck: r.cards[id].deck, text: r.cards[id].text });
  return {
    t: 'state', code: r.code, you: seat, logs: r.logs, logN: r.logN,
    players: r.seats.map((s, i) => s && {
      seat: i, name: s.name, nick: s.nick || s.name, char: s.char || null, color: s.color || null, online: s.online,
      money: total(s), lands: ownedBy(r, i), nQuests: s.quests.length, kept: s.kept.map(cardText), tile: s.tile, jail: s.jail
    }),
    me: me && {
      purse: me.purse, quests: me.quests.map(cardText),
      offer: me.offer, rent: me.rent
    },
    owner: r.owner,
    objs: Object.values(r.objs).map(o => o.kind === 'card' ? { ...o, deck: r.cards[o.card].deck, text: r.cards[o.card].text } : o),
    decks: Object.fromEntries(Object.entries(r.decks).map(([k, v]) => [k, v.length])),
    dice: r.dice, rollN: r.rollN, ev: r.ev, now: Date.now(),
    pot: totalOf(r.pot),
    auction: r.auction && { name: r.auction.name, price: r.auction.price, high: r.auction.high, leader: r.auction.leader,
      turn: r.auction.turn, deadline: r.auction.deadline, log: r.auction.log.slice(-4), people: r.auction.order, active: r.auction.active }
  };
}

function sendAll(r) {
  for (const ws of r.clients) if (ws.readyState === 1) ws.send(JSON.stringify(viewFor(r, ws.seat)));
}
function sendOthers(r, from, msg) {
  const s = JSON.stringify(msg);
  for (const ws of r.clients) if (ws !== from && ws.readyState === 1) ws.send(s);
}
function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

/* ---------- landing, buying, auctions, rent ---------- */
function land(r, seat, token) {
  const s = r.seats[seat]; if (!s || s.moveToken !== token || !s.char) return;
  const name = G.TILE_NAMES[s.tile], L = LAND[name];
  if (s.tile === 30) {
    s.jail = true; s.tile = 10; r.ev = { n: ++r.evN, seat, jail: true };
    log(r, who(s) + ' landed on To the Dungeon and was sent to the Dungeon!', 'move');
    return sendAll(r);
  }
  if (!L) return sendAll(r);
  const owner = r.owner[name];
  if (owner === undefined || owner === null) {
    s.offer = { name, price: L.price };
    log(r, who(s) + ' landed on ' + name + ', which is for sale for $' + L.price, 'move');
  } else if (owner === seat) {
    log(r, who(s) + ' landed on ' + name + ', which they own. No rent.', 'move');
  } else {
    const R = rentFor(r, name, owner); if (R) {
      const amt = Math.ceil(R.amt / 5) * 5;
      s.rent = { name, owner, amt, why: R.why, rounded: amt !== R.amt };
      log(r, who(s) + ' landed on ' + name + ', owned by ' + who(r.seats[owner]) + ': rent is $' + amt + ' (' + R.why.toLowerCase() + ')', 'rent');
    }
  }
  sendAll(r);
}

function startAuction(r, seat) {
  const s = r.seats[seat], name = s.offer.name, price = s.offer.price; s.offer = null;
  // everyone playing who is connected bids, starting with the player who landed
  const all = r.seats.map((x, i) => x && x.char && (x.online || i === seat) ? i : -1).filter(i => i >= 0);
  const k = all.indexOf(seat), order = [...all.slice(k), ...all.slice(0, k)];
  r.auction = { name, price, order, active: order.slice(), high: 0, leader: null, turn: order[0], deadline: 0, log: ['Bidding opens'], token: 0 };
  log(r, who(s) + ' put ' + name + ' up for auction', 'auction');
  auctionTurn(r, order[0]);
}
function auctionTurn(r, seat) {
  const a = r.auction; if (!a) return;
  a.turn = seat; a.deadline = Date.now() + AUCTION_MS; const tok = ++a.token;
  // players who dropped out of the game are passed automatically
  if (!r.seats[seat] || !r.seats[seat].online) { setImmediate(() => auctionPass(r, seat, tok)); return; }
  setTimeout(() => auctionPass(r, seat, tok, true), AUCTION_MS + 100);
}
function auctionPass(r, seat, tok, timeout) {
  const a = r.auction; if (!a || a.turn !== seat || a.token !== tok) return;
  a.active = a.active.filter(x => x !== seat);
  const line = who(r.seats[seat]) + ' passes' + (timeout ? ' (out of time)' : ''); a.log.push(line); log(r, 'Auction for ' + a.name + ': ' + line, 'auction');
  auctionNext(r, seat); sendAll(r);
}
function auctionBid(r, seat, amt) {
  const a = r.auction, s = r.seats[seat]; if (!a || a.turn !== seat) return;
  amt = Number(amt);
  if (!Number.isInteger(amt) || amt % 5 || amt <= a.high || amt > total(s)) return;
  a.high = amt; a.leader = seat;
  const line = who(s) + ' bids $' + amt; a.log.push(line); log(r, 'Auction for ' + a.name + ': ' + line, 'auction');
  auctionNext(r, seat); sendAll(r);
}
function auctionNext(r, from) {
  const a = r.auction;
  const askable = a.order.filter(x => a.active.includes(x) && x !== a.leader);
  if (!askable.length) return auctionEnd(r);
  // next player after `from` in turn order who is still in and is not the high bidder
  const k = a.order.indexOf(from);
  for (let i = 1; i <= a.order.length; i++) { const c = a.order[(k + i) % a.order.length]; if (askable.includes(c)) return auctionTurn(r, c); }
  auctionEnd(r);
}
function auctionEnd(r) {
  const a = r.auction; r.auction = null;
  if (a.leader === null) return log(r, 'Nobody bid on ' + a.name + ', so it stays in the Land bank', 'auction');
  const w = r.seats[a.leader];
  if (!payFrom(w.purse, Math.min(a.high, total(w)))) payFrom(w.purse, total(w));
  r.owner[a.name] = a.leader;
  log(r, who(w) + ' won the auction for ' + a.name + ' with $' + a.high, 'auction');
}

/* ---------- actions ---------- */
function err(ws, msg) { sendTo(ws, { t: 'err', msg }); }

function handle(ws, m) {
  const r = ws.room, me = ws.seat, S = r && r.seats[me];
  if (!r || !S) return;
  const o = okId(m.id) ? r.objs[m.id] : null;
  const bx = v => num(v, -200, BS + 200), by = v => num(v, -200, BS + 200);
  const tableCard = (cid, x, y) => put(r, { id: 'c' + cid, kind: 'card', card: cid, bx: bx(x), by: by(y) });
  const centerSpot = () => { const k = Object.values(r.objs).filter(x => x.kind === 'card').length % 5; return [450 - 55 + k * 14, 450 - 55 + k * 14]; };
  const cardLabel = cid => { const c = r.cards[cid]; return c.deck === 'quest' ? 'a Quest card' : 'a ' + deckName(c.deck) + ' card: ' + c.text; };
  const busy = () => S.offer || S.rent || r.auction || Date.now() < r.busyUntil;

  switch (m.t) {
    case 'pick': { // character, color and nickname
      const ch = G.characters.includes(m.char) ? m.char : null, col = G.ringColors.find(c => c[1] === m.color);
      const nick = String(m.nick || '').trim().slice(0, 16);
      if (!ch || !col || !nick) return err(ws, 'Pick a color, a character and a nickname.');
      if (r.seats.some((s, i) => s && i !== me && s.char === ch)) return err(ws, 'That character is taken.');
      if (r.seats.some((s, i) => s && i !== me && s.color === col[1])) return err(ws, 'That color is taken.');
      const first = !S.char;
      S.char = ch; S.color = col[1]; S.nick = nick;
      if (S.tile == null) S.tile = 0;
      log(r, first ? nick + ' is playing as ' + ch : nick + ' changed to ' + ch, 'join');
      break;
    }
    case 'move': // live drag of a card or token
      if (!o) return;
      o.bx = bx(m.bx); o.by = by(m.by);
      return sendOthers(r, ws, { t: 'mv', id: o.id, bx: o.bx, by: o.by, z: o.z });
    case 'lift':
      if (!o) return;
      o.z = ++r.z;
      return sendOthers(r, ws, { t: 'mv', id: o.id, bx: o.bx, by: o.by, z: o.z });
    case 'draw': {
      const d = r.decks[m.deck]; if (!d || !d.length) return;
      const cid = d.pop(), c = r.cards[cid];
      if (c.deck === 'quest') { S.quests.push(cid); log(r, who(S) + ' drew a Quest card', 'card'); }
      else {
        const n = Object.values(r.objs).filter(x => x.kind === 'card' && r.cards[x.card].deck === c.deck).length % 4;
        tableCard(cid, 450 + (c.deck === 'chest' ? 20 : -130) + n * 10, 450 - 150 + n * 8);
        log(r, who(S) + ' drew a ' + deckName(c.deck) + ' card: ' + c.text, 'card');
      }
      break;
    }
    case 'play': { // a Quest or kept card from my hand onto the table, face up
      const cid = m.card, qi = S.quests.indexOf(cid), ki = S.kept.indexOf(cid);
      if (qi < 0 && ki < 0) return;
      if (qi >= 0) S.quests.splice(qi, 1); else S.kept.splice(ki, 1);
      const [x, y] = centerSpot(); tableCard(cid, x, y);
      log(r, who(S) + ' played ' + cardLabel(cid), 'card');
      break;
    }
    case 'take': { // a card from the table into my hand
      if (!o || o.kind !== 'card') return;
      const c = r.cards[o.card]; delete r.objs[o.id];
      (c.deck === 'quest' ? S.quests : S.kept).push(o.card);
      log(r, who(S) + ' kept ' + (c.deck === 'quest' ? 'a Quest card' : 'a ' + deckName(c.deck) + ' card'), 'card');
      break;
    }
    case 'toBottom': { // Fate and Treasure Chest cards only
      let cid = null;
      if (o && o.kind === 'card') cid = o.card; else if (S.kept.includes(m.card)) cid = m.card;
      if (!cid || r.cards[cid].deck === 'quest') return;
      if (o && o.kind === 'card') delete r.objs[o.id]; else S.kept.splice(S.kept.indexOf(cid), 1);
      r.decks[r.cards[cid].deck].unshift(cid);
      log(r, 'Card put at the bottom of the ' + deckName(r.cards[cid].deck) + ' deck', 'card');
      break;
    }
    case 'bankTake': { // take an unowned Land straight from the bank (no payment)
      const L = LAND[m.name]; if (!L || r.owner[L.name] != null) return;
      r.owner[L.name] = me;
      log(r, who(S) + ' took ' + L.name + ' from the Land bank', 'buy');
      break;
    }
    case 'spawn':
      if (!okId(m.id) || r.objs[m.id] || !['tavern', 'keep'].includes(m.tok)) return;
      if (Object.keys(r.objs).length >= MAX_OBJS) return err(ws, 'The table is full. Put some pieces back first.');
      put(r, { id: m.id, kind: 'tok', tok: m.tok, n: 1, bx: bx(m.bx), by: by(m.by) });
      break;
    case 'del':
      if (!o || o.kind !== 'tok') return;
      delete r.objs[o.id]; break;
    case 'merge': {
      const into = okId(m.into) ? r.objs[m.into] : null;
      if (!o || !into || o === into || o.kind !== 'tok' || into.tok !== o.tok) return;
      into.n += o.n; delete r.objs[o.id]; break;
    }
    case 'split':
      if (!o || o.kind !== 'tok' || o.n < 2 || !okId(m.newId) || r.objs[m.newId]) return;
      o.n -= 1; put(r, { id: m.newId, kind: 'tok', tok: o.tok, n: 1, bx: o.bx, by: o.by }); break;
    case 'place': { // drag my own character to a space
      if (!S.char) return;
      const t = Math.floor(Number(m.tile)); if (!(t >= 0 && t < 40)) return;
      S.tile = t; S.jail = t === 10 && !!m.jail;
      log(r, who(S) + ' moved their character to ' + G.TILE_NAMES[t], 'move');
      break;
    }
    case 'roll': {
      if (!S.char) return err(ws, 'Choose a character first.');
      if (busy()) return err(ws, S.offer || S.rent ? 'Settle the card on the board first, then roll.' : r.auction ? 'An auction is under way.' : 'Wait for the move to finish.');
      r.dice = [rnd(6), rnd(6)]; r.rollN++;
      const steps = r.dice[0] + r.dice[1] + 2, from = S.tile == null ? 0 : S.tile, freed = S.jail;
      let passed = false; for (let k = 1; k < steps; k++) if ((from + k) % 40 === 0) passed = true;
      S.tile = (from + steps) % 40; S.jail = false;
      r.ev = { n: ++r.evN, seat: me, from, steps };
      log(r, who(S) + ' rolled ' + (r.dice[0] + 1) + ' and ' + (r.dice[1] + 1) + ' (' + steps + ')', 'roll');
      log(r, who(S) + ' ' + (freed ? 'left the Dungeon and ' : '') + 'moved ' + steps + ' to ' + G.TILE_NAMES[S.tile] + (passed ? ', passing Avalon Gate' : ''), 'move');
      const wait = steps * HOP_MS + 350; r.busyUntil = Date.now() + wait + 500;
      const tok = S.moveToken = ++r.nextId;
      setTimeout(() => land(r, me, tok), wait);
      break;
    }
    case 'buy': {
      const off = S.offer; if (!off || total(S) < off.price) return;
      payFrom(S.purse, off.price); r.owner[off.name] = me; S.offer = null;
      log(r, who(S) + ' bought ' + off.name + ' for $' + off.price, 'buy');
      break;
    }
    case 'auction':
      if (!S.offer || r.auction) return;
      startAuction(r, me); break;
    case 'bid': return auctionBid(r, me, m.amt);
    case 'pass':
      if (r.auction && r.auction.turn === me) return auctionPass(r, me, r.auction.token);
      return;
    case 'payRent': {
      const R = S.rent; if (!R) return;
      const to = r.seats[R.owner], pay = Math.min(R.amt, total(S));
      if (pay > 0 && payFrom(S.purse, pay) && to) addCoins(to.purse, greedy(pay));
      S.rent = null;
      log(r, who(S) + ' paid $' + pay + ' rent to ' + who(to) + ' for ' + R.name + (pay < R.amt ? ' (short by $' + (R.amt - pay) + ')' : ''), 'rent');
      break;
    }
    case 'pay': { // pay a player, the board pot, or the bank
      const amt = Number(m.amt);
      if (!Number.isInteger(amt) || amt <= 0 || amt % 5 || amt > total(S)) return;
      let where = 'to the bank';
      if (m.to === 'board') { where = 'onto the board'; }
      else if (m.to === 'bank') { where = 'to the bank'; }
      else { const ts = Number(String(m.to).replace('p', '')), T = r.seats[ts]; if (!T || ts === me) return; where = 'to ' + who(T); }
      const pl = planPayment(amt, S.purse); if (!pl) return;
      payFrom(S.purse, amt);
      if (m.to === 'board') addCoins(r.pot, greedy(amt));
      else if (m.to !== 'bank') addCoins(r.seats[Number(String(m.to).replace('p', ''))].purse, greedy(amt));
      log(r, who(S) + ' paid $' + amt + ' ' + where + (pl.change ? ' (got $' + pl.change + ' change)' : ''), 'money');
      break;
    }
    case 'collect': {
      const amt = Number(m.amt);
      if (!Number.isInteger(amt) || amt <= 0 || amt % 5 || amt > 5000) return;
      addCoins(S.purse, greedy(amt));
      log(r, who(S) + ' collected $' + amt + ' from the bank', 'money');
      break;
    }
    case 'takePot': {
      const t = totalOf(r.pot); if (!t) return;
      addCoins(S.purse, r.pot); r.pot = {};
      log(r, who(S) + ' took the $' + t + ' from the board', 'money');
      break;
    }
    case 'shuffle':
      for (const d of G.decks) {
        const ids = Object.keys(r.cards).filter(id => r.cards[id].deck === d.key);
        for (const id of ids) delete r.objs['c' + id];
        r.seats.forEach(s => { if (s) { s.quests = s.quests.filter(x => !ids.includes(x)); s.kept = s.kept.filter(x => !ids.includes(x)); } });
        r.decks[d.key] = shuffle(ids);
      }
      log(r, who(S) + ' shuffled the decks', 'card'); break;
    case 'reset':
      resetGame(r); log(r, who(S) + ' reset the table', 'reset'); break;
    default: return;
  }
  sendAll(r);
}

/* ---------- connections ---------- */
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return join(ws, m);
    if (ws.room) { try { handle(ws, m); } catch (e) { console.error(e); } }
  });
  ws.on('close', () => {
    const r = ws.room; if (!r) return;
    r.clients.delete(ws);
    const s = r.seats[ws.seat];
    if (s && ![...r.clients].some(c => c.seat === ws.seat)) {
      s.online = false; log(r, who(s) + ' left', 'join');
      // a leaving player can't hold up an auction
      if (r.auction && r.auction.turn === ws.seat) auctionPass(r, ws.seat, r.auction.token);
    }
    if (!r.clients.size) r.emptySince = Date.now();
    sendAll(r);
  });
});

function join(ws, m) {
  if (ws.room) return;
  const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const name = String(m.name || '').trim().slice(0, 20) || 'Player';
  if (code.length < 3) return sendTo(ws, { t: 'err', fatal: true, msg: 'Room codes are at least 3 letters or numbers.' });
  const r = rooms.get(code) || newRoom(code);
  let seat = typeof m.token === 'string' ? r.seats.findIndex(s => s && s.token === m.token) : -1;
  if (seat < 0) seat = r.seats.findIndex(s => !s);
  if (seat < 0) seat = r.seats.findIndex(s => s && !s.online); // take over an abandoned seat
  if (seat < 0) return sendTo(ws, { t: 'err', fatal: true, msg: 'This room is full (8 players).' });
  let s = r.seats[seat];
  const rejoin = s && s.token === m.token;
  if (!rejoin) {
    // a new player in this seat: whatever the last occupant held goes back
    if (s) {
      for (const n of ownedBy(r, seat)) delete r.owner[n];
      [...s.quests, ...s.kept].forEach(id => r.decks[r.cards[id].deck].unshift(id));
    }
    s = r.seats[seat] = { token: crypto.randomBytes(12).toString('hex'), name, nick: '', char: null, color: null, purse: { ...G.startPurse },
      quests: [], kept: [], offer: null, rent: null, tile: null, jail: false };
  }
  s.name = name; s.online = true;
  ws.room = r; ws.seat = seat; r.clients.add(ws); r.emptySince = null;
  sendTo(ws, { t: 'welcome', seat, token: s.token, code, rejoin,
    cfg: { lands: G.lands, rents: G.RENTS, tavernCost: G.TAVERN_COST, checkpointRent: G.CHECKPOINT_RENT, tiles: G.TILE_NAMES,
      characters: G.characters, ringColors: G.ringColors, decks: G.decks.map(d => ({ key: d.key, name: d.name, color: d.color })) } });
  log(r, who(s) + (rejoin ? ' is back' : ' joined'), 'join');
  sendAll(r);
}

// keep connections healthy and clear out rooms nobody has used for 6 hours
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  for (const [code, r] of rooms) if (r.emptySince && Date.now() - r.emptySince > 6 * 3600e3) rooms.delete(code);
}, 30000);

server.listen(PORT, () => console.log('Tabletop running on port ' + PORT));
