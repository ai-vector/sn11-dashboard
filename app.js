// SN11 dashboard: renders data/latest.json (written by collect.py). All times are shown in EDT.
'use strict';

const TZ = 'America/New_York';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('sn11-dash:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('sn11-dash:' + k, v); } catch { /* private window */ } },
};

// ---- formatting ----
function toDate(ts) {
  if (!ts) return null;
  let s = String(ts).replace(/(\.\d{3})\d+/, '$1');
  if (!/[zZ]$|[+-]\d\d:\d\d$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const fmtT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
const fmtH = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtD = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const edt = ts => { const d = toDate(ts); return d ? fmtT.format(d) : '—'; };
function rel(ts) {
  const d = toDate(ts); if (!d) return '';
  const m = Math.round((d - Date.now()) / 60000), a = Math.abs(m);
  const t = a < 60 ? `${a} min` : a < 2880 ? `${(a / 60).toFixed(1)} h` : `${(a / 1440).toFixed(1)} d`;
  return m >= 0 ? `in ${t}` : `${t} ago`;
}
const tao = (v, d = 4) => v == null ? '—' : 'τ' + Number(v).toFixed(d);
const usd = v => v == null ? '—' : '$' + Number(v).toFixed(2);
const num = (v, d = 1) => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v, d = 1) => v == null ? '—' : (v * 100).toFixed(d) + '%';
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const addr = a => a ? `<span class="addr" title="${esc(a)} (click to copy)" data-copy="${esc(a)}">${esc(short(a))}</span>` : '—';
const status = (lvl, text) => `<span class="status ${lvl}"><i></i>${esc(text)}</span>`;
const tile = (k, v, d = '') => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
const tipAttr = s => `data-tip="${esc(s).replace(/\n/g, '&#10;')}"`;

// ---- state ----
const S = {
  d: null, tab: location.hash.slice(1) || store.get('tab') || 'overview', q: {}, sort: {}, open: new Set(), more: {}, flags: {},
  lbMode: store.get('lbMode') || 'all', feeWin: store.get('feeWin') || 'h24', tmMode: store.get('tmMode') || 'teams',
};
let X = null;
const TABLES = {};

function derive(d) {
  const my = d.my || { hotkeys: [] };
  const myHot = new Set(my.hotkeys.map(h => h.hotkey));
  const neurons = d.chain?.neurons || [];
  const chainBy = new Map(neurons.map(n => [n.hotkey, n]));
  const ep = d.trajrl?.epoch || {}, lb = d.trajrl?.leaderboard || {};
  const miners = lb.miners || [];
  const price = d.chain?.alpha_price_tao, tusd = d.tao_usd;
  const isMine = hk => myHot.has(hk) || (my.coldkey && chainBy.get(hk)?.coldkey === my.coldkey);
  const coldOf = hk => chainBy.get(hk)?.coldkey || null;
  // every hotkey we know about: chain UIDs plus leaderboard rows (a leaderboard row may be deregistered)
  const rows = new Map();
  for (const n of neurons) rows.set(n.hotkey, { hotkey: n.hotkey, uid: n.uid, n, m: null });
  for (const m of miners) { const r = rows.get(m.hotkey) || { hotkey: m.hotkey, uid: m.uid, n: null }; r.m = m; rows.set(m.hotkey, r); }
  const qRank = new Map(miners.filter(m => m.queue_position != null).sort((a, b) => a.queue_position - b.queue_position).map((m, i) => [m.hotkey, i + 1]));
  const immuneLeft = n => n && d.chain ? n.registered_block + d.chain.immunity_period - d.chain.block : null;
  return { my, myHot, chainBy, ep, lb, miners, price, tusd, isMine, coldOf, rows: [...rows.values()], immuneLeft, qRank };
}
const alphaTao = a => a == null || X.price == null ? null : a * X.price;
const alphaUsd = a => alphaTao(a) == null || X.tusd == null ? null : alphaTao(a) * X.tusd;
const moneyAlpha = a => a == null ? '—' : `${num(a, 1)} α <span class="muted">${tao(alphaTao(a), 2)} · ${usd(alphaUsd(a))}</span>`;

// ---- sortable table ----
function drawTable(id) {
  const spec = TABLES[id]; const box = document.getElementById('tbl-' + id);
  if (!spec || !box) return;
  const { cols, opt = {} } = spec;
  let rows = spec.rows();
  const st = S.sort[id] || opt.sort || { k: cols[0].k, dir: 1 };
  const col = cols.find(c => c.k === st.k) || cols[0];
  const val = r => col.v ? col.v(r) : r[col.k];
  rows = rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
  });
  const limit = S.more[id] ? Infinity : (opt.limit || Infinity);
  const shown = rows.slice(0, limit);
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}" data-table="${id}" data-k="${c.k}"${c.k === col.k ? ` aria-sort="${st.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(c.label)}</th>`).join('');
  const body = shown.map(r => {
    const key = opt.key ? opt.key(r) : null;
    const cls = [opt.rowClass?.(r), opt.expand ? 'click' : ''].filter(Boolean).join(' ');
    let tr = `<tr class="${cls}"${opt.expand ? ` data-open="${esc(id + '|' + key)}"` : ''}>` +
      cols.map(c => `<td class="${[c.num ? 'num' : '', c.cls || ''].join(' ')}">${c.f ? c.f(r) : esc(r[c.k] ?? '—')}</td>`).join('') + '</tr>';
    if (opt.expand && S.open.has(id + '|' + key)) tr += `<tr class="detail"><td colspan="${cols.length}">${opt.expand(r)}</td></tr>`;
    return tr;
  }).join('');
  const more = rows.length > shown.length ? `<div class="more"><button data-more="${id}">Show all ${rows.length} rows</button></div>` : '';
  box.innerHTML = `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted">No rows</td></tr>`}</tbody></table></div>` +
    `<div class="muted" style="font-size:12px;margin-top:4px">${shown.length} of ${rows.length} rows</div>${more}`;
}
const tableBox = id => `<div id="tbl-${id}"></div>`;
const search = (id, ph) => `<input type="search" data-search="${id}" placeholder="${esc(ph)}" value="${esc(S.q[id] || '')}">`;
const match = (id, ...fields) => {
  const q = (S.q[id] || '').trim().toLowerCase();
  return !q || fields.some(f => String(f ?? '').toLowerCase().includes(q));
};
const flag = (id, label) => `<label class="chk"><input type="checkbox" data-flag="${id}"${S.flags[id] ? ' checked' : ''}> ${esc(label)}</label>`;
const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-seg="${key}:${v}" aria-pressed="${S[key] === v}">${esc(l)}</button>`).join('')}</div>`;

