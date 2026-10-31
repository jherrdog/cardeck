/* CARDECK — a commonplace book of index cards.
   Static app. Cards are Markdown files in a private GitHub repository you own;
   each device keeps a full copy in IndexedDB so everything is instant and works offline. */
(() => {
'use strict';
const VERSION = '1.8.0';
/* Bump when the app starts tracking a new kind of file, so every device re-reads the whole repository once. */
const TRACK_VER = 2;
try { const z = localStorage.getItem('cardeck.size'); if (z) document.documentElement.dataset.size = z; } catch (_) { }
const INBOX = '00 Inbox';
const TYPES = [['idea', 'Idea'], ['quote', 'Quote'], ['story', 'Story'], ['fact', 'Fact'], ['question', 'Question']];
const TYPE_PLURAL = { all: 'All', idea: 'Ideas', quote: 'Quotes', story: 'Stories', fact: 'Facts', question: 'Questions' };

/* ---------------- small utilities ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = new TextEncoder(), dec = new TextDecoder();
const num = n => Number(n).toLocaleString();
const icon = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function b64encode(str) { const b = enc.encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function b64urlEncode(str) { return b64encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return dec.decode(b); }
async function gitSha(text) {
  const body = enc.encode(text), head = enc.encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length); buf.set(head); buf.set(body, head.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function fmtDate(iso, long) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: long ? 'long' : 'short', day: 'numeric' });
}
function safeName(t) {
  return (t || '').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 80).trim();
}
function hueFor(name) { return hashStr(name) % 360; }
function relTime(ts) {
  if (!ts) return ''; const s = (Date.now() - ts) / 1000;
  if (s < 50) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(ts).toLocaleDateString();
}

/* ---------------- card files (Markdown + front matter) ---------------- */
const KNOWN = new Set(['category', 'also', 'type', 'quoted', 'source', 'date', 'evernote', 'projects', 'status']);
function unq(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') return v.slice(1, -1).replace(/\\(["\\n])/g, (m, c) => c === 'n' ? '\n' : c);
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
function splitList(s) {
  const out = []; let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"' && i + 1 < s.length) { cur += c + s[++i]; continue; } if (c === q) q = null; cur += c; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseVal(v) {
  v = v.trim(); if (v === '') return '';
  if (v[0] === '[' && v.at(-1) === ']') return splitList(v.slice(1, -1)).map(unq).filter(x => x !== '');
  return unq(v);
}
function parseFM(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { props: {}, order: [], body: text };
  const props = {}, order = []; let last = null;
  for (const line of m[1].split(/\r?\n/)) {
    const li = /^\s+-\s*(.*)$/.exec(line);
    if (li && last) { if (!Array.isArray(props[last])) props[last] = []; const v = unq(li[1]); if (v) props[last].push(v); continue; }
    const kv = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(line);
    if (kv) { last = kv[1]; if (!order.includes(last)) order.push(last); props[last] = parseVal(kv[2]); }
  }
  return { props, order, body: text.slice(m[0].length) };
}
const asList = v => Array.isArray(v) ? v : (v ? [v] : []);
const asStr = v => Array.isArray(v) ? v.join(', ') : (v || '');
const unlink = s => { const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(s); return m ? (m[2] || m[1]) : s; };
const q = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';

function isBookPath(p) { return /^(Books|Sermons)\/[^/]+\.md$/i.test(p); }
function isDraftPath(p) { return /^Drafts\/[^/]+\.md$/i.test(p); }
function isDevoPath(p) { return /^Devotionals\/[^/]+\.md$/i.test(p); }
function isTracked(p) { return isCardPath(p) || isBookPath(p) || isDraftPath(p) || isDevoPath(p); }
function makeDevo(path, text, sha, extra = {}) { return { kind: 'devo', path, sha: sha || null, text, title: path.split('/').pop().replace(/\.md$/i, ''), edited: extra.edited || 0 }; }
function makeDraft(path, text, sha, extra = {}) { return { kind: 'draft', path, sha: sha || null, text, title: path.split('/').pop().replace(/\.md$/i, ''), edited: extra.edited || 0 }; }
function makeDoc(path, text, sha, extra) { return isDevoPath(path) ? makeDevo(path, text, sha, extra) : isDraftPath(path) ? makeDraft(path, text, sha, extra) : isBookPath(path) ? makeBook(path, text, sha, extra) : makeCard(path, text, sha, extra); }
function docGet(p) { return S.cards.get(p) || S.books.get(p) || (S.drafts && S.drafts.get(p)) || (S.devos && S.devos.get(p)); }
function docSet(d) { (d.kind === 'book' ? S.books : d.kind === 'draft' ? (S.drafts = S.drafts || new Map()) : d.kind === 'devo' ? (S.devos = S.devos || new Map()) : S.cards).set(d.path, d); }
function docDel(p) { S.cards.delete(p); S.books.delete(p); S.drafts && S.drafts.delete(p); S.devos && S.devos.delete(p); }
function allDocs() { return [...S.cards.values(), ...S.books.values(), ...(S.drafts ? S.drafts.values() : []), ...(S.devos ? S.devos.values() : [])]; }
function isCardPath(p) { return /\.md$/i.test(p) && ((p.startsWith('Cards/') && p.split('/').length === 3) || (p.startsWith(INBOX + '/') && p.split('/').length === 2)); }
function boxOf(p) { return p.startsWith('Cards/') ? p.split('/')[1] : ''; }
function folderFor(box) { return box ? `Cards/${box}` : INBOX; }

function makeCard(path, text, sha, extra = {}) {
  const { props, order, body } = parseFM(text);
  const links = new Set();
  const take = v => asList(v).map(s => { const u = unlink(s); if (u !== s) links.add(u); return u; });
  const src = asStr(props.source); const srcU = unlink(src); if (srcU !== src) links.add(srcU);
  const c = {
    path, sha: sha || null, text, title: path.split('/').pop().replace(/\.md$/i, ''), box: boxOf(path),
    also: asList(props.also), type: (asStr(props.type) || 'idea').toLowerCase(), quoted: take(props.quoted),
    source: srcU, date: asStr(props.date), evernote: asStr(props.evernote), projects: take(props.projects),
    status: asStr(props.status), body: body.replace(/^\s*\n/, '').replace(/\s+$/, ''),
    extra: {}, extraOrder: order.filter(k => !KNOWN.has(k)), links, edited: extra.edited || 0,
  };
  for (const k of c.extraOrder) c.extra[k] = props[k];
  index(c);
  return c;
}
function index(c) {
  c.titleL = c.title.toLowerCase();
  c.hay = (c.title + '\n' + c.body + '\n' + c.quoted.join(' ') + '\n' + c.projects.join(' ') + '\n' + c.source).toLowerCase();
}
function serialize(c) {
  const L = n => q(c.links.has(n) ? `[[${n}]]` : n);
  const lines = ['---',
    `category: ${q(c.box)}`,
    `also: [${c.also.map(q).join(', ')}]`,
    `type: ${c.type || 'idea'}`,
    `quoted: [${c.quoted.map(L).join(', ')}]`,
    `source: ${c.source ? L(c.source) : '""'}`,
    `date: ${c.date || today()}`];
  if (c.evernote) lines.push(`evernote: ${q(c.evernote)}`);
  lines.push(`projects: [${c.projects.map(L).join(', ')}]`, `status: ${c.status || 'new'}`);
  for (const k of c.extraOrder) {
    const v = c.extra[k];
    lines.push(Array.isArray(v) ? `${k}: [${v.map(q).join(', ')}]` : `${k}: ${/^[\w.\-/ ]*$/.test(v) && v !== '' ? v : q(v)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n' + (c.body || '') + '\n';
}
/* A book idea is a Markdown file: the pitch, parts (#), chapters (##) with a spine paragraph, and an ordered list of card links. */
function makeBook(path, text, sha, extra = {}) {
  const { props, order, body } = parseFM(text);
  const b = { kind: 'book', doc: /^Sermons\//i.test(path) ? 'series' : 'book', path, sha: sha || null, text, title: path.split('/').pop().replace(/\.md$/i, ''), subtitle: asStr(props.subtitle), status: asStr(props.status) || 'idea',
    extra: {}, extraOrder: order.filter(k => !['type', 'subtitle', 'status'].includes(k)), pitch: '', chapters: [], edited: extra.edited || 0 };
  for (const k of b.extraOrder) b.extra[k] = props[k];
  let part = '', sec = null; const pitch = [];
  const chapter = (title) => { const ch = { title, part, note: [], needs: '', items: [] }; b.chapters.push(ch); return ch; };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^#\s+(.+)$/.exec(line))) { part = m[1].trim(); sec = null; continue; }
    if ((m = /^##\s+(.+)$/.exec(line))) { sec = /^(the pitch|the big idea)$/i.test(m[1].trim()) ? 'pitch' : chapter(m[1].trim()); continue; }
    if ((m = /^\s*[-*]\s+\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*(?:[—–-]+\s*)?(.*)$/.exec(line))) {
      const target = m[1].trim(); const item = { path: /\.md$/i.test(target) ? target : target + '.md', note: m[2].trim() };
      if (!sec || sec === 'pitch') sec = chapter('Unsorted');
      sec.items.push(item); continue;
    }
    if ((m = /^\*(?:Still needs|The thread):\*\s*(.*)$/.exec(line)) && sec && sec !== 'pitch') { sec.needs = m[1].trim(); continue; }
    if (sec === 'pitch' || !sec) pitch.push(line); else sec.note.push(line);
  }
  b.pitch = pitch.join('\n').trim();
  for (const ch of b.chapters) ch.note = ch.note.join('\n').trim();
  return b;
}
function serializeBook(b) {
  const X = LEX[b.doc || 'book']; const L = ['---', `type: ${X.type}`, `subtitle: ${q(b.subtitle || '')}`, `status: ${b.status || 'idea'}`];
  for (const k of b.extraOrder) { const v = b.extra[k]; L.push(Array.isArray(v) ? `${k}: [${v.map(q).join(', ')}]` : `${k}: ${q(v)}`); }
  L.push('---', `## ${X.pitch}`, '', b.pitch || '', '');
  let part = null;
  for (const ch of b.chapters) {
    if ((ch.part || '') !== (part || '') && ch.part) L.push(`# ${ch.part}`, '');
    part = ch.part || part;
    L.push(`## ${ch.title || 'Untitled ' + X.unit}`, '');
    if (ch.note) L.push(ch.note, '');
    if (ch.needs) L.push(`*${X.needs}:* ${ch.needs}`, '');
    for (const it of ch.items) L.push(`- [[${it.path.replace(/\.md$/i, '')}]]${it.note ? ' — ' + it.note : ''}`);
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
function plain(md) {
  return md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*|__/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$|[.,;:!?])/g, '$1')
    .replace(/^>\s?/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}
function renderMd(md) {
  const inline = s => esc(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  const blocks = (md || '').replace(/\r/g, '').split(/\n\s*\n/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*>/.test(l))) return `<blockquote>${lines.map(l => inline(l.replace(/^\s*>\s?/, ''))).join('<br>')}</blockquote>`;
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cardeck', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('cards', { keyPath: 'path' }); d.createObjectStore('kv'); d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), s = t.objectStore(store); let out;
      const r = fn(s); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  all(store) { return this.req(store, 'readonly', s => s.getAll()); },
  get(key) { return this.req('kv', 'readonly', s => s.get(key)); },
  set(key, val) { return this.req('kv', 'readwrite', s => s.put(val, key)); },
  putCards(cards) { return this.req('cards', 'readwrite', s => { for (const c of cards) s.put({ path: c.path, sha: c.sha, text: c.text, edited: c.edited || 0 }); }); },
  delCards(paths) { return this.req('cards', 'readwrite', s => { for (const p of paths) s.delete(p); }); },
  addOp(op) { return this.req('outbox', 'readwrite', s => s.add(op)); },
  firstOp() { return new Promise((res, rej) => { const r = this.db.transaction('outbox', 'readonly').objectStore('outbox').openCursor(); r.onsuccess = () => res(r.result ? r.result.value : null); r.onerror = () => rej(r.error); }); },
  delOp(id) { return this.req('outbox', 'readwrite', s => s.delete(id)); },
  clearAll() { return Promise.all(['cards', 'kv', 'outbox'].map(n => this.req(n, 'readwrite', s => s.clear()))); },
};

/* ---------------- GitHub ---------------- */
class GitHub {
  constructor(s) { this.s = s; this.base = `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`; }
  async req(method, path, body, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.once(method, path, body, opts); }
      catch (e) {
        const busy = e.offline || e.status >= 500 || e.status === 429 || (e.status === 403 && /rate limit/i.test(e.message));
        if (!busy || attempt >= 3 || (e.offline && !navigator.onLine)) throw e;
        await sleep(e.retryAfter ? e.retryAfter * 1000 : 1500 * (attempt + 1) ** 2);
      }
    }
  }
  async once(method, path, body, opts) {
    let res;
    try {
      res = await fetch(path.startsWith('http') ? path : this.base + path, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${this.s.token}`, Accept: opts.accept || 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { const err = new Error('You appear to be offline.'); err.offline = true; throw err; }
    if (!res.ok) {
      if ((opts.allow || []).includes(res.status)) return null;
      let msg = ''; try { msg = (await res.json()).message || ''; } catch (_) { }
      const err = new Error(msg || res.statusText || `GitHub error ${res.status}`); err.status = res.status;
      const ra = +res.headers.get('retry-after'); if (ra) err.retryAfter = Math.min(ra, 60); throw err;
    }
    if (res.status === 204) return null;
    return opts.raw ? res.text() : res.json();
  }
  enc(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  repo() { return this.req('GET', ''); }
  async head() {
    try { const r = await this.req('GET', `/git/ref/heads/${encodeURIComponent(this.s.branch)}`); return r.object.sha; }
    catch (e) { if (e.status === 409 || e.status === 404) return null; throw e; }
  }
  commit(sha) { return this.req('GET', `/git/commits/${sha}`); }
  tree(sha) { return this.req('GET', `/git/trees/${sha}?recursive=1`); }
  blob(sha) { return this.req('GET', `/git/blobs/${sha}`, null, { accept: 'application/vnd.github.raw+json', raw: true }); }
  meta(path) { return this.req('GET', `/contents/${this.enc(path)}?ref=${encodeURIComponent(this.s.branch)}`, null, { allow: [404] }); }
  put(path, text, sha, message) { return this.req('PUT', `/contents/${this.enc(path)}`, { message, content: b64encode(text), branch: this.s.branch, ...(sha ? { sha } : {}) }); }
  del(path, sha, message) { return this.req('DELETE', `/contents/${this.enc(path)}`, { message, sha, branch: this.s.branch }); }
  createBlob(text) { return this.req('POST', '/git/blobs', { content: b64encode(text), encoding: 'base64' }).then(r => r.sha); }
  async ensureInit() {
    let h = await this.head(); if (h) return h;
    await this.req('PUT', '/contents/README.md', { message: 'Start CARDECK', content: b64encode('# CARDECK\n\nYour cards live here as Markdown files, one card per file, filed in folders by box.\n') });
    try { const r = await this.repo(); if (r.default_branch) this.s.branch = r.default_branch; } catch (_) { }
    for (let i = 0; i < 6 && !h; i++) { await sleep(600); h = await this.head(); }
    if (!h) throw new Error('GitHub did not finish creating the first commit. Try again in a minute.');
    return h;
  }
  async commitFiles(entries, message, onProgress) {
    const head = await this.ensureInit();
    let tree = (await this.commit(head)).tree.sha;
    const STEP = 120;
    for (let i = 0; i < entries.length; i += STEP) {
      const chunk = entries.slice(i, i + STEP).map(e => e.remove ? { path: e.path, mode: '100644', type: 'blob', sha: null }
        : e.blobSha ? { path: e.path, mode: '100644', type: 'blob', sha: e.blobSha } : { path: e.path, mode: '100644', type: 'blob', content: e.text });
      tree = (await this.req('POST', '/git/trees', { base_tree: tree, tree: chunk })).sha;
      onProgress && onProgress(Math.min(i + STEP, entries.length), entries.length);
    }
    const c = await this.req('POST', '/git/commits', { message, tree, parents: [head] });
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.s.branch)}`, { sha: c.sha });
    return c.sha;
  }
}

/* ---------------- state ---------------- */
const S = {
  settings: null, gh: null,
  cards: new Map(), books: new Map(), boxes: [],
  view: { kind: 'desk' }, q: '', type: 'all', sort: 'new', seed: Math.random(),
  list: [], reader: null, outbox: 0,
  sync: { state: 'local', text: 'This device', last: 0, busy: false },
  loading: null, // {done,total,label}
};
function loadSettings() { try { return JSON.parse(localStorage.getItem('cardeck.settings') || 'null'); } catch (_) { return null; } }
/* The connection is kept in three places so the app opens connected every time:
   localStorage, IndexedDB, and (in a browser tab) a first-party cookie. iPhone, iPad and Mac copy a site's cookies
   into a Home Screen or Dock app at the moment it is added, so adding CARDECK from a connected Safari tab
   gives the new app its connection without any setup. */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const COOKIE = 'cardeck_link';
function cookiePath() { return location.pathname.replace(/[^/]*$/, '') || '/'; }
function writeCookie(s) {
  try {
    if (s && s.mode === 'github') document.cookie = `${COOKIE}=${b64urlEncode(JSON.stringify({ owner: s.owner, repo: s.repo, branch: s.branch || '', token: s.token }))}; Max-Age=31536000; Path=${cookiePath()}; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
    else document.cookie = `${COOKIE}=; Max-Age=0; Path=${cookiePath()}`;
  } catch (_) { }
}
function readCookie() {
  try { const m = document.cookie.split(/;\s*/).find(x => x.startsWith(COOKIE + '=')); if (!m) return null; const v = JSON.parse(b64urlDecode(m.slice(COOKIE.length + 1))); return v.owner && v.repo && v.token ? { mode: 'github', owner: v.owner, repo: v.repo, branch: v.branch || '', token: v.token } : null; } catch (_) { return null; }
}
function saveSettings(s) {
  S.settings = s;
  try { if (s) localStorage.setItem('cardeck.settings', JSON.stringify(s)); else localStorage.removeItem('cardeck.settings'); } catch (_) { }
  try { DB.db && DB.set('settings', s || null).catch(() => { }); } catch (_) { }
  if (!isStandalone() || !s) writeCookie(s);
  S.gh = s && s.mode === 'github' ? new GitHub(s) : null;
}
async function restoreSettings() {
  let s = loadSettings(), from = 'local';
  if (!s) { try { s = await DB.get('settings'); from = 'db'; } catch (_) { s = null; } }
  if (!s) { s = readCookie(); from = 'cookie'; }
  if (s) { saveSettings(s); if (from !== 'local') S.restored = from; }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) { }
  return s;
}

function allBoxes() {
  const names = new Set(S.boxes.map(b => b.name)); const extra = [];
  for (const c of S.cards.values()) if (c.box && !names.has(c.box)) { names.add(c.box); extra.push({ name: c.box, description: '', hue: hueFor(c.box) }); }
  return [...S.boxes, ...extra.sort((a, b) => a.name.localeCompare(b.name))];
}
function boxInfo(name) { return allBoxes().find(b => b.name === name) || { name, description: '', hue: hueFor(name) }; }
function counts() {
  const box = new Map(), proj = new Map(); let inbox = 0, starred = 0;
  for (const c of S.cards.values()) {
    if (!c.box) inbox++; else box.set(c.box, (box.get(c.box) || 0) + 1);
    for (const p of c.projects) proj.set(p, (proj.get(p) || 0) + 1);
    if (isStarred(c)) starred++;
  }
  return { box, proj, inbox, starred, total: S.cards.size };
}

/* ---------------- sync status ---------------- */
function setSync(state, text) { S.sync.state = state; S.sync.text = text; const el = $('#sync'); if (!el) return; el.dataset.state = state; $('#sync-text').textContent = text; el.title = state === 'local' ? 'Cards are stored on this device only' : 'Sync now'; }
function syncIdle() {
  if (!S.gh) return setSync('local', 'This device only');
  if (!navigator.onLine) return setSync('offline', S.outbox ? `Offline, ${S.outbox} to save` : 'Offline');
  if (S.outbox) return setSync('busy', `Saving ${S.outbox}…`);
  setSync('ok', S.sync.last ? `Synced ${relTime(S.sync.last)}` : 'Synced');
}

/* ---------------- persistence & sync engine ---------------- */
async function loadLocal() {
  const [rows, boxes, last] = await Promise.all([DB.all('cards'), DB.get('boxes'), DB.get('lastSync')]);
  S.boxes = boxes || [];
  S.sync.last = last || 0;
  S.cards = new Map(); S.books = new Map(); S.drafts = new Map(); S.devos = new Map();
  for (const r of rows) { if (!isTracked(r.path)) continue; const d = makeDoc(r.path, r.text, r.sha, { edited: r.edited }); docSet(d); }
  S.outbox = (await DB.all('outbox')).length;
}
async function pendingPaths() { return new Set((await DB.all('outbox')).map(o => o.path)); }

async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, run)); }

let syncPromise = null;
function sync(opts = {}) { if (!S.gh) { syncIdle(); return Promise.resolve(); } if (syncPromise) return syncPromise; syncPromise = doSync(opts).finally(() => { syncPromise = null; }); return syncPromise; }
async function doSync({ quiet } = {}) {
  setSync('busy', 'Syncing…');
  try {
    const flushed = await flush(); if (!flushed) return;
    const head = await S.gh.head();
    if (!head) { syncIdle(); return; }
    const lastHead = await DB.get('lastHead');
    if (head === lastHead && S.cards.size && await DB.get('trackVer') === TRACK_VER) { S.sync.last = Date.now(); await DB.set('lastSync', S.sync.last); syncIdle(); return; }
    const commit = await S.gh.commit(head);
    const tree = await S.gh.tree(commit.tree.sha);
    const remote = new Map(); const snaps = []; let boxesSha = null;
    for (const e of tree.tree) if (e.type === 'blob') {
      if (isTracked(e.path)) remote.set(e.path, e.sha);
      else if (/^\.cardeck\/snapshot(-\d+)?\.json$/.test(e.path)) snaps.push(e);
      else if (e.path === '.cardeck/boxes.json') boxesSha = e.sha;
    }
    if (boxesSha && boxesSha !== await DB.get('boxesSha')) {
      try { const j = JSON.parse(await S.gh.blob(boxesSha)); S.boxes = j.boxes || []; await DB.set('boxes', S.boxes); await DB.set('boxesSha', boxesSha); } catch (_) { }
    }
    const pending = await pendingPaths();
    const need = [];
    for (const [p, sha] of remote) { if (pending.has(p) || bookTimers.has(p)) continue; const c = docGet(p); if (!c || c.sha !== sha) need.push([p, sha]); }
    const gone = allDocs().filter(c => !remote.has(c.path) && !pending.has(c.path) && !bookTimers.has(c.path) && c.sha).map(c => c.path);
    const changed = [];
    let snap = null;
    if (need.length > 40 && snaps.length) {
      S.loading = { done: 0, total: need.length, label: 'Downloading your cards' }; renderLoading();
      snap = { files: {} };
      await pool(snaps, 4, async e => { try { Object.assign(snap.files, JSON.parse(await S.gh.blob(e.sha)).files || {}); } catch (_) { } });
    }
    const fetchList = [];
    for (const [p, sha] of need) {
      const s = snap && snap.files && snap.files[p];
      if (s && s.sha === sha) changed.push(makeDoc(p, s.text, sha)); else fetchList.push([p, sha]);
    }
    if (S.loading) { S.loading.done = changed.length; renderLoading(); }
    await pool(fetchList, 6, async ([p, sha]) => {
      const text = await S.gh.blob(sha); changed.push(makeDoc(p, text, sha));
      if (S.loading) { S.loading.done++; if (S.loading.done % 25 === 0) renderLoading(); }
    });
    for (const c of changed) { const old = docGet(c.path); c.edited = old ? old.edited : 0; docSet(c); }
    for (const p of gone) docDel(p);
    if (changed.length) await DB.putCards(changed);
    if (gone.length) await DB.delCards(gone);
    await DB.set('lastHead', head); await DB.set('trackVer', TRACK_VER);
    S.sync.last = Date.now(); await DB.set('lastSync', S.sync.last);
    S.loading = null;
    if (changed.length || gone.length) render();
    syncIdle();
    if (fetchList.filter(([p]) => isCardPath(p)).length > 150) rebuildSnapshot(snaps.map(e => e.path)).catch(() => { });
  } catch (e) {
    S.loading = null;
    if (e.offline) setSync('offline', S.outbox ? `Offline, ${S.outbox} to save` : 'Offline');
    else if (e.status === 401) setSync('error', 'Reconnect needed');
    else if (e.status === 403 || e.status === 404) setSync('error', 'No access to repository');
    else setSync('error', 'Sync problem');
    if (!quiet && !e.offline) toast(e.status === 401 ? 'GitHub rejected the access token. Open Settings to reconnect.' : `Sync failed: ${e.message}`);
    render();
  }
}

let flushing = false;
async function flush() {
  if (!S.gh) return true;
  if (flushing) return true; flushing = true;
  try {
    for (;;) {
      const op = await DB.firstOp(); if (!op) break;
      setSync('busy', `Saving ${S.outbox}…`);
      try {
        if (op.kind === 'put') {
          const cur = docGet(op.path); let sha = cur ? cur.sha : op.sha;
          let r;
          try { r = await S.gh.put(op.path, op.text, sha, op.msg); }
          catch (e) {
            if (e.status !== 409 && e.status !== 422) throw e;
            const m = await S.gh.meta(op.path); r = await S.gh.put(op.path, op.text, m && m.sha, op.msg);
          }
          const c = docGet(op.path);
          if (c && c.text === op.text) { c.sha = r.content.sha; await DB.putCards([c]); }
        } else if (op.kind === 'del') {
          try { await S.gh.del(op.path, op.sha, op.msg); }
          catch (e) {
            if (e.status === 404) { /* already gone */ }
            else if (e.status === 409 || e.status === 422) { const m = await S.gh.meta(op.path); if (m && m.sha) await S.gh.del(op.path, m.sha, op.msg); }
            else throw e;
          }
        }
        await DB.delOp(op.id); S.outbox = Math.max(0, S.outbox - 1);
      } catch (e) {
        if (e.offline) { setSync('offline', `Offline, ${S.outbox} to save`); return false; }
        if (e.status === 401) { setSync('error', 'Reconnect needed'); toast('GitHub rejected the access token. Open Settings to reconnect.'); return false; }
        setSync('error', 'Save problem'); toast(`Couldn't save "${op.path.split('/').pop().replace(/\.md$/, '')}" to GitHub: ${e.message}`); return false;
      }
    }
    syncIdle(); return true;
  } finally { flushing = false; }
}
async function queue(op) { await DB.addOp(op); S.outbox++; syncIdle(); if (S.gh && !syncPromise) flush(); }

/* Quick-start copy: every card in a few ~1 MB pieces, so a new device downloads the deck in a handful of requests. */
async function snapshotEntries(cards, oldPaths = []) {
  const chunks = []; let cur = {}, size = 0;
  for (const c of cards) { if (!c.sha) continue; if (size > 900000) { chunks.push(cur); cur = {}; size = 0; } cur[c.path] = { sha: c.sha, text: c.text }; size += c.text.length + 80; }
  if (Object.keys(cur).length) chunks.push(cur);
  const entries = [];
  for (let i = 0; i < chunks.length; i++) entries.push({ path: `.cardeck/snapshot-${i + 1}.json`, blobSha: await S.gh.createBlob(JSON.stringify({ format: 'cardeck-snapshot', version: 2, files: chunks[i] })) });
  const keep = new Set(entries.map(e => e.path));
  for (const p of oldPaths) if (!keep.has(p)) entries.push({ path: p, remove: true });
  return entries;
}
async function rebuildSnapshot(oldPaths) {
  if (!S.gh) return;
  await S.gh.commitFiles(await snapshotEntries([...S.cards.values()], oldPaths), 'Refresh CARDECK quick-start copy');
}

/* ---------------- card operations ---------------- */
function uniquePath(folder, name, except) {
  const base = safeName(name) || 'Untitled'; let p = `${folder}/${base}.md`, i = 2;
  const taken = x => [...S.cards.keys()].some(k => k !== except && k.toLowerCase() === x.toLowerCase());
  while (taken(p)) p = `${folder}/${base} (${i++}).md`;
  return p;
}
async function saveCard(draft, oldPath) {
  const old = oldPath ? S.cards.get(oldPath) : null;
  const title = safeName(draft.title) || safeName(plain(draft.body).split(/\s+/).slice(0, 6).join(' ')) || 'Untitled';
  const folder = folderFor(draft.box);
  const wanted = `${folder}/${title}.md`;
  const path = old && old.path.toLowerCase() === wanted.toLowerCase() ? old.path : uniquePath(folder, title, oldPath);
  const base = old || { links: new Set(), extra: {}, extraOrder: [], evernote: '', status: 'new' };
  const c = {
    ...base, path, title: path.split('/').pop().replace(/\.md$/, ''), box: draft.box,
    also: draft.also.filter(a => a && a !== draft.box), type: draft.type, quoted: draft.quoted, source: draft.source,
    date: draft.date || today(), projects: draft.projects, body: draft.body.replace(/\s+$/, ''), edited: Date.now(),
    sha: old && old.path === path ? old.sha : null,
  };
  c.text = serialize(c); index(c);
  if (old && old.path === path && old.text === c.text) return old;
  S.cards.set(path, c);
  await DB.putCards([c]);
  if (old && old.path !== path) { S.cards.delete(old.path); await DB.delCards([old.path]); relinkBooks(old.path, path); }
  if (S.gh) {
    await queue({ kind: 'put', path, text: c.text, sha: c.sha, msg: old ? `Edit card: ${c.title}` : `New card: ${c.title}` });
    if (old && old.path !== path) await queue({ kind: 'del', path: old.path, sha: old.sha, msg: `Move card: ${c.title}` });
  }
  return c;
}
async function deleteCard(path) {
  const c = S.cards.get(path); if (!c) return;
  S.cards.delete(path); await DB.delCards([path]);
  if (S.gh) await queue({ kind: 'del', path, sha: c.sha, msg: `Delete card: ${c.title}` });
  relinkBooks(path, null);
}

/* ---------------- views ---------------- */
const view = () => $('#view');
function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h.startsWith('connect=')) return { kind: 'connect', data: location.hash.split('connect=')[1] };
  if (h === 'all') return { kind: 'all' };
  if (h === 'inbox') return { kind: 'inbox' };
  if (h === 'starred') return { kind: 'starred' };
  if (h === 'devotionals') return { kind: 'devos' };
  if (h === 'advent') return { kind: 'advent' };
  if (/^advent\/\d{4}-\d{2}-\d{2}$/.test(h)) return { kind: 'advent', date: h.slice(7) };
  if (h.startsWith('devo/')) { const m = /^devo\/(.+)\/(\d+)$/.exec(h); if (m) return { kind: 'devo', name: m[1], n: +m[2] }; return { kind: 'devos' }; }
  if (h.startsWith('compile/book/')) return { kind: 'compile', doc: 'book', name: h.slice(13) };
  if (h.startsWith('compile/series/')) return { kind: 'compile', doc: 'series', name: h.slice(15) };
  if (h.startsWith('box/')) return { kind: 'box', name: h.slice(4) };
  if (h.startsWith('project/')) return { kind: 'project', name: h.slice(8) };
  if (h.startsWith('card/')) return { kind: 'card', path: h.slice(5) };
  if (h === 'new') return { kind: 'new' };
  if (h === 'books') return { kind: 'books', doc: 'book' };
  if (h === 'sermons') return { kind: 'books', doc: 'series' };
  if (h.startsWith('book/')) return { kind: 'book', doc: 'book', name: h.slice(5) };
  if (h.startsWith('series/')) return { kind: 'book', doc: 'series', name: h.slice(7) };
  return { kind: 'desk' };
}
function hashFor(v) {
  if (v.kind === 'all') return '#/all'; if (v.kind === 'inbox') return '#/inbox'; if (v.kind === 'starred') return '#/starred';
  if (v.kind === 'advent') return v.date ? '#/advent/' + v.date : '#/advent';
  if (v.kind === 'devos') return '#/devotionals'; if (v.kind === 'devo') return '#/devo/' + encodeURIComponent(v.name) + '/' + v.n;
  if (v.kind === 'compile') return `#/compile/${v.doc}/` + encodeURIComponent(v.name);
  if (v.kind === 'box') return '#/box/' + encodeURIComponent(v.name);
  if (v.kind === 'project') return '#/project/' + encodeURIComponent(v.name);
  if (v.kind === 'books') return LEX[v.doc].allHash;
  if (v.kind === 'book') return LEX[v.doc].oneHash + encodeURIComponent(v.name);
  return '#/';
}
function tokens() { return (S.q.toLowerCase().match(/"[^"]+"|\S+/g) || []).map(t => t.replace(/^"|"$/g, '')).filter(Boolean); }
function baseList(v) {
  const all = [...S.cards.values()];
  if (v.kind === 'inbox') return all.filter(c => !c.box);
  if (v.kind === 'starred') return all.filter(isStarred);
  if (v.kind === 'box') return all.filter(c => c.box === v.name || c.also.includes(v.name));
  if (v.kind === 'project') return all.filter(c => c.projects.includes(v.name));
  return all;
}
function sortList(list) {
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || a.titleL.localeCompare(b.titleL);
  if (S.sort === 'old') return list.sort((a, b) => -byDate(a, b));
  if (S.sort === 'az') return list.sort((a, b) => a.titleL.localeCompare(b.titleL));
  if (S.sort === 'shuffle') return list.sort((a, b) => hashStr(a.path + S.seed) - hashStr(b.path + S.seed));
  return list.sort(byDate);
}
function searchList(list, toks) {
  const out = [];
  for (const c of list) {
    let ok = true, score = 0;
    for (const t of toks) { if (!c.hay.includes(t)) { ok = false; break; } if (c.titleL.includes(t)) score += 10; }
    if (ok) { c._score = score; out.push(c); }
  }
  return out.sort((a, b) => b._score - a._score || (b.date || '').localeCompare(a.date || ''));
}
function hl(text, toks) {
  if (!toks.length) return esc(text);
  const re = new RegExp(toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) { out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
  return out + esc(text.slice(last));
}
function excerpt(c, toks, max = 420) {
  const p = plain(c.body); const cut = s => s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
  if (!toks.length) return cut(p);
  const low = p.toLowerCase(); let i = -1;
  for (const t of toks) { const j = low.indexOf(t); if (j >= 0 && (i < 0 || j < i)) i = j; }
  if (i < 90) return cut(p);
  const s = p.lastIndexOf(' ', i - 60); return '…' + cut(p.slice(s + 1));
}
function tileHTML(c, toks = [], cls = '') {
  const corner = c.box || 'Inbox';
  const flag = c.quoted.length ? c.quoted[0] : '';
  return `<button class="tile ${c.type === 'quote' ? 'is-quote' : ''} ${cls}" data-path="${esc(c.path)}" aria-label="${esc(c.title)}">`
    + `<span class="corner">${esc(corner)}</span>`
    + `<span class="tile-title" style="display:block">${isStarred(c) ? '<span class="star-mark" aria-label="Starred">★</span>' : ''}${hl(c.title, toks)}</span>`
    + `<span class="tile-text">${hl(excerpt(c, toks, cls === 'daycard' ? 900 : 420), toks)}</span>`
    + (flag && cls !== 'daycard' ? `<span class="tile-flag">${esc(flag)}</span>` : '')
    + (c.date ? `<span class="tile-date">${esc(fmtDate(c.date))}</span>` : '')
    + `</button>`;
}

let gridObserver = null;
function renderGrid(container, list, toks) {
  const grid = document.createElement('div'); grid.className = 'grid'; container.appendChild(grid);
  let i = 0; const STEP = 60;
  const sentinel = document.createElement('div'); sentinel.className = 'more'; container.appendChild(sentinel);
  const more = () => { const chunk = list.slice(i, i + STEP); i += chunk.length; grid.insertAdjacentHTML('beforeend', chunk.map(c => tileHTML(c, toks)).join('')); if (i >= list.length) { gridObserver && gridObserver.disconnect(); sentinel.remove(); } };
  more();
  if (gridObserver) gridObserver.disconnect();
  if (i < list.length) { gridObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '1200px' }); gridObserver.observe(sentinel); }
}

function renderNav() {
  const cn = counts(); const v = S.view; const cur = (k, n) => v.kind === k && (n === undefined || v.name === n) && !S.q ? 'aria-current="page"' : '';
  $('#nav-main').innerHTML = `
    <a class="nav-item" href="#/" ${cur('desk')}>${icon('desk')}Desk</a>
    <a class="nav-item" href="#/inbox" ${cur('inbox')}>${icon('inbox')}Inbox${cn.inbox ? `<span class="badge">${num(cn.inbox)}</span>` : ''}</a>
    <a class="nav-item" href="#/all" ${cur('all')}>${icon('stack')}All cards<span class="count">${num(cn.total)}</span></a>
    <a class="nav-item" href="#/starred" ${cur('starred')}>${icon('star')}Starred<span class="count">${num(cn.starred)}</span></a>
    ${['book', 'series'].map(d => `<a class="nav-item" href="${LEX[d].allHash}" ${(v.kind === 'books' || v.kind === 'book') && v.doc === d && !S.q ? 'aria-current="page"' : ''}>${icon(d === 'book' ? 'book' : 'pulpit')}${LEX[d].tab}<span class="count">${num(sortedBooks(d).length)}</span></a>`).join('')}
    ${adventDoc() ? `<a class="nav-item" href="#/advent" ${v.kind === 'advent' && !S.q ? 'aria-current="page"' : ''}>${icon('candle')}Advent<span class="count">${num(adventParse(adventDoc()).days.length)}</span></a>` : ''}
    <a class="nav-item" href="#/devotionals" ${(v.kind === 'devos' || v.kind === 'devo') && !S.q ? 'aria-current="page"' : ''}>${icon('flame')}Devotionals<span class="count">${num(devoAll().length)}</span></a>`;
  $('#nav-boxes').innerHTML = `<div class="nav-head"><span>Boxes</span></div>` + allBoxes().map(b =>
    `<a class="nav-item" href="${hashFor({ kind: 'box', name: b.name })}" ${cur('box', b.name)}><span class="tab" style="--h:${b.hue}"></span>${esc(b.name)}<span class="count">${num(cn.box.get(b.name) || 0)}</span></a>`).join('');
  const projs = [...cn.proj.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  $('#nav-projects').innerHTML = projs.length ? `<div class="nav-head"><span>Projects</span></div>` + projs.map(([p, n]) =>
    `<a class="nav-item" href="${hashFor({ kind: 'project', name: p })}" ${cur('project', p)}>${icon('folder')}${esc(p)}<span class="count">${num(n)}</span></a>`).join('') : '';
}

function render() {
  renderMain();
  if (S.coach && S.coach.open) { renderCoach(); observeChapters(); if (S.view.kind === 'book') focusChapter(S.coach.ci || 0); }
  const cb = $('#coach-btn'); if (cb) cb.setAttribute('aria-pressed', !!(S.coach && S.coach.open));
  const k = S.view.kind, d = S.view.doc;
  const tab = k === 'desk' ? 'desk' : k === 'advent' ? 'advent' : (k === 'devos' || k === 'devo') ? 'devos' : (k === 'books' || k === 'book' || k === 'compile') ? (d === 'series' ? 'sermons' : 'books') : 'boxes';
  $$('#tabbar [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  { const at = $('#tabbar [data-tab="advent"]'); if (at) at.hidden = !(adventDoc() && (advSeason() || k === 'advent')); }
  document.body.dataset.view = k;
}
function renderMain() {
  renderNav();
  const el = view(); el.innerHTML = '';
  if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
  if (!S.cards.size) return renderEmptyDeck(el);
  const toks = tokens();
  if (toks.length) return renderSearch(el, toks);
  if (S.view.kind === 'desk') return renderDesk(el);
  if (S.view.kind === 'devos') return renderDevos(el);
  if (S.view.kind === 'advent') return renderAdvent(el);
  if (S.view.kind === 'devo') return renderDevo(el);
  if (S.view.kind === 'books') return renderBooks(el, S.view.doc);
  if (S.view.kind === 'book') { const b = curBook(); if (b) return renderBook(el, b); return renderBooks(el, S.view.doc); }
  if (S.view.kind === 'compile') { const b = bookByName(S.view.name, S.view.doc); if (b) return renderCompile(el, b); return renderBooks(el, S.view.doc); }
  renderList(el);
}
function renderLoading() {
  if (!S.loading || S.cards.size > 200) return;
  const el = view(); const l = S.loading; const pct = l.total ? Math.round(100 * l.done / l.total) : 0;
  el.innerHTML = `<div class="empty"><h3>${esc(l.label)}…</h3><p>${num(l.done)} of ${num(l.total)} cards. This happens once per device; after that everything opens instantly, even offline.</p><div class="progress" style="max-width:360px;margin:0 auto"><i style="width:${pct}%"></i></div></div>`;
}
function renderEmptyDeck(el) {
  if (S.loading) return renderLoading();
  el.innerHTML = `<div class="empty"><h3>Your deck is empty</h3><p>${S.settings ? 'Add your first card, or import your cards from Settings.' : 'Connect your card repository on GitHub, or start on this device.'}</p><div class="prow" style="justify-content:center">${S.settings ? `<button class="btn btn-primary" data-act="new">${icon('plus')}New card</button><button class="btn" data-act="settings">Open settings</button>` : `<button class="btn btn-primary" data-act="setup">Set up CARDECK</button>`}</div></div>`;
}
function renderSearch(el, toks) {
  const list = searchList([...S.cards.values()], toks); S.list = list.map(c => c.path);
  el.insertAdjacentHTML('beforeend', `<div class="view-head"><div><h1 class="view-title">${num(list.length)} ${list.length === 1 ? 'card' : 'cards'}</h1><p class="view-sub">matching “${esc(S.q.trim())}” across every box</p></div></div>`);
  if (!list.length) { el.insertAdjacentHTML('beforeend', `<div class="empty"><h3>No card says that</h3><p>Try fewer words, or put an exact phrase in quotes.</p></div>`); return; }
  renderGrid(el, list, toks);
}
function renderList(el) {
  const v = S.view; const cn = counts();
  let title = 'All cards', sub = `Every card in every box. ${num(cn.total)} in all.`, hue = null;
  if (v.kind === 'inbox') { title = 'Inbox'; sub = 'New cards wait here. Give each one a box when it still matters a week later.'; }
  if (v.kind === 'box') { const b = boxInfo(v.name); title = b.name; sub = b.description || ''; hue = b.hue; }
  if (v.kind === 'project') { title = v.name; sub = 'Cards pulled into this project.'; }
  if (v.kind === 'starred') { title = 'Starred'; sub = 'The cards you marked with a star. Tap the star on any open card to add it here.'; }
  const base = baseList(v);
  const typeCounts = {}; for (const c of base) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
  const filtered = S.type === 'all' ? base : base.filter(c => c.type === S.type);
  const list = sortList(filtered.slice()); S.list = list.map(c => c.path);
  el.insertAdjacentHTML('beforeend', `
    <div class="view-head"><div><h1 class="view-title">${esc(title)}</h1>${sub ? `<p class="view-sub">${esc(sub)}</p>` : ''}</div>
      <div class="view-actions">${list.length ? `<button class="btn" data-act="shuffle">${icon('shuffle')}Draw a card</button>` : ''}</div></div>
    <div class="toolbar"><div class="chips" role="group" aria-label="Kind of card">
      ${['all', ...TYPES.map(t => t[0])].filter(t => t === 'all' || typeCounts[t]).map(t => `<button class="chip" data-type="${t}" aria-pressed="${S.type === t}">${TYPE_PLURAL[t]}<span class="n">${num(t === 'all' ? base.length : typeCounts[t])}</span></button>`).join('')}
    </div>
    <label class="sr" for="sort">Sort</label>
    <select class="select" id="sort">${[['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'A to Z'], ['shuffle', 'Shuffled']].map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`);
  if (!list.length) {
    el.insertAdjacentHTML('beforeend', v.kind === 'inbox' ? `<div class="empty"><h3>Inbox zero</h3><p>Every card has a box. New cards you write land here first.</p><button class="btn btn-primary" data-act="new">${icon('plus')}New card</button></div>`
      : v.kind === 'starred' ? `<div class="empty"><h3>No starred cards yet</h3><p>Open any card and tap the star. Your favorites collect here.</p></div>` : `<div class="empty"><h3>Nothing here yet</h3><p>Cards you file in this box will show up here.</p><button class="btn btn-primary" data-act="new">${icon('plus')}New card</button></div>`);
    return;
  }
  renderGrid(el, list);
}
function dayCard(reroll) {
  const pool = [...S.cards.values()].filter(c => c.box && c.body.length > 80);
  if (!pool.length) return null;
  if (reroll) return pool[Math.floor(Math.random() * pool.length)];
  return pool[hashStr(today()) % pool.length];
}
function renderDesk(el) {
  const cn = counts(); S.list = [];
  const dc = S.deskCard && S.cards.get(S.deskCard) || dayCard(false); if (dc) S.deskCard = dc.path;
  const d = new Date(); const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yr = String(d.getFullYear());
  let otd = [...S.cards.values()].filter(c => c.date && c.date.slice(5) === md && c.date.slice(0, 4) !== yr);
  let otdLabel = 'On this day';
  if (otd.length < 3) {
    const near = new Set(); for (let k = -3; k <= 3; k++) { const x = new Date(d); x.setDate(d.getDate() + k); near.add(`${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
    otd = [...S.cards.values()].filter(c => c.date && near.has(c.date.slice(5)) && c.date.slice(0, 4) !== yr); otdLabel = 'This week, other years';
  }
  otd.sort((a, b) => b.date.localeCompare(a.date)); otd = otd.slice(0, 12);
  const recent = [...S.cards.values()].filter(c => c.edited).sort((a, b) => b.edited - a.edited).slice(0, 12);
  const hour = d.getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const b = dc ? boxInfo(dc.box) : null;
  el.innerHTML = `
    <section class="desk-hero">
      <div class="daycard-wrap">${dc ? tileHTML(dc, [], 'daycard') : ''}</div>
      <div class="desk-side">
        <h2>${greet}. Here’s a card from ${esc(b ? b.name : 'your deck')}.</h2>
        <p>${dc && dc.date ? `You wrote it ${fmtDate(dc.date, true)}.` : ''} ${num(cn.total)} cards in ${num(cn.box.size)} boxes are on your desk.</p>
        <div class="row"><button class="btn" data-act="reroll">${icon('shuffle')}Draw another</button>${dc ? `<button class="btn btn-quiet" data-open="${esc(dc.path)}">Read it</button>` : ''}</div>
        ${S.gh && !isStandalone() && /iPhone|iPad|Macintosh/.test(navigator.userAgent) && !localStorage.getItem('cardeck.a2hs') ? `<div class="inbox-note a2hs">${icon('share')}<span><b>Make it an app.</b> ${/iPhone|iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? 'Tap Share, then <b>Add to Home Screen</b>.' : 'In Safari choose File → <b>Add to Dock</b>.'} It opens already connected, no setup.</span><button class="icon-btn" data-act="dismiss-a2hs" aria-label="Dismiss">${icon('x')}</button></div>` : ''}
        ${S.books.size ? `<button class="inbox-note coach-note" data-act="coach">${icon('spark')}<span><b>Writing coach.</b> Pick up where you left off in ${esc((coachBook() || {}).title || 'your book')}.</span></button>` : ''}
        ${cn.inbox ? `<button class="inbox-note" data-go="#/inbox">${icon('inbox')}<span><b>${num(cn.inbox)} ${cn.inbox === 1 ? 'card is' : 'cards are'} waiting in your Inbox.</b> File them when you’re ready.</span></button>` : ''}
      </div>
    </section>
    ${otd.length ? `<section class="desk-section"><div class="section-head"><h2>${otdLabel}</h2><p>${fmtDate(today(), true).replace(/,? \d{4}$/, '')}, in years past</p></div><div class="strip">${otd.map(c => tileHTML(c)).join('')}</div></section>` : ''}
    ${recent.length ? `<section class="desk-section"><div class="section-head"><h2>Recently edited</h2><p>On this device</p></div><div class="strip">${recent.map(c => tileHTML(c)).join('')}</div></section>` : ''}
    ${adventDeskHTML()}
    ${devoDeskHTML()}
    ${postHTML()}
    ${quoteHTML()}
    ${(() => { const st = [...S.cards.values()].filter(isStarred).sort((x, y) => (y.edited || 0) - (x.edited || 0)).slice(0, 12); return st.length ? `<section class="desk-section"><div class="section-head"><h2>Starred</h2><p><a class="crumb" href="#/starred">See all</a></p></div><div class="strip">${st.map(c => tileHTML(c)).join('')}</div></section>` : ''; })()}
    ${S.books.size ? `<section class="desk-section"><div class="section-head"><h2>On the floor</h2><p>Book ideas and sermon series you’re arranging</p></div><div class="covers covers-strip">${sortedBooks().slice(0, 8).map(coverHTML).join('')}</div></section>` : ''}
    <section class="desk-section"><div class="section-head"><h2>Your boxes</h2><p>Pick one and flip through it.</p></div>
      <div class="dividers">${allBoxes().map(x => `<a class="divider" href="${hashFor({ kind: 'box', name: x.name })}" style="--h:${x.hue}"><span class="divider-tab">${esc(x.name)}</span><span class="divider-body"><span class="divider-name">${esc(x.name)}</span><span class="divider-desc">${esc(x.description || '')}</span><span class="divider-count">${num(cn.box.get(x.name) || 0)} cards</span></span></a>`).join('')}</div>
    </section>`;
}

/* ---------------- reader & editor ---------------- */
let lastFocus = null;
function openReader(path, { edit = false, isNew = false, replace = false } = {}) {
  if (!isNew && !S.cards.has(path)) { toast('That card isn’t in your deck any more.'); return; }
  lastFocus = lastFocus || document.activeElement;
  S.reader = { path, flipped: false, editing: edit || isNew, isNew, draft: null };
  const want = isNew ? '#/new' : '#/card/' + encodeURIComponent(path);
  if (location.hash !== want) { if (replace || S.readerPushed) history.replaceState(null, '', want); else { history.pushState(null, '', want); S.readerPushed = true; } }
  showOverlay(); renderReader();
}
function showOverlay() {
  const sc = $('#scrim'), rd = $('#reader'), dk = $('#dock');
  sc.hidden = false; rd.hidden = false; dk.hidden = false; document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => sc.classList.add('open'));
}
function hideOverlay() {
  const sc = $('#scrim'); sc.classList.remove('open');
  $('#reader').hidden = true; $('#dock').hidden = true; $('#reader').innerHTML = '';
  if ($('#panel').hidden && !$('#shell').classList.contains('drawer')) sc.hidden = true;
  document.body.style.overflow = '';
  S.reader = null;
  if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (_) { }
  lastFocus = null;
}
async function closeReader() {
  if (S.reader && S.reader.editing && isDirty() && !(await confirmBox('Discard your changes?', 'This card has edits you haven’t saved.', 'Discard'))) return;
  hideOverlay();
  if (S.readerPushed) { S.readerPushed = false; history.back(); }
  else history.replaceState(null, '', hashFor(S.view));
}
function neighbors() {
  const L = S.list.length ? S.list : [...S.cards.keys()];
  const i = S.reader ? L.indexOf(S.reader.path) : -1;
  return { prev: i > 0 ? L[i - 1] : null, next: i >= 0 && i < L.length - 1 ? L[i + 1] : null, list: L };
}
function backFace(c) {
  const fact = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const tags = a => a.length ? `<span class="tagline">${a.map(x => `<span>${esc(x)}</span>`).join('')}</span>` : '';
  return `<article class="bigcard"><span class="corner">${esc(c.box || 'Inbox')}</span>
    <div class="big-head"><h2 class="back-title">The back of the card</h2></div>
    <div class="big-body"><dl class="facts">
      ${fact('Box', esc(c.box || 'Inbox'))}
      ${fact('Also in', tags(c.also))}
      ${fact('Kind', esc((TYPES.find(t => t[0] === c.type) || [0, c.type])[1]))}
      ${fact('Who said it', esc(c.quoted.join(', ')))}
      ${fact('Source', esc(c.source))}
      ${fact('Date', esc(fmtDate(c.date, true)))}
      ${fact(/^scrivener/i.test(c.evernote || '') ? 'From Scrivener' : 'From Evernote', esc((c.evernote || '').replace(/^Scrivener \/ /i, '')))}
      ${fact('Projects', tags(c.projects))}
      ${fact('Used in', booksWith(c.path).map(({ b, ch }) => `<a class="usedin" href="${bookHash(b)}"><b>${esc(b.title)}</b> · ${esc(ch.title)}</a>`).join(''))}
    </dl></div></article>`;
}
function renderReader() {
  const r = S.reader; if (!r) return;
  const rd = $('#reader'), dk = $('#dock');
  if (r.editing) return renderEditor();
  const c = S.cards.get(r.path); if (!c) return hideOverlay();
  const { prev, next } = neighbors();
  rd.innerHTML = `<div class="reader-grab" aria-hidden="true"><span></span></div><div class="reader-inner"><div class="flip ${r.flipped ? 'flipped' : ''}"><div class="flipper">
      <div class="face front"><article class="bigcard ${c.type === 'quote' ? 'is-quote' : ''}">
        <span class="corner">${esc(c.box || 'Inbox')}</span>
        <div class="big-head"><h1 class="big-title">${esc(c.title)}</h1></div>
        <div class="big-body">${renderMd(c.body) || '<p></p>'}</div>
        ${c.date ? `<span class="card-date" title="Date created">${esc(fmtDate(c.date, true))}</span>` : ''}
      </article></div>
      <div class="face back" aria-hidden="${!r.flipped}">${backFace(c)}</div>
    </div></div></div>`;
  dk.innerHTML = `
    <button data-act="close" aria-label="Close">${icon('x')}<span class="lbl">Close</span></button>
    <span class="sep"></span>
    <button class="wide-only" data-act="prev" aria-label="Previous card" ${prev ? '' : 'disabled'}>${icon('left')}</button>
    <button class="wide-only" data-act="next" aria-label="Next card" ${next ? '' : 'disabled'}>${icon('right')}</button>
    <button class="wide-only" data-act="draw" aria-label="Draw a random card">${icon('shuffle')}<span class="lbl">Draw</span></button>
    <button data-act="flip" aria-label="Flip card" aria-pressed="${r.flipped}">${icon('flip')}<span class="lbl">${r.flipped ? 'Front' : 'Back'}</span></button>
    <button data-act="star" aria-label="${isStarred(c) ? 'Unstar' : 'Star'} this card" aria-pressed="${isStarred(c)}" class="star-btn">${icon('star')}</button>
    <button data-act="share" aria-label="Share or copy this card">${icon('share')}</button>
    <button data-act="add-to-book" aria-label="Add to a book idea or sermon series">${icon('book')}<span class="lbl">Add to…</span></button>
    <span class="sep"></span>
    <button class="primary" data-act="edit">${icon('pen')}<span class="lbl">Edit</span></button>`;
  rd.scrollTop = 0; rd.focus({ preventScroll: true });
}
function draftFrom(c) {
  return { title: c ? c.title : '', box: c ? c.box : (S.view.kind === 'box' ? S.view.name : ''), also: c ? [...c.also] : [], type: c ? c.type : 'idea',
    quoted: c ? [...c.quoted] : [], source: c ? c.source : '', date: c ? c.date : today(), projects: c ? [...c.projects] : (S.view.kind === 'project' ? [S.view.name] : []), body: c ? c.body : '' };
}
function isDirty() {
  const r = S.reader; if (!r || !r.draft) return false;
  const base = JSON.stringify(draftFrom(r.isNew ? null : S.cards.get(r.path))); readDraft();
  if (r.isNew) return !!(r.draft.title.trim() || r.draft.body.trim());
  return JSON.stringify(r.draft) !== base;
}
function readDraft() {
  const r = S.reader; if (!r || !r.draft || !$('#ed-body')) return;
  const d = r.draft;
  d.title = $('#ed-title').value.replace(/\n/g, ' ');
  d.body = $('#ed-body').value; d.box = $('#ed-box').value;
  d.quoted = $('#ed-quoted').value.split(',').map(s => s.trim()).filter(Boolean);
  d.projects = $('#ed-projects').value.split(',').map(s => s.trim()).filter(Boolean);
  d.source = $('#ed-source').value.trim(); d.date = $('#ed-date').value;
}
function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function renderEditor() {
  const r = S.reader; const c = r.isNew ? null : S.cards.get(r.path);
  if (!r.draft) r.draft = draftFrom(c);
  const d = r.draft; const boxes = allBoxes();
  const projects = [...counts().proj.keys()];
  $('#reader').innerHTML = `<div class="reader-inner">
    <article class="bigcard editing">
      <div class="ed-corner"><label class="sr" for="ed-box">Box</label><select id="ed-box">
        <option value="" ${!d.box ? 'selected' : ''}>Inbox</option>${boxes.map(b => `<option ${d.box === b.name ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="big-head"><label class="sr" for="ed-title">Title</label><textarea id="ed-title" class="ed-title" rows="1" placeholder="Name the idea">${esc(d.title)}</textarea></div>
      <div class="big-body"><label class="sr" for="ed-body">Card text</label><textarea id="ed-body" class="ed-body" placeholder="One idea. Write it so you’ll understand it years from now.">${esc(d.body)}</textarea></div>
    </article>
    <div class="props">
      <div class="prop"><span class="plabel">Kind</span><div class="seg" role="group" aria-label="Kind of card">${TYPES.map(([k, l]) => `<button type="button" data-settype="${k}" aria-pressed="${d.type === k}">${l}</button>`).join('')}</div></div>
      <div class="prop"><span class="plabel">Also belongs in</span><div class="tags" id="ed-also">${d.also.map(a => `<span class="tag">${esc(a)}<button type="button" data-unalso="${esc(a)}" aria-label="Remove ${esc(a)}">${icon('x')}</button></span>`).join('')}
        <select id="ed-addalso" aria-label="Add a second box"><option value="">Add a box</option>${boxes.filter(b => b.name !== d.box && !d.also.includes(b.name)).map(b => `<option>${esc(b.name)}</option>`).join('')}</select></div></div>
      <div class="prop"><label for="ed-quoted">Who said it</label><div><input type="text" id="ed-quoted" value="${esc(d.quoted.join(', '))}" placeholder="Leave empty if these are your words"></div></div>
      <div class="prop"><label for="ed-source">Source</label><input type="text" id="ed-source" value="${esc(d.source)}" placeholder="Book, article, sermon, conversation"></div>
      <div class="prop"><label for="ed-projects">Projects</label><div><input type="text" id="ed-projects" list="proj-list" value="${esc(d.projects.join(', '))}" placeholder="e.g. Substack: Shame and Grace"><datalist id="proj-list">${projects.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div></div>
      <div class="prop"><label for="ed-date">Date</label><input type="date" id="ed-date" value="${esc(d.date)}"></div>
    </div></div>`;
  $('#dock').innerHTML = `
    <button data-act="cancel">${icon('x')}<span class="lbl">Cancel</span></button>
    ${r.isNew ? '' : `<span class="sep"></span><button data-act="delete" aria-label="Delete card">${icon('trash')}<span class="lbl">Delete</span></button>`}
    <span class="sep"></span>
    <button class="primary" data-act="save">${icon('check')}<span class="lbl">Save card</span></button>`;
  const ta = $('#ed-body'), tt = $('#ed-title');
  [ta, tt].forEach(t => { autosize(t); t.addEventListener('input', () => autosize(t)); });
  tt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } });
  requestAnimationFrame(() => { (r.isNew ? tt : ta).focus({ preventScroll: true }); if (!r.isNew) ta.setSelectionRange(ta.value.length, ta.value.length); });
}
async function doSave() {
  readDraft(); const r = S.reader; const d = r.draft;
  if (!d.title.trim() && !d.body.trim()) { toast('Write something on the card first.'); return; }
  const c = await saveCard(d, r.isNew ? null : r.path);
  toast(r.isNew ? (c.box ? `Saved to ${c.box}` : 'Saved to your Inbox') : 'Card saved');
  S.readerPushed && history.replaceState(null, '', '#/card/' + encodeURIComponent(c.path));
  S.reader = { path: c.path, flipped: false, editing: false };
  render(); renderReader();
}
async function doDelete() {
  const r = S.reader; const c = S.cards.get(r.path); if (!c) return;
  if (!(await confirmBox('Delete this card?', `“${c.title}” will be removed from every device. Its history stays in your GitHub repository.`, 'Delete card'))) return;
  await deleteCard(c.path); r.editing = false; r.draft = null;
  hideOverlay(); if (S.readerPushed) { S.readerPushed = false; history.back(); } else history.replaceState(null, '', hashFor(S.view));
  render(); toast('Card deleted');
}

/* ---------------- book ideas & sermon series ---------------- */
/* Both are "outlines": an ordered set of sections, each holding an ordered set of card links. */
const LEX = {
  book: { folder: 'Books', type: 'book', tab: 'Book ideas', one: 'book idea', One: 'Book idea', kindLabel: 'Book', unit: 'chapter', Unit: 'Chapter', units: 'chapters',
    pitch: 'The pitch', needs: 'Still needs', needsField: 'Still needs', needsPh: 'A story, a source, a scene…', allHash: '#/books', oneHash: '#/book/', titlePh: 'A working title',
    intro: 'Each book idea is a box of cards: chapters in order, cards in order inside them. Drag the cards until the book shows itself.',
    pitchTip: 'Holiday’s test: can you say the book in one sentence? Put that sentence first.', unitPh: 'Chapter title', argues: 'What this chapter argues', first: 'First chapter',
    status: [['idea', 'Idea'], ['outlining', 'Outlining'], ['drafting', 'Drafting'], ['done', 'Done']] },
  series: { folder: 'Sermons', type: 'sermon-series', tab: 'Sermonizing', one: 'sermon series', One: 'Sermon series', kindLabel: 'Series', unit: 'sermon', Unit: 'Sermon', units: 'sermons',
    pitch: 'The big idea', needs: 'The thread', needsField: 'The thread (how these cards connect)', needsPh: 'The line that ties these cards together', allHash: '#/sermons', oneHash: '#/series/', titlePh: 'A working title',
    intro: 'Sermon series built only from your cards. Each week gathers cards that already belong together; the summary says what they say together. Drag cards between weeks to find the series.',
    pitchTip: 'One sentence the whole series keeps returning to. Use only what your cards already say.', unitPh: 'Sermon title', argues: 'What these cards say together', first: 'Week one',
    status: [['idea', 'Idea'], ['shaping', 'Shaping'], ['ready', 'Ready to preach'], ['preached', 'Preached']] },
};
const lex = b => LEX[b.doc || 'book'];
const bookTimers = new Map();
function bookHash(b) { return lex(b).oneHash + encodeURIComponent(b.title); }
function scheduleBookSave(b, delay = 900) {
  b.text = serializeBook(b); b.edited = Date.now(); S.books.set(b.path, b);
  clearTimeout(bookTimers.get(b.path));
  bookTimers.set(b.path, setTimeout(() => commitBook(b.path), delay));
}
async function commitBook(path) {
  clearTimeout(bookTimers.get(path)); bookTimers.delete(path);
  const b = S.books.get(path); if (!b) return;
  b.text = serializeBook(b);
  await DB.putCards([b]);
  if (S.gh) await queue({ kind: 'put', path, text: b.text, sha: b.sha, msg: `${lex(b).One}: ${b.title}` });
}
function flushBookSaves() { for (const p of [...bookTimers.keys()]) commitBook(p); }
function relinkBooks(oldPath, newPath) {
  for (const b of S.books.values()) {
    let hit = false;
    for (const ch of b.chapters) {
      if (newPath) { for (const it of ch.items) if (it.path === oldPath) { it.path = newPath; hit = true; } }
      else { const n = ch.items.length; ch.items = ch.items.filter(it => it.path !== oldPath); if (ch.items.length !== n) hit = true; }
    }
    if (hit) scheduleBookSave(b, 400);
  }
}
function resolveCard(b, it) {
  const c = S.cards.get(it.path); if (c) return c;
  const name = it.path.split('/').pop().replace(/\.md$/i, '').toLowerCase();
  const hits = []; for (const x of S.cards.values()) if (x.titleL === name) hits.push(x);
  if (hits.length === 1) { it.path = hits[0].path; scheduleBookSave(b, 2500); return hits[0]; }
  return null;
}
function bookCounts(b) { let n = 0; for (const ch of b.chapters) n += ch.items.length; return { chapters: b.chapters.length, cards: n }; }
function bookOrder(b) { const out = []; for (const ch of b.chapters) for (const it of ch.items) if (S.cards.has(it.path)) out.push(it.path); return out; }
function booksWith(path) { const out = []; for (const b of S.books.values()) b.chapters.forEach((ch, i) => { if (ch.items.some(it => it.path === path)) out.push({ b, ch, i }); }); return out; }
function sortedBooks(doc) { return [...S.books.values()].filter(b => !doc || b.doc === doc).sort((a, b) => (b.edited || 0) - (a.edited || 0) || a.title.localeCompare(b.title)); }
function bookByName(name, doc) { return [...S.books.values()].find(b => b.title === name && b.doc === doc); }
function uniqueBookPath(title, doc, except) {
  const base = safeName(title) || 'Untitled'; const dir = LEX[doc].folder; let p = `${dir}/${base}.md`, i = 2;
  while ([...S.books.keys()].some(k => k !== except && k.toLowerCase() === p.toLowerCase())) p = `${dir}/${base} (${i++}).md`;
  return p;
}
async function renameBook(b, title) {
  const np = uniqueBookPath(title, b.doc, b.path); if (np === b.path) return;
  const old = b.path, oldSha = b.sha;
  clearTimeout(bookTimers.get(old)); bookTimers.delete(old);
  S.books.delete(old); await DB.delCards([old]);
  b.path = np; b.title = np.split('/').pop().replace(/\.md$/i, ''); b.sha = null;
  S.books.set(np, b); await commitBook(np);
  if (S.gh && oldSha) await queue({ kind: 'del', path: old, sha: oldSha, msg: `Rename ${lex(b).one}: ${b.title}` });
}
function coverHTML(b) {
  const n = bookCounts(b), L = lex(b); const st = (L.status.find(s => s[0] === b.status) || [0, b.status])[1];
  return `<a class="cover cover-${b.doc}" href="${bookHash(b)}"><span class="cover-status">${esc(st)}</span><span class="cover-title">${esc(b.title)}</span>${b.subtitle ? `<span class="cover-sub">${esc(b.subtitle)}</span>` : ''}<span class="cover-meta"><span>${num(n.chapters)} ${L.units}</span><span>${num(n.cards)} cards</span></span></a>`;
}
function renderBooks(el, doc) {
  const L = LEX[doc], books = sortedBooks(doc); S.list = [];
  el.innerHTML = `<div class="view-head"><div><h1 class="view-title">${L.tab}</h1><p class="view-sub">${L.intro}</p></div>
    <div class="view-actions"><button class="btn btn-primary" data-act="new-book" data-doc="${doc}">${icon('plus')}New ${L.one}</button></div></div>
    ${books.length ? `<div class="covers">${books.map(coverHTML).join('')}</div>` : `<div class="empty"><h3>No ${L.one} yet</h3><p>Start one from scratch, or import an outline file in Settings.</p><button class="btn btn-primary" data-act="new-book" data-doc="${doc}">${icon('plus')}New ${L.one}</button></div>`}`;
}
function btileHTML(b, ci, ii, it) {
  const c = resolveCard(b, it);
  const menu = `<button class="bt-menu" data-btmenu="${ci}:${ii}" aria-label="Move or remove this card">${icon('grip')}</button>`;
  const note = it.note ? `<p class="bnote">${esc(it.note)}</p>` : '';
  if (!c) return `<div class="btile missing" data-ch="${ci}" data-idx="${ii}"><div class="bt-card"><div class="tile"><span class="tile-title">${esc(it.path.split('/').pop().replace(/\.md$/i, ''))}</span><span class="tile-text">This card isn’t in your deck yet. Import the file it came from, or remove it here.</span></div>${menu}</div>${note}</div>`;
  return `<div class="btile" data-ch="${ci}" data-idx="${ii}"><div class="bt-card">${tileHTML(c)}${menu}</div>${note}</div>`;
}
function draftOf(b) { return S.drafts && S.drafts.get(`Drafts/${b.title}.md`); }
function bookTabsHTML(b) {
  const t = (S.bookTabs && S.bookTabs[b.path]) || 'outline'; const d = draftOf(b);
  const w = d ? (draftBody(d).replace(/\*Built from:\*.*$/gm, '').match(/\S+/g) || []).length : 0;
  return `<div class="book-tabs" role="tablist"><button role="tab" data-btab="outline" aria-selected="${t === 'outline'}">${icon('rows')}Outline</button><button role="tab" data-btab="draft" aria-selected="${t === 'draft'}">${icon('pen')}Draft${w ? `<span class="n">${num(w)} words</span>` : ''}</button></div>`;
}
function renderBook(el, b) {
  if (S.bookTabs && S.bookTabs[b.path] === 'draft') return renderDraft(el, b);
  const L = lex(b); S.list = bookOrder(b); const n = bookCounts(b);
  let num_ = 0, part = null;
  const chapters = b.chapters.map((ch, ci) => {
    const front = /^(before|front|preface|intro)/i.test(ch.part || '');
    const label = front ? '' : String(++num_);
    let head = '';
    if (ch.part && ch.part !== part) head = `<h2 class="part">${esc(ch.part)}</h2>`;
    part = ch.part || part;
    return `${head}<section class="chapter ${S.compact && !(S.openCh && S.openCh.has(ci)) ? 'collapsed' : ''}" data-ch="${ci}" id="ch-${ci}">
      <header class="ch-head"><span class="ch-num" aria-hidden="true">${b.doc === 'series' && label ? '<small>week</small>' : ''}${label}</span><div class="ch-text"><h3 class="ch-title">${esc(ch.title)}<span class="ch-count">${ch.items.length} ${ch.items.length === 1 ? 'card' : 'cards'}</span></h3>${ch.note ? `<div class="ch-spine">${renderMd(ch.note)}</div>` : ''}${ch.needs ? `<p class="ch-needs"><b>${L.needs}:</b> ${esc(ch.needs)}</p>` : ''}</div>
        <button class="icon-btn ch-more" data-chmenu="${ci}" aria-label="${L.Unit} options">${icon('dots')}</button></header>
      <div class="ch-cards" data-ch="${ci}">${ch.items.map((it, ii) => btileHTML(b, ci, ii, it)).join('')}<button class="add-tile" data-addcards="${ci}">${icon('plus')}Add cards</button></div>
    </section>`;
  }).join('');
  el.innerHTML = `<div class="view-head"><div><a class="crumb" href="${L.allHash}">${L.tab}</a><h1 class="view-title">${esc(b.title)}</h1>${b.subtitle ? `<p class="view-sub book-sub">${esc(b.subtitle)}</p>` : ''}
      <div class="book-meta"><span>${num(n.chapters)} ${L.units}</span><span>${num(n.cards)} cards</span><label class="sr" for="book-status">Stage</label><select class="select" id="book-status">${L.status.map(([k, l]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="view-actions">${S.list.length ? `<button class="btn" data-act="book-read">${icon('stack')}Read in order</button><button class="btn" data-act="draw">${icon('shuffle')}Draw</button>` : ''}<button class="btn" data-act="edit-book">${icon('pen')}Edit ${L.pitch.toLowerCase().replace(/^the /, '')}</button><button class="btn btn-coach" data-act="coach">${icon('spark')}Coach</button></div></div>
    ${bookTabsHTML(b)}
    <div class="book-tools"><button class="btn btn-quiet" data-act="toc">${icon('list')}Chapters</button><button class="btn btn-quiet" data-act="compact" aria-pressed="${!!S.compact}">${icon('rows')}${S.compact ? 'Show cards' : 'Outline only'}</button><button class="btn btn-quiet" data-act="compile">${icon('doc')}Read as manuscript</button></div>
    ${b.pitch ? `<details class="pitch" ${b.chapters.length ? '' : 'open'}><summary>${L.pitch}</summary><div class="pitch-body">${renderMd(b.pitch)}</div></details>` : ''}
    <p class="book-hint">Drag a card to move it${matchMedia('(pointer: coarse)').matches ? ' (press and hold first)' : ''}, or use ${icon('grip', 'ico inline')} on any card.</p>
    ${chapters || `<div class="empty"><h3>No ${L.units} yet</h3><p>Add a ${L.unit}, then pull cards into it.</p></div>`}
    <div class="book-foot"><button class="btn" data-act="add-chapter">${icon('plus')}Add ${L.unit}</button></div>`;
}
const curBook = () => S.view.kind === 'book' ? bookByName(S.view.name, S.view.doc) : null;

/* menus & forms */
function closeMenu() { const m = $('#menu'); if (m) m.remove(); }
function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.id = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button role="menuitem" data-mi="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let x = Math.min(Math.max(8, r.right - w), innerWidth - w - 8), y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.addEventListener('click', e => { const b = e.target.closest('[data-mi]'); if (b) { e.stopPropagation(); closeMenu(); items[+b.dataset.mi].run(); } });
  const f = m.querySelector('button:not([disabled])'); f && f.focus({ preventScroll: true });
}
function formBox(title, fields, okLabel) {
  return new Promise(res => {
    const d = $('#dialog');
    d.innerHTML = `<h3>${esc(title)}</h3><form id="fb">${fields.map(f => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'textarea'
      ? `<textarea name="${f.name}" rows="${f.rows || 4}">${esc(f.value || '')}</textarea>`
      : f.type === 'select' ? `<select name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input name="${f.name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}
      <div class="prow"><button type="button" class="pbtn" data-r="0">Cancel</button><button type="submit" class="pbtn primary">${esc(okLabel)}</button></div></form>`;
    d.hidden = false; d.classList.add('wide');
    const done = v => { d.hidden = true; d.classList.remove('wide'); document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    $('#fb', d).addEventListener('submit', e => { e.preventDefault(); done(Object.fromEntries(new FormData(e.target))); });
    $('[data-r="0"]', d).addEventListener('click', () => done(null));
    const first = $('input,textarea,select', d); first && first.focus();
  });
}
function moveItem(b, from, to) {
  const [fc, fi] = from; const it = b.chapters[fc].items.splice(fi, 1)[0]; if (!it) return;
  let [tc, ti] = to; if (fc === tc && fi < ti) ti--;
  b.chapters[tc].items.splice(Math.max(0, Math.min(ti, b.chapters[tc].items.length)), 0, it);
  scheduleBookSave(b); render();
}
function cardMenu(anchor, b, ci, ii) {
  const L = lex(b), ch = b.chapters[ci], it = ch.items[ii];
  openMenu(anchor, [
    { label: 'Move earlier', disabled: ii === 0 && ci === 0, run: () => ii > 0 ? moveItem(b, [ci, ii], [ci, ii - 1]) : moveItem(b, [ci, ii], [ci - 1, b.chapters[ci - 1].items.length]) },
    { label: 'Move later', disabled: ii === ch.items.length - 1 && ci === b.chapters.length - 1, run: () => ii < ch.items.length - 1 ? moveItem(b, [ci, ii], [ci, ii + 2]) : moveItem(b, [ci, ii], [ci + 1, 0]) },
    { label: `Move to another ${L.unit}…`, disabled: b.chapters.length < 2, run: () => setTimeout(() => openMenu(anchor, b.chapters.map((c, k) => ({ label: c.title, disabled: k === ci, run: () => moveItem(b, [ci, ii], [k, c.items.length]) }))), 0) },
    { label: it.note ? 'Edit note' : 'Add a note', run: async () => { const v = await formBox('Why this card is here', [{ name: 'note', label: 'Note', type: 'textarea', value: it.note, rows: 3 }], 'Save note'); if (v) { it.note = v.note.replace(/\s+/g, ' ').trim(); scheduleBookSave(b); render(); } } },
    { sep: true },
    { label: `Remove from this ${L.one}`, danger: true, run: () => { ch.items.splice(ii, 1); scheduleBookSave(b); render(); toast(`Removed. The card is still in your deck.`); } },
  ]);
}
function chapterMenu(anchor, b, ci) {
  const L = lex(b), ch = b.chapters[ci];
  openMenu(anchor, [
    { label: `Edit ${L.unit}`, run: () => editChapter(b, ci) },
    { label: 'Add cards', run: () => openPicker(b, ci) },
    { label: `Move ${L.unit} up`, disabled: ci === 0, run: () => { const [c] = b.chapters.splice(ci, 1); c.part = b.chapters[ci - 1].part; b.chapters.splice(ci - 1, 0, c); scheduleBookSave(b); render(); } },
    { label: `Move ${L.unit} down`, disabled: ci === b.chapters.length - 1, run: () => { const [c] = b.chapters.splice(ci, 1); c.part = b.chapters[ci].part; b.chapters.splice(ci + 1, 0, c); scheduleBookSave(b); render(); } },
    { sep: true },
    { label: `Delete ${L.unit}`, danger: true, run: async () => { if (await confirmBox(`Delete this ${L.unit}?`, `“${ch.title}” and its order will go. Its ${ch.items.length} cards stay in your deck.`, `Delete ${L.unit}`)) { b.chapters.splice(ci, 1); scheduleBookSave(b); render(); } } },
  ]);
}
async function editChapter(b, ci) {
  const L = lex(b), isNew = ci == null; const ch = isNew ? { title: '', part: (b.chapters.at(-1) || {}).part || '', note: '', needs: '', items: [] } : b.chapters[ci];
  const v = await formBox(isNew ? `New ${L.unit}` : `Edit ${L.unit}`, [
    { name: 'title', label: `${L.Unit} title`, value: ch.title, placeholder: L.unitPh },
    { name: 'note', label: L.argues, type: 'textarea', value: ch.note, rows: 4 },
    { name: 'needs', label: L.needsField, value: ch.needs, placeholder: L.needsPh },
    { name: 'part', label: 'Part', value: ch.part, placeholder: 'e.g. Part Two' },
  ], isNew ? `Add ${L.unit}` : `Save ${L.unit}`);
  if (!v) return;
  Object.assign(ch, { title: v.title.trim() || `Untitled ${L.unit}`, note: v.note.trim(), needs: v.needs.trim(), part: v.part.trim() });
  if (isNew) b.chapters.push(ch);
  scheduleBookSave(b); render();
}
function editBook(b) {
  const L = lex(b);
  openPanel(`${panelHead(L.pitch)}
    <form id="book-form">
      <label class="field"><span>Title</span><input name="title" value="${esc(b.title)}" required></label>
      <label class="field"><span>Subtitle</span><input name="subtitle" value="${esc(b.subtitle)}"></label>
      <label class="field"><span>${L.pitch}</span><textarea name="pitch" rows="16">${esc(b.pitch)}</textarea></label>
      <p class="muted">${L.pitchTip}</p>
      <div class="prow"><button class="pbtn primary" type="submit">Save</button><button class="pbtn" type="button" data-act="close-panel">Cancel</button><span style="flex:1"></span><button class="pbtn red" type="button" data-act="delete-book">Delete ${L.one}</button></div>
    </form>`);
  $('#book-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    b.subtitle = f.get('subtitle').trim(); b.pitch = f.get('pitch').trim();
    const t = f.get('title').trim();
    if (t && t !== b.title) { await renameBook(b, t); history.replaceState(null, '', bookHash(b)); S.view = { kind: 'book', doc: b.doc, name: b.title }; }
    else scheduleBookSave(b, 200);
    closePanel(); render(); toast('Saved');
  });
}
async function newBook(doc) {
  const L = LEX[doc];
  const v = await formBox(`New ${L.one}`, [{ name: 'title', label: 'Working title', placeholder: L.titlePh }, { name: 'subtitle', label: 'Subtitle (optional)' }], `Create ${L.one}`);
  if (!v || !v.title.trim()) return;
  const path = uniqueBookPath(v.title.trim(), doc);
  const b = makeBook(path, `---\ntype: ${L.type}\nsubtitle: ${q(v.subtitle.trim())}\nstatus: idea\n---\n## ${L.pitch}\n\n\n## ${L.first}\n`, null);
  S.books.set(path, b); await commitBook(path);
  location.hash = bookHash(b);
}
async function deleteBook(b) {
  const L = lex(b);
  if (!(await confirmBox(`Delete this ${L.one}?`, `“${b.title}” will be removed from every device. Its cards stay in your deck.`, `Delete ${L.one}`))) return;
  clearTimeout(bookTimers.get(b.path)); bookTimers.delete(b.path);
  S.books.delete(b.path); await DB.delCards([b.path]);
  if (S.gh && b.sha) await queue({ kind: 'del', path: b.path, sha: b.sha, msg: `Delete ${L.one}: ${b.title}` });
  closePanel(); location.hash = L.allHash; toast(`${L.One} deleted`);
}
function openPicker(b, ci) {
  const ch = b.chapters[ci];
  openPanel(`${panelHead('Add cards')}
    <p class="muted">Adding to <b>${esc(ch.title)}</b> in <b>${esc(b.title)}</b>. Tap a card to add it to the end.</p>
    <div class="search pick-search">${icon('search')}<input id="pick-q" type="search" placeholder="Search your cards" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search your cards"></div>
    <div id="pick-list" class="pick-list"></div>`);
  S.picker = { b, ci };
  const inp = $('#pick-q'), list = $('#pick-list');
  const draw_ = () => {
    const toks = (inp.value.toLowerCase().match(/"[^"]+"|\S+/g) || []).map(t => t.replace(/^"|"$/g, '')).filter(Boolean);
    const inBook = new Set(b.chapters.flatMap(c => c.items.map(i => i.path)));
    const res = toks.length ? searchList([...S.cards.values()], toks).slice(0, 60) : [];
    list.innerHTML = !toks.length ? `<p class="muted">Search all ${num(S.cards.size)} cards by any word.</p>` : !res.length ? '<p class="muted">No card says that.</p>'
      : res.map(c => `<button class="pick ${inBook.has(c.path) ? 'added' : ''}" data-pick="${esc(c.path)}"><span class="pick-t">${hl(c.title, toks)}</span><span class="pick-b">${esc(c.box || 'Inbox')}${c.date ? ', ' + esc(fmtDate(c.date)) : ''}</span><span class="pick-x">${hl(excerpt(c, toks, 160), toks)}</span><span class="pick-s">${inBook.has(c.path) ? 'Added' : 'Add'}</span></button>`).join('');
  };
  S.picker.draw = draw_;
  inp.addEventListener('input', debounce(draw_, 60)); draw_();
  setTimeout(() => inp.focus(), 120);
}
function pickCard(path) {
  const p = S.picker; if (!p) return; const ch = p.b.chapters[p.ci]; if (!ch) return;
  if (ch.items.some(i => i.path === path)) { toast(`Already in “${ch.title}”`); return; }
  ch.items.push({ path, note: '' }); scheduleBookSave(p.b); p.draw(); render();
  toast(`Added to ${ch.title}`);
}
function addToBookMenu(anchor, path) {
  const books = sortedBooks();
  if (!books.length) { toast('Start a book idea or sermon series first.'); return; }
  const pickChapter = b => {
    if (!b.chapters.length) b.chapters.push({ title: lex(b).first, part: '', note: '', needs: '', items: [] });
    setTimeout(() => openMenu(anchor, b.chapters.map(ch => ({ label: ch.title, run: () => {
      if (ch.items.some(i => i.path === path)) { toast(`Already in “${ch.title}”`); return; }
      ch.items.push({ path, note: '' }); scheduleBookSave(b); toast(`Added to ${b.title}: ${ch.title}`); renderReader();
    } }))), 0);
  };
  openMenu(anchor, books.map(b => ({ label: `${lex(b).kindLabel}: ${b.title}`, run: () => pickChapter(b) })));
}

/* ---------------- writing coach ----------------
   A coach that lives beside a book idea or sermon series. It reads the outline and your deck, then:
   names the one next step (with a button that does it), checks the stage, captures ideas into cards on the fly,
   suggests cards that fit a chapter, spots cards that seem to belong elsewhere, offers prompts, and runs writing sprints.
   Everything runs on this device; nothing leaves it except the cards you save. */
const STOPW = new Set(('the a an and or of to in on for is are was were be been it its this that with as at by from your you i my me we our they their he his she her not but so if then than what who how why when where which do does did have has had just more most about into out up all can will would should there here very also like one get got going really know think want them us him am im ive dont its thats theres youre theyre were weve ill youll every some any no yes oh because only even still much many way make made things thing something lot day days time year years').split(' '));
const ctoks = s => (s.toLowerCase().match(/[a-z][a-z']{2,}/g) || []).map(w => w.replace(/'s$|'/g, '')).filter(w => w.length > 2 && !STOPW.has(w));
let SIM = null;
function simIndex() {
  if (SIM && SIM.size === S.cards.size) return SIM;
  const df = new Map(), tf = new Map();
  for (const c of S.cards.values()) {
    if (c.box === 'Gratitude') continue;
    const m = new Map(); for (const w of ctoks(c.title + ' ' + c.title + ' ' + c.body.slice(0, 2400))) m.set(w, (m.get(w) || 0) + 1);
    tf.set(c.path, m); for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const N = tf.size, vec = new Map(), norm = new Map(), inv = new Map();
  for (const [p, m] of tf) {
    const v = new Map(); let n = 0;
    for (const [w, k] of m) { const d = df.get(w); if (d > N * .25) continue; const x = (1 + Math.log(k)) * Math.log(N / (1 + d)); v.set(w, x); n += x * x; }
    vec.set(p, v); norm.set(p, Math.sqrt(n) || 1);
    for (const [w, x] of v) { let a = inv.get(w); if (!a) inv.set(w, a = []); a.push([p, x]); }
  }
  SIM = { size: S.cards.size, df, N, vec, norm, inv };
  return SIM;
}
function qvec(text) {
  const X = simIndex(); const m = new Map(); for (const w of ctoks(text)) m.set(w, (m.get(w) || 0) + 1);
  const v = new Map(); let n = 0;
  for (const [w, k] of m) { const d = X.df.get(w); if (!d || d > X.N * .25) continue; const x = (1 + Math.log(k)) * Math.log(X.N / (1 + d)); v.set(w, x); n += x * x; }
  return { v, n: Math.sqrt(n) || 1 };
}
function similar(text, k, exclude) {
  const X = simIndex(), q = qvec(text); const sc = new Map();
  const terms = [...q.v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [w, x] of terms) for (const [p, y] of X.inv.get(w) || []) sc.set(p, (sc.get(p) || 0) + x * y);
  const out = [];
  for (const [p, s] of sc) { if (exclude && exclude.has(p)) continue; const c = S.cards.get(p); if (!c || /^\s*(Home\s+World|Home\s+U\.S\.|Skip navigation)/.test(c.body)) continue; out.push([p, s / (q.n * X.norm.get(p))]); }
  return out.sort((a, b) => b[1] - a[1]).slice(0, k);
}
function chapterText(b, ch) {
  return [ch.title, ch.title, ch.note, ch.needs, ...ch.items.slice(0, 8).map(it => { const c = S.cards.get(it.path); return c ? c.title + ' ' + c.body.slice(0, 700) : ''; })].join(' ');
}
function cosine(a, an, p) { const X = simIndex(); const v = X.vec.get(p); if (!v) return 0; let s = 0; for (const [w, x] of a) { const y = v.get(w); if (y) s += x * y; } return s / (an * X.norm.get(p)); }

const PROMPTS = {
  book: [
    'What is the one scene that proves this chapter? Write only the scene.',
    'Name one real person who needs this chapter. Write a card to them.',
    'What would a skeptic say here? Answer them in one card.',
    'Which card in this chapter is the strongest? Write the sentence that should come right before it.',
    'Where is the story, where is the Scripture, and where is the practice? Write whichever is missing.',
    'Finish this sentence: “The reader closes this chapter and…”',
    'What mistake did you make here? Confession builds trust. Card it.',
    'Write this chapter’s last line first.',
    'One idea per card. Is any card here really two ideas? Split it.',
    'Find the name, number or date that makes this concrete.',
    'What do you believe about this now that you didn’t believe five years ago?',
    'If this chapter were a sticky note on the fridge, what would it say?',
    'What question will the reader be asking by page two? Answer it on a card.',
    'Cut one card from this chapter. Which one, and why? Move it to the end or remove it.',
    'Tell it the way you’d tell it across the table at the coffee shop. Write that version.',
  ],
  series: [
    'What is the one thing they should remember on Monday?',
    'Where is the tension? What question will they be asking five minutes in?',
    'Me, We, God, You, We: which part is missing from this week?',
    'What happened in your own life this week that fits this sermon?',
    'What should they do this week? Make it small enough to do by Wednesday.',
    'Which card is the illustration? Which card is the text? Which card is the landing?',
    'Write the opening line, the one that makes a teenager look up.',
    'What would a student who doesn’t believe any of this say? Answer them.',
    'How does this week connect to last week and next week? Write the thread.',
  ],
};
function coachBook() {
  if (S.view.kind === 'book') { const b = curBook(); if (b) return b; }
  let p = ''; try { p = localStorage.getItem('cardeck.coach.book') || ''; } catch (_) { }
  return S.books.get(p) || sortedBooks()[0] || null;
}
function coachLog() { try { return JSON.parse(localStorage.getItem('cardeck.coach.log') || '{}'); } catch (_) { return {}; } }
function coachMark(b, key) { try { const l = coachLog(); l[b.path] = l[b.path] || {}; l[b.path][key] = today(); const d = l.days || []; if (key === 'wrote' && !d.includes(today())) d.push(today()); l.days = d.slice(-60); localStorage.setItem('cardeck.coach.log', JSON.stringify(l)); } catch (_) { } }
function streak() { const d = new Set(coachLog().days || []); let n = 0; const x = new Date(); for (; ;) { const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; if (d.has(k)) { n++; x.setDate(x.getDate() - 1); } else break; } return n; }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
const isFront = ch => /^(before|front|preface|intro)/i.test(ch.part || '');
function coachChecks(b) {
  const L = lex(b), chs = b.chapters, body = chs.filter(ch => !isFront(ch));
  const counts = body.map(ch => ch.items.length), med = Math.max(3, median(counts));
  const firstSentence = (plain(b.pitch || '').split(/(?<=[.!?])\s/)[0] || '');
  const log = (coachLog()[b.path] || {});
  const findCh = f => chs.findIndex(f);
  const thin = findCh(ch => !isFront(ch) && ch.items.length < 3);
  const empty = findCh(ch => !isFront(ch) && ch.items.length === 0);
  const noSpine = findCh(ch => !isFront(ch) && !ch.note);
  const needs = findCh(ch => ch.needs);
  const fat = findCh(ch => !isFront(ch) && ch.items.length > Math.max(12, med * 3));
  const U = L.unit, Us = L.units;
  return [
    { id: 'pitch', stage: 'Idea', ok: !!firstSentence && firstSentence.split(/\s+/).length <= 40, title: `Say the ${b.doc === 'series' ? 'series' : 'book'} in one sentence`, why: 'Holiday’s test: if you can’t say it in a sentence, you don’t know it yet. Put that sentence first in the pitch.', act: 'pitch', label: 'Write the sentence' },
    { id: 'shape', stage: 'Idea', ok: body.length >= (b.doc === 'series' ? 3 : 5), title: `Sketch at least ${b.doc === 'series' ? 3 : 5} ${Us}`, why: `A rough list of ${Us} gives your cards somewhere to land. You can rename them all later.`, act: 'add-chapter', label: `Add a ${U}` },
    { id: 'spine', stage: 'Outline', ok: noSpine < 0, ci: noSpine, title: `Give every ${U} one line that says what it argues`, why: noSpine >= 0 ? `“${chs[noSpine].title}” doesn’t say what it’s for yet.` : '', act: 'edit-ch', label: 'Write the line' },
    { id: 'empty', stage: 'Outline', ok: empty < 0, ci: empty, title: `No empty ${Us}`, why: empty >= 0 ? `“${chs[empty].title}” has no cards. Pull some from your deck or capture a new one.` : '', act: 'suggest', label: 'Find cards' },
    { id: 'thin', stage: 'Outline', ok: thin < 0, ci: thin, title: `At least three cards in every ${U}`, why: thin >= 0 ? `“${chs[thin].title}” has ${chs[thin].items.length}. Three cards is about where a ${U} starts to hold together.` : '', act: 'suggest', label: 'Find cards' },
    { id: 'fat', stage: 'Outline', ok: fat < 0, ci: fat, title: `No ${U} carrying too much`, why: fat >= 0 ? `“${chs[fat].title}” holds ${chs[fat].items.length} cards, far more than the others. It may be two ${Us}.` : '', act: 'split', label: `Split the ${U}` },
    { id: 'read', stage: 'Outline', ok: !!log.read, title: 'Read the whole thing in order once', why: 'Greene’s step: lay the cards out and read them straight through. Where you get bored, something is in the wrong place.', act: 'read', label: 'Read in order' },
    { id: 'place', stage: 'Outline', ok: !!log.placed, title: 'Check where each card sits', why: 'The coach compares every card with every ' + U + ' and points out the ones that seem to belong somewhere else.', act: 'placement', label: 'Check placement' },
    { id: 'needs', stage: 'Draft', ok: needs < 0, ci: needs, title: `Close the open “${L.needs}” notes`, why: needs >= 0 ? `“${chs[needs].title}”: ${chs[needs].needs}` : '', act: 'capture', label: 'Capture it' },
    { id: 'sprint', stage: 'Draft', ok: !!log.wrote && log.wrote === today(), title: 'Write one new card today', why: 'Small and daily beats big and someday. A 15-minute sprint is enough.', act: 'sprint', label: 'Start a sprint' },
  ];
}
function coachOpen(on) {
  const el = $('#coach'); if (!el) return;
  S.coach = S.coach || { tab: 'next', ci: 0, prompt: 0 };
  S.coach.open = on ?? !S.coach.open;
  document.body.classList.toggle('coach-on', S.coach.open);
  el.hidden = !S.coach.open;
  try { localStorage.setItem('cardeck.coach.open', S.coach.open ? '1' : ''); } catch (_) { }
  if (S.coach.open) {
    const b = coachBook();
    if (b && S.view.kind !== 'book') { location.hash = bookHash(b); return; }
    renderCoach();
  }
  const cb = $('#coach-btn'); if (cb) cb.setAttribute('aria-pressed', S.coach.open);
}
function focusChapter(ci) {
  if (!S.coach) return; S.coach.ci = ci;
  const sel = $('#cap-ch'); if (sel && !S.coach.pinned) sel.value = String(ci);
  $$('.chapter.coach-focus').forEach(e => e.classList.remove('coach-focus'));
  const sec = $(`.chapter[data-ch="${ci}"]`); sec && sec.classList.add('coach-focus');
  if (S.coach.tab === 'ideas' || S.coach.tab === 'prompts') renderCoachTab();
  const lab = $('#coach-focus-name'); if (lab) { const b = coachBook(); lab.textContent = b && b.chapters[ci] ? b.chapters[ci].title : ''; }
}
function scrollToChapter(ci) { const sec = $(`.chapter[data-ch="${ci}"]`); if (sec) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); focusChapter(ci); } }
let coachObs = null;
function observeChapters() {
  if (coachObs) coachObs.disconnect(); coachObs = null;
  if (!S.coach || !S.coach.open || S.view.kind !== 'book') return;
  const seen = new Map();
  coachObs = new IntersectionObserver(es => {
    for (const e of es) seen.set(+e.target.dataset.ch, e.isIntersecting ? e.boundingClientRect.top : null);
    const vis = [...seen.entries()].filter(([, t]) => t !== null).sort((a, b) => Math.abs(a[1] - 120) - Math.abs(b[1] - 120));
    if (vis.length && vis[0][0] !== S.coach.ci) focusChapter(vis[0][0]);
  }, { rootMargin: '-80px 0px -45% 0px' });
  $$('.chapter[data-ch]').forEach(s => coachObs.observe(s));
}
function renderCoach() {
  const el = $('#coach'); if (!el || !S.coach || !S.coach.open) return;
  const b = coachBook();
  if (!b) {
    el.innerHTML = `<div class="coach-head"><h2>Writing coach</h2><button class="icon-btn" data-act="coach-close" aria-label="Close coach">${icon('x')}</button></div>
      <div class="coach-body"><p class="coach-lead">Start a book idea or a sermon series. The coach will walk you through it, one step at a time.</p>
      <div class="prow"><button class="pbtn primary" data-act="new-book" data-doc="book">New book idea</button><button class="pbtn" data-act="new-book" data-doc="series">New sermon series</button></div></div>`;
    return;
  }
  try { localStorage.setItem('cardeck.coach.book', b.path); } catch (_) { }
  const L = lex(b), checks = coachChecks(b), done = checks.filter(c => c.ok).length;
  if (S.coach.ci >= b.chapters.length) S.coach.ci = 0;
  const pct = Math.round(100 * done / checks.length);
  const stage = (checks.find(c => !c.ok && !(S.coach.skipped || new Set()).has(c.id)) || { stage: 'Done' }).stage;
  const books = sortedBooks();
  el.innerHTML = `<div class="coach-head">
      <div class="coach-id"><span class="coach-kicker">Writing coach</span>
        <label class="sr" for="coach-book">Project</label><select id="coach-book" class="coach-book">${books.map(x => `<option value="${esc(x.path)}" ${x === b ? 'selected' : ''}>${esc(lex(x).kindLabel)}: ${esc(x.title)}</option>`).join('')}</select></div>
      <button class="icon-btn coach-min" data-act="coach-min" aria-label="Minimize coach">${icon('down')}</button>
      <button class="icon-btn" data-act="coach-close" aria-label="Close coach">${icon('x')}</button></div>
    <div class="coach-progress"><div class="bar"><span style="width:${pct}%"></span></div><span class="coach-stage">${esc(stage === 'Done' ? 'Ready to write it all out' : stage + ' stage')} · ${done}/${checks.length}${streak() ? ` · ${streak()}-day streak` : ''}</span></div>
    <form class="capture" id="capture" autocomplete="off">
      <label class="sr" for="cap-text">Capture an idea</label>
      <textarea id="cap-text" rows="2" placeholder="Capture an idea. It becomes a card in this ${esc(L.unit)}."></textarea>
      <div class="cap-row"><label class="sr" for="cap-ch">${L.Unit}</label><select id="cap-ch">${b.chapters.map((ch, i) => `<option value="${i}" ${i === S.coach.ci ? 'selected' : ''}>${esc(ch.title)}</option>`).join('')}<option value="new">+ New ${esc(L.unit)}…</option></select>
        <button class="pbtn primary" type="submit">${icon('plus')}Add card</button></div>
      <p class="cap-hint">${matchMedia('(pointer: coarse)').matches ? '' : '⌘/Ctrl+Enter adds it. '}The first line becomes the title. It also goes to your Inbox to file later.</p>
    </form>
    <div class="coach-tabs" role="tablist">${[['next', 'Next step'], ['ideas', 'Find cards'], ['moves', 'Rearrange'], ['prompts', 'Prompts'], ['sprint', 'Sprint']].map(([k, l]) => `<button role="tab" data-ctab="${k}" aria-selected="${S.coach.tab === k}">${l}</button>`).join('')}</div>
    <div class="coach-body" id="coach-tab"></div>`;
  renderCoachTab();
}
function renderCoachTab() {
  const box = $('#coach-tab'); if (!box) return; const b = coachBook(); if (!b) return;
  const L = lex(b), t = S.coach.tab, ci = Math.min(S.coach.ci || 0, Math.max(0, b.chapters.length - 1)), ch = b.chapters[ci];
  const chName = ch ? `<button class="linkish" data-cgo="${ci}" id="coach-focus-name">${esc(ch.title)}</button>` : '';
  if (t === 'next') {
    const checks = coachChecks(b), skip = S.coach.skipped || new Set(), next = checks.find(c => !c.ok && !skip.has(c.id));
    box.innerHTML = (next ? `<div class="next-card"><span class="coach-kicker">Next step</span><h3>${esc(next.title)}</h3>${next.why ? `<p>${esc(next.why)}</p>` : ''}
        <div class="prow"><button class="pbtn primary" data-cdo="${next.act}" data-cci="${next.ci ?? ''}">${esc(next.label)}</button>${next.ci != null && next.ci >= 0 ? `<button class="pbtn" data-cgo="${next.ci}">Show me</button>` : ''}<button class="pbtn quiet" data-cskip="${next.id}">Skip for now</button></div></div>`
      : `<div class="next-card"><span class="coach-kicker">Next step</span><h3>The outline is ready. Write it out.</h3><p>Pick a ${esc(L.unit)}, start a sprint, and turn its cards into prose, one card at a time.</p><div class="prow"><button class="pbtn primary" data-cdo="sprint">Start a sprint</button></div></div>`)
      + `<ol class="checks">${checks.map(c => `<li class="${c.ok ? 'ok' : ''}"><span class="tick">${c.ok ? icon('check') : ''}</span><span><b>${esc(c.title)}</b><small>${esc(c.stage)}</small></span>${c.ok ? '' : `<button class="pbtn small" data-cdo="${c.act}" data-cci="${c.ci ?? ''}">${esc(c.label)}</button>`}</li>`).join('')}</ol>`;
    return;
  }
  if (!ch && t !== 'sprint') { box.innerHTML = `<p class="muted">Add a ${esc(L.unit)} first.</p><button class="pbtn primary" data-cdo="add-chapter">Add a ${esc(L.unit)}</button>`; return; }
  if (t === 'ideas') {
    const inBook = new Set(b.chapters.flatMap(c => c.items.map(i => i.path)));
    const res = similar(chapterText(b, ch), 12, inBook).filter(([, s]) => s > 0.06);
    box.innerHTML = `<p class="coach-lead">Cards from your deck that fit ${chName}. Scroll the outline and this list follows along.</p>`
      + (res.length ? `<div class="sugg">${res.map(([p, s]) => { const c = S.cards.get(p); return `<div class="sg"><button class="sg-open" data-open="${esc(p)}"><span class="sg-t">${esc(c.title)}</span><span class="sg-b">${esc(c.box || 'Inbox')}${c.date ? ' · ' + esc(fmtDate(c.date)) : ''}</span><span class="sg-x">${esc(excerpt(c, [], 150))}</span></button><button class="pbtn small" data-cadd="${esc(p)}" data-cci="${ci}">Add</button></div>`; }).join('')}</div>`
        : `<p class="muted">Nothing close yet. Give this ${esc(L.unit)} a line saying what it argues, or capture a first card, and suggestions will follow.</p>`)
      + `<button class="pbtn" data-addcards="${ci}">${icon('search')}Search all cards</button>`;
    return;
  }
  if (t === 'moves') {
    const sug = S.coach.moves && S.coach.moves.book === b.path ? S.coach.moves.list : null;
    const counts = b.chapters.map(c => c.items.length), med = Math.max(3, median(counts));
    const fat = b.chapters.map((c, i) => [c, i]).filter(([c]) => !isFront(c) && c.items.length > Math.max(12, med * 3));
    const empty = b.chapters.map((c, i) => [c, i]).filter(([c]) => !isFront(c) && !c.items.length);
    box.innerHTML = `<p class="coach-lead">Move things around without losing anything. Every move is saved and synced, and you can drag cards in the outline too.</p>
      <div class="prow"><button class="pbtn primary" data-cdo="placement">${sug ? 'Check again' : 'Check card placement'}</button></div>`
      + (sug ? (sug.length ? `<div class="sugg">${sug.map((m, k) => { const c = S.cards.get(m.path); return c ? `<div class="sg"><button class="sg-open" data-open="${esc(m.path)}"><span class="sg-t">${esc(c.title)}</span><span class="sg-b">Now in “${esc(b.chapters[m.from].title)}”</span><span class="sg-x">Fits “${esc(b.chapters[m.to].title)}” better.</span></button><button class="pbtn small" data-cmove="${k}">Move</button></div>` : ''; }).join('')}</div>` : '<p class="muted">Every card sits where it fits best. Nice.</p>') : '')
      + (fat.length ? `<h4>Heavy ${esc(L.units)}</h4>${fat.map(([c, i]) => `<div class="sg"><span class="sg-open"><span class="sg-t">${esc(c.title)}</span><span class="sg-b">${c.items.length} cards</span></span><button class="pbtn small" data-cdo="split" data-cci="${i}">Split in two</button></div>`).join('')}` : '')
      + (empty.length ? `<h4>Empty ${esc(L.units)}</h4>${empty.map(([c, i]) => `<div class="sg"><span class="sg-open"><span class="sg-t">${esc(c.title)}</span></span><button class="pbtn small" data-cdo="suggest" data-cci="${i}">Find cards</button></div>`).join('')}` : '')
      + `<h4>This ${esc(L.unit)}: ${chName}</h4><div class="prow wrap"><button class="pbtn small" data-cdo="ch-up" data-cci="${ci}">Move ${esc(L.unit)} up</button><button class="pbtn small" data-cdo="ch-down" data-cci="${ci}">Move ${esc(L.unit)} down</button><button class="pbtn small" data-cdo="edit-ch" data-cci="${ci}">Rename or retitle</button><button class="pbtn small" data-cdo="add-after" data-cci="${ci}">New ${esc(L.unit)} after</button></div>`;
    return;
  }
  if (t === 'prompts') {
    const P = PROMPTS[b.doc] || PROMPTS.book; const k = (S.coach.prompt + ci) % P.length; const p = P[k];
    box.innerHTML = `<p class="coach-lead">A prompt for ${chName}.</p><blockquote class="prompt">${esc(p)}</blockquote>
      <div class="prow"><button class="pbtn primary" data-cdo="use-prompt" data-prompt="${k}">Write it</button><button class="pbtn" data-cdo="next-prompt">Another prompt</button></div>
      ${ch.needs ? `<p class="muted"><b>${esc(L.needs)}:</b> ${esc(ch.needs)}</p>` : ''}${ch.note ? `<p class="muted">${esc(plain(ch.note).slice(0, 300))}${plain(ch.note).length > 300 ? '…' : ''}</p>` : ''}`;
    return;
  }
  if (t === 'sprint') {
    const sp = S.coach.sprint;
    if (sp && sp.end > Date.now()) {
      const left = Math.max(0, sp.end - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      box.innerHTML = `<div class="sprint"><span class="clock" id="sprint-clock">${m}:${String(s).padStart(2, '0')}</span><p>Writing in <b>${esc((b.chapters[sp.ci] || ch).title)}</b>. One idea per card. Don’t edit, just capture.</p><div class="prow"><button class="pbtn" data-cdo="sprint-stop">End sprint</button></div><p class="muted">${sp.made ? `${sp.made} ${sp.made === 1 ? 'card' : 'cards'} so far.` : 'Use the capture box above. Each idea becomes a card here.'}</p></div>`;
      clearTimeout(S.coach.tick); S.coach.tick = setTimeout(() => { if (S.coach.tab === 'sprint') renderCoachTab(); }, 1000);
    } else {
      box.innerHTML = `<p class="coach-lead">Set a timer, pick ${chName}, and capture ideas as fast as they come. Holiday’s rule: card it now, sort it later.</p>
        <div class="prow">${[10, 15, 25].map(n => `<button class="pbtn ${n === 15 ? 'primary' : ''}" data-csprint="${n}">${n} minutes</button>`).join('')}</div>
        ${streak() ? `<p class="muted">You’ve written ${streak() === 1 ? 'today' : `${streak()} days in a row`}. Keep it going.</p>` : ''}`;
    }
  }
}
async function coachCapture() {
  const b = coachBook(); if (!b) return; const ta = $('#cap-text'); const raw = ta.value.trim();
  if (!raw) { ta.focus(); return; }
  let sel = $('#cap-ch').value, ci;
  if (sel === 'new') {
    const v = await formBox(`New ${lex(b).unit}`, [{ name: 'title', label: `${lex(b).Unit} title`, placeholder: lex(b).unitPh }], `Add ${lex(b).unit}`);
    if (!v || !v.title.trim()) return;
    const cur = b.chapters[S.coach.ci]; b.chapters.splice((S.coach.ci ?? b.chapters.length - 1) + 1, 0, { title: v.title.trim(), part: cur ? cur.part : '', note: '', needs: '', items: [] });
    ci = (S.coach.ci ?? b.chapters.length - 2) + 1;
  } else ci = +sel;
  const lines = raw.split(/\n/); let title = '', body = raw;
  if (lines.length > 1 && lines[0].length <= 90) { title = lines[0].replace(/^#+\s*/, '').trim(); body = lines.slice(1).join('\n').trim() || title; }
  else { const s = raw.split(/(?<=[.!?])\s/)[0]; title = s.length <= 70 ? s.replace(/[.!?]$/, '') : raw.split(/\s+/).slice(0, 7).join(' ') + '…'; }
  const c = await saveCard({ title, box: '', also: [], type: /^[“"]/.test(raw) ? 'quote' : 'idea', quoted: [], source: '', date: today(), projects: [b.title], body }, null);
  b.chapters[ci].items.push({ path: c.path, note: 'Captured with the coach.' });
  scheduleBookSave(b, 500); coachMark(b, 'wrote');
  if (SIM) { SIM = null; }
  if (S.coach.sprint && S.coach.sprint.end > Date.now()) S.coach.sprint.made = (S.coach.sprint.made || 0) + 1;
  ta.value = ''; S.coach.ci = ci; render(); renderCoach(); toast(`Card added to “${b.chapters[ci].title}”`);
  requestAnimationFrame(() => { const t = $('#cap-text'); t && t.focus({ preventScroll: true }); const sec = $(`.chapter[data-ch="${ci}"]`); sec && sec.classList.add('coach-focus'); });
}
function placementCheck(b) {
  const cents = b.chapters.map(ch => qvec(chapterText(b, ch)));
  const out = [];
  b.chapters.forEach((ch, ci) => {
    if (isFront(ch) || ch.items.length < 2) return;
    ch.items.forEach(it => {
      if (!S.cards.has(it.path)) return;
      const here = cosine(cents[ci].v, cents[ci].n, it.path); let best = ci, bs = here;
      cents.forEach((q, k) => { if (k === ci || isFront(b.chapters[k])) return; const s = cosine(q.v, q.n, it.path); if (s > bs) { bs = s; best = k; } });
      if (best !== ci && bs > 0.12 && bs > here * 1.8) out.push({ path: it.path, from: ci, to: best, gain: bs - here });
    });
  });
  out.sort((a, b2) => b2.gain - a.gain);
  S.coach.moves = { book: b.path, list: out.slice(0, 12) };
  coachMark(b, 'placed');
}
async function coachDo(act, ci, el) {
  const b = coachBook(); if (!b) return; const L = lex(b);
  if (ci === '' || ci == null || isNaN(ci)) ci = S.coach.ci || 0; ci = +ci;
  switch (act) {
    case 'pitch': editBook(b); break;
    case 'add-chapter': await editChapter(b, null); S.coach.ci = b.chapters.length - 1; renderCoach(); setTimeout(() => scrollToChapter(S.coach.ci), 80); break;
    case 'add-after': { const v = await formBox(`New ${L.unit}`, [{ name: 'title', label: `${L.Unit} title`, placeholder: L.unitPh }], `Add ${L.unit}`); if (!v || !v.title.trim()) return; b.chapters.splice(ci + 1, 0, { title: v.title.trim(), part: (b.chapters[ci] || {}).part || '', note: '', needs: '', items: [] }); scheduleBookSave(b); S.coach.ci = ci + 1; render(); renderCoach(); setTimeout(() => scrollToChapter(ci + 1), 80); break; }
    case 'edit-ch': await editChapter(b, ci); renderCoach(); break;
    case 'suggest': S.coach.tab = 'ideas'; S.coach.ci = ci; renderCoach(); scrollToChapter(ci); break;
    case 'capture': S.coach.ci = ci; renderCoach(); scrollToChapter(ci); { const t = $('#cap-text'); t.placeholder = b.chapters[ci].needs ? `${L.needs}: ${b.chapters[ci].needs}` : t.placeholder; t.focus(); } break;
    case 'read': coachMark(b, 'read'); S.list = bookOrder(b); S.list.length ? openReader(S.list[0]) : toast('Add some cards first.'); renderCoach(); break;
    case 'placement': placementCheck(b); S.coach.tab = 'moves'; renderCoach(); break;
    case 'split': {
      const ch = b.chapters[ci]; if (!ch || ch.items.length < 2) return;
      const v = await formBox(`Split “${ch.title}”`, [{ name: 'title', label: `Title for the second half`, value: ch.title + ' (part two)' }], 'Split');
      if (!v) return; const half = Math.ceil(ch.items.length / 2);
      b.chapters.splice(ci + 1, 0, { title: v.title.trim() || ch.title + ' (part two)', part: ch.part, note: '', needs: '', items: ch.items.splice(half) });
      scheduleBookSave(b); render(); renderCoach(); toast(`Split into two ${L.units}`); break;
    }
    case 'ch-up': if (ci > 0) { const [c] = b.chapters.splice(ci, 1); c.part = b.chapters[ci - 1].part; b.chapters.splice(ci - 1, 0, c); S.coach.ci = ci - 1; scheduleBookSave(b); render(); renderCoach(); scrollToChapter(ci - 1); } break;
    case 'ch-down': if (ci < b.chapters.length - 1) { const [c] = b.chapters.splice(ci, 1); c.part = b.chapters[ci].part; b.chapters.splice(ci + 1, 0, c); S.coach.ci = ci + 1; scheduleBookSave(b); render(); renderCoach(); scrollToChapter(ci + 1); } break;
    case 'use-prompt': { const P = PROMPTS[b.doc] || PROMPTS.book; const t = $('#cap-text'); t.placeholder = P[+el.dataset.prompt]; t.focus(); break; }
    case 'next-prompt': S.coach.prompt++; renderCoachTab(); break;
    case 'sprint': S.coach.tab = 'sprint'; renderCoach(); break;
    case 'sprint-stop': { const sp = S.coach.sprint; S.coach.sprint = null; renderCoachTab(); toast(sp && sp.made ? `Sprint done: ${sp.made} new ${sp.made === 1 ? 'card' : 'cards'}.` : 'Sprint ended.'); break; }
  }
}
function bindCoach() {
  const el = $('#coach'); if (!el) return;
  el.addEventListener('submit', e => { if (e.target.id === 'capture') { e.preventDefault(); coachCapture(); } });
  el.addEventListener('keydown', e => { if (e.target.id === 'cap-text' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); coachCapture(); } });
  el.addEventListener('change', e => {
    if (e.target.id === 'coach-book') { const b = S.books.get(e.target.value); if (b) { try { localStorage.setItem('cardeck.coach.book', b.path); } catch (_) { } S.coach.ci = 0; S.coach.moves = null; location.hash = bookHash(b); } }
    if (e.target.id === 'cap-ch') { S.coach.pinned = e.target.value !== 'new'; if (e.target.value !== 'new') { S.coach.ci = +e.target.value; scrollToChapter(S.coach.ci); } }
  });
  el.addEventListener('click', async e => {
    const t = e.target;
    const tab = t.closest('[data-ctab]'); if (tab) { S.coach.tab = tab.dataset.ctab; $$('[data-ctab]', el).forEach(x => x.setAttribute('aria-selected', x === tab)); renderCoachTab(); return; }
    const go = t.closest('[data-cgo]'); if (go) { scrollToChapter(+go.dataset.cgo); return; }
    const d = t.closest('[data-cdo]'); if (d) { coachDo(d.dataset.cdo, d.dataset.cci, d); return; }
    const sk = t.closest('[data-cskip]'); if (sk) { const b = coachBook(); coachMark(b, sk.dataset.cskip === 'read' ? 'read' : sk.dataset.cskip === 'place' ? 'placed' : 'skip-' + sk.dataset.cskip); S.coach.skipped = S.coach.skipped || new Set(); S.coach.skipped.add(sk.dataset.cskip); renderCoach(); return; }
    const ad = t.closest('[data-cadd]'); if (ad) { const b = coachBook(); const ch = b.chapters[+ad.dataset.cci]; if (!ch.items.some(i => i.path === ad.dataset.cadd)) { ch.items.push({ path: ad.dataset.cadd, note: '' }); scheduleBookSave(b); render(); toast(`Added to “${ch.title}”`); } ad.textContent = 'Added'; ad.disabled = true; return; }
    const mv = t.closest('[data-cmove]'); if (mv) { const b = coachBook(); const m = S.coach.moves.list[+mv.dataset.cmove]; const from = b.chapters[m.from], to = b.chapters[m.to]; const i = from.items.findIndex(x => x.path === m.path); if (i >= 0) { const [it] = from.items.splice(i, 1); to.items.push(it); scheduleBookSave(b); render(); toast(`Moved to “${to.title}”`); } S.coach.moves.list.splice(+mv.dataset.cmove, 1); renderCoachTab(); return; }
    const sp = t.closest('[data-csprint]'); if (sp) { const b = coachBook(); S.coach.sprint = { end: Date.now() + +sp.dataset.csprint * 60000, ci: S.coach.ci || 0, made: 0, book: b.path }; renderCoachTab(); $('#cap-text').focus(); return; }
    const a = t.closest('[data-act]');
    if (a && a.dataset.act === 'coach-close') { e.stopPropagation(); coachOpen(false); return; }
    if (a && a.dataset.act === 'coach-min') { e.stopPropagation(); el.classList.toggle('min'); return; }
  });
  // chapters: clicking a chapter heading focuses it in the coach
  document.addEventListener('click', e => { if (!S.coach || !S.coach.open) return; const sec = e.target.closest('.chapter[data-ch]'); if (sec && !e.target.closest('.tile,[data-btmenu],[data-chmenu]')) focusChapter(+sec.dataset.ch); });
}

/* ---------------- daily quote for sharing ----------------
   Only quotes with a solid source (a book, a speech, a verse), so nothing you post is misattributed. */
const QUOTES = [
  ['Darkness cannot drive out darkness; only light can do that. Hate cannot drive out hate; only love can do that.', 'Martin Luther King Jr.', 'Strength to Love, 1963'],
  ['The time is always right to do what is right.', 'Martin Luther King Jr.', 'Oberlin College, 1964'],
  ['Life’s most persistent and urgent question is, “What are you doing for others?”', 'Martin Luther King Jr.', 'Montgomery, 1957'],
  ['Only when it is dark enough can you see the stars.', 'Martin Luther King Jr.', 'I’ve Been to the Mountaintop, 1968'],
  ['The credit belongs to the man who is actually in the arena.', 'Theodore Roosevelt', 'Citizenship in a Republic, 1910'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt', 'quoting Squire Bill Widener, Autobiography'],
  ['With malice toward none, with charity for all, with firmness in the right as God gives us to see the right, let us strive on to finish the work we are in.', 'Abraham Lincoln', 'Second Inaugural Address, 1865'],
  ['Never give in, never give in, never, never, never, never—in nothing, great or small, large or petty—never give in except to convictions of honour and good sense.', 'Winston Churchill', 'Harrow School, 1941'],
  ['I believe in Christianity as I believe that the sun has risen: not only because I see it, but because by it I see everything else.', 'C.S. Lewis', 'Is Theology Poetry?'],
  ['To love at all is to be vulnerable.', 'C.S. Lewis', 'The Four Loves'],
  ['Friendship is born at the moment when one man says to another, “What! You too? I thought that no one but myself…”', 'C.S. Lewis', 'The Four Loves'],
  ['Aim at Heaven and you will get earth “thrown in”: aim at earth and you will get neither.', 'C.S. Lewis', 'Mere Christianity'],
  ['If I find in myself a desire which no experience in this world can satisfy, the most probable explanation is that I was made for another world.', 'C.S. Lewis', 'Mere Christianity'],
  ['There are no ordinary people. You have never talked to a mere mortal.', 'C.S. Lewis', 'The Weight of Glory'],
  ['Courage is not simply one of the virtues, but the form of every virtue at the testing point.', 'C.S. Lewis', 'The Screwtape Letters'],
  ['All we have to decide is what to do with the time that is given us.', 'J.R.R. Tolkien', 'The Fellowship of the Ring'],
  ['Not all those who wander are lost.', 'J.R.R. Tolkien', 'The Fellowship of the Ring'],
  ['The Christian ideal has not been tried and found wanting. It has been found difficult; and left untried.', 'G.K. Chesterton', 'What’s Wrong with the World'],
  ['Cheap grace is grace without discipleship, grace without the cross, grace without Jesus Christ, living and incarnate.', 'Dietrich Bonhoeffer', 'The Cost of Discipleship'],
  ['The first service that one owes to others in the fellowship consists in listening to them.', 'Dietrich Bonhoeffer', 'Life Together'],
  ['We must learn to regard people less in the light of what they do or omit to do, and more in the light of what they suffer.', 'Dietrich Bonhoeffer', 'Letters and Papers from Prison'],
  ['The greatest trap in our life is not success, popularity, or power, but self-rejection.', 'Henri Nouwen', 'Life of the Beloved'],
  ['Being the Beloved expresses the core truth of our existence.', 'Henri Nouwen', 'Life of the Beloved'],
  ['Joy does not simply happen to us. We have to choose joy and keep choosing it every day.', 'Henri Nouwen', 'Here and Now'],
  ['My deepest awareness of myself is that I am deeply loved by Jesus Christ and I have done nothing to earn it or deserve it.', 'Brennan Manning', 'Abba’s Child'],
  ['Grace is not opposed to effort, it is opposed to earning.', 'Dallas Willard', 'The Great Omission'],
  ['To be loved but not known is comforting but superficial. To be known and not loved is our greatest fear. But to be fully known and truly loved is, well, a lot like being loved by God.', 'Timothy Keller', 'The Meaning of Marriage'],
  ['We are more sinful and flawed in ourselves than we ever dared believe, yet at the very same time we are more loved and accepted in Jesus Christ than we ever dared hope.', 'Timothy Keller', 'The Meaning of Marriage'],
  ['What comes into our minds when we think about God is the most important thing about us.', 'A.W. Tozer', 'The Knowledge of the Holy'],
  ['You have made us for yourself, O Lord, and our heart is restless until it rests in you.', 'Augustine', 'Confessions'],
  ['Love, and do what you will.', 'Augustine', 'Homilies on the First Epistle of John'],
  ['The glory of God is a human being fully alive.', 'Irenaeus', 'Against Heresies'],
  ['The heart has its reasons which reason knows nothing of.', 'Blaise Pascal', 'Pensées'],
  ['Life can only be understood backwards; but it must be lived forwards.', 'Søren Kierkegaard', 'Journals, 1843'],
  ['Attention is the rarest and purest form of generosity.', 'Simone Weil', 'letter to Joë Bousquet, 1942'],
  ['Let nothing disturb you, let nothing frighten you. All things are passing away: God never changes.', 'Teresa of Ávila', 'her bookmark prayer'],
  ['All shall be well, and all shall be well, and all manner of thing shall be well.', 'Julian of Norwich', 'Revelations of Divine Love'],
  ['There is no pit so deep that He is not deeper still.', 'Betsie ten Boom', 'The Hiding Place'],
  ['He is no fool who gives what he cannot keep to gain what he cannot lose.', 'Jim Elliot', 'journal, 1949'],
  ['Everything can be taken from a man but one thing: the last of the human freedoms—to choose one’s attitude in any given set of circumstances.', 'Viktor Frankl', 'Man’s Search for Meaning'],
  ['Waste no more time arguing about what a good man should be. Be one.', 'Marcus Aurelius', 'Meditations'],
  ['The impediment to action advances action. What stands in the way becomes the way.', 'Marcus Aurelius', 'Meditations'],
  ['The best revenge is not to be like your enemy.', 'Marcus Aurelius', 'Meditations'],
  ['We suffer more often in imagination than in reality.', 'Seneca', 'Letters to Lucilius'],
  ['No man is free who is not master of himself.', 'Epictetus', 'Fragments'],
  ['Well done is better than well said.', 'Benjamin Franklin', 'Poor Richard’s Almanack'],
  ['Make each day your masterpiece.', 'John Wooden', 'from his father’s seven-point creed'],
  ['Be quick, but don’t hurry.', 'John Wooden', 'Wooden on Leadership'],
  ['Your time is limited, so don’t waste it living someone else’s life.', 'Steve Jobs', 'Stanford, 2005'],
  ['The greatest thing a human soul ever does in this world is to see something, and tell what it saw in a plain way.', 'John Ruskin', 'Modern Painters'],
  ['There’s no person in the whole world like you, and I like you just the way you are.', 'Fred Rogers', 'Mister Rogers’ Neighborhood'],
  ['Look for the helpers. You will always find people who are helping.', 'Fred Rogers', 'quoting his mother'],
  ['Your direction, not your intention, determines your destination.', 'Andy Stanley', 'The Principle of the Path'],
  ['Vulnerability is the birthplace of love, belonging, joy, courage, empathy, and creativity.', 'Brené Brown', 'Daring Greatly'],
  ['Come to me, all you who are weary and burdened, and I will give you rest.', 'Jesus', 'Matthew 11:28'],
  ['Do not worry about tomorrow, for tomorrow will worry about itself.', 'Jesus', 'Matthew 6:34'],
  ['Love your neighbor as yourself.', 'Jesus', 'Mark 12:31'],
  ['I have come that they may have life, and have it to the full.', 'Jesus', 'John 10:10'],
  ['In this world you will have trouble. But take heart! I have overcome the world.', 'Jesus', 'John 16:33'],
  ['Peace I leave with you; my peace I give you.', 'Jesus', 'John 14:27'],
  ['Martha, Martha, you are worried and upset about many things, but few things are needed—or indeed only one.', 'Jesus', 'Luke 10:41–42'],
  ['Rejoice that your names are written in heaven.', 'Jesus', 'Luke 10:20'],
  ['I am the way and the truth and the life.', 'Jesus', 'John 14:6'],
  ['And now these three remain: faith, hope and love. But the greatest of these is love.', 'Paul', '1 Corinthians 13:13'],
  ['Love is patient, love is kind.', 'Paul', '1 Corinthians 13:4'],
  ['It is for freedom that Christ has set us free.', 'Paul', 'Galatians 5:1'],
  ['Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.', 'Paul', 'Galatians 6:9'],
  ['If anyone is in Christ, the new creation has come: The old has gone, the new is here!', 'Paul', '2 Corinthians 5:17'],
  ['For we are God’s handiwork, created in Christ Jesus to do good works.', 'Paul', 'Ephesians 2:10'],
  ['Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.', 'Paul', 'Philippians 4:6'],
  ['I can do all this through him who gives me strength.', 'Paul', 'Philippians 4:13'],
  ['There is no fear in love. But perfect love drives out fear.', 'John', '1 John 4:18'],
  ['We love because he first loved us.', 'John', '1 John 4:19'],
  ['He must become greater; I must become less.', 'John the Baptist', 'John 3:30'],
  ['Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', 'Joshua 1:9', ''],
  ['The Lord is my shepherd, I lack nothing.', 'David', 'Psalm 23:1'],
  ['Be still, and know that I am God.', 'Psalm 46:10', ''],
  ['Trust in the Lord with all your heart and lean not on your own understanding.', 'Solomon', 'Proverbs 3:5'],
  ['Children’s children are a crown to the aged, and parents are the pride of their children.', 'Solomon', 'Proverbs 17:6'],
  ['Those who hope in the Lord will renew their strength. They will soar on wings like eagles.', 'Isaiah', 'Isaiah 40:31'],
  ['Do not fear, for I have redeemed you; I have called you by name; you are mine.', 'Isaiah', 'Isaiah 43:1'],
  ['For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.', 'Jeremiah', 'Jeremiah 29:11'],
  ['Because of the Lord’s great love we are not consumed, for his compassions never fail. They are new every morning.', 'Lamentations 3:22–23', ''],
  ['He has shown you, O mortal, what is good. And what does the Lord require of you? To act justly and to love mercy and to walk humbly with your God.', 'Micah', 'Micah 6:8'],
];
function quoteFor(day) { return QUOTES[(day % QUOTES.length + QUOTES.length) % QUOTES.length]; }
function dayIndex() { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
function curQuote() { return quoteFor(dayIndex() + (S.quoteShift || 0)); }
function quoteText(q) { return `“${q[0]}”\n— ${q[1]}${q[2] ? `, ${q[2]}` : ''}`; }
function quoteHTML() {
  const q = curQuote();
  return `<section class="desk-section qotd"><div class="section-head"><h2>Today’s quote</h2><p>Ready to post</p></div>
    <figure class="qcard"><blockquote>${esc(q[0])}</blockquote><figcaption><b>${esc(q[1])}</b>${q[2] ? `<span>${esc(q[2])}</span>` : ''}</figcaption></figure>
    <div class="row qrow"><button class="btn btn-primary" data-act="q-share">${icon('share')}Share to Facebook</button><button class="btn" data-act="q-copy">Copy text</button><button class="btn" data-act="q-image">${icon('doc')}Quote image</button><button class="btn btn-quiet" data-act="q-next">${icon('shuffle')}Another</button><button class="btn btn-quiet" data-act="q-save">Save as card</button></div></section>`;
}
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
async function quoteImage(q) {
  try { await document.fonts.load('600 60px "Source Serif 4"'); await document.fonts.load('600 60px "Caveat"'); } catch (_) { }
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff9a46'); g.addColorStop(.45, '#ff5f1f'); g.addColorStop(1, '#c93a05'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const r = x.createRadialGradient(W * .5, H * .38, 10, W * .5, H * .38, W * .8); r.addColorStop(0, 'rgba(255,240,210,.35)'); r.addColorStop(1, 'rgba(255,240,210,0)'); x.fillStyle = r; x.fillRect(0, 0, W, H);
  x.save(); x.translate(W / 2, H / 2 + 10); x.rotate(-.025);
  const cw = 900, ch = 1060; x.shadowColor = 'rgba(90,20,0,.45)'; x.shadowBlur = 60; x.shadowOffsetY = 26; x.fillStyle = '#fff';
  x.beginPath(); x.roundRect(-cw / 2, -ch / 2, cw, ch, 22); x.fill(); x.shadowColor = 'transparent';
  x.fillStyle = '#ff5f1f'; x.fillRect(-cw / 2, -ch / 2 + 150, cw, 8);
  x.strokeStyle = '#ffd9c4'; x.lineWidth = 3; for (let y = -ch / 2 + 230; y < ch / 2 - 40; y += 70) { x.beginPath(); x.moveTo(-cw / 2, y); x.lineTo(cw / 2, y); x.stroke(); }
  x.fillStyle = '#ff5f1f'; x.font = '600 190px "Source Serif 4", Georgia, serif'; x.textAlign = 'left'; x.fillText('“', -cw / 2 + 60, -ch / 2 + 150);
  let size = 92; let lines; const top = -ch / 2 + 200, bottom = ch / 2 - 190;
  for (; size >= 34; size -= 2) { x.font = `600 ${size}px "Source Serif 4", Georgia, serif`; lines = wrapLines(x, q[0], cw - 140); if (lines.length * size * 1.3 < bottom - top) break; }
  x.fillStyle = '#1b2233'; x.textAlign = 'left'; const lh = size * 1.3; let y = top + ((bottom - top) - lines.length * lh) / 2 + size * .2;
  for (const l of lines) { y += lh; x.fillText(l, -cw / 2 + 70, y); }
  x.fillStyle = '#ff5f1f'; x.font = '600 58px "Caveat", cursive'; x.fillText('— ' + q[1], -cw / 2 + 70, ch / 2 - 120);
  if (q[2]) { x.fillStyle = '#6b7486'; x.font = 'italic 400 30px "Source Serif 4", Georgia, serif'; x.fillText(q[2], -cw / 2 + 74, ch / 2 - 62); }
  x.restore();
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function quoteAct(act) {
  const q = curQuote(), text = quoteText(q);
  if (act === 'q-next') { S.quoteShift = (S.quoteShift || 0) + 1; const s = $('.qotd'); if (s) s.outerHTML = quoteHTML(); return; }
  if (act === 'q-copy') { try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into Facebook.'); } catch (_) { toast('Copy isn’t allowed here.'); } return; }
  if (act === 'q-save') {
    const exists = [...S.cards.values()].some(c => c.body.includes(q[0].slice(0, 40)));
    if (exists) { toast('That quote is already in your deck.'); return; }
    await saveCard({ title: q[0].split(/[.;:!?—]/)[0].slice(0, 70), box: '', also: [], type: 'quote', quoted: [q[1]], source: q[2] || '', date: today(), projects: [], body: `“${q[0]}”` }, null);
    toast('Saved to your Inbox'); renderNav(); return;
  }
  if (act === 'q-image' || act === 'q-share') {
    let file = null;
    if (act === 'q-image' || navigator.canShare) { const blob = await quoteImage(q); file = new File([blob], 'quote.png', { type: 'image/png' }); }
    if (act === 'q-share' && navigator.share) {
      try { await navigator.clipboard.writeText(text); } catch (_) { }
      try { if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text }); else await navigator.share({ text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (act === 'q-share') { try { await navigator.clipboard.writeText(text); } catch (_) { } window.open('https://www.facebook.com/', '_blank', 'noopener'); toast('Quote copied. Paste it into a new Facebook post.'); return; }
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = 'quote.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Quote image saved');
  }
}

/* ---------------- today's post from your writing ---------------- */
function postPool() { return [...S.cards.values()].filter(c => c.extra && c.extra.facebook && !c.extra.posted).sort((a, b) => a.path.localeCompare(b.path)); }
function curPost() {
  const pool = postPool();
  if (!pool.length) {
    const st = [...S.cards.values()].filter(c => isStarred(c) && !c.extra.posted && c.body.length > 120);
    if (!st.length) return null; const c = st[(dayIndex() + (S.postShift || 0)) % st.length];
    const words = plain(c.body).split(/\s+/); return { c, text: words.slice(0, 140).join(' ') + (words.length > 140 ? '…' : ''), auto: true };
  }
  const md = today().slice(5);
  const dated = pool.find(c => String(c.extra.facebook_on || '') === md);
  const c = (!S.postShift && dated) || pool[(dayIndex() + (S.postShift || 0)) % pool.length];
  return { c, text: c.extra.facebook };
}
function postHTML() {
  const p = curPost(); if (!p) return '';
  const done = [...S.cards.values()].filter(c => c.extra && c.extra.posted).length, left = postPool().length;
  return `<section class="desk-section fbpost"><div class="section-head"><h2>Today’s post from your writing</h2><p>${left ? `${num(left)} ready` : 'From your starred cards'}${done ? ` · ${num(done)} posted` : ''}</p></div>
    <div class="fb-card"><div class="fb-head"><img src="icons/deck-192.png" alt="" width="40" height="40"><div><b>Jeremy Herr</b><span>From your card “${esc(p.c.title)}”${p.c.date ? `, ${esc(fmtDate(p.c.date))}` : ''}</span></div></div>
      <div class="fb-text" id="fb-text" contenteditable="true" spellcheck="true" aria-label="Post text you can edit">${esc(p.text)}</div>
      <p class="fb-hint">Tap the text to tweak it before you post.</p></div>
    <div class="row qrow"><button class="btn btn-primary" data-act="p-share">${icon('share')}Share to Facebook</button><button class="btn" data-act="p-copy">Copy post</button><button class="btn btn-quiet" data-act="p-next">${icon('shuffle')}Another</button><button class="btn btn-quiet" data-open="${esc(p.c.path)}">Open the card</button><button class="btn btn-quiet" data-act="p-posted" data-path="${esc(p.c.path)}">${icon('check')}I posted it</button></div></section>`;
}
async function postAct(act, el) {
  const box = $('#fb-text'); const text = box ? box.innerText.trim() : '';
  if (act === 'p-next') { S.postShift = (S.postShift || 0) + 1; const s = $('.fbpost'); if (s) s.outerHTML = postHTML(); return; }
  if (act === 'p-copy') { try { await navigator.clipboard.writeText(text); toast('Post copied. Paste it into Facebook.'); } catch (_) { toast('Copy isn’t allowed here.'); } return; }
  if (act === 'p-share') {
    try { await navigator.clipboard.writeText(text); } catch (_) { }
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    window.open('https://www.facebook.com/', '_blank', 'noopener'); toast('Post copied. Paste it into a new Facebook post.'); return;
  }
  if (act === 'p-posted') {
    const c = S.cards.get(el.dataset.path); if (!c) return;
    c.extra.posted = today(); if (!c.extraOrder.includes('posted')) c.extraOrder.push('posted');
    c.text = serialize(c); c.edited = Date.now(); await DB.putCards([c]);
    if (S.gh) await queue({ kind: 'put', path: c.path, text: c.text, sha: c.sha, msg: `Posted to Facebook: ${c.title}` });
    S.postShift = 0; const s = $('.fbpost'); if (s) s.outerHTML = postHTML(); toast('Marked as posted. Tomorrow brings a new one.');
  }
}

/* ---------------- drafts: the prose of a book, written chapter by chapter ---------------- */
function draftParts(d) { const m = /^---\n([\s\S]*?)\n---\n?/.exec(d.text); return m ? { fm: m[0], body: d.text.slice(m[0].length) } : { fm: '', body: d.text }; }
function draftBody(d) { return draftParts(d).body; }
function draftSections(body) {
  const out = []; let cur = null;
  for (const line of body.replace(/\r/g, '').split('\n')) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) { cur = { title: m[1].trim(), lines: [] }; out.push(cur); continue; }
    if (!cur) { cur = { title: '', lines: [] }; out.push(cur); }
    cur.lines.push(line);
  }
  return out.filter(x => x.title || x.lines.join('').trim());
}
function draftSectionHTML(sec, i) {
  const blocks = sec.lines.join('\n').split(/\n\s*\n/); const html = [];
  for (const blk of blocks) {
    const t = blk.trim(); if (!t) continue;
    const h = /^##\s+(.+)$/.exec(t);
    if (h) { html.push(`<h3 class="dr-h">${esc(h[1])}</h3>`); continue; }
    if (/^\*Built from:\*/.test(t)) {
      const links = [...t.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1] + '.md');
      html.push(`<div class="dr-cards"><span>Cards behind this ${i ? 'chapter' : 'section'}</span>${links.map(p => { const c = S.cards.get(p); return `<button class="chip-card" data-open="${esc(p)}">${esc(c ? c.title : p.split('/').pop().replace(/\.md$/, ''))}</button>`; }).join('')}</div>`);
      continue;
    }
    html.push(renderMd(t));
  }
  return `<section class="dr-sec" id="dr-${i}">${sec.title ? `<h2 class="dr-title">${esc(sec.title)}</h2>` : ''}${html.join('')}</section>`;
}
function renderDraft(el, b) {
  const L = lex(b), d = draftOf(b); S.list = bookOrder(b);
  const head = `<div class="view-head"><div><a class="crumb" href="${L.allHash}">${L.tab}</a><h1 class="view-title">${esc(b.title)}</h1>${b.subtitle ? `<p class="view-sub book-sub">${esc(b.subtitle)}</p>` : ''}</div></div>${bookTabsHTML(b)}`;
  if (!d) {
    el.innerHTML = head + `<div class="empty"><h3>No draft yet</h3><p>The draft is where the outline turns into prose. Start one and it opens with a heading for each ${esc(L.unit)}, ready to write.</p><button class="btn btn-primary" data-act="draft-new">${icon('pen')}Start the draft</button></div>`;
    return;
  }
  const secs = draftSections(draftBody(d));
  if (S.draftEdit === d.path) {
    el.innerHTML = head + `<div class="dr-edit"><p class="muted dr-help"># starts a chapter, ## a section. Blank lines separate paragraphs. Your changes save to your private repository.</p>
      <textarea id="dr-text" spellcheck="true">${esc(draftBody(d))}</textarea>
      <div class="row"><button class="btn btn-primary" data-act="draft-save">${icon('check')}Save draft</button><button class="btn" data-act="draft-cancel">Cancel</button></div></div>`;
    const ta = $('#dr-text'); ta.style.height = Math.max(420, ta.scrollHeight + 20) + 'px'; ta.focus({ preventScroll: true });
    return;
  }
  const words = (draftBody(d).replace(/\*Built from:\*.*$/gm, '').match(/\S+/g) || []).length;
  el.innerHTML = head + `<div class="dr-bar"><span class="dr-stat">${num(words)} words · ${Math.max(1, Math.round(words / 230))} min read · ${secs.filter(x => x.title).length} ${secs.length === 1 ? 'part' : 'parts'}</span>
      <div class="dr-actions"><button class="btn" data-act="draft-edit">${icon('pen')}Edit</button><button class="btn" data-act="draft-listen" aria-pressed="${!!S.speaking}">${S.speaking ? 'Stop' : 'Listen'}</button><button class="btn btn-quiet" data-act="draft-copy">Copy</button><button class="btn btn-quiet" data-act="draft-md">Download</button><button class="btn btn-quiet" data-act="print">Print or PDF</button></div></div>
    <nav class="dr-nav">${secs.map((x, i) => x.title ? `<button class="chip" data-drgo="${i}">${esc(x.title.replace(/:.*/, ''))}</button>` : '').join('')}</nav>
    <article class="manuscript draft">${secs.map(draftSectionHTML).join('')}</article>`;
}
async function saveDraft(d, body) {
  d.text = (draftParts(d).fm || '') + body.replace(/\s+$/, '') + '\n'; d.edited = Date.now();
  S.drafts.set(d.path, d); await DB.putCards([d]);
  if (S.gh) await queue({ kind: 'put', path: d.path, text: d.text, sha: d.sha, msg: `Draft: ${d.title}` });
}
async function draftAct(act, el) {
  const b = curBook(); if (!b) return; const d = draftOf(b);
  if (act === 'draft-new') {
    const path = `Drafts/${b.title}.md`;
    const body = b.chapters.map(ch => `# ${ch.title}\n\n`).join('');
    const nd = makeDraft(path, `---\ntype: draft\nbook: ${q(b.title)}\nstatus: started\n---\n${body}`, null); S.drafts.set(path, nd);
    await saveDraft(nd, body); S.draftEdit = path; render(); return;
  }
  if (!d) return;
  if (act === 'draft-edit') { S.draftEdit = d.path; render(); return; }
  if (act === 'draft-cancel') { S.draftEdit = null; render(); return; }
  if (act === 'draft-save') { await saveDraft(d, $('#dr-text').value); S.draftEdit = null; render(); toast('Draft saved'); return; }
  if (act === 'draft-copy') { try { await navigator.clipboard.writeText(draftBody(d)); toast('Draft copied'); } catch (_) { toast('Copy isn’t allowed here.'); } return; }
  if (act === 'draft-md') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([draftBody(d)], { type: 'text/markdown' })); a.download = `${safeName(b.title)} (draft).md`; document.body.appendChild(a); a.click(); a.remove(); return; }
  if (act === 'draft-listen') {
    if (!('speechSynthesis' in window)) { toast('Listening isn’t available on this device.'); return; }
    if (S.speaking) { speechSynthesis.cancel(); S.speaking = false; render(); return; }
    const text = plain(draftBody(d).replace(/\*Built from:\*.*$/gm, '').replace(/^#+\s*/gm, ''));
    const chunks = text.match(/[^.!?]+[.!?]+["”’]?\s*/g) || [text]; S.speaking = true; render();
    chunks.forEach((c, i) => { const u = new SpeechSynthesisUtterance(c); u.rate = 1; if (i === chunks.length - 1) u.onend = () => { S.speaking = false; render(); }; speechSynthesis.speak(u); });
  }
}

/* ---------------- devotionals ---------------- */
const DEVO_FIELDS = [['sit', 'Sit with it'], ['pray', 'Pray'], ['try', 'Try this today']];
function devoParse(d) {
  if (d._parsed && d._parsed.text === d.text) return d._parsed.v;
  const { props, body } = parseFM(d.text);
  const out = { path: d.path, title: d.title, subtitle: asStr(props.subtitle), about: '', weeks: [], items: [] };
  let week = null, item = null, inAbout = false; const pre = [];
  const close = () => { if (item) { item.body = item.bodyLines.join('\n').trim(); delete item.bodyLines; } item = null; };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^#\s+(.+)$/.exec(line))) { close(); inAbout = false; week = { title: m[1].trim(), items: [] }; out.weeks.push(week); continue; }
    if ((m = /^##\s+(.+)$/.exec(line))) {
      close();
      if (/^about$/i.test(m[1].trim())) { inAbout = true; continue; }
      inAbout = false;
      if (!week) { week = { title: '', items: [] }; out.weeks.push(week); }
      const tm = /^(\d+)[.)]\s*(.+)$/.exec(m[1].trim());
      item = { title: tm ? tm[2] : m[1].trim(), ref: '', verse: '', big: '', sit: '', pray: '', try: '', cards: [], bodyLines: [], week: week.title };
      week.items.push(item); out.items.push(item); continue;
    }
    if (inAbout || !item) { pre.push(line); continue; }
    if ((m = /^>\s*\*\*(.+?)\*\*\s*(.*)$/.exec(line))) { item.ref = m[1].trim(); item.verse = m[2].trim().replace(/^["“]|["”]$/g, ''); continue; }
    if ((m = /^\*\*The big idea:?\*\*:?\s*(.+)$/i.exec(line))) { item.big = m[1].trim(); continue; }
    const f = DEVO_FIELDS.find(([, l]) => new RegExp('^\\*\\*' + l + ':?\\*\\*', 'i').test(line));
    if (f) { item[f[0]] = line.replace(/^\*\*[^*]+\*\*:?\s*/, '').trim(); continue; }
    if (/^\*Built from:\*/.test(line)) { item.cards = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map(x => x[1] + '.md'); continue; }
    item.bodyLines.push(line);
  }
  close();
  out.about = pre.join('\n').trim();
  out.items.forEach((it, i) => { it.n = i + 1; it.words = ((it.big + ' ' + it.body + ' ' + it.sit + ' ' + it.pray + ' ' + it.try).match(/\S+/g) || []).length; });
  d._parsed = { text: d.text, v: out };
  return out;
}
function devoCols() { return [...(S.devos ? S.devos.values() : [])].filter(d => !isAdventDoc(d) && !/## 1\. Title\n\n> \*\*Reference\*\*/.test(d.text) || (S.devoEdit === d.path)).sort((a, b) => a.title.localeCompare(b.title)).map(devoParse); }
function devoAll() { return devoCols().flatMap(c => c.items.map(it => ({ col: c, it }))); }
function devoDone() { try { return JSON.parse(localStorage.getItem('cardeck.devo') || '{}'); } catch (_) { return {}; } }
function devoKey(col, it) { return `${col.path}#${it.n}`; }
function devoIsDone(col, it) { return !!devoDone()[devoKey(col, it)]; }
function devoToday() {
  const all = devoAll(); if (!all.length) return null;
  const done = devoDone();
  const next = all.find(x => !done[devoKey(x.col, x.it)]);
  return next || all[hashStr(today()) % all.length];
}
function devoHash(col, it) { return hashFor({ kind: 'devo', name: col.title, n: it.n }); }
function devoCur() {
  const v = S.view; const col = devoCols().find(c => c.title === v.name); if (!col) return null;
  const it = col.items.find(x => x.n === v.n); return it ? { col, it } : null;
}
function devoMins(it) { return Math.max(2, Math.round(it.words / 170)); }
function devoText(col, it) {
  return [it.title.toUpperCase(), it.ref ? `${it.ref}\n“${it.verse}”` : '', it.big, plainKeepLines(it.body),
    ...DEVO_FIELDS.filter(([k]) => it[k]).map(([k, l]) => `${l}: ${plain(it[k])}`)].filter(Boolean).join('\n\n');
}
function plainKeepLines(md) { return (md || '').split(/\n\s*\n/).map(p => p.split('\n').map(plain).join('\n')).join('\n\n'); }
function devoDeskHTML() {
  const t = devoToday(); if (!t) return '';
  const { col, it } = t; const done = devoDone(); const doneN = devoAll().filter(x => done[devoKey(x.col, x.it)]).length; const total = devoAll().length;
  return `<section class="desk-section devo-desk">
    <div class="section-head"><h2>Today’s devotional</h2><p><a class="crumb" href="#/devotionals">All ${num(total)}</a></p></div>
    <a class="devo-hero" href="${devoHash(col, it)}">
      <span class="devo-hero-top"><span class="devo-day">Day ${it.n}</span><span>${esc(col.title)} · ${devoMins(it)} min</span></span>
      <span class="devo-hero-title">${esc(it.title)}</span>
      ${it.big ? `<span class="devo-hero-big">${esc(it.big)}</span>` : ''}
      ${it.ref ? `<span class="devo-hero-ref">${icon('flame')}${esc(it.ref)}</span>` : ''}
      <span class="devo-hero-go">Read today’s devotional<span class="devo-prog-mini">${num(doneN)} of ${num(total)} done</span></span>
    </a></section>`;
}
function renderDevos(el) {
  const cols = devoCols(); S.list = [];
  if (S.devoEdit) { const d = S.devos.get(S.devoEdit); if (d) return renderDevoEdit(el, d); S.devoEdit = null; }
  if (!cols.length) {
    el.innerHTML = `<div class="view-head"><div><h1 class="view-title">Devotionals</h1><p class="view-sub">Short readings built from your own cards.</p></div></div>
      <div class="empty"><h3>No devotionals yet</h3><p>Start a collection. Each devotional gets a verse, one big idea, a short reading, a question, a prayer, and one thing to try today.</p><button class="btn btn-primary" data-act="devo-new">${icon('plus')}Start a collection</button></div>`;
    return;
  }
  const done = devoDone(); const t = devoToday();
  el.innerHTML = cols.map(col => {
    const dn = col.items.filter(it => done[devoKey(col, it)]).length; const pct = col.items.length ? Math.round(100 * dn / col.items.length) : 0;
    const today = t && t.col.path === col.path ? t.it : col.items[0];
    return `<div class="devo-index">
      <header class="devo-head">
        <p class="devo-eyebrow">${icon('flame')}Devotionals</p>
        <h1 class="devo-coltitle">${esc(col.title)}</h1>
        ${col.subtitle ? `<p class="devo-sub">${esc(col.subtitle)}</p>` : ''}
        <div class="devo-progress"><div class="progress"><i style="width:${pct}%"></i></div><span>${num(dn)} of ${num(col.items.length)} done</span></div>
        <div class="row devo-head-actions">
          ${today ? `<a class="btn btn-primary" href="${devoHash(col, today)}">${icon('flame')}${dn && dn < col.items.length ? `Continue with day ${today.n}` : dn === col.items.length ? 'Read today’s' : 'Start day 1'}</a>` : ''}
          <button class="btn" data-act="devo-edit" data-path="${esc(col.path)}">${icon('pen')}Edit</button>
          <button class="btn btn-quiet" data-act="devo-copyall" data-path="${esc(col.path)}">Copy all</button>
          <button class="btn btn-quiet" data-act="devo-md" data-path="${esc(col.path)}">Download</button>
          <button class="btn btn-quiet" data-act="print">Print or PDF</button>
        </div>
      </header>
      ${col.about ? `<div class="devo-about">${renderMd(col.about)}</div>` : ''}
      ${col.weeks.filter(w => w.items.length).map(w => `<section class="devo-week"><h2 class="devo-weektitle">${esc(w.title)}</h2>
        <div class="devo-grid">${w.items.map(it => { const isDone = !!done[devoKey(col, it)]; const isToday = t && t.col.path === col.path && t.it.n === it.n;
          return `<a class="devo-tile${isDone ? ' is-done' : ''}${isToday ? ' is-today' : ''}" href="${devoHash(col, it)}">
            <span class="devo-n">${isDone ? icon('check') : it.n}</span>
            <span class="devo-tbody"><span class="devo-t">${esc(it.title)}</span>${it.ref ? `<span class="devo-ref">${esc(it.ref)}</span>` : ''}${it.big ? `<span class="devo-big">${esc(it.big)}</span>` : ''}</span>
            ${isToday ? '<span class="devo-flag">Today</span>' : ''}</a>`; }).join('')}</div></section>`).join('')}
      <article class="manuscript devo-print">${col.items.map(it => devoBodyHTML(col, it)).join('')}</article>
    </div>`;
  }).join('');
}
function devoBodyHTML(col, it) {
  return `<section class="devo-piece">
    <p class="devo-pos">Day ${it.n} of ${col.items.length}${it.week ? ` · ${esc(it.week)}` : ''}</p>
    <h1 class="devo-title">${esc(it.title)}</h1>
    ${it.ref ? `<blockquote class="devo-verse"><p>“${esc(it.verse)}”</p><cite>${esc(it.ref)}</cite></blockquote>` : ''}
    ${it.big ? `<p class="devo-bigidea">${esc(it.big)}</p>` : ''}
    <div class="devo-body">${renderMd(it.body)}</div>
    <div class="devo-steps">${DEVO_FIELDS.filter(([k]) => it[k]).map(([k, l]) => `<div class="devo-step devo-${k}"><h3>${l}</h3>${renderMd(it[k])}</div>`).join('')}</div>
    ${it.cards.length ? `<div class="dr-cards devo-cards"><span>Built from ${it.cards.length === 1 ? 'your card' : `${it.cards.length} of your cards`}</span>${it.cards.map(p => { const c = S.cards.get(p); return `<button class="chip-card" data-open="${esc(p)}">${esc(c ? c.title : p.split('/').pop().replace(/\.md$/, ''))}</button>`; }).join('')}</div>` : ''}
  </section>`;
}
function renderDevo(el) {
  const cur = devoCur(); if (!cur) return renderDevos(el);
  const { col, it } = cur; S.list = it.cards.filter(p => S.cards.has(p));
  if (S.speaking && S.speakFor !== devoKey(col, it)) stopSpeaking();
  const prev = col.items[it.n - 2], next = col.items[it.n];
  const isDone = devoIsDone(col, it);
  el.innerHTML = `<div class="devo-read">
    <div class="devo-top"><a class="crumb" href="#/devotionals">${icon('flame')}${esc(col.title)}</a><span class="devo-mins">${devoMins(it)} min</span></div>
    ${devoBodyHTML(col, it)}
    <div class="devo-bar">
      <button class="btn ${isDone ? '' : 'btn-primary'}" data-act="devo-done" aria-pressed="${isDone}">${icon('check')}${isDone ? 'Done' : 'Mark done'}</button>
      <button class="btn" data-act="devo-listen" aria-pressed="${!!S.speaking}">${S.speaking ? 'Stop' : 'Listen'}</button>
      <button class="btn btn-quiet" data-act="devo-share">${icon('share')}Share</button>
      <button class="btn btn-quiet" data-act="devo-copy">Copy</button>
    </div>
    <nav class="devo-pager">
      ${prev ? `<a class="devo-pg prev" href="${devoHash(col, prev)}"><small>Day ${prev.n}</small><span>${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="devo-pg next" href="${devoHash(col, next)}"><small>Day ${next.n}</small><span>${esc(next.title)}</span></a>` : `<a class="devo-pg next" href="#/devotionals"><small>That’s all ${col.items.length}</small><span>Back to ${esc(col.title)}</span></a>`}
    </nav>
  </div>`;
}
function renderDevoEdit(el, d) {
  el.innerHTML = `<div class="view-head"><div><a class="crumb" href="#/devotionals">Devotionals</a><h1 class="view-title">${esc(d.title)}</h1></div></div>
    <div class="dr-edit"><p class="muted dr-help"># starts a week, ## starts a devotional (“## 3. Title”). Then a verse line (&gt; **Ref** “text”), **The big idea:**, your reading, **Sit with it:**, **Pray:**, **Try this today:**, and *Built from:* [[card links]].</p>
    <textarea id="devo-text" spellcheck="true">${esc(parseFM(d.text).body)}</textarea>
    <div class="row"><button class="btn btn-primary" data-act="devo-save">${icon('check')}Save</button><button class="btn" data-act="devo-cancel">Cancel</button></div></div>`;
  const ta = $('#devo-text'); ta.style.height = Math.max(480, Math.min(ta.scrollHeight + 20, 4000)) + 'px'; ta.focus({ preventScroll: true });
}
function devoStep(dir) {
  const cur = devoCur(); if (!cur) return;
  const to = cur.col.items[cur.it.n - 1 + dir]; if (to) { stopSpeaking(); location.hash = devoHash(cur.col, to); }
}
function stopSpeaking() { if (S.speaking && 'speechSynthesis' in window) { speechSynthesis.cancel(); S.speaking = false; } }
async function devoAct(act, el) {
  if (act === 'devo-new') {
    const path = 'Devotionals/My devotionals.md';
    const body = `## About\n\nA few words about this collection.\n\n# Week 1\n\n## 1. Title\n\n> **Reference** “The verse.”\n\n**The big idea:** One line.\n\nYour reading.\n\n**Sit with it:** A question.\n\n**Pray:** A short prayer.\n\n**Try this today:** One small thing.\n`;
    const d = makeDevo(path, `---\ntype: devotional\nsubtitle: ""\nstatus: started\n---\n${body}`, null); docSet(d);
    await DB.putCards([d]); if (S.gh) await queue({ kind: 'put', path, text: d.text, sha: null, msg: `Devotionals: ${d.title}` });
    S.devoEdit = path; render(); return;
  }
  if (act === 'devo-edit') { S.devoEdit = el.dataset.path; location.hash === '#/devotionals' ? render() : (location.hash = '#/devotionals'); return; }
  if (act === 'devo-cancel') { S.devoEdit = null; render(); return; }
  if (act === 'devo-save') {
    const d = S.devos.get(S.devoEdit); if (!d) return;
    const fm = (/^---\n[\s\S]*?\n---\n/.exec(d.text) || [''])[0];
    d.text = fm + $('#devo-text').value.replace(/\s+$/, '') + '\n'; d.edited = Date.now(); d._parsed = null;
    await DB.putCards([d]); if (S.gh) await queue({ kind: 'put', path: d.path, text: d.text, sha: d.sha, msg: `Devotionals: ${d.title}` });
    S.devoEdit = null; render(); toast('Devotionals saved'); return;
  }
  if (act === 'devo-copyall' || act === 'devo-md') {
    const col = devoCols().find(c => c.path === el.dataset.path); if (!col) return;
    if (act === 'devo-md') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([parseFM(S.devos.get(col.path).text).body], { type: 'text/markdown' })); a.download = `${safeName(col.title)}.md`; document.body.appendChild(a); a.click(); a.remove(); return; }
    const text = col.items.map(it => `DAY ${it.n}\n` + devoText(col, it)).join('\n\n———\n\n');
    try { await navigator.clipboard.writeText(text); toast(`All ${col.items.length} copied`); } catch (_) { toast('Copy isn’t allowed here. Use Download instead.'); } return;
  }
  const cur = devoCur(); if (!cur) return; const { col, it } = cur;
  if (act === 'devo-done') {
    const done = devoDone(); const k = devoKey(col, it);
    if (done[k]) delete done[k]; else done[k] = today();
    try { localStorage.setItem('cardeck.devo', JSON.stringify(done)); } catch (_) { }
    render(); if (done[k]) toast(it.n < col.items.length ? `Day ${it.n} done. Day ${it.n + 1} is ready when you are.` : `All ${col.items.length} done. Well run.`); return;
  }
  if (act === 'devo-copy') { try { await navigator.clipboard.writeText(devoText(col, it)); toast('Devotional copied'); } catch (_) { toast('Copy isn’t allowed here.'); } return; }
  if (act === 'devo-share') {
    const text = devoText(col, it);
    if (navigator.share) { try { await navigator.share({ title: it.title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); } catch (_) { toast('Sharing isn’t available here.'); } return;
  }
  if (act === 'devo-listen') {
    if (!('speechSynthesis' in window)) { toast('Listening isn’t available on this device.'); return; }
    if (S.speaking) { stopSpeaking(); render(); return; }
    const text = [it.title + '.', it.ref ? `${it.ref}. ${it.verse}` : '', it.big, plain(it.body.replace(/\n/g, '\n\n')), ...DEVO_FIELDS.filter(([k]) => it[k]).map(([k, l]) => `${l}. ${plain(it[k])}`)].filter(Boolean).join(' ');
    const chunks = text.match(/[^.!?]+[.!?]+["”’)]?\s*/g) || [text]; S.speaking = true; S.speakFor = devoKey(col, it); render();
    chunks.forEach((c, i) => { const u = new SpeechSynthesisUtterance(c); u.rate = 0.97; if (i === chunks.length - 1) u.onend = () => { S.speaking = false; render(); }; speechSynthesis.speak(u); });
  }
}

(() => {
  let sx = 0, sy = 0, st = 0;
  document.addEventListener('touchstart', e => { if (S.view && S.view.kind === 'devo' && !S.reader && e.touches.length === 1 && !e.target.closest('textarea,input,button')) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } else st = 0; }, { passive: true });
  document.addEventListener('touchend', e => { if (!st || Date.now() - st > 650) return; const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; st = 0; if (Math.abs(dx) > 80 && Math.abs(dy) < 50) devoStep(dx < 0 ? 1 : -1); }, { passive: true });
})();

/* ---------------- advent ---------------- */
const ADV_FIELDS = [['practice', 'Practice'], ['pray', 'Pray']];
const ADV_CANDLES = [['Hope', '#7b4bb7'], ['Peace', '#7b4bb7'], ['Joy', '#e46aa3'], ['Love', '#7b4bb7']];
function isAdventDoc(d) { return /^type:\s*"?advent"?\s*$/m.test((/^---\n([\s\S]*?)\n---/.exec(d.text) || [, ''])[1]); }
function adventDoc() { return [...(S.devos ? S.devos.values() : [])].filter(isAdventDoc).sort((a, b) => b.title.localeCompare(a.title))[0] || null; }
function adventParse(d) {
  if (d._adv && d._adv.text === d.text) return d._adv.v;
  const { props, body } = parseFM(d.text);
  const out = { path: d.path, title: asStr(props.title) || d.title, subtitle: asStr(props.subtitle), intro: '', guides: '', weeks: [], days: [] };
  let week = null, day = null, sec = null; const buf = { intro: [], guides: [] };
  const close = () => { if (day) { day.body = day.lines.join('\n').trim(); delete day.lines; } day = null; };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, ''); let m;
    if ((m = /^#\s+(.+)$/.exec(line))) { close(); sec = null; week = { title: m[1].trim(), intro: [], days: [], n: out.weeks.length }; out.weeks.push(week); continue; }
    if ((m = /^##\s+(.+)$/.exec(line))) {
      close(); const h = m[1].trim();
      if (/^before you begin/i.test(h)) { sec = 'intro'; continue; }
      if (/^your guides/i.test(h)) { sec = 'guides'; continue; }
      sec = null; const dm = /^(\d{4}-\d{2}-\d{2})\s*[·\-–—]\s*(.+)$/.exec(h);
      if (!dm) continue;
      if (!week) { week = { title: '', intro: [], days: [], n: 0 }; out.weeks.push(week); }
      day = { date: dm[1], title: dm[2].trim(), ref: '', verse: '', read: '', guide: '', voice: '', voiceBy: '', practice: '', pray: '', cards: [], lines: [], week: week.title, wn: week.n };
      week.days.push(day); out.days.push(day); continue;
    }
    if (sec) { buf[sec].push(line); continue; }
    if (!day) { if (week) week.intro.push(line); continue; }
    if ((m = /^>\s*\*\*(.+?)\*\*\s*(.*)$/.exec(line))) { day.ref = m[1].trim(); day.verse = m[2].trim().replace(/^["“]|["”]$/g, ''); continue; }
    if ((m = /^\*\*Read:?\*\*:?\s*(.+)$/i.exec(line))) { day.read = m[1].trim(); continue; }
    if ((m = /^\*\*Guide:?\*\*:?\s*(.+)$/i.exec(line))) { day.guide = m[1].trim(); continue; }
    if ((m = /^\*\*Voice:?\*\*:?\s*(.+)$/i.exec(line))) { const v = m[1].trim(); const k = v.lastIndexOf(' — '); day.voice = (k > 0 ? v.slice(0, k).trim() : v).replace(/^"([\s\S]*)"$/, '“$1”'); day.voiceBy = k > 0 ? v.slice(k + 3).trim() : ''; continue; }
    const f = ADV_FIELDS.find(([, l]) => new RegExp('^\\*\\*' + l + ':?\\*\\*', 'i').test(line));
    if (f) { day[f[0]] = line.replace(/^\*\*[^*]+\*\*:?\s*/, '').trim(); continue; }
    if (/^\*From your cards:\*/.test(line)) { day.cards = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map(x => x[1] + '.md'); continue; }
    day.lines.push(line);
  }
  close();
  out.intro = buf.intro.join('\n').trim(); out.guides = buf.guides.join('\n').trim();
  out.weeks.forEach(w => { w.intro = w.intro.join('\n').trim(); });
  out.days.forEach((x, i) => { x.n = i + 1; x.words = ((x.body + ' ' + x.voice + ' ' + x.practice + ' ' + x.pray).match(/\S+/g) || []).length; });
  d._adv = { text: d.text, v: out };
  return out;
}
const advDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const advFmt = (s, o = { weekday: 'long', month: 'long', day: 'numeric' }) => advDate(s).toLocaleDateString(undefined, o);
function advToday() { return today(); }
function advState(a) {
  const t = advToday(); if (!a.days.length) return { phase: 'none' };
  const first = a.days[0].date, last = a.days[a.days.length - 1].date;
  if (t < first) return { phase: 'before', daysTo: Math.round((advDate(first) - advDate(t)) / 864e5), lit: 0 };
  const day = a.days.find(x => x.date === t);
  if (day) return { phase: 'during', day, lit: day.date >= last ? 5 : day.wn + 1 };
  return { phase: 'after', lit: 5, day: a.days[a.days.length - 1] };
}
function advSeason() { const t = advToday(); const md = t.slice(5); return md >= '10-15' || md <= '01-06'; }
function advKey(a, x) { return `${a.path}#${x.date}`; }
function advHash(x) { return '#/advent/' + x.date; }
function wreathSVG(lit, size = 180) {
  const order = [0, 1, 3, 2]; const pos = [[46, 70], [134, 70], [158, 112], [22, 112]];
  const leaves = Array.from({ length: 22 }, (_, i) => { const a = i / 22 * Math.PI * 2; const x = 90 + Math.cos(a) * 74, y = 122 + Math.sin(a) * 26; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="14" ry="6" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${i % 2 ? '#2f6b45' : '#24563a'}"/>`; }).join('');
  const berries = Array.from({ length: 8 }, (_, i) => { const a = (i + .5) / 8 * Math.PI * 2; return `<circle cx="${(90 + Math.cos(a) * 70).toFixed(1)}" cy="${(122 + Math.sin(a) * 24).toFixed(1)}" r="3.4" fill="#d9322b"/>`; }).join('');
  const candle = (i, x, base, h, color, on) => `<g class="cdl${on ? ' on' : ''}"><rect x="${x - 7}" y="${base - h}" width="14" height="${h}" rx="3" fill="${color}"/><rect x="${x - 7}" y="${base - h}" width="5" height="${h}" rx="2" fill="#fff" opacity=".18"/><line x1="${x}" y1="${base - h}" x2="${x}" y2="${base - h - 6}" stroke="#3a2a1a" stroke-width="1.6"/>${on ? `<g class="flame"><ellipse cx="${x}" cy="${base - h - 13}" rx="9" ry="14" fill="#ffb347" opacity=".25"/><path d="M${x} ${base - h - 26} C ${x + 7} ${base - h - 15}, ${x + 5} ${base - h - 6}, ${x} ${base - h - 5} C ${x - 5} ${base - h - 6}, ${x - 7} ${base - h - 15}, ${x} ${base - h - 26} Z" fill="#ff8a1f"/><path d="M${x} ${base - h - 19} C ${x + 3} ${base - h - 13}, ${x + 2} ${base - h - 8}, ${x} ${base - h - 7} C ${x - 2} ${base - h - 8}, ${x - 3} ${base - h - 13}, ${x} ${base - h - 19} Z" fill="#fff3c4"/></g>` : ''}</g>`;
  const back = order.slice(0, 2).map(i => candle(i, pos[i][0], pos[i][1] + 40, 52, ADV_CANDLES[i][1], lit > i)).join('');
  const front = order.slice(2).map(i => candle(i, pos[i][0], pos[i][1] + 22, 52, ADV_CANDLES[i][1], lit > i)).join('');
  return `<svg class="wreath" viewBox="0 0 180 180" width="${size}" height="${size}" role="img" aria-label="Advent wreath, ${Math.min(lit, 4)} of 4 candles lit${lit > 4 ? ' and the Christ candle' : ''}">
    <ellipse cx="90" cy="124" rx="86" ry="32" fill="#000" opacity=".25"/>
    ${back}${candle(4, 90, 118, 66, '#f7f2e6', lit > 4)}${leaves}${berries}${front}</svg>`;
}
function adventDeskHTML() {
  const d = adventDoc(); if (!d || !advSeason()) return '';
  const a = adventParse(d); const st = advState(a);
  if (st.phase === 'none') return '';
  const x = st.phase === 'before' ? a.days[0] : st.day;
  const top = st.phase === 'before' ? `Advent begins ${advFmt(a.days[0].date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${st.daysTo === 1 ? 'tomorrow' : `in ${st.daysTo} days`}`
    : st.phase === 'during' ? `${advFmt(x.date)} · Day ${x.n} of ${a.days.length}` : 'Christmastide';
  return `<section class="desk-section adv-desk"><div class="section-head"><h2>Advent</h2><p><a class="crumb" href="#/advent">The whole walk</a></p></div>
    <a class="adv-hero" href="${st.phase === 'before' ? '#/advent' : advHash(x)}">
      <span class="adv-hero-wreath">${wreathSVG(st.lit, 120)}</span>
      <span class="adv-hero-text"><span class="adv-hero-top">${esc(top)}</span>
      <span class="adv-hero-title">${esc(st.phase === 'before' ? a.title : x.title)}</span>
      <span class="adv-hero-sub">${esc(st.phase === 'before' ? a.subtitle : `${x.week}${x.guide ? ' · with ' + x.guide : ''}`)}</span>
      <span class="adv-hero-go">${st.phase === 'before' ? 'Take the first step' : 'Walk today'}</span></span>
    </a></section>`;
}
function renderAdvent(el) {
  const d = adventDoc(); S.list = [];
  if (!d) { el.innerHTML = `<div class="view-head"><div><h1 class="view-title">Advent</h1></div></div><div class="empty"><h3>No Advent walk yet</h3><p>Sync to bring it down, or add a file to the Devotionals folder with <code>type: advent</code>.</p></div>`; return; }
  const a = adventParse(d); const st = advState(a); const done = devoDone(); const t = advToday();
  if (S.view.date) return renderAdventDay(el, a, st);
  const doneN = a.days.filter(x => done[advKey(a, x)]).length;
  const status = st.phase === 'before' ? `Begins ${advFmt(a.days[0].date)} · ${st.daysTo === 1 ? 'tomorrow' : `${st.daysTo} days to go`}`
    : st.phase === 'during' ? `Day ${st.day.n} of ${a.days.length} · ${st.day.week}` : 'Merry Christmas. The walk is complete.';
  const primary = st.phase === 'during' ? `<a class="btn btn-primary" href="${advHash(st.day)}">${icon('flame')}Walk today</a>` : `<a class="btn btn-primary" href="${advHash(a.days[0])}">${icon('flame')}${st.phase === 'before' ? 'Preview day 1' : 'Start from day 1'}</a>`;
  el.innerHTML = `<div class="adv">
    <header class="adv-head">
      <div class="adv-head-wreath">${wreathSVG(st.lit, 220)}</div>
      <div class="adv-head-text">
        <p class="adv-eyebrow">Advent ${esc(a.days[0].date.slice(0, 4))}</p>
        <h1 class="adv-title">${esc(a.title)}</h1>
        ${a.subtitle ? `<p class="adv-sub">${esc(a.subtitle)}</p>` : ''}
        <p class="adv-status">${esc(status)}${doneN ? ` · ${doneN} walked` : ''}</p>
        <div class="row adv-actions">${primary}<button class="btn" data-act="adv-intro">Before you begin</button><button class="btn btn-quiet" data-act="devo-edit" data-path="${esc(a.path)}">${icon('pen')}Edit</button><button class="btn btn-quiet" data-act="print">Print</button></div>
      </div>
    </header>
    <section class="adv-cal" aria-label="Advent calendar">
      ${a.weeks.map(w => `<div class="adv-week" style="--cdl:${(ADV_CANDLES[w.n] || ['', '#f1c75b'])[1]}">
        <div class="adv-week-head"><span class="adv-cdl"></span><h2>${esc(w.title)}</h2></div>
        ${w.intro ? `<div class="adv-week-intro">${renderMd(w.intro)}</div>` : ''}
        <div class="adv-days">${w.days.map(x => { const isT = x.date === t, past = x.date < t, isD = !!done[advKey(a, x)]; const dt = advDate(x.date);
          return `<a class="adv-day${isT ? ' is-today' : ''}${past ? ' is-past' : ''}${isD ? ' is-done' : ''}${x.date.endsWith('12-25') ? ' is-xmas' : ''}" href="${advHash(x)}">
            <span class="adv-dow">${dt.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <span class="adv-dnum">${dt.getDate()}</span>
            <span class="adv-dtitle">${esc(x.title)}</span>
            ${x.guide ? `<span class="adv-dguide">${esc(x.guide)}</span>` : ''}
            ${isD ? `<span class="adv-check">${icon('check')}</span>` : ''}${isT ? '<span class="adv-flag">Today</span>' : ''}</a>`; }).join('')}</div></div>`).join('')}
    </section>
    <section class="adv-letter" id="adv-intro"><h2>Before you begin</h2>${renderMd(a.intro)}</section>
    ${a.guides ? `<details class="adv-guides"><summary>Your guides</summary>${renderMd(a.guides)}</details>` : ''}
    <article class="manuscript adv-print">${a.days.map(x => advBodyHTML(a, x)).join('')}</article>
  </div>`;
}
function advBodyHTML(a, x) {
  const dt = advDate(x.date); const sun = dt.getDay() === 0 && !x.date.endsWith('12-25');
  const sunName = sun ? ['First', 'Second', 'Third', 'Fourth'][x.wn] + ' Sunday of Advent' : '';
  return `<section class="adv-piece" style="--cdl:${(ADV_CANDLES[x.wn] || ['', '#f1c75b'])[1]}">
    <p class="adv-pos">${esc(advFmt(x.date))}${sunName ? ` · ${sunName}` : ''} · Day ${x.n} of ${a.days.length}</p>
    <p class="adv-wk">${esc(x.week)}</p>
    <h1 class="adv-dtitle-big">${esc(x.title)}</h1>
    ${x.ref ? `<blockquote class="devo-verse adv-verse"><p>“${esc(x.verse)}”</p><cite>${esc(x.ref)}</cite></blockquote>` : ''}
    ${x.read ? `<p class="adv-read"><b>Read</b> ${esc(x.read)}</p>` : ''}
    ${x.voice ? `<figure class="adv-voice"><span class="adv-voice-who">${esc(x.guide || 'A voice')}</span><blockquote>${renderMd(x.voice)}</blockquote>${x.voiceBy ? `<figcaption>${renderMd(x.voiceBy)}</figcaption>` : ''}</figure>` : ''}
    <div class="devo-body adv-body">${renderMd(x.body)}</div>
    <div class="devo-steps">${x.practice ? `<div class="devo-step devo-try"><h3>Practice</h3>${renderMd(x.practice)}</div>` : ''}${x.pray ? `<div class="devo-step devo-pray"><h3>Pray</h3>${renderMd(x.pray)}</div>` : ''}</div>
    ${x.cards.length ? `<div class="dr-cards devo-cards"><span>From your cards</span>${x.cards.map(p => { const c = S.cards.get(p); return `<button class="chip-card" data-open="${esc(p)}">${esc(c ? c.title : p.split('/').pop().replace(/\.md$/, ''))}</button>`; }).join('')}</div>` : ''}
  </section>`;
}
function renderAdventDay(el, a, st) {
  const x = a.days.find(y => y.date === S.view.date); if (!x) { location.hash = '#/advent'; return; }
  S.list = x.cards.filter(p => S.cards.has(p));
  if (S.speaking && S.speakFor !== advKey(a, x)) stopSpeaking();
  const prev = a.days[x.n - 2], next = a.days[x.n];
  const isD = !!devoDone()[advKey(a, x)]; const t = advToday();
  const lit = x.date.endsWith('12-25') ? 5 : x.wn + 1;
  el.innerHTML = `<div class="devo-read adv-read-wrap">
    <div class="devo-top"><a class="crumb" href="#/advent">${icon('flame')}${esc(a.title)}</a><span class="devo-mins">${Math.max(3, Math.round(x.words / 170))} min</span></div>
    <div class="adv-day-wreath">${wreathSVG(lit, 120)}</div>
    ${x.date > t ? `<p class="adv-early">You’re reading ahead. This one is for ${esc(advFmt(x.date))}.</p>` : ''}
    ${advBodyHTML(a, x)}
    <div class="devo-bar">
      <button class="btn ${isD ? '' : 'btn-primary'}" data-act="adv-done" aria-pressed="${isD}">${icon('check')}${isD ? 'Walked' : 'I walked this today'}</button>
      <button class="btn" data-act="adv-listen" aria-pressed="${!!S.speaking}">${S.speaking ? 'Stop' : 'Listen'}</button>
      <button class="btn btn-quiet" data-act="adv-share">${icon('share')}Share</button>
      <button class="btn btn-quiet" data-act="adv-copy">Copy</button>
    </div>
    <nav class="devo-pager">
      ${prev ? `<a class="devo-pg prev" href="${advHash(prev)}"><small>${esc(advFmt(prev.date, { month: 'short', day: 'numeric' }))}</small><span>${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="devo-pg next" href="${advHash(next)}"><small>${esc(advFmt(next.date, { month: 'short', day: 'numeric' }))}</small><span>${esc(next.title)}</span></a>` : `<a class="devo-pg next" href="#/advent"><small>Merry Christmas</small><span>Back to the wreath</span></a>`}
    </nav>
  </div>`;
}
function advCur() { const d = adventDoc(); if (!d || !S.view.date) return null; const a = adventParse(d); const x = a.days.find(y => y.date === S.view.date); return x ? { a, x } : null; }
function advText(a, x) {
  return [x.title.toUpperCase(), advFmt(x.date), x.ref ? `${x.ref}\n“${x.verse}”` : '', x.read ? `Read: ${x.read}` : '', x.voice ? `${plain(x.voice)}${x.voiceBy ? `\n— ${plain(x.voiceBy)}` : ''}` : '',
    plainKeepLines(x.body), x.practice ? `Practice: ${plain(x.practice)}` : '', x.pray ? `Pray: ${plain(x.pray)}` : ''].filter(Boolean).join('\n\n');
}
function advStep(dir) { const c = advCur(); if (!c) return; const to = c.a.days[c.x.n - 1 + dir]; if (to) { stopSpeaking(); location.hash = advHash(to); } }
async function advAct(act) {
  const c = advCur(); if (!c) return; const { a, x } = c;
  if (act === 'adv-done') {
    const done = devoDone(); const k = advKey(a, x);
    if (done[k]) delete done[k]; else done[k] = today();
    try { localStorage.setItem('cardeck.devo', JSON.stringify(done)); } catch (_) { }
    render(); if (done[k]) toast(x.n < a.days.length ? 'Walked. See you tomorrow.' : 'Merry Christmas, Jeremy.'); return;
  }
  if (act === 'adv-copy') { try { await navigator.clipboard.writeText(advText(a, x)); toast('Copied'); } catch (_) { toast('Copy isn’t allowed here.'); } return; }
  if (act === 'adv-share') {
    const text = advText(a, x);
    if (navigator.share) { try { await navigator.share({ title: x.title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); } catch (_) { toast('Sharing isn’t available here.'); } return;
  }
  if (act === 'adv-listen') {
    if (!('speechSynthesis' in window)) { toast('Listening isn’t available on this device.'); return; }
    if (S.speaking) { stopSpeaking(); render(); return; }
    const text = [x.title + '.', x.ref ? `${x.ref}. ${x.verse}` : '', x.voice ? `${plain(x.voice)} ${plain(x.voiceBy)}.` : '', plain(x.body.replace(/\n/g, '\n\n')), x.practice ? `Practice. ${plain(x.practice)}` : '', x.pray ? `Pray. ${plain(x.pray)}` : ''].filter(Boolean).join(' ');
    const chunks = text.match(/[^.!?]+[.!?]+["”’)]?\s*/g) || [text]; S.speaking = true; S.speakFor = advKey(a, x); render();
    chunks.forEach((ch, i) => { const u = new SpeechSynthesisUtterance(ch); u.rate = 0.96; if (i === chunks.length - 1) u.onend = () => { S.speaking = false; render(); }; speechSynthesis.speak(u); });
  }
}
(() => {
  let sx = 0, sy = 0, st = 0;
  document.addEventListener('touchstart', e => { if (S.view && S.view.kind === 'advent' && S.view.date && !S.reader && e.touches.length === 1 && !e.target.closest('textarea,input,button')) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } else st = 0; }, { passive: true });
  document.addEventListener('touchend', e => { if (!st || Date.now() - st > 650) return; const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; st = 0; if (Math.abs(dx) > 80 && Math.abs(dy) < 50) advStep(dx < 0 ? 1 : -1); }, { passive: true });
})();

/* ---------------- stars, sharing, chapter list, manuscript, shortcuts ---------------- */
function isStarred(c) { return !!c && c.extra && String(c.extra.starred) === 'true'; }
async function toggleStar(path) {
  const c = S.cards.get(path); if (!c) return;
  const on = !isStarred(c);
  if (on) { c.extra.starred = 'true'; if (!c.extraOrder.includes('starred')) c.extraOrder.push('starred'); }
  else { delete c.extra.starred; c.extraOrder = c.extraOrder.filter(k => k !== 'starred'); }
  c.text = serialize(c); c.edited = Date.now(); S.cards.set(path, c); await DB.putCards([c]);
  if (S.gh) await queue({ kind: 'put', path, text: c.text, sha: c.sha, msg: `${on ? 'Star' : 'Unstar'} card: ${c.title}` });
  const b = $('[data-act="star"]'); if (b) { b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', `${on ? 'Unstar' : 'Star'} this card`); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  renderNav(); toast(on ? 'Starred' : 'Removed from Starred');
}
function cardText(c) { return `${c.title}\n\n${plain(c.body).length ? c.body.replace(/\*\*/g, '') : ''}${c.quoted.length ? `\n\n— ${c.quoted.join(', ')}` : ''}${c.date ? `\n\n(${fmtDate(c.date, true)})` : ''}`; }
async function shareCard(path) {
  const c = S.cards.get(path); if (!c) return;
  const text = cardText(c);
  if (navigator.share) { try { await navigator.share({ title: c.title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Card copied. Paste it anywhere.'); } catch (_) { toast('Sharing isn’t available here.'); }
}
function openToc(b) {
  const L = lex(b); let part = null, n = 0;
  const rows = b.chapters.map((ch, ci) => {
    let h = ''; if (ch.part && ch.part !== part) { h = `<div class="toc-part">${esc(ch.part)}</div>`; part = ch.part; }
    const front = isFront(ch); const label = front ? '' : String(++n);
    return `${h}<button class="toc-row" data-tocgo="${ci}"><span class="toc-n">${label}</span><span class="toc-t">${esc(ch.title)}</span><span class="toc-c">${ch.items.length}</span></button>`;
  }).join('');
  openPanel(`${panelHead(L.units[0].toUpperCase() + L.units.slice(1))}<p class="muted">${esc(b.title)}: tap one to jump there.</p><div class="toc">${rows}</div>`);
}
function msParts(b) {
  const out = []; let part = null;
  for (const ch of b.chapters) {
    if (ch.part && ch.part !== part) { out.push({ kind: 'part', text: ch.part }); part = ch.part; }
    out.push({ kind: 'ch', ch, cards: ch.items.map(it => S.cards.get(it.path)).filter(Boolean) });
  }
  return out;
}
function manuscriptMd() {
  const b = bookByName(S.view.name, S.view.doc); if (!b) return '';
  const L = [`# ${b.title}`]; if (b.subtitle) L.push(`*${b.subtitle}*`); L.push('');
  for (const x of msParts(b)) {
    if (x.kind === 'part') { L.push(`## ${x.text}`, ''); continue; }
    L.push(`### ${x.ch.title}`, '');
    if (S.msNotes && x.ch.note) L.push(`> ${plain(x.ch.note)}`, '');
    for (const c of x.cards) { if (S.msTitles) L.push(`**${c.title}**`, ''); L.push(c.body.trim(), ''); }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
function downloadManuscript() {
  const b = bookByName(S.view.name, S.view.doc); if (!b) return;
  const blob = new Blob([manuscriptMd()], { type: 'text/markdown' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${safeName(b.title) || 'Manuscript'}.md`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function renderCompile(el, b) {
  const L = lex(b); if (S.msTitles === undefined) S.msTitles = true;
  const parts = msParts(b); S.list = bookOrder(b);
  let words = 0; for (const x of parts) if (x.cards) for (const c of x.cards) words += (plain(c.body).match(/\S+/g) || []).length;
  let n = 0;
  const body = parts.map(x => {
    if (x.kind === 'part') return `<h2 class="ms-part">${esc(x.text)}</h2>`;
    const label = isFront(x.ch) ? '' : `<span class="ms-num">${L.Unit} ${++n}</span>`;
    return `<section class="ms-ch">${label}<h3 class="ms-title">${esc(x.ch.title)}</h3>${S.msNotes && x.ch.note ? `<div class="ms-note">${renderMd(x.ch.note)}</div>` : ''}
      ${x.cards.length ? x.cards.map(c => `<div class="ms-card" data-open="${esc(c.path)}">${S.msTitles ? `<h4>${esc(c.title)}</h4>` : ''}${renderMd(c.body)}</div>`).join('') : `<p class="ms-empty">No cards yet.</p>`}</section>`;
  }).join('');
  el.innerHTML = `<div class="view-head ms-head"><div><a class="crumb" href="${bookHash(b)}">${esc(b.title)}</a><h1 class="view-title">Manuscript</h1>
      <p class="view-sub">Your ${esc(L.units)} with every card in order, as one piece of writing. About ${num(words)} words, a ${Math.max(1, Math.round(words / 230))}-minute read. Tap any passage to open its card.</p></div>
    <div class="view-actions"><button class="btn" data-act="print">${icon('doc')}Print or save PDF</button><button class="btn" data-act="ms-md">Download .md</button><button class="btn" data-act="ms-copy">Copy</button></div></div>
    <div class="book-tools"><button class="btn btn-quiet" data-act="ms-titles" aria-pressed="${!!S.msTitles}">${S.msTitles ? 'Hide' : 'Show'} card titles</button><button class="btn btn-quiet" data-act="ms-notes" aria-pressed="${!!S.msNotes}">${S.msNotes ? 'Hide' : 'Show'} ${esc(L.unit)} notes</button></div>
    <article class="manuscript"><header class="ms-cover"><h1>${esc(b.title)}</h1>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}</header>${body}</article>`;
}
function showKeys() {
  const d = $('#dialog');
  d.innerHTML = `<h3>Shortcuts</h3><div class="kbd-list"><kbd>/</kbd><span>Search</span><kbd>N</kbd><span>New card</span><kbd>R</kbd><span>Draw a random card</span><kbd>C</kbd><span>Writing coach</span><kbd>← →</kbd><span>Previous and next card</span><kbd>E</kbd><span>Edit the open card</span><kbd>F</kbd><span>Flip to the back</span><kbd>S</kbd><span>Star the open card</span><kbd>Ctrl/⌘ Enter</kbd><span>Save card or add an idea</span><kbd>Esc</kbd><span>Close</span></div>
    <p class="muted">Touch: swipe left or right on an open card to move through the deck, swipe down or tap outside the card to close it.</p><div class="prow"><button class="pbtn primary" data-r="ok">Got it</button></div>`;
  d.hidden = false;
  const done = () => { d.hidden = true; document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); e.preventDefault(); done(); } };
  document.addEventListener('keydown', key, true); $('[data-r="ok"]', d).addEventListener('click', done); $('[data-r="ok"]', d).focus();
}

/* drag cards between sections: mouse drags at once; touch drags after a short press */
let drag = null, suppressClick = 0;
function dragStart() {
  const d = drag; d.started = true; closeMenu();
  const r = d.el.getBoundingClientRect(); d.dx = d.x - r.left; d.dy = d.y - r.top;
  const g = d.el.cloneNode(true); g.classList.add('ghost'); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
  document.body.appendChild(g); d.ghost = g; d.el.classList.add('dragging'); document.body.classList.add('is-dragging');
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { }
  const tick = () => { if (!drag || !drag.started) return; const y = drag.cy; const edge = 90; if (y < edge) scrollBy(0, -Math.ceil((edge - y) / 6)); else if (y > innerHeight - edge) scrollBy(0, Math.ceil((y - innerHeight + edge) / 6)); drag.raf = requestAnimationFrame(tick); };
  d.raf = requestAnimationFrame(tick);
}
function dragTarget(x, y) {
  const els = document.elementsFromPoint(x, y);
  const tile = els.map(e => e.closest && e.closest('.btile')).find(t => t && t !== drag.el && !t.classList.contains('ghost'));
  if (tile) { const r = tile.getBoundingClientRect(); const after = x > r.left + r.width / 2; return { el: tile, ch: +tile.dataset.ch, idx: +tile.dataset.idx + (after ? 1 : 0), side: after ? 'after' : 'before' }; }
  const zone = els.map(e => e.closest && e.closest('.ch-cards, .chapter')).find(Boolean);
  if (zone) { const ci = +zone.dataset.ch; const b = curBook(); return { el: zone.classList.contains('chapter') ? zone.querySelector('.ch-cards') : zone, ch: ci, idx: b ? b.chapters[ci].items.length : 0, side: 'end' }; }
  return null;
}
function clearMarks() { $$('.drop-before,.drop-after,.drop-end').forEach(e => e.classList.remove('drop-before', 'drop-after', 'drop-end')); }
function dragEnd(commit) {
  const d = drag; drag = null; if (!d) return;
  clearTimeout(d.timer); cancelAnimationFrame(d.raf);
  if (!d.started) return;
  suppressClick = Date.now();
  d.ghost && d.ghost.remove(); d.el.classList.remove('dragging'); document.body.classList.remove('is-dragging'); clearMarks();
  if (commit && d.target) { const b = curBook(); if (b) moveItem(b, [+d.el.dataset.ch, +d.el.dataset.idx], [d.target.ch, d.target.idx]); }
}
function bindDrag() {
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.btile'); if (!el || e.button > 0 || e.target.closest('.bt-menu') || S.view.kind !== 'book') return;
    drag = { el, x: e.clientX, y: e.clientY, cy: e.clientY, touch: e.pointerType !== 'mouse', started: false };
    if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.started) dragStart(); }, 380);
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.started) { if (drag.touch) { if (dist > 10) dragEnd(false); return; } if (dist < 6) return; dragStart(); }
    e.preventDefault(); drag.cy = e.clientY;
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px'; drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    const t = dragTarget(e.clientX, e.clientY); clearMarks(); drag.target = t;
    if (t) t.el.classList.add(t.side === 'end' ? 'drop-end' : 'drop-' + t.side);
  }, { passive: false });
  document.addEventListener('pointerup', () => dragEnd(true));
  document.addEventListener('pointercancel', () => dragEnd(false));
  document.addEventListener('touchmove', e => { if (drag && drag.started) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (e.target.closest('.btile') && S.view.kind === 'book') e.preventDefault(); });
  document.addEventListener('click', e => { if (Date.now() - suppressClick < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('pointerdown', e => { const m = $('#menu'); if (m && !m.contains(e.target) && !e.target.closest('[data-btmenu],[data-chmenu],[data-act="add-to-book"]')) closeMenu(); }, true);
}
async function importBooks(data) {
  const n = { book: 0, series: 0, added: 0 };
  for (const f of data.files) {
    if (!isBookPath(f.path)) continue;
    const incoming = makeBook(f.path, f.text, null), old = S.books.get(f.path);
    if (old) {
      // Already have this outline: keep your order and edits, only add cards it doesn't have yet.
      const have = new Set(old.chapters.flatMap(c => c.items.map(i => i.path)));
      let added = 0;
      for (const ch of incoming.chapters) {
        const fresh = ch.items.filter(i => !have.has(i.path)); if (!fresh.length) continue;
        let tgt = old.chapters.find(c => c.title === ch.title);
        if (!tgt) { tgt = { ...ch, items: [] }; old.chapters.push(tgt); }
        for (const it of fresh) { tgt.items.push(it); have.add(it.path); added++; }
      }
      if (added) { scheduleBookSave(old, 300); n.added += added; }
      continue;
    }
    incoming.edited = Date.now(); S.books.set(f.path, incoming); await commitBook(f.path); n[incoming.doc]++;
  }
  return n;
}

/* ---------------- panel: setup & settings ---------------- */
function openPanel(html) {
  const p = $('#panel'), sc = $('#scrim');
  p.innerHTML = html; p.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { p.classList.add('open'); sc.classList.add('open'); });
  p.setAttribute('tabindex', '-1'); setTimeout(() => p.focus({ preventScroll: true }), 60);
}
function closePanel() {
  const p = $('#panel'); p.classList.remove('open');
  if ($('#reader').hidden && !$('#shell').classList.contains('drawer')) $('#scrim').classList.remove('open');
  setTimeout(() => { p.hidden = true; p.innerHTML = ''; if ($('#reader').hidden && !$('#shell').classList.contains('drawer')) $('#scrim').hidden = true; }, 280);
}
const panelHead = t => `<div class="panel-head"><h2>${t}</h2><button class="icon-btn" data-act="close-panel" aria-label="Close">${icon('x')}</button></div>`;
const REPO_LINK = 'https://github.com/new?name=cardeck-data&visibility=private&description=My%20CARDECK%20cards';
const TOKEN_LINK = 'https://github.com/settings/personal-access-tokens/new?name=CARDECK&description=Lets%20the%20CARDECK%20app%20read%20and%20save%20my%20cards&expires_in=none&contents=write';

function setupHome() {
  openPanel(`${panelHead('Set up CARDECK')}
    <p class="muted">Your cards are plain Markdown files in a private GitHub repository that only you can see. This app keeps a copy on each device, so cards open instantly and work offline. It’s free.</p>
    <h3>How do you want to start?</h3>
    <button class="choice choice-hot" data-act="paste-link"><strong>Paste my link</strong><span>Already using CARDECK on your Mac? There: Settings → Add another device → Copy. Send it to yourself, copy it here, then tap this.</span></button>
    <p class="muted" id="paste-msg" role="alert"></p>
    <button class="choice" data-act="setup-github"><strong>Connect my GitHub repository</strong><span>Recommended. Your cards sync across Firefox, iPhone and iPad.</span></button>
    <button class="choice" data-act="setup-link"><strong>I have a link from my other device</strong><span>Fastest way to set up your iPhone or iPad after your computer is connected.</span></button>
    <button class="choice" data-act="setup-local"><strong>Just this device for now</strong><span>Cards stay in this browser only. You can connect GitHub later.</span></button>`);
}
function setupGithub(prefill = {}) {
  openPanel(`${panelHead('Connect GitHub')}
    <ol class="steps">
      <li><b>Make a private repository</b> called <code>cardeck-data</code>. <a href="${REPO_LINK}" target="_blank" rel="noopener">Open the form</a>, keep it <b>Private</b>, then click <b>Create repository</b>.</li>
      <li><b>Make an access token</b> so this app can save cards. <a href="${TOKEN_LINK}" target="_blank" rel="noopener">Open the form</a>. Under <b>Repository access</b> pick <b>Only select repositories</b> and choose <code>cardeck-data</code>. The name, “no expiration”, and <b>Contents: Read and write</b> are already filled in. Click <b>Generate token</b> and copy it.</li>
      <li><b>Paste it here.</b></li>
    </ol>
    <form id="gh-form">
      <label class="field"><span>Your GitHub username</span><input name="owner" required autocomplete="username" autocapitalize="off" value="${esc(prefill.owner || '')}"></label>
      <label class="field"><span>Repository</span><input name="repo" required autocapitalize="off" value="${esc(prefill.repo || 'cardeck-data')}"></label>
      <label class="field"><span>Access token</span><input name="token" required type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(prefill.token || '')}"></label>
      <p class="muted" id="gh-msg" role="alert"></p>
      <div class="prow"><button class="pbtn primary" type="submit">Connect</button><button class="pbtn" type="button" data-act="setup-home">Back</button></div>
    </form>`);
  $('#gh-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const s = { mode: 'github', owner: f.get('owner').trim().replace(/^@/, ''), repo: f.get('repo').trim(), token: f.get('token').trim(), branch: '' };
    await connect(s, $('#gh-msg'));
  });
}
async function connect(s, msgEl) {
  const say = t => { if (msgEl) msgEl.textContent = t; };
  say('Checking your repository…');
  const gh = new GitHub({ ...s, branch: s.branch || 'main' });
  try {
    const repo = await gh.repo();
    if (!repo.private) say('Heads up: this repository is public. Make it private on GitHub (Settings → General → Danger Zone) to keep your cards to yourself.');
    if (repo.permissions && repo.permissions.push === false) { say('This token can read the repository but not save to it. Give it “Contents: Read and write”.'); return; }
    s.branch = repo.default_branch || 'main';
  } catch (e) {
    if (e.offline) return say('You’re offline. Connect to the internet and try again.');
    if (e.status === 401) return say('GitHub didn’t accept that token. Copy it again and paste the whole thing.');
    if (e.status === 404 || e.status === 403) return say(`Can’t see ${s.owner}/${s.repo}. Check the spelling, and that the token was given access to this repository.`);
    return say(`GitHub said: ${e.message}`);
  }
  const prev = S.settings;
  const wasLocal = prev && prev.mode === 'local' && S.cards.size;
  const sameRepo = prev && prev.mode === 'github' && prev.owner.toLowerCase() === s.owner.toLowerCase() && prev.repo.toLowerCase() === s.repo.toLowerCase();
  saveSettings(s);
  if (!wasLocal && !sameRepo) { await DB.clearAll(); S.cards = new Map(); S.outbox = 0; }
  say('Connected. Looking for your cards…');
  let hasCards = false;
  try {
    const head = await S.gh.head();
    if (head) { const t = await S.gh.tree((await S.gh.commit(head)).tree.sha); hasCards = t.tree.some(e => e.type === 'blob' && isCardPath(e.path)); }
  } catch (e) { say(`Connected, but reading the repository failed: ${e.message}`); }
  if (wasLocal && !hasCards) { await uploadDeck(); return; }
  if (!hasCards) return importScreen();
  closePanel(); render(); await sync(); render(); toast('Connected. Your cards are on this device.');
}
function importScreen() {
  if (S.cards.size) return openPanel(`${panelHead('Add more cards')}
    <p>Choose a CARDECK file, like <b>cardeck-add-sermon-notes.json</b>. New cards are added to your deck. Cards you already have are never changed.</p>
    <div class="prow"><label class="pbtn primary" for="file-in" role="button" tabindex="0">Choose file</label><button class="pbtn" data-act="close-panel">Cancel</button></div>
    <div id="imp-status" hidden><div class="progress"><i id="imp-bar"></i></div><p class="muted" id="imp-msg"></p></div>`);
  openPanel(`${panelHead('Bring in your cards')}
    <p>${S.gh ? 'Your repository is empty.' : 'This device has no cards yet.'} Choose <b>cardeck-import.json</b>, the file that came with this app. It holds every card from your journal.</p>
    ${S.gh ? '<p class="muted">This uploads your cards to your private repository once. It takes about a minute.</p>' : ''}
    <div class="prow"><label class="pbtn primary" for="file-in" role="button" tabindex="0">Choose file</label><button class="pbtn" data-act="skip-import">Start with an empty deck</button></div>
    <div id="imp-status" hidden><div class="progress"><i id="imp-bar"></i></div><p class="muted" id="imp-msg"></p></div>`);
}
async function runImport(file) {
  const st = $('#imp-status'), bar = $('#imp-bar'), msg = $('#imp-msg');
  const show = (pct, t) => { if (st) { st.hidden = false; bar.style.width = pct + '%'; msg.textContent = t; } };
  let step = 'reading the file';
  try {
    show(3, 'Reading the file…');
    let data; try { data = JSON.parse(await file.text()); } catch (_) { throw new Error(`“${file.name}” isn’t the CARDECK import file. Choose cardeck-import.json.`); }
    if (data.format !== 'cardeck-import' || !Array.isArray(data.files)) throw new Error('That isn’t a CARDECK import file.');
    if (S.cards.size || data.mode === 'add') return await addCards(data, show, s => { step = s; });
    const cardFiles = data.files.filter(f => isCardPath(f.path));
    show(8, `Preparing ${num(cardFiles.length)} cards…`);
    const cards = [];
    for (const f of cardFiles) cards.push(makeCard(f.path, f.text, S.gh ? await gitSha(f.text) : null));
    S.boxes = data.boxes || []; await DB.set('boxes', S.boxes);
    if (S.gh) {
      step = 'preparing the repository'; show(10, 'Getting your repository ready…');
      await S.gh.ensureInit();
      step = 'packing a quick-start copy'; show(12, 'Packing a quick-start copy…');
      let snapEntries = [];
      try { snapEntries = await snapshotEntries(cards); } catch (e) { if (e.offline || e.status === 401) throw e; }
      const entries = data.files.filter(f => !f.path.startsWith('.cardeck/snapshot')).map(f => ({ path: f.path, text: f.text }));
      if (!entries.some(e => e.path === '.cardeck/boxes.json')) entries.push({ path: '.cardeck/boxes.json', text: JSON.stringify({ version: 1, boxes: S.boxes }, null, 1) + '\n' });
      entries.push(...snapEntries);
      step = 'uploading your cards';
      const head = await S.gh.commitFiles(entries, `Import ${cards.length} cards`, (d, t) => show(15 + Math.round(80 * d / t), `Uploading ${num(d)} of ${num(t)} files…`));
      await DB.set('lastHead', head); saveSettings(S.gh.s);
    }
    S.cards = new Map(cards.map(c => [c.path, c])); await DB.putCards(cards);
    show(100, 'Done.');
    S.sync.last = Date.now(); await DB.set('lastSync', S.sync.last);
    await sleep(400); closePanel(); render(); syncIdle(); toast(`${num(cards.length)} cards are on your desk.`);
  } catch (e) {
    const why = e.status === 401 ? 'GitHub rejected the access token. Make a new one and reconnect in Settings.'
      : e.status === 403 || e.status === 404 ? 'The token can’t write to this repository. Give it “Contents: Read and write” for cardeck-data, then try again.'
      : e.offline ? 'The connection dropped. Choose the file again to retry.' : e.message;
    show(0, `Stopped while ${step}: ${why}${e.status ? ` (GitHub ${e.status})` : ''}`);
  }
}
/* Adding more cards to an existing deck: new files only, existing cards are never touched. */
async function addCards(data, show, setStep) {
  const fresh = data.files.filter(f => isCardPath(f.path) && !S.cards.has(f.path) && ![...S.cards.keys()].some(k => k.toLowerCase() === f.path.toLowerCase()));
  const skipped = data.files.filter(f => isCardPath(f.path)).length - fresh.length;
  show(8, `Preparing ${num(fresh.length)} new cards…`);
  const cards = [];
  for (const f of fresh) cards.push(makeCard(f.path, f.text, S.gh ? await gitSha(f.text) : null));
  let boxesChanged = false;
  for (const b of data.boxes || []) if (!S.boxes.some(x => x.name === b.name)) { S.boxes.push(b); boxesChanged = true; }
  if (!cards.length && !boxesChanged) { show(100, skipped ? `All ${num(skipped)} cards in this file are already in your deck.` : 'There were no cards in this file.'); return; }
  if (S.gh) {
    setStep('reading your repository'); show(10, 'Checking your repository…');
    const head = await S.gh.head(); let oldSnaps = [];
    if (head) { const tree = await S.gh.tree((await S.gh.commit(head)).tree.sha); oldSnaps = tree.tree.filter(e => /^\.cardeck\/snapshot(-\d+)?\.json$/.test(e.path)).map(e => e.path); }
    setStep('packing a quick-start copy'); show(12, 'Packing a quick-start copy…');
    let snapEntries = [];
    try { snapEntries = await snapshotEntries([...S.cards.values(), ...cards], oldSnaps); } catch (e) { if (e.offline || e.status === 401) throw e; }
    const entries = cards.map(c => ({ path: c.path, text: c.text }));
    if (boxesChanged) entries.push({ path: '.cardeck/boxes.json', text: JSON.stringify({ version: 1, boxes: S.boxes }, null, 1) + '\n' });
    entries.push(...snapEntries);
    setStep('uploading your new cards');
    const nh = await S.gh.commitFiles(entries, `Add ${cards.length} cards`, (d, t) => show(15 + Math.round(80 * d / t), `Uploading ${num(d)} of ${num(t)} files…`));
    if (head && head === await DB.get('lastHead')) await DB.set('lastHead', nh);
  }
  await DB.set('boxes', S.boxes);
  for (const c of cards) S.cards.set(c.path, c);
  await DB.putCards(cards);
  show(100, 'Done.');
  await sleep(400); closePanel(); render(); syncIdle();
  toast(`${num(cards.length)} new cards are on your desk${skipped ? ` (${num(skipped)} were already there)` : ''}.`);
}
async function uploadDeck() {
  importScreen(); const st = $('#imp-status'); st.hidden = false;
  const cards = [...S.cards.values()];
  const entries = cards.map(c => ({ path: c.path, text: c.text }));
  entries.push({ path: '.cardeck/boxes.json', text: JSON.stringify({ version: 1, boxes: S.boxes }, null, 1) + '\n' });
  try {
    const head = await S.gh.commitFiles(entries, `Upload ${cards.length} cards`, (d, t) => { $('#imp-bar').style.width = Math.round(100 * d / t) + '%'; $('#imp-msg').textContent = `Uploading ${num(d)} of ${num(t)}…`; });
    for (const c of cards) c.sha = await gitSha(c.text);
    await DB.putCards(cards); await DB.set('lastHead', null);
    closePanel(); await sync(); render(); toast('Your cards are now on GitHub.');
  } catch (e) { $('#imp-msg').textContent = `Upload stopped: ${e.message}`; }
}
function setupLink() {
  openPanel(`${panelHead('Use a device link')}
    <p>On your connected computer, open <b>Settings → Add another device</b> and copy the link. Send it to this device (AirDrop, Notes or Messages to yourself), copy it, and paste it here.</p>
    <label class="field"><span>Device link</span><input id="link-in" autocapitalize="off" autocomplete="off" placeholder="https://…#/connect=…"></label>
    <p class="muted" id="link-msg" role="alert"></p>
    <div class="prow"><button class="pbtn primary" data-act="use-link">Connect</button><button class="pbtn" data-act="setup-home">Back</button></div>`);
}
async function useLink(raw, msgEl) {
  try {
    const part = raw.includes('connect=') ? raw.split('connect=')[1] : raw;
    const s = JSON.parse(b64urlDecode(part.trim()));
    if (!s.owner || !s.repo || !s.token) throw new Error('bad');
    await connect({ mode: 'github', owner: s.owner, repo: s.repo, token: s.token, branch: s.branch || '' }, msgEl);
  } catch (e) { if (msgEl) msgEl.textContent = 'That link doesn’t look right. Copy the whole link from Settings → Add another device.'; }
}
function deviceLink() { const s = S.settings; return `${location.origin}${location.pathname}#/connect=${b64urlEncode(JSON.stringify({ owner: s.owner, repo: s.repo, branch: s.branch, token: s.token }))}`; }
function openSettings() {
  const s = S.settings; const theme = localStorage.getItem('cardeck.theme') || 'auto';
  openPanel(`${panelHead('Settings')}
    ${s && s.mode === 'github' ? `
      <h3>Sync</h3>
      <p>Connected to <b>${esc(s.owner)}/${esc(s.repo)}</b>. ${S.sync.last ? `Last synced ${esc(relTime(S.sync.last))}.` : ''} ${S.outbox ? `${S.outbox} change${S.outbox > 1 ? 's' : ''} waiting to save.` : ''}</p>
      <div class="prow"><button class="pbtn" data-act="sync-now">${icon('sync')}Sync now</button><a class="pbtn" href="https://github.com/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}" target="_blank" rel="noopener">Open on GitHub</a></div>
      <h3>Add another device</h3>
      <p class="muted">Send this link to your iPhone or iPad, then paste it into the app there (Set up → I have a link). It contains your access token, so keep it private.</p>
      <div class="copybox"><input id="dev-link" readonly value="${esc(deviceLink())}" aria-label="Device link"><button class="pbtn" data-act="copy-link">Copy</button></div>`
    : `<h3>Sync</h3><p>Your cards are stored in this browser only.</p><div class="prow"><button class="pbtn primary" data-act="setup-github">Connect GitHub</button></div>`}
    <h3>Appearance</h3>
    <div class="seg" role="group" aria-label="Theme">${[['auto', 'Match my device'], ['day', 'Day'], ['night', 'Night']].map(([k, l]) => `<button type="button" data-settheme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
    <h3>Reading</h3>
    <p class="muted">Text size for cards, outlines and the manuscript view.</p>
    <div class="seg" role="group" aria-label="Text size">${[['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']].map(([k, l]) => `<button type="button" data-act="setsize" data-size="${k}" aria-pressed="${(document.documentElement.dataset.size || 'm') === k}">${l}</button>`).join('')}</div>
    <h3>Your data</h3>
    <p class="muted">Everything is plain Markdown. Download a copy any time; it opens in Obsidian or any text editor.</p>
    <div class="prow"><button class="pbtn" data-act="export">Download all cards (.zip)</button>${S.cards.size ? '<button class="pbtn" data-act="import-outlines">Import more cards, book ideas or sermon series</button>' : '<button class="pbtn" data-act="import">Import cards</button>'}</div>
    <h3>Keyboard</h3>
    <div class="kbd-list"><kbd>/</kbd><span>Search</span><kbd>N</kbd><span>New card</span><kbd>R</kbd><span>Draw a random card</span><kbd>← →</kbd><span>Previous and next card</span><kbd>E</kbd><span>Edit the open card</span><kbd>F</kbd><span>Flip to the back</span><kbd>S</kbd><span>Star the open card</span><kbd>C</kbd><span>Writing coach</span><kbd>?</kbd><span>All shortcuts</span><kbd>Ctrl/⌘ Enter</kbd><span>Save card</span><kbd>Esc</kbd><span>Close</span></div>
    <p class="muted">On iPhone and iPad: swipe left or right on an open card to move through the deck, swipe down to close it, or tap anywhere outside the card.</p>
    <h3>This device</h3>
    <div class="prow"><button class="pbtn red" data-act="disconnect">Remove CARDECK from this device</button></div>
    <p class="muted" style="margin-top:24px">CARDECK ${VERSION}</p>`);
}

/* ---------------- export (.zip, no compression) ---------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  const now = new Date(); const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF; const dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const f of files) {
    const name = enc.encode(f.path), data = enc.encode(f.text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
function exportZip() {
  const files = [...S.cards.values()].map(c => ({ path: 'CARDECK/' + c.path, text: c.text }));
  files.push({ path: 'CARDECK/.cardeck/boxes.json', text: JSON.stringify({ version: 1, boxes: S.boxes }, null, 1) + '\n' });
  const url = URL.createObjectURL(makeZip(files));
  const a = document.createElement('a'); a.href = url; a.download = `CARDECK-${today()}.zip`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Downloading ${num(files.length - 1)} cards`);
}

/* ---------------- dialog & toast ---------------- */
function confirmBox(title, text, okLabel) {
  return new Promise(res => {
    const d = $('#dialog');
    d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="prow"><button class="pbtn" data-r="0">Keep</button><button class="pbtn primary" data-r="1">${esc(okLabel)}</button></div>`;
    d.hidden = false; const done = v => { d.hidden = true; d.removeEventListener('click', on); document.removeEventListener('keydown', key, true); res(v); };
    const on = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    d.addEventListener('click', on); document.addEventListener('keydown', key, true);
    $('[data-r="1"]', d).focus();
  });
}
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

/* ---------------- events ---------------- */
function draw() {
  const L = S.list.length ? S.list : [...S.cards.keys()].filter(p => S.cards.get(p).box);
  if (!L.length) return; let p = L[Math.floor(Math.random() * L.length)];
  if (S.reader && L.length > 1) while (p === S.reader.path) p = L[Math.floor(Math.random() * L.length)];
  openReader(p, { replace: !!S.reader });
}
function toggleDrawer(open) {
  const sh = $('#shell'), sc = $('#scrim');
  const on = open ?? !sh.classList.contains('drawer');
  sh.classList.toggle('drawer', on);
  if (on) { sc.hidden = false; requestAnimationFrame(() => sc.classList.add('open')); }
  else if ($('#reader').hidden && $('#panel').hidden) { sc.classList.remove('open'); setTimeout(() => { if (!sh.classList.contains('drawer') && $('#reader').hidden && $('#panel').hidden) sc.hidden = true; }, 200); }
}
function route() {
  const h = parseHash();
  if (h.kind === 'connect') { history.replaceState(null, '', '#/'); openPanel(`${panelHead('Connecting…')}<p class="muted" id="link-msg"></p>`); useLink(h.data, $('#link-msg')); return; }
  if (h.kind === 'card') {
    if (!S.reader || S.reader.path !== h.path || S.reader.editing) { if (S.cards.has(h.path)) { if (!S.list.length && S.view.kind === 'desk') S.list = []; S.reader = null; openReader(h.path, { replace: true }); } else { history.replaceState(null, '', hashFor(S.view)); } }
    return;
  }
  if (h.kind === 'new') { if (!S.reader) openReader(null, { isNew: true, replace: true }); return; }
  const closing = !!S.reader;
  if (S.reader) { S.reader.editing = false; S.readerPushed = false; hideOverlay(); }
  const same = hashFor(h) === hashFor(S.view);
  if (same && closing) return;
  S.view = h; if (!same) { S.type = 'all'; if (S.q) { S.q = ''; $('#q').value = ''; $('#q-clear').hidden = true; } }
  toggleDrawer(false); render(); if (!same) window.scrollTo(0, 0);
}

function bind() {
  window.addEventListener('hashchange', route);
  const qi = $('#q');
  const doSearch = debounce(() => { S.q = qi.value; $('#q-clear').hidden = !S.q; render(); }, 60);
  qi.addEventListener('input', doSearch);
  qi.addEventListener('keydown', e => { if (e.key === 'Escape') { qi.value = ''; S.q = ''; $('#q-clear').hidden = true; render(); qi.blur(); } if (e.key === 'Enter') { e.preventDefault(); if (matchMedia('(max-width: 900px)').matches) qi.blur(); } });
  $('#q-clear').addEventListener('click', () => { qi.value = ''; S.q = ''; $('#q-clear').hidden = true; render(); qi.focus(); });
  $('#new-btn').addEventListener('click', () => openReader(null, { isNew: true }));
  $('#fab').addEventListener('click', () => openReader(null, { isNew: true }));
  $('#coach-btn') && $('#coach-btn').addEventListener('click', () => coachOpen());
  bindCoach();
  $('#menu-btn').addEventListener('click', () => toggleDrawer(true));
  $('#open-settings').addEventListener('click', () => { toggleDrawer(false); S.settings ? openSettings() : setupHome(); });
  $('#sync').addEventListener('click', () => { if (S.gh) sync(); else openSettings(); });
  let rdDown = null;
  const outsideCard = t => !t.closest('.bigcard, .props, .coach, button, a, input, textarea, select, label, #menu');
  $('#reader').addEventListener('pointerdown', e => { rdDown = outsideCard(e.target) ? e.target : null; });
  $('#reader').addEventListener('click', e => {
    if (!S.reader || !rdDown || !outsideCard(e.target)) { rdDown = null; return; }
    rdDown = null; if (window.getSelection && String(window.getSelection())) return;
    if (S.reader.editing && !S.reader.isNew) { $('[data-act="cancel"]') && $('[data-act="cancel"]').click(); return; }
    closeReader();
  });
  // swipe on an open card: left/right for next/previous, down to close
  let sw = null;
  $('#reader').addEventListener('touchstart', e => { if (!S.reader || S.reader.editing || e.touches.length !== 1) { sw = null; return; } const t0 = e.touches[0]; sw = { x: t0.clientX, y: t0.clientY, t: Date.now(), top: $('#reader').scrollTop }; }, { passive: true });
  $('#reader').addEventListener('touchend', e => {
    if (!sw || !S.reader || S.reader.editing) { sw = null; return; }
    const t1 = e.changedTouches[0], dx = t1.clientX - sw.x, dy = t1.clientY - sw.y, dt = Date.now() - sw.t; const top = sw.top; sw = null;
    if (String(window.getSelection && window.getSelection()) || dt > 700) return;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) { const n = dx < 0 ? neighbors().next : neighbors().prev; if (n) { $('#reader').classList.add(dx < 0 ? 'swipe-l' : 'swipe-r'); openReader(n, { replace: true }); setTimeout(() => $('#reader').classList.remove('swipe-l', 'swipe-r'), 260); } return; }
    if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 2 && top <= 2) closeReader();
  }, { passive: true });
  $('#scrim').addEventListener('click', () => { if (!$('#panel').hidden) closePanel(); else if ($('#shell').classList.contains('drawer')) toggleDrawer(false); else if (S.reader) closeReader(); });
  $('#side').addEventListener('click', e => { if (e.target.closest('a')) toggleDrawer(false); });

  document.addEventListener('click', async e => {
    const t = e.target;
    const tile = t.closest('.tile[data-path]'); if (tile) { openReader(tile.dataset.path); return; }
    const op = t.closest('[data-open]'); if (op) { openReader(op.dataset.open); return; }
    const go = t.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
    const chip = t.closest('.chip[data-type]'); if (chip) { S.type = chip.dataset.type; render(); return; }
    const st = t.closest('[data-settype]'); if (st && S.reader) { readDraft(); S.reader.draft.type = st.dataset.settype; $$('[data-settype]').forEach(b => b.setAttribute('aria-pressed', b === st)); return; }
    const ua = t.closest('[data-unalso]'); if (ua && S.reader) { readDraft(); S.reader.draft.also = S.reader.draft.also.filter(x => x !== ua.dataset.unalso); renderEditor(); return; }
    const th = t.closest('[data-settheme]'); if (th) { const v = th.dataset.settheme; localStorage.setItem('cardeck.theme', v); if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v; $$('[data-settheme]').forEach(b => b.setAttribute('aria-pressed', b === th)); return; }
    const bm = t.closest('[data-btmenu]'); if (bm) { const b = curBook(); const [ci, ii] = bm.dataset.btmenu.split(':').map(Number); b && cardMenu(bm, b, ci, ii); return; }
    const cm = t.closest('[data-chmenu]'); if (cm) { const b = curBook(); b && chapterMenu(cm, b, +cm.dataset.chmenu); return; }
    const bt = t.closest('[data-btab]'); if (bt) { const b = curBook(); if (b) { S.bookTabs = S.bookTabs || {}; S.bookTabs[b.path] = bt.dataset.btab; S.draftEdit = null; if (S.speaking) { speechSynthesis.cancel(); S.speaking = false; } render(); } return; }
    const dg = t.closest('[data-drgo]'); if (dg) { const sec = $(`#dr-${dg.dataset.drgo}`); sec && sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const tj = t.closest('[data-tocgo]'); if (tj) { closePanel(); const ci = +tj.dataset.tocgo; if (S.compact) { S.openCh = S.openCh || new Set(); S.openCh.add(ci); render(); } setTimeout(() => { const sec = $(`#ch-${ci}`); sec && sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); S.coach && S.coach.open && focusChapter(ci); }, 300); return; }
    const tb = t.closest('#tabbar [data-tab]'); if (tb && tb.getAttribute('aria-current') === 'page' && tb.tagName === 'A') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const cc = t.closest('.chapter.collapsed .ch-head'); if (cc && !t.closest('[data-chmenu]')) { const ci = +cc.closest('.chapter').dataset.ch; S.openCh = S.openCh || new Set(); S.openCh.add(ci); cc.closest('.chapter').classList.remove('collapsed'); return; }
    const ac = t.closest('[data-addcards]'); if (ac) { const b = curBook(); b && openPicker(b, +ac.dataset.addcards); return; }
    const pk = t.closest('[data-pick]'); if (pk) { pickCard(pk.dataset.pick); return; }
    const a = t.closest('[data-act]'); if (!a) return;
    switch (a.dataset.act) {
      case 'coach': coachOpen(true); break;
      case 'star': if (S.reader) toggleStar(S.reader.path); break;
      case 'share': if (S.reader) shareCard(S.reader.path); break;
      case 'toc': { const b = curBook(); b && openToc(b); break; }
      case 'compact': S.compact = !S.compact; S.openCh = new Set(); try { localStorage.setItem('cardeck.compact', S.compact ? '1' : ''); } catch (_) { } render(); break;
      case 'compile': { const b = curBook(); if (b) location.hash = `#/compile/${b.doc}/` + encodeURIComponent(b.title); break; }
      case 'print': window.print(); break;
      case 'ms-md': downloadManuscript(); break;
      case 'ms-copy': { try { await navigator.clipboard.writeText(manuscriptMd()); toast('Manuscript copied'); } catch (_) { toast('Copy isn’t allowed here. Use Download instead.'); } break; }
      case 'ms-titles': S.msTitles = !S.msTitles; render(); break;
      case 'ms-notes': S.msNotes = !S.msNotes; render(); break;
      case 'keys': showKeys(); break;
      case 'tab-boxes': toggleDrawer(true); break;
      case 'draft-new': case 'draft-edit': case 'draft-cancel': case 'draft-save': case 'draft-copy': case 'draft-md': case 'draft-listen': draftAct(a.dataset.act, a); break;
      case 'devo-listen': case 'devo-copy': case 'devo-share': case 'devo-done': case 'devo-edit': case 'devo-save': case 'devo-cancel': case 'devo-copyall': case 'devo-new': case 'devo-md': devoAct(a.dataset.act, a); break;
      case 'adv-done': case 'adv-copy': case 'adv-share': case 'adv-listen': advAct(a.dataset.act); break;
      case 'adv-intro': { const s = $('#adv-intro'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
      case 'p-share': case 'p-copy': case 'p-next': case 'p-posted': postAct(a.dataset.act, a); break;
      case 'q-share': case 'q-copy': case 'q-image': case 'q-next': case 'q-save': quoteAct(a.dataset.act); break;
      case 'paste-link': { let t = ''; try { t = await navigator.clipboard.readText(); } catch (_) { } if (t && t.includes('connect=')) { useLink(t, $('#paste-msg')); } else { setupLink(); } break; }
      case 'dismiss-a2hs': try { localStorage.setItem('cardeck.a2hs', '1'); } catch (_) { } render(); break;
      case 'setsize': { const z = a.dataset.size; try { localStorage.setItem('cardeck.size', z); } catch (_) { } document.documentElement.dataset.size = z; $$('[data-act="setsize"]').forEach(x => x.setAttribute('aria-pressed', x === a)); break; }
      case 'close': closeReader(); break;
      case 'prev': { const n = neighbors().prev; n && openReader(n, { replace: true }); break; }
      case 'next': { const n = neighbors().next; n && openReader(n, { replace: true }); break; }
      case 'flip': S.reader.flipped = !S.reader.flipped; $('.flip').classList.toggle('flipped', S.reader.flipped); a.setAttribute('aria-pressed', S.reader.flipped); a.querySelector('.lbl').textContent = S.reader.flipped ? 'Front' : 'Back'; $('.face.back').setAttribute('aria-hidden', !S.reader.flipped); break;
      case 'draw': case 'shuffle': draw(); break;
      case 'reroll': { const c = dayCard(true); if (c) { S.deskCard = c.path; render(); } break; }
      case 'edit': S.reader.editing = true; S.reader.draft = null; renderReader(); break;
      case 'cancel': if (S.reader.isNew) { closeReader(); } else if (!isDirty() || await confirmBox('Discard your changes?', 'This card has edits you haven’t saved.', 'Discard')) { S.reader.editing = false; S.reader.draft = null; renderReader(); } break;
      case 'save': doSave(); break;
      case 'delete': doDelete(); break;
      case 'new': openReader(null, { isNew: true }); break;
      case 'settings': openSettings(); break;
      case 'setup': case 'setup-home': setupHome(); break;
      case 'setup-github': setupGithub(S.settings && S.settings.mode === 'github' ? S.settings : {}); break;
      case 'setup-link': setupLink(); break;
      case 'use-link': useLink($('#link-in').value, $('#link-msg')); break;
      case 'setup-local': saveSettings({ mode: 'local' }); syncIdle(); importScreen(); break;
      case 'pick-import': case 'import': if (a.dataset.act === 'import') importScreen(); $('#file-in').click(); break;
      case 'skip-import': closePanel(); render(); break;
      case 'close-panel': closePanel(); break;
      case 'new-book': newBook(a.dataset.doc || 'book'); break;
      case 'add-chapter': { const b = curBook(); b && editChapter(b, null); break; }
      case 'edit-book': { const b = curBook(); b && editBook(b); break; }
      case 'delete-book': { const b = curBook(); b && deleteBook(b); break; }
      case 'book-read': S.list.length && openReader(S.list[0]); break;
      case 'add-to-book': S.reader && addToBookMenu(a, S.reader.path); break;
      case 'import-outlines': $('#file-in').click(); break;
      case 'sync-now': await sync(); openSettings(); break;
      case 'copy-link': { const i = $('#dev-link'); i.select(); try { await navigator.clipboard.writeText(i.value); } catch (_) { document.execCommand('copy'); } toast('Link copied. Keep it private.'); break; }
      case 'export': exportZip(); break;
      case 'disconnect': if (await confirmBox('Remove CARDECK from this device?', S.gh ? 'Your cards stay safe in your GitHub repository. This device forgets them and your token.' : 'Cards stored only on this device will be deleted. Download a copy first if you need it.', 'Remove')) { await DB.clearAll(); saveSettings(null); localStorage.removeItem('cardeck.theme'); location.hash = '#/'; location.reload(); } break;
    }
  });
  document.addEventListener('change', async e => {
    if (e.target.id === 'sort') { S.sort = e.target.value; S.seed = Math.random(); render(); }
    if (e.target.id === 'ed-addalso' && e.target.value) { readDraft(); S.reader.draft.also.push(e.target.value); renderEditor(); }
    if (e.target.id === 'ed-box' && S.reader) { readDraft(); S.reader.draft.also = S.reader.draft.also.filter(x => x !== S.reader.draft.box); }
    if (e.target.id === 'book-status') { const b = curBook(); if (b) { b.status = e.target.value; scheduleBookSave(b, 300); } return; }
    if (e.target.id === 'file-in' && e.target.files[0]) {
      const f = e.target.files[0]; e.target.value = '';
      let data = null; try { data = JSON.parse(await f.text()); } catch (_) { }
      if (data && data.format === 'cardeck-books' && Array.isArray(data.files)) {
        const n = await importBooks(data); closePanel();
        const parts = []; if (n.book) parts.push(`${n.book} book ${n.book === 1 ? 'idea' : 'ideas'}`); if (n.series) parts.push(`${n.series} sermon series`);
        if (n.added) parts.push(`${n.added} new cards to your outlines`);
        toast(parts.length ? `Added ${parts.join(' and ')}.` : 'Everything in that file is already in your outlines.');
        location.hash = n.series && !n.book ? '#/sermons' : '#/books'; render(); return;
      }
      if ($('#panel').hidden || !$('#imp-status')) importScreen(); runImport(f);
    }
  });
  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && S.reader && S.reader.editing) { e.preventDefault(); doSave(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (S.reader) closeReader(); $('#q').focus(); $('#q').select(); return; }
    if (e.key === 'Escape') {
      if ($('#menu')) { closeMenu(); return; }
      if (!$('#dialog').hidden) return;
      if (!$('#panel').hidden) { closePanel(); return; }
      if (S.reader) { if (S.reader.editing && !S.reader.isNew) $('[data-act="cancel"]').click(); else closeReader(); return; }
      if ($('#shell').classList.contains('drawer')) { toggleDrawer(false); return; }
      return;
    }
    if (inField || e.metaKey || e.ctrlKey || e.altKey || !$('#panel').hidden || !$('#dialog').hidden) return;
    if (S.reader && !S.reader.editing) {
      if (e.key === 'ArrowLeft' || e.key === 'k') { const n = neighbors().prev; if (n) openReader(n, { replace: true }); e.preventDefault(); return; }
      if (e.key === 'ArrowRight' || e.key === 'j') { const n = neighbors().next; if (n) openReader(n, { replace: true }); e.preventDefault(); return; }
      if (e.key === 'e') { e.preventDefault(); $('[data-act="edit"]').click(); return; }
      if (e.key === 'f') { $('[data-act="flip"]').click(); return; }
      if (e.key === 's') { toggleStar(S.reader.path); return; }
    }
    if (S.reader && S.reader.editing) return;
    if (!S.reader && S.view.kind === 'devo' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { devoStep(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
    if (!S.reader && S.view.kind === 'advent' && S.view.date && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { advStep(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
    if (e.key === '/') { e.preventDefault(); if (S.reader) closeReader(); $('#q').focus(); }
    else if (e.key === 'n') { e.preventDefault(); openReader(null, { isNew: true, replace: !!S.reader }); }
    else if (e.key === 'r') { draw(); }
    else if (e.key === 'c') { e.preventDefault(); coachOpen(); }
    else if (e.key === '?') { e.preventDefault(); showKeys(); }
  });
  window.addEventListener('online', () => sync({ quiet: true }));
  window.addEventListener('offline', syncIdle);
  bindDrag();
  addEventListener('pagehide', flushBookSaves);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushBookSaves(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.gh && Date.now() - S.sync.last > 30000) sync({ quiet: true }); });
  setInterval(() => { if (document.visibilityState === 'visible' && S.gh) sync({ quiet: true }); else syncIdle(); }, 120000);
  setInterval(() => { if (S.sync.state === 'ok') syncIdle(); }, 30000);
}

/* ---------------- boot ---------------- */
async function boot() {
  bind();
  try { await DB.open(); } catch (e) { view().innerHTML = `<div class="empty"><h3>This browser is blocking storage</h3><p>CARDECK keeps your cards on this device. Turn off private browsing, or allow site data for this page, then reload.</p></div>`; return; }
  await restoreSettings();
  try { S.compact = !!localStorage.getItem('cardeck.compact'); } catch (_) { }
  await loadLocal();
  syncIdle();
  const h = parseHash();
  if (h.kind !== 'card' && h.kind !== 'new' && h.kind !== 'connect') S.view = h;
  try { if (localStorage.getItem('cardeck.coach.open') && S.books.size && matchMedia('(min-width: 1100px)').matches) { S.coach = { tab: 'next', ci: 0, prompt: 0, open: true }; document.body.classList.add('coach-on'); $('#coach').hidden = false; } } catch (_) { }
  render();
  if (h.kind === 'card' || h.kind === 'new' || h.kind === 'connect') route();
  if (!S.settings && h.kind !== 'connect') setupHome();
  else if (S.gh) sync({ quiet: !!S.cards.size });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) { const had = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !S.reader && $('#panel').hidden) location.reload(); }); navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { }); }
}
boot();
})();