// ---- team labels (teams.py): hotkey -> team, team -> Discord names; the newer `at` wins per record ----
const TM = { doc: { teams: {}, hotkeys: {} } };
const teamOf = hk => (hk && TM.doc.hotkeys[hk]?.team) || '';
const teamInfo = name => (name && !TM.doc.teams[name]?.deleted && TM.doc.teams[name]) || {};
const teamNames = () => [...new Set([...Object.keys(TM.doc.teams).filter(n => !TM.doc.teams[n].deleted),
  ...Object.values(TM.doc.hotkeys).map(c => c.team).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
const canEditTeams = () => MODE === 'local' || !!S.d?.edit?.token;
const teamKey = hk => X.isMine(hk) ? 'us' : teamOf(hk);
const teamBadge = hk => {
  if (X.isMine(hk)) return '<span class="badge ours">ours</span>';
  const name = teamOf(hk); if (!name) return '';
  const dis = teamInfo(name).discord;
  return `<span class="badge team" title="${esc(dis ? 'Discord: ' + dis : 'team')}">${esc(name)}</span>`;
};
const teamText = hk => { const t = teamOf(hk); return [t, teamInfo(t).discord, teamInfo(t).note]; };
function teamCell(hk) {
  if (X.isMine(hk)) return '<span class="muted">us</span>';
  const name = teamOf(hk), dis = teamInfo(name).discord;
  const label = name ? `<span class="teamname">${esc(name)}</span>${dis ? ` <span class="muted">${esc(dis)}</span>` : ''}` : '+ team';
  if (!canEditTeams()) return name ? label : '—';
  return `<button type="button" class="teambtn${name ? '' : ' add'}" data-team-edit="${esc(hk)}" title="edit team">${label}</button>`;
}

function mergeTeams(a, b) {
  const canon = r => JSON.stringify(r, Object.keys(r).sort());
  const out = {};
  for (const sec of ['teams', 'hotkeys']) {
    const x = a?.[sec] || {}, y = b?.[sec] || {};
    out[sec] = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const p = x[k], q = y[k];
      out[sec][k] = !p ? q : !q ? p : (p.at > q.at || (p.at === q.at && canon(p) > canon(q))) ? p : q;
    }
  }
  return out;
}
const ghApi = (path, opt = {}) => fetch(`https://api.github.com/repos/${S.d.edit.repo}/${path}`, { cache: 'no-store', ...opt,
  headers: { Authorization: `Bearer ${S.d.edit.token}`, Accept: 'application/vnd.github+json', ...(opt.headers || {}) } });
async function encryptBlob(obj) {
  const gz = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const key = await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz));
  const b = u => btoa(Array.from(u, c => String.fromCharCode(c)).join(''));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: META.iter, salt: META.salt, iv: b(iv), ct: b(ct) };
}
async function remoteTeams() {
  const e = S.d.edit, r = await ghApi(`contents/${e.path}?ref=${e.branch}&t=${Date.now()}`);
  if (r.status === 404) return { doc: { teams: {}, hotkeys: {} }, sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const info = await r.json();
  return { doc: await decryptBlob(JSON.parse(atob(info.content.replace(/\s/g, ''))), KEY), sha: info.sha };
}
async function loadTeams() {
  try {
    if (MODE === 'local') TM.doc = await (await fetch('api/teams', { cache: 'no-store' })).json();
    else TM.doc = mergeTeams(S.d.teams, S.d.edit?.token ? (await remoteTeams()).doc : null);
  } catch (err) {
    if (MODE === 'static') TM.doc = mergeTeams(S.d.teams, null);
    console.warn('team labels:', err.message);
  }
}
async function saveTeams(ops) {
  if (MODE === 'local') {
    const r = await fetch('api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ops) });
    if (!r.ok) throw new Error(`server ${r.status}`);
    TM.doc = await r.json(); return;
  }
  const at = new Date().toISOString(), mine = { teams: {}, hotkeys: {} };
  for (const o of ops) mine[o.sec][o.key] = { ...o.val, at };
  for (let i = 0; i < 3; i++) {
    const { doc, sha } = await remoteTeams();
    const merged = mergeTeams(mergeTeams(S.d.teams, doc), mine);
    const r = await ghApi(`contents/${S.d.edit.path}`, { method: 'PUT', body: JSON.stringify({ message: 'team labels', branch: S.d.edit.branch,
      content: btoa(JSON.stringify(await encryptBlob(merged))), ...(sha ? { sha } : {}) }) });
    if (r.ok) { TM.doc = merged; return; }
    if (![409, 422].includes(r.status) || i === 2) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || ''}`);
  }
}

// the edit dialog: one hotkey (assign / remove; optionally all hotkeys of its coldkey) or one team (rename, Discord, note)
const DLG = { mode: null, key: null };
const siblings = hk => { const ck = X.coldOf(hk); return ck ? (S.d.chain?.neurons || []).filter(n => n.coldkey === ck).map(n => n.hotkey) : [hk]; };
function openTeamDialog(mode, key) {
  DLG.mode = mode; DLG.key = key;
  const name = mode === 'hotkey' ? teamOf(key) : key, info = teamInfo(name);
  $('#team-title').textContent = mode === 'hotkey' ? `Hotkey team · UID ${X.chainBy.get(key)?.uid ?? '—'}` : 'Edit team';
  $('#team-who').textContent = mode === 'hotkey' ? short(key) : `${Object.values(TM.doc.hotkeys).filter(c => c.team === key).length} hotkeys`;
  $('#team-list').innerHTML = teamNames().map(n => `<option value="${esc(n)}">`).join('');
  $('#team-name').value = name; $('#team-discord').value = info.discord || ''; $('#team-note').value = info.note || '';
  $('#team-clear').hidden = mode !== 'hotkey' || !name;
  const sib = mode === 'hotkey' ? siblings(key) : [];
  $('#team-allwrap').hidden = sib.length < 2;
  $('#team-all').checked = sib.length >= 2 && sib.every(h => !teamOf(h) || teamOf(h) === name);
  $('#team-alltext').textContent = `Apply to all ${sib.length} UIDs of coldkey ${short(X.coldOf(key))}`;
  $('#team-msg').textContent = '';
  $('#teamdlg').showModal(); $('#team-name').focus();
}
$('#team-name').addEventListener('change', () => {
  const info = teamInfo($('#team-name').value.trim());
  if (info.at) { $('#team-discord').value = info.discord || ''; $('#team-note').value = info.note || ''; }
});
$('#team-cancel').addEventListener('click', () => $('#teamdlg').close());
async function submitTeam(clear) {
  const name = clear ? '' : $('#team-name').value.trim(), discord = $('#team-discord').value.trim(), note = $('#team-note').value.trim();
  const ops = [];
  if (DLG.mode === 'hotkey') {
    const keys = !$('#team-allwrap').hidden && $('#team-all').checked ? siblings(DLG.key) : [DLG.key];
    for (const hk of keys) ops.push({ sec: 'hotkeys', key: hk, val: { team: name } });
    const info = teamInfo(name);
    if (name && (!info.at || info.discord !== discord || info.note !== note)) ops.push({ sec: 'teams', key: name, val: { discord, note } });
  } else {
    if (!name) { $('#team-msg').textContent = 'A team needs a name.'; return; }
    ops.push({ sec: 'teams', key: name, val: { discord, note } });
    if (name !== DLG.key) {
      for (const [hk, c] of Object.entries(TM.doc.hotkeys)) if (c.team === DLG.key) ops.push({ sec: 'hotkeys', key: hk, val: { team: name } });
      ops.push({ sec: 'teams', key: DLG.key, val: { deleted: true } });
    }
  }
  const btn = $('#team-save'); btn.disabled = true; $('#team-msg').textContent = 'Saving…';
  try { await saveTeams(ops); $('#teamdlg').close(); render(); }
  catch (err) { $('#team-msg').textContent = 'Not saved: ' + err.message; }
  finally { btn.disabled = false; }
}
$('#teamform').addEventListener('submit', e => { e.preventDefault(); submitTeam(false); });
$('#team-clear').addEventListener('click', () => submitTeam(true));

// ---- charts ----
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || hi || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
  const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const chartW = id => Math.max(300, (document.getElementById(id)?.clientWidth || 800) - 24);

// registration fee over time: one series, floor + our alert target as reference lines, crosshair tooltip
let FEE = null;
function feeSvg(pts, width, floor, target) {
  const H = 220, L = 58, R = 14, T = 12, B = 26;
  if (pts.length < 2) return `<p class="muted note">Collecting fee samples (one per minute). The chart fills in as serve.py runs.</p>`;
  const xs = pts.map(p => toDate(p[0]).getTime()), ys = pts.map(p => p[1]);
  const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1;
  let lo = Math.min(...ys, floor ?? Infinity), hi = Math.max(...ys);
  if (target != null && target < hi * 1.5 && target > lo * 0.5) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  const ticks = niceTicks(lo * 0.98, hi * 1.02); lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x = t => L + (t - x0) / (x1 - x0 || 1) * (width - L - R), y = v => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  let g = ticks.map(v => `<line class="gl" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(3)}</text>`).join('');
  const days = (x1 - x0) > 36 * 3600e3, nX = Math.max(2, Math.floor((width - L - R) / 90));
  for (let i = 0; i <= nX; i++) { const t = x0 + (x1 - x0) * i / nX; g += `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nX ? 'end' : 'middle'}">${days ? fmtD.format(t) : fmtH.format(t)}</text>`; }
  const ref = (v, label) => v == null || v < lo || v > hi ? '' : `<line class="ref" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text class="vl" x="${width - R}" y="${y(v) - 4}" text-anchor="end">${label} ${v.toFixed(4)}</text>`;
  g += ref(floor, 'floor') + ref(target, 'your alert');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`).join('');
  g += `<path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>`;
  const last = pts.length - 1;
  g += `<circle class="dot" cx="${x(xs[last])}" cy="${y(ys[last])}" r="4.5" fill="var(--series-1)"/>`;
  g += `<g class="xh" hidden><line x1="0" x2="0" y1="${T}" y2="${H - B}" class="ref"/><circle r="4.5" class="dot" fill="var(--series-1)"/></g>`;
  g += `<rect class="hit" data-fee="1" x="${L}" y="${T}" width="${width - L - R}" height="${H - T - B}"/>`;
  FEE = { xs, ys, x, y, pts };
  return `<svg width="${width}" height="${H}" role="img" aria-label="Registration fee over time">${g}</svg>`;
}
function feeHover(e) {
  const svg = e.target.closest('svg'), xh = svg?.querySelector('.xh'); if (!FEE || !xh) return;
  const px = e.clientX - svg.getBoundingClientRect().left;
  let best = 0, bd = Infinity;
  FEE.xs.forEach((t, i) => { const dd = Math.abs(FEE.x(t) - px); if (dd < bd) { bd = dd; best = i; } });
  const cx = FEE.x(FEE.xs[best]), cy = FEE.y(FEE.ys[best]);
  xh.hidden = false; xh.querySelector('line').setAttribute('x1', cx); xh.querySelector('line').setAttribute('x2', cx);
  xh.querySelector('circle').setAttribute('cx', cx); xh.querySelector('circle').setAttribute('cy', cy);
  TIP.hidden = false; TIP.textContent = `${edt(FEE.pts[best][0])}\nfee ${tao(FEE.ys[best], 5)}` + (X.tusd ? ` · ${usd(FEE.ys[best] * X.tusd)}` : '');
  placeTip(e);
}
function drawFee(boxId, win) {
  const box = document.getElementById(boxId); if (!box) return;
  const cfg = S.d.alerts_cfg || {};
  box.innerHTML = feeSvg(S.d.burn?.[win] || [], chartW(boxId), S.d.reg?.min_burn_tao ?? S.d.chain?.min_burn_tao, cfg.target);
}

// Engy spend per day: bars, one series, hover per bar
function barsSvg(days, width) {
  const H = 170, L = 44, R = 10, T = 10, B = 24;
  if (!days.length) return '<p class="muted note">No usage in the last 7 days.</p>';
  const hi = Math.max(...days.map(d => d.usd), 0.01), ticks = niceTicks(0, hi), top = ticks[ticks.length - 1];
  const bw = (width - L - R) / days.length, y = v => T + (1 - v / top) * (H - T - B);
  let g = ticks.map(v => `<line class="${v ? 'gl' : 'base'}" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">$${v}</text>`).join('');
  days.forEach((d, i) => {
    const x = L + i * bw + 1, w = Math.max(2, bw - 2), h = y(0) - y(d.usd), r = Math.min(4, h, w / 2);
    if (h > 0) g += `<path class="mk" fill="var(--series-1)" d="M${x},${y(0)}V${y(d.usd) + r}Q${x},${y(d.usd)} ${x + r},${y(d.usd)}H${x + w - r}Q${x + w},${y(d.usd)} ${x + w},${y(d.usd) + r}V${y(0)}Z"/>`;
    g += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.day.slice(5))}</text>`;
    g += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" ${tipAttr(`${d.day}\n${usd(d.usd)} · ${d.requests} requests`)}/>`;
  });
  return `<svg width="${width}" height="${H}" role="img" aria-label="Engy spend per day">${g}</svg>`;
}

// one floating tooltip for every [data-tip] mark
const TIP = Object.assign(document.createElement('div'), { className: 'tip', hidden: true });
document.body.append(TIP);
function placeTip(e) {
  TIP.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - TIP.offsetWidth - 8)) + 'px';
  TIP.style.top = (e.clientY + 16 + TIP.offsetHeight > innerHeight ? e.clientY - TIP.offsetHeight - 10 : e.clientY + 16) + 'px';
}
document.addEventListener('mouseover', e => { if (e.target.dataset?.fee) return; const t = e.target.closest?.('[data-tip]'); TIP.hidden = !t; if (t) TIP.textContent = t.dataset.tip; });
document.addEventListener('mousemove', e => {
  if (e.target.dataset?.fee) return feeHover(e);
  document.querySelectorAll('.xh').forEach(x => { x.hidden = true; });
  if (!TIP.hidden && !e.target.closest?.('[data-tip]')) TIP.hidden = true;
  if (!TIP.hidden) placeTip(e);
});

// ---- header strip + alerts ----
function drawStrip() {
  const e = X.ep.epoch || {}, w = X.ep.winner || {}, sub = S.d.submit;
  const parts = [
    `Fee <b>${tao(S.d.reg?.burn_tao)}</b>` + (X.tusd && S.d.reg?.burn_tao ? ` (${usd(S.d.reg.burn_tao * X.tusd)})` : ''),
    `Submissions ${sub ? (sub.open ? '<b class="pos">open</b>' : '<b class="neg">closed</b>') : '—'}`,
    `Epoch <b>${esc(e.challenge_epoch_id ?? '—')}</b> · ${Math.round((X.ep.remaining_blocks || 0) * 12 / 60)} min left`,
    `Seat UID <b>${esc(w.uid ?? '—')}</b> ${w.score != null ? w.score.toFixed(3) : ''}`,
    `TAO ${usd(X.tusd)} · α ${tao(X.price, 5)}`,
  ];
  $('#strip').innerHTML = parts.map(p => `<span>${p}</span>`).join('');
  $('#fresh').textContent = `snapshot ${edt(S.d.generated_at)}`;
}

function alerts() {
  const out = [];
  for (const e of S.d.errors || []) {
    const name = e.split(':')[0], sec = S.d.sections?.[name];
    out.push(['warning', name, sec?.stale ? `fetch failed · showing ${edt(sec.at)}` : 'fetch failed']);
  }
  const fee = S.d.reg?.burn_tao, free = X.my.free_tao, cfg = S.d.alerts_cfg || {};
  if (S.d.submit?.open) out.push(['good', 'Submissions', 'web submissions are OPEN']);
  if (fee != null && cfg.target != null && fee <= cfg.target) out.push(['good', 'Reg fee', `${tao(fee)} is at or below your target ${tao(cfg.target)}`]);
  if (fee != null && free != null && free < fee) out.push(['critical', 'Coldkey', `free ${tao(free)} is below the fee ${tao(fee)}`]);
  for (const h of X.my.hotkeys) {
    if (!h.registered) continue;
    const left = (toDate(h.immunity_ends) - Date.now()) / 3600e3;
    if (h.immune && left < 6 && !(h.emission_alpha_day > 0)) out.push(['serious', h.name, `immunity ends ${rel(h.immunity_ends)} with 0 emission`]);
    if (!h.immune && !(h.emission_alpha_day > 0)) out.push(['serious', h.name, `prune risk · 0 emission · #${h.prune_position ?? '—'} of ${h.prune_pool} prunable`]);
    if (h.queue_eta && h.immunity_ends && h.immune && toDate(h.queue_eta) > toDate(h.immunity_ends))
      out.push(['warning', h.name, `queue turn ${rel(h.queue_eta)} comes after immunity ends (${rel(h.immunity_ends)})`]);
  }
  const eg = S.d.engy || {};
  if (eg.account && !eg.account.ok) out.push(['warning', 'Engy', eg.account.detail]);
  if (eg.balance_usd != null && cfg.engy_min != null && eg.balance_usd < cfg.engy_min) out.push(['critical', 'Engy', `balance ${usd(eg.balance_usd)} under ${usd(cfg.engy_min)}`]);
  if (!cfg.linked) out.push(['warning', 'Telegram', 'no bot linked: open each SN11 bot and send /start']);
  const order = { critical: 0, serious: 1, warning: 2, good: 3 };
  return out.sort((a, b) => order[a[0]] - order[b[0]]);
}

// trajectoryRL main: recent merged PRs (repo_watch.py), flagged when they touch spec/scoring/version files
function repoBlock() {
  const r = S.d.repo; if (!r?.recent?.length) return '';
  const b = r.behind;
  const rows = r.recent.slice(0, 8).map(c => `<tr><td><a class="addr" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.sha.slice(0, 7))}</a></td>
    <td class="wrap">${esc(c.title)}${(c.flags || []).map(f => `<span class="badge king">${esc(f)}</span>`).join('')}</td>
    <td>${esc(c.author)}</td><td>${edt(c.date)}</td></tr>`).join('');
  return `<h2>trajectoryRL main<span class="sub">checked ${rel(r.checked_at)} · local clone ${b === 0 ? 'up to date' : b ? `<b class="neg">${esc(b)} behind</b>: git -C sn11/trajectoryRL pull` : 'unknown'} · new merges go to Telegram</span></h2>
    <div class="tablewrap"><table><thead><tr><th>Commit</th><th>Title</th><th>Author</th><th>Merged</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- tabs ----
const TABS = {
  overview() {
    const fee = S.d.reg?.burn_tao, st = S.d.burn?.stats || {}, w = X.ep.winner || {}, e = X.ep.epoch || {};
    const seatAlpha = X.chainBy.get(w.hotkey)?.emission_alpha_day ?? S.d.chain?.miner_alpha_day;
    const myAlpha = X.my.hotkeys.reduce((s, h) => s + (h.emission_alpha_day || 0), 0);
    const eg = S.d.engy || {}, free = X.my.free_tao;
    const al = alerts();
    const done = X.ep.elapsed_blocks != null && e.epoch_length_blocks ? X.ep.elapsed_blocks / e.epoch_length_blocks : null;
    const queue = X.miners.filter(m => m.queue_position != null).length;
    return { html: `
      ${al.length ? `<div class="alerts">${al.map(([l, k, t]) => `<span class="alert ${l}">${status(l, k)}<span>${esc(t)}</span></span>`).join('')}</div>` : ''}
      <div class="tiles" style="margin-top:12px">
        ${tile('Registration fee', tao(fee), `${X.tusd && fee ? usd(fee * X.tusd) + ' · ' : ''}floor ${tao(S.d.reg?.min_burn_tao)} · 24 h low ${tao(st.h24?.min)}`)}
        ${tile('Web submissions', S.d.submit ? (S.d.submit.open ? status('good', 'open') : status('critical', 'closed')) : '—', S.d.submit ? `HTTP ${S.d.submit.http} · checked ${rel(S.d.submit.at)}` : '')}
        ${tile('Seat (winner takes all)', `UID ${esc(w.uid ?? '—')}`, `${w.score != null ? w.score.toFixed(4) + '/20' : ''} since epoch ${esc(w.since_epoch_id ?? '—')} · ${moneyAlpha(seatAlpha)}/day`)}
        ${tile('Our emission', moneyAlpha(myAlpha).replace(/<span.*/, ''), `${tao(alphaTao(myAlpha), 3)} · ${usd(alphaUsd(myAlpha))} per day · ${X.my.registered} registered`)}
        ${tile('Coldkey', tao(free), `${esc(X.my.wallet)} · ${free != null && fee ? Math.floor(free / fee) + ' registrations at today\'s fee' : ''}`)}
        ${tile('Engy credit', eg.balance_usd != null ? usd(eg.balance_usd) : '—', eg.balance_usd != null ? `${usd(eg.usage_7d?.total_usd)} spent in 7 d` : esc(eg.account?.ok === false ? 'needs account token (see Engy tab)' : ''))}
      </div>
      <h2>Epoch ${esc(e.challenge_epoch_id ?? '—')}<span class="sub">spec ${esc(e.spec_number ?? '—')} · ${esc(e.status ?? '')} · challenger UID ${esc(X.lb.in_progress_epoch?.challenger_uid ?? '—')} ${X.isMine(e.challenger_hotkey) ? '<span class="badge ours">ours</span>' : teamBadge(e.challenger_hotkey)}</span></h2>
      <div class="card">
        <div class="meter"><div style="width:${pct(done ?? 0, 2)};background:var(--series-1)"></div></div>
        <div class="muted note">${X.ep.elapsed_blocks ?? '—'} of ${e.epoch_length_blocks ?? '—'} blocks · ends ~${edt(new Date(Date.now() + (X.ep.remaining_blocks || 0) * 12000).toISOString())} · ${queue} in the queue (~${queue * 2} h at one challenger per epoch)</div>
      </div>
      <h2>Registration fee · 24 h<span class="sub">sampled every minute · a jump = someone registered; it then decays toward the floor</span></h2>
      <div class="chart" id="fee-ov"></div>
      ${repoBlock()}`, after: () => drawFee('fee-ov', 'h24') };
  },

  fee() {
    const st = S.d.burn?.stats || {}, reg = S.d.reg || {}, cfg = S.d.alerts_cfg || {}, free = X.my.free_tao;
    const w = k => st[k] ? `${tao(st[k].min)} – ${tao(st[k].max)}` : '—';
    return { html: `
      <div class="tiles">
        ${tile('Now', tao(reg.burn_tao, 5), `${X.tusd && reg.burn_tao ? usd(reg.burn_tao * X.tusd) + ' · ' : ''}block ${esc(reg.block ?? '—')} · ${rel(reg.at)}`)}
        ${tile('Floor (MinBurn)', tao(reg.min_burn_tao), `max ${tao(S.d.chain?.max_burn_tao, 0)} · ${S.d.chain?.num_uids ?? '—'}/${S.d.chain?.max_uids ?? '—'} UIDs used`)}
        ${tile('1 h low – high', w('h1'))}
        ${tile('24 h low – high', w('h24'), `${st.regs_24h ?? '—'} fee jumps (registrations) seen`)}
        ${tile('7 d low – high', w('d7'))}
        ${tile('Telegram alert', cfg.target != null ? '≤ ' + tao(cfg.target) : '—', cfg.linked ? `drop ≥ ${cfg.drop_pct}%/h · change with /target and /drop` : 'bot not linked yet: send /start')}
      </div>
      <h2>Fee over time</h2>
      <div class="controls">${seg('feeWin', [['h24', '24 h'], ['d7', '7 d']])}</div>
      <div class="chart" id="fee-big"></div>
      <p class="muted note">Coldkey ${esc(X.my.wallet)}: ${tao(free)} free${free != null && reg.burn_tao ? ` · enough for ${Math.floor(free / reg.burn_tao)} registrations now` : ''}.
        A new UID is immune for ${S.d.chain ? Math.round(S.d.chain.immunity_period * 12 / 3600) : '—'} h; after that, with zero emission, any new registration can prune it.</p>`,
      after: () => drawFee('fee-big', S.feeWin) };
  },

  leaderboard() {
    const w = X.ep.winner || {};
    const modes = seg('lbMode', [['all', 'All'], ['queue', 'Queue'], ['recent', 'Recent challenges']]);
    const base = X.rows.filter(r => S.lbMode === 'queue' ? r.m?.queue_position != null : S.lbMode === 'recent' ? r.m?.last_epoch_id : true);
    const prunable = new Set();
    const cols = [
      { k: 'uid', label: 'UID', num: true, v: r => r.n?.uid ?? r.uid },
      { k: 'agent', label: 'Hotkey', v: r => r.hotkey, f: r => addr(r.hotkey) + (r.hotkey === w.hotkey ? '<span class="badge king">seat</span>' : '') + teamBadge(r.hotkey) + (r.n ? '' : '<span class="badge">not on chain</span>') },
      { k: 'team', label: 'Team', cls: 'wrap', v: r => teamKey(r.hotkey).toLowerCase() || null, f: r => teamCell(r.hotkey) },
      { k: 'coldkey', label: 'Coldkey', v: r => X.coldOf(r.hotkey), f: r => addr(X.coldOf(r.hotkey)) },
      { k: 'score', label: 'Last score', num: true, v: r => r.m?.last_score, f: r => r.m?.last_score == null ? '—' : `${num(r.m.last_score, 3)} ${r.m.last_qualified ? '' : '<span class="muted">✗</span>'}` },
      { k: 'epoch', label: 'Epoch', num: true, v: r => r.m?.last_epoch_id, f: r => r.m?.last_epoch_id ?? '—' },
      { k: 'queue', label: 'Queue', num: true, v: r => X.qRank.get(r.hotkey), f: r => { const k = X.qRank.get(r.hotkey); return k == null ? '—' : `#${k} <span class="muted">${rel(new Date(Date.now() + ((X.ep.remaining_blocks || 0) + (k - 1) * 600) * 12000).toISOString())}</span>`; } },
      { k: 'em', label: 'α / day', num: true, v: r => r.n?.emission_alpha_day, f: r => r.n ? num(r.n.emission_alpha_day, 1) : '—' },
      { k: 'imm', label: 'Immunity', num: true, v: r => X.immuneLeft(r.n), f: r => { const l = X.immuneLeft(r.n); return l == null ? '—' : l > 0 ? `${(l * 12 / 3600).toFixed(1)} h left` : '<span class="muted">none</span>'; } },
    ];
    TABLES.lb = {
      cols, rows: () => base.filter(r => match('lb', r.hotkey, r.uid, X.coldOf(r.hotkey), ...teamText(r.hotkey)) && (!S.flags.lbMine || X.isMine(r.hotkey)) && (!S.flags.lbChain || r.n)),
      opt: { sort: S.lbMode === 'queue' ? { k: 'queue', dir: 1 } : S.lbMode === 'recent' ? { k: 'epoch', dir: -1 } : { k: 'score', dir: -1 },
        limit: 100, rowClass: r => X.isMine(r.hotkey) ? 'ours' : '' },
    };
    return { html: `<div class="controls">${modes}${search('lb', 'Filter UID, hotkey, coldkey, team, Discord')}${flag('lbMine', 'ours')}${flag('lbChain', 'on chain only')}</div>
      <p class="muted note">Scores are each miner's last evaluated challenge; older epochs may be from an earlier spec and are not comparable. The seat holder takes all miner emission.${canEditTeams() ? ' Click a Team cell to label a hotkey.' : ''}</p>${tableBox('lb')}`, tables: ['lb'] };
  },

  hotkeys() {
    const m = X.my, fee = S.d.reg?.burn_tao;
    const ck = `<div class="card"><div class="cardhead"><b>Coldkey ${esc(m.wallet)}</b>${addr(m.coldkey)}</div>
      <dl class="kv"><dt>Free</dt><dd>${tao(m.free_tao)} ${X.tusd && m.free_tao != null ? `<span class="muted">${usd(m.free_tao * X.tusd)}</span>` : ''}</dd>
      <dt>Hotkeys on chain</dt><dd>${m.owned_hotkeys} created · ${m.registered} registered on SN11</dd>
      <dt>Alpha stake (SN11)</dt><dd>${moneyAlpha(m.alpha_stake)}</dd>
      <dt>Can register</dt><dd>${m.free_tao != null && fee ? (m.free_tao >= fee ? status('good', `yes · ${Math.floor(m.free_tao / fee)}× at ${tao(fee)}`) : status('critical', `no · need ${tao(fee)}`)) : '—'}</dd>
      ${m.balance_error ? `<dt>Balance</dt><dd class="neg">${esc(m.balance_error)}</dd>` : ''}</dl></div>`;
    const card = h => {
      const lb = h.leaderboard || {};
      if (!h.registered) return `<div class="card"><div class="cardhead"><b>${esc(h.name)}</b>${addr(h.hotkey)}</div><p class="muted note">Not registered on SN11.${lb.last_score != null ? ` Last score ${lb.last_score} in epoch ${lb.last_epoch_id}.` : ''}</p></div>`;
      const badge = h.is_winner ? status('good', 'holds the seat') : h.is_challenger ? status('warning', 'challenger now') : h.immune ? status('good', 'immune') : (h.emission_alpha_day > 0 ? status('good', 'earning') : status('serious', 'prune risk'));
      return `<div class="card"><div class="cardhead"><b>${esc(h.name)} · UID ${h.uid}</b>${badge}</div>
        <dl class="kv"><dt>Hotkey</dt><dd>${addr(h.hotkey)}</dd>
        <dt>Emission</dt><dd>${moneyAlpha(h.emission_alpha_day)} per day · incentive ${pct(h.incentive, 2)}</dd>
        <dt>Stake</dt><dd>${moneyAlpha(h.alpha_stake)}</dd>
        <dt>Immunity</dt><dd>${h.immune ? `ends ${edt(h.immunity_ends)} (${rel(h.immunity_ends)})` : `over · prune order #${h.prune_position ?? '—'} of ${h.prune_pool}`}</dd>
        <dt>Last challenge</dt><dd>${lb.last_score != null ? `${lb.last_score}/20 ${lb.last_qualified ? 'qualified' : 'not qualified'} · epoch ${lb.last_epoch_id} · ${edt(lb.last_finalized_at)}` : 'none yet'}</dd>
        <dt>Queue</dt><dd>${h.queue_rank != null ? `#${h.queue_rank} of ${X.qRank.size} · turn ~${edt(h.queue_eta)} (${rel(h.queue_eta)})` + (h.immune && toDate(h.queue_eta) > toDate(h.immunity_ends) ? ' <span class="neg">after immunity ends</span>' : '') : '—'}</dd></dl></div>`;
    };
    const cards = m.hotkeys.length ? m.hotkeys.map(card).join('') : `<div class="card"><b>No SN11 hotkey yet</b>
      <p class="muted note">Planned: create <code>sn11</code> under ${esc(m.wallet)} and register it only once submissions reopen and your queue turn fits inside the ${S.d.chain ? Math.round(S.d.chain.immunity_period * 12 / 3600) : 36} h immunity.</p>
      <p class="note"><code>btcli wallet new-hotkey -w ${esc(m.wallet)} -H sn11</code><br><code>btcli subnets register --netuid 11 -w ${esc(m.wallet)} -H sn11</code></p></div>`;
    return { html: `<div class="grid2">${ck}${cards}</div>` };
  },

  agents() {
    const c = S.d.candidates || [];
    TABLES.ag = {
      cols: [
        { k: 'name', label: 'Candidate', f: r => `<b>${esc(r.name)}</b>${r.author ? ` <span class="muted">${esc(r.author)}</span>` : ''}` },
        { k: 'title', label: 'Idea', cls: 'wrap', f: r => esc(r.title || r.state || '') || '<span class="muted">—</span>' },
        { k: 'state', label: 'State', v: r => r.built ? 2 : r.has_skill ? 1 : 0, f: r => r.built ? status('good', 'pack built') : r.has_skill ? status('warning', 'not built') : status('idle', r.state || 'draft') },
        { k: 'built_at', label: 'Built', f: r => r.built_at ? edt(r.built_at) : '—' },
        { k: 'checked_at', label: 'Mock check', f: r => r.checked_at ? edt(r.checked_at) : '<span class="muted">not run</span>' },
        { k: 'pack_kb', label: 'Size', num: true, f: r => r.pack_kb != null ? r.pack_kb + ' KB' : '—' },
        { k: 'lb', label: 'On leaderboard', v: r => r.on_leaderboard_uid, f: r => r.on_leaderboard_uid != null ? `UID ${r.on_leaderboard_uid}` : '—' },
      ],
      rows: () => c.filter(r => match('ag', r.name, r.title, r.author)),
      opt: { sort: { k: 'name', dir: 1 } },
    };
    const built = c.filter(r => r.built).length;
    const sub = X.my.hotkeys.filter(h => h.leaderboard);
    return { html: `<div class="tiles">${tile('Candidates', c.length, `${built} packs built · ${c.filter(r => r.checked_at).length} mock-checked`)}
      ${tile('Submitted', sub.length, sub.length ? sub.map(h => `${esc(h.name)}: ${h.leaderboard.last_score ?? 'queued'}`).join(' · ') : (S.d.submit?.open ? 'submissions are open' : 'submissions closed'))}</div>
      <h2>Local packs<span class="sub">sn11/candidates · build with ./sn11.sh build &lt;name&gt;, free test with ./sn11.sh check &lt;name&gt;</span></h2>
      <div class="controls">${search('ag', 'Filter name, idea, author')}</div>${tableBox('ag')}`, tables: ['ag'] };
  },

  engy() {
    const eg = S.d.engy || {}, u = eg.usage_7d;
    const head = `<div class="tiles">
      ${tile('Balance', eg.balance_usd != null ? usd(eg.balance_usd) : '—', eg.available_usd != null ? `${usd(eg.available_usd)} available (minus holds)` : '')}
      ${tile('Spent · 7 days', u ? usd(u.total_usd) : '—', u ? `${num(u.requests, 0)} requests · complete UTC days only` : '')}
      ${tile('API key (sk-engy)', eg.api_key === 'set' ? status('good', 'in .env') : status('critical', 'missing'), 'used by ./sn11.sh eval and serve')}
      ${tile('Account token (rk-engy)', eg.account?.ok ? status('good', 'valid') : status('warning', 'not set'), eg.account?.ok ? 'Management API: read-only' : '')}
    </div>`;
    if (!eg.account?.ok) return { html: head + `<div class="card" style="margin-top:12px"><b>Balance needs an account token</b>
      <p class="note">${esc(eg.account?.detail || '')}</p>
      <p class="muted note">Engy's balance and usage endpoints accept only an account token (<code>rk-engy-…</code>); the API key in .env (<code>sk-engy-…</code>) is for inference. Create one on engy.ai (Account › Management API), then add <code>ENGY_ACCOUNT_TOKEN=rk-engy-…</code> to sn11/.env. The dashboard picks it up within 10 minutes.</p></div>` };
    TABLES.em = {
      cols: [{ k: 'model', label: 'Model' }, { k: 'usd', label: 'Spent', num: true, f: r => usd(r.usd) }, { k: 'requests', label: 'Requests', num: true, f: r => num(r.requests, 0) }],
      rows: () => u?.by_model || [], opt: { sort: { k: 'usd', dir: -1 } },
    };
    return { html: head + `<h2>Spend per day</h2><div class="chart" id="engy-bars"></div><h2>By model · 7 days</h2>${tableBox('em')}`, tables: ['em'],
      after: () => { const b = $('#engy-bars'); if (b) b.innerHTML = barsSvg(u?.by_day || [], chartW('engy-bars')); } };
  },

  teams() {
    const modes = seg('tmMode', [['teams', 'Teams'], ['coldkeys', 'Coldkeys']]);
    const lbBy = new Map(X.miners.map(m => [m.hotkey, m]));
    if (S.tmMode === 'coldkeys') {  // coldkeys with their UIDs: the quick way to label a whole operator
      const by = new Map();
      for (const n of S.d.chain?.neurons || []) (by.get(n.coldkey) || by.set(n.coldkey, []).get(n.coldkey)).push(n);
      const rows = [...by.entries()].map(([ck, ns]) => ({ ck, ns, best: Math.max(...ns.map(n => lbBy.get(n.hotkey)?.last_score ?? -1)), em: ns.reduce((s, n) => s + n.emission_alpha_day, 0) }));
      TABLES.ck = {
        cols: [
          { k: 'ck', label: 'Coldkey', f: r => addr(r.ck) + (r.ck === X.my.coldkey ? '<span class="badge ours">ours</span>' : '') },
          { k: 'uids', label: 'UIDs', num: true, v: r => r.ns.length, f: r => r.ns.length },
          { k: 'team', label: 'Team', cls: 'wrap', v: r => [...new Set(r.ns.map(n => teamKey(n.hotkey)).filter(Boolean))].join(', ').toLowerCase() || null,
            f: r => [...new Set(r.ns.map(n => teamKey(n.hotkey)))].filter(Boolean).map(t => `<span class="badge team">${esc(t)}</span>`).join('') || (canEditTeams() && r.ck !== X.my.coldkey ? `<button type="button" class="teambtn add" data-team-edit="${esc(r.ns[0].hotkey)}">+ team</button>` : '—') },
          { k: 'best', label: 'Best last score', num: true, v: r => r.best < 0 ? null : r.best, f: r => r.best < 0 ? '—' : num(r.best, 3) },
          { k: 'em', label: 'α / day', num: true, f: r => num(r.em, 1) },
        ],
        rows: () => rows.filter(r => match('ck', r.ck, ...r.ns.flatMap(n => [n.hotkey, n.uid, ...teamText(n.hotkey)])) && (!S.flags.ckMulti || r.ns.length > 1)),
        opt: { sort: { k: 'uids', dir: -1 }, limit: 60, key: r => r.ck, rowClass: r => r.ck === X.my.coldkey ? 'ours' : '',
          expand: r => r.ns.map(n => `UID ${n.uid} ${addr(n.hotkey)} ${teamCell(n.hotkey)} <span class="muted">last ${lbBy.get(n.hotkey)?.last_score ?? '—'}</span>`).join('<br>') },
      };
      return { html: `<div class="controls">${modes}${search('ck', 'Filter coldkey, hotkey, UID, team')}${flag('ckMulti', 'several UIDs')}</div>
        <p class="muted note">${by.size} coldkeys hold the ${S.d.chain?.neurons?.length ?? 0} UIDs. Click a row for its hotkeys; the team dialog can label every UID of a coldkey at once.</p>${tableBox('ck')}`, tables: ['ck'] };
    }
    const T = new Map();
    for (const r of X.rows) {
      const t = teamKey(r.hotkey); if (!t) continue;
      const s = T.get(t) || T.set(t, { team: t, hks: [], reg: 0, best: null, em: 0, queued: 0, cks: new Set() }).get(t);
      s.hks.push(r); if (r.n) { s.reg++; s.em += r.n.emission_alpha_day; s.cks.add(r.n.coldkey); }
      if (r.m?.queue_position != null) s.queued++;
      if (r.m?.last_score != null && (s.best == null || r.m.last_score > s.best)) s.best = r.m.last_score;
    }
    for (const name of teamNames()) if (!T.has(name)) T.set(name, { team: name, hks: [], reg: 0, best: null, em: 0, queued: 0, cks: new Set() });
    TABLES.tm = {
      cols: [
        { k: 'team', label: 'Team', v: s => s.team.toLowerCase(), f: s => s.team === 'us' ? '<b>us</b>' : (canEditTeams() ? `<button type="button" class="teambtn" data-team-rename="${esc(s.team)}"><span class="teamname">${esc(s.team)}</span></button>` : `<span class="teamname">${esc(s.team)}</span>`) },
        { k: 'discord', label: 'Discord', cls: 'wrap', v: s => teamInfo(s.team).discord || null, f: s => esc(teamInfo(s.team).discord || '—') },
        { k: 'reg', label: 'UIDs', num: true },
        { k: 'cks', label: 'Coldkeys', num: true, v: s => s.cks.size, f: s => s.cks.size },
        { k: 'queued', label: 'Queued', num: true },
        { k: 'best', label: 'Best last score', num: true, f: s => s.best == null ? '—' : num(s.best, 3) },
        { k: 'em', label: 'α / day', num: true, f: s => num(s.em, 1) },
        { k: 'note', label: 'Note', cls: 'wrap', v: s => teamInfo(s.team).note || null, f: s => esc(teamInfo(s.team).note || '') },
      ],
      rows: () => [...T.values()].filter(s => match('tm', s.team, teamInfo(s.team).discord, teamInfo(s.team).note, ...s.hks.map(r => r.hotkey))),
      opt: { sort: { k: 'reg', dir: -1 }, key: s => s.team, rowClass: s => s.team === 'us' ? 'ours' : '',
        expand: s => s.hks.map(r => `UID ${r.n?.uid ?? r.uid} ${addr(r.hotkey)} <span class="muted">coldkey ${short(X.coldOf(r.hotkey))} · last ${r.m?.last_score ?? '—'}${r.m?.queue_position != null ? ' · queue #' + r.m.queue_position : ''}</span>`).join('<br>') || '<span class="muted">no hotkeys</span>' },
    };
    const n = Object.values(TM.doc.hotkeys).filter(h => h.team).length;
    return { html: `<div class="controls">${modes}${search('tm', 'Filter team, Discord, note, hotkey')}</div>
      <p class="muted note">${teamNames().length} teams · ${n} hotkeys labelled. Label hotkeys from the Leaderboard (Team column) or the Coldkeys view${canEditTeams() ? '; click a team name to rename it or set its Discord names' : ' (read-only on this copy)'}. Click a row for its hotkeys.</p>${tableBox('tm')}`, tables: ['tm'] };
  },
};

// ---- render + events ----
let AFTER = null;
function render() {
  if (!S.d) return;
  try { draw(); } catch (err) {
    $('#main').innerHTML = `<p class="pad">Could not draw this view: ${esc(err.message)}. Try another tab or Refresh.</p>`;
    console.error(err);
  }
}
function draw() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  drawStrip();
  for (const k in TABLES) delete TABLES[k];
  const view = (TABS[S.tab] || TABS.overview)();
  $('#main').innerHTML = view.html;
  (view.tables || []).forEach(drawTable);
  AFTER = view.after || null; AFTER?.();
  const secs = S.d.sections || {};
  $('#foot').innerHTML = 'Sources: ' + Object.entries(secs).map(([k, v]) => `${k} ${edt(v.at)}${v.stale ? ' (stale)' : ''}`).join(' · ') +
    '. Times in EDT.' + (MODE === 'static' ? ' Encrypted snapshot.' : ' Local only (127.0.0.1).');
}
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => AFTER?.(), 150); });

document.addEventListener('click', e => {
  const t = e.target.closest('button, th[data-table], tr[data-open], .addr');
  if (!t) return;
  if (t.matches('.addr')) { navigator.clipboard?.writeText(t.dataset.copy); t.style.opacity = .5; setTimeout(() => { t.style.opacity = ''; }, 300); e.stopPropagation(); return; }
  if (t.dataset.teamEdit) { e.stopPropagation(); openTeamDialog('hotkey', t.dataset.teamEdit); return; }
  if (t.dataset.teamRename) { e.stopPropagation(); openTeamDialog('team', t.dataset.teamRename); return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; store.set('tab', S.tab); history.replaceState(null, '', '#' + S.tab); render(); return; }
  if (t.dataset.seg) { const [k, v] = t.dataset.seg.split(':'); S[k] = v; store.set(k, v); S.open.clear(); render(); return; }
  if (t.dataset.more) { S.more[t.dataset.more] = true; drawTable(t.dataset.more); return; }
  if (t.matches('th[data-table]')) {
    const id = t.dataset.table, k = t.dataset.k, cur = S.sort[id] || TABLES[id].opt?.sort || {};
    S.sort[id] = { k, dir: cur.k === k ? -cur.dir : (TABLES[id].cols.find(c => c.k === k).num ? -1 : 1) };
    drawTable(id); return;
  }
  if (t.dataset.open) { const [id] = t.dataset.open.split('|'); S.open.has(t.dataset.open) ? S.open.delete(t.dataset.open) : S.open.add(t.dataset.open); drawTable(id); }
});
document.addEventListener('input', e => { if (e.target.dataset.search) { S.q[e.target.dataset.search] = e.target.value; drawTable(e.target.dataset.search); } });
document.addEventListener('change', e => {
  const id = e.target.dataset.flag; if (!id) return;
  S.flags[id] = e.target.checked; Object.keys(TABLES).forEach(drawTable);
});

const savedTheme = store.get('theme'); if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', document.documentElement.dataset.theme); AFTER?.();
});

// ---- data: local server (plain JSON) or hosted page (encrypted data.enc + login) ----
let MODE = 'local', KEY = null, META = null;
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const KEY_SLOT = 'sn11-dash:key';
async function deriveKey(user, pass, meta) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${user}\n${pass}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(meta.salt), iterations: meta.iter }, base, 256);
  return new Uint8Array(bits);
}
async function decryptBlob(blob, raw) {
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
const fetchBlob = async () => { const r = await fetch('data.enc?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
function savedKey(salt) {
  for (const s of [sessionStorage, localStorage]) {
    try { const v = JSON.parse(s.getItem(KEY_SLOT) || 'null'); if (v && v.salt === salt) return b64(v.key); } catch { /* storage blocked */ }
  }
  return null;
}
function forgetKey() { for (const s of [sessionStorage, localStorage]) { try { s.removeItem(KEY_SLOT); } catch { /* storage blocked */ } } }
async function accept(d) {
  const before = JSON.stringify(TM.doc), changed = !S.d || S.d.generated_at !== d.generated_at;
  S.d = d; X = derive(d);
  await loadTeams();
  if ((changed || JSON.stringify(TM.doc) !== before) && !document.querySelector('#main input:focus') && !$('#teamdlg').open) render();
}
async function load() {
  try {
    if (MODE === 'static') accept(await decryptBlob(await fetchBlob(), KEY));
    else accept(await (await fetch('data/latest.json', { cache: 'no-store' })).json());
  } catch (err) {
    if (!S.d) $('#main').innerHTML = `<p class="pad">No snapshot yet. Run <code>python3 collect.py</code> or wait for the server's first refresh. (${esc(err.message)})</p>`;
  }
}
function showLogin(msg = '') { document.body.classList.add('locked'); $('#login').hidden = false; $('#login-err').textContent = msg; $('#login-user').focus(); }
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login button'); btn.disabled = true; $('#login-err').textContent = '';
  try {
    const blob = await fetchBlob();
    const raw = await deriveKey($('#login-user').value.trim(), $('#login-pass').value, blob);
    const d = await decryptBlob(blob, raw).catch(() => null);
    if (!d) { $('#login-err').textContent = 'Wrong username or password.'; return; }
    KEY = raw;
    const slot = JSON.stringify({ salt: blob.salt, key: btoa(String.fromCharCode(...raw)) });
    try { ($('#login-remember').checked ? localStorage : sessionStorage).setItem(KEY_SLOT, slot); } catch { /* storage blocked */ }
    $('#login-pass').value = ''; $('#login').hidden = true; document.body.classList.remove('locked');
    accept(d); setInterval(load, 120000);
  } catch (err) { $('#login-err').textContent = 'Could not load data: ' + err.message; }
  finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', () => { forgetKey(); location.reload(); });
$('#refresh').addEventListener('click', async () => {
  const b = $('#refresh'); b.disabled = true; b.textContent = 'Refreshing…';
  try {
    if (MODE === 'local') {
      await fetch('api/refresh', { method: 'POST' });
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (!(await (await fetch('api/status', { cache: 'no-store' })).json()).running) break;
      }
    }
    await load();
  } finally { b.disabled = false; b.textContent = 'Refresh'; }
});
(async function start() {
  let blob = null;
  try { blob = await fetchBlob(); } catch { /* no data.enc: local server */ }
  if (!blob) { load(); setInterval(load, 60000); return; }
  MODE = 'static'; META = { salt: blob.salt, iter: blob.iter }; $('#logout').hidden = false;
  KEY = savedKey(blob.salt);
  if (KEY) { try { accept(await decryptBlob(blob, KEY)); setInterval(load, 120000); return; } catch { forgetKey(); KEY = null; } }
  showLogin();
})();
