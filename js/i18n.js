// HU / EN language toggle (2026-10-08). The page is written in Hungarian; English is a translation layer laid over the
// live DOM, so no module needs to know about it: text nodes, whole inline-formatted paragraphs and a few attributes are
// looked up in data/i18n-en.json (built by tools/build_i18n.ps1 from the translated string lists), plus RULES for
// strings with numbers in them. A MutationObserver translates whatever the apps render later, the shadow roots of the
// embedded apps included. Switching back restores the stored Hungarian originals. User content (record titles, notes,
// OSM names) is not in the dictionary and stays as written. Choice remembered in localStorage `bo-lang`.
const KEY = 'bo-lang';
const DICT_URL = 'data/i18n-en.json';
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
const INLINE = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'SMALL', 'SUP', 'SUB', 'BR', 'CODE', 'ABBR']);
const SKIP = /^(SCRIPT|STYLE|TEXTAREA|CANVAS|INPUT)$/i;
const LETTERS = /[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{2}/;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const recall = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } };

// numbers: Hungarian decimal comma / thousands space -> English point / comma
const num = (s) => s.replace(/(\d)\s(?=\d{3}\b)/g, '$1,').replace(/(\d),(\d)/g, '$1.$2');
const MONTHS = { 'jan.': 'Jan', 'febr.': 'Feb', 'márc.': 'Mar', 'ápr.': 'Apr', 'máj.': 'May', 'jún.': 'Jun', 'júl.': 'Jul', 'aug.': 'Aug', 'szept.': 'Sep', 'okt.': 'Oct', 'nov.': 'Nov', 'dec.': 'Dec' };
const COMPASS = { É: 'N', ÉÉK: 'NNE', ÉK: 'NE', KÉK: 'ENE', K: 'E', KDK: 'ESE', DK: 'SE', DDK: 'SSE', D: 'S', DDNy: 'SSW', DNy: 'SW', NyDNy: 'WSW', Ny: 'W', NyÉNy: 'WNW', ÉNy: 'NW', ÉÉNy: 'NNW' };
let dict = { text: {}, html: {}, attr: {} };
// strings with numbers or names inside: [pattern, replacement function]; the first match wins
const RULES = [
  [/^az O épülettől (legközelebb )?([\d\s,.]+) (m|km)(-re)?$/, (m, near, n, u) => `${near ? 'nearest ' : ''}${num(n)} ${u} from Building O`],
  [/^(.*) · az O épülettől ([\d\s,.]+) (m|km) · (.*)$/, (m, a, n, u, b) => `${tr(a) ?? a} · ${num(n)} ${u} from Building O · ${tr(b) ?? b}`],
  [/^az O épülettől ([\d\s,.]+) (m|km) · (.*)$/, (m, n, u, b) => `${num(n)} ${u} from Building O · ${tr(b) ?? b}`],
  [/^(?:(.*) · )?az O épülettől ([\d\s,.]+) (m|km) ·$/, (m, a, n, u) => `${a ? `${tr(a) ?? a} · ` : ''}${num(n)} ${u} from Building O ·`],
  [/^(\d+) fotó$/, (m, n) => `${n} photo${n === '1' ? '' : 's'}`],
  [/^(\d+)\. fotó$/, (m, n) => `photo ${n}`],
  [/^(.*) · (\d+)\. fotó \/ (\d+)$/, (m, a, i, n) => `${tr(a) ?? a} · photo ${i} of ${n}`],
  [/^(\d+)\. lap: (.*)$/, (m, i, t) => `Sheet ${i}: ${tr(t) ?? t}`],
  [/^(\d+) nézet$/, (m, n) => `${n} view${n === '1' ? '' : 's'}`],
  [/^(\d+) felvétel · (\d+) képpel$/, (m, a, b) => `${a} records · ${b} with images`],
  [/^(Fotó|Vázlat) ([PS]-\d+) · a kép később érkezik$/, (m, k, id) => `${k === 'Fotó' ? 'Photo' : 'Sketch'} ${id} · image to follow`],
  [/^([PS]-\d+) · a fotó később jön$/, (m, id) => `${id} · photo to follow`],
  [/^(\S+) (\d+)\. · (\d\d:\d\d) (CEST|CET) · nap (\d+)° magasan, (\S+)$/, (m, mo, d, t, z, a, c) => `${d} ${MONTHS[mo] || mo} · ${t} ${z} · sun ${a}° up, ${COMPASS[c] || c}`],
  [/^(\S+) (\d+)\. · (\d\d:\d\d) (CEST|CET) · a nap a horizont alatt$/, (m, mo, d, t, z) => `${d} ${MONTHS[mo] || mo} · ${t} ${z} · sun below the horizon`],
  [/^(\d+)° (\S+)$/, (m, a, c) => (COMPASS[c] ? `${a}° ${COMPASS[c]}` : null)],
  [/^(.+) · metszet ([+±−-][\d,]+) m-en$/, (m, l, h) => `${tr(l) ?? l} · cut at ${num(h)} m`],
  [/^(.+) · (\d+) fő( · .*)?$/, (m, a, n, rest) => `${tr(a) ?? a} · ${n} people${rest ? rest.replace(/(\d+) szék/, '$1 chairs').replace(/(\d+) asztal/, '$1 tables').replace(/(\d+) mobil fal/, '$1 mobile walls').replace(/(\d+) posztamens/, '$1 plinths').replace(/(\d+) sátor/, '$1 stalls').replace(/(\d+) lelátóelem/, '$1 bleacher units').replace(/(\d+) nyugágy/, '$1 deckchairs').replace(/(\d+) sörasztal/, '$1 beer tables') : ''}`],
  [/^([\d\s,]+) \/ ([\d\s,]+) m² · (\d+) tér$/, (m, a, b, n) => `${num(a)} / ${num(b)} m² · ${n} spaces`],
  [/^([\d\s,]+) m² · (\d+) tér$/, (m, a, n) => `${num(a)} m² · ${n} spaces`],
  [/^(\d+) tér$/, (m, n) => `${n} space${n === '1' ? '' : 's'}`],
  [/^(\d+) perc$/, (m, n) => `${n} min`],
  [/^(\d+) perc \/ s$/, (m, n) => `${n} min / s`],
  [/^(\d+) óra \/ s$/, (m, n) => `${n} h / s`],
  [/^(\d+) település$/, (m, n) => `${n} settlements`],
  [/^(\d+) hely$/, (m, n) => `${n} places`],
  [/^(\d+) · (gyenge|közepes|szoros)$/, (m, n, w) => `${n} · ${{ gyenge: 'weak', közepes: 'medium', szoros: 'strong' }[w]}`],
  [/^([\d\s,]+) (fotó|vázlat|rögzített elem)$/, (m, n, w) => `${num(n)} ${{ fotó: 'photos', vázlat: 'sketches', 'rögzített elem': 'recorded elements' }[w]}`],
];
const FURN = { szék: 'chairs', asztal: 'tables', 'mobil fal': 'mobile walls', posztamens: 'plinths', sátor: 'stalls', lelátóelem: 'bleacher units', nyugágy: 'deckchairs', sörasztal: 'beer tables' };
RULES.push(
  // multi-use layouts: "Kiállítás · 12 mobil fal · 9 posztamens"
  [/^([^·]+?)((?: · \d+ [^·]+)+)$/, (m, a, rest) => {
    const parts = rest.split(' · ').slice(1).map((p) => { const [, n, w] = p.match(/^(\d+) (.+)$/); return FURN[w] ? `${n} ${FURN[w]}` : null; });
    return parts.includes(null) ? null : [tr(a) ?? a, ...parts].join(' · ');
  }],
  [/^(\d+) látható elem$/, (m, n) => `${n} visible item${n === '1' ? '' : 's'}`],
  [/^programterv sor (\d+) · (.*)$/, (m, n, l) => `programme row ${n} · ${tr(l) ?? l}`],
  [/^Programlap · (.*)$/, (m, s) => `Programme sheet · ${tr(s) ?? s}`],
  [/^Kapcsolatok \((\d+)\)$/, (m, n) => `Links (${n})`],
  [/^(.+), felmérési terv, (≈ )?(1:\d+)$/, (m, s, ap, sc) => `${tr(s) ?? s}, survey drawing, ${ap || ''}${sc}`],
  [/^(.+) · (≈ )?(1:\d+) · A2$/, (m, l, ap, sc) => { const e = tr(l); return e == null ? null : `${e} · ${ap || ''}${sc} · A2`; }],
);
// composite labels ("Kapcsolat oszlop · Publikus mosdó → Kávézó; a kávézóhoz tartozik"): translate the pieces between
// separators from the dictionary; used only when at least one piece is known
const SEP = /( → | ↔ | ← |; |, | · | – )/;
function trParts(s) {
  const bits = s.split(SEP);
  if (bits.length < 3) return undefined;
  let hit = false;
  const out = bits.map((b, i) => { if (i % 2) return b; const e = dict.text[b.trim()]; if (e != null) { hit = true; return e; } return b; });
  return hit ? out.join('') : undefined;
}
function tr(s) {   // Hungarian string -> English, or undefined
  if (dict.text[s] != null) return dict.text[s];
  for (const [re, fn] of RULES) { const m = s.match(re); if (m) { const out = fn(...m); if (out) return out; } }
  return trParts(s);
}

// ---- per-node records of what was replaced, for switching back
const textRec = new WeakMap();   // Text -> { hu: original data, en: normalised English }
const htmlRec = new WeakMap();   // Element -> { hu: original innerHTML, en: normalised English innerHTML }
const attrRec = new WeakMap();   // Element -> { attr: { hu, en } }
let lang = recall() === 'en' ? 'en' : 'hu';

const isBlock = (el) => {
  let text = false, tag = false;
  for (const k of el.childNodes) {
    if (k.nodeType === 3) { if (k.data.trim()) text = true; continue; }
    if (k.nodeType !== 1 || !INLINE.has(k.tagName) || k.id || k.querySelector('[id]')) return false;
    tag = true;
  }
  return text && tag;
};

function toEn(node) {
  if (node.nodeType === 3) {
    const t = norm(node.data);
    if (!t) return;
    const rec = textRec.get(node);
    if (rec && rec.en === t) return;            // already English
    // no words: only level heights and areas need their decimal comma changed (±0,00 · 1:100, +3,90, 522,5 m²)
    const en = LETTERS.test(t) ? tr(t) : (/(^|[\s±+−-])\d+,\d/.test(t) ? num(t) : undefined);
    if (en == null) return;
    const lead = node.data.match(/^\s*/)[0], trail = node.data.match(/\s*$/)[0];
    textRec.set(node, { hu: node.data, en: norm(en) });
    node.data = lead + en + trail;
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) return;
  if (node.nodeType === 1) {
    if (SKIP.test(node.tagName) || node.classList.contains('notranslate') || node.getAttribute('translate') === 'no') return;
    for (const a of ATTRS) {
      const v = node.getAttribute(a); if (!v || !LETTERS.test(v)) continue;
      const r = attrRec.get(node) || {};
      if (r[a] && r[a].en === v) continue;
      const en = dict.attr[norm(v)] ?? dict.text[norm(v)] ?? tr(norm(v));
      if (en == null) continue;
      r[a] = { hu: v, en }; attrRec.set(node, r); node.setAttribute(a, en);
    }
    if (isBlock(node)) {
      const key = norm(node.innerHTML), rec = htmlRec.get(node);
      if (rec && rec.en === key) return;
      const en = dict.html[key];
      if (en != null) { htmlRec.set(node, { hu: node.innerHTML, en: norm(en) }); node.innerHTML = en; return; }
    }
    if (node.shadowRoot) { watch(node.shadowRoot); toEn(node.shadowRoot); }
  }
  for (const k of [...node.childNodes]) toEn(k);
}
function toHu(node) {
  if (node.nodeType === 3) {
    const rec = textRec.get(node);
    if (rec && norm(node.data) === rec.en) node.data = rec.hu;
    textRec.delete(node);
    return;
  }
  if (node.nodeType === 1) {
    const r = attrRec.get(node);
    if (r) { for (const [a, { hu, en }] of Object.entries(r)) if (node.getAttribute(a) === en) node.setAttribute(a, hu); attrRec.delete(node); }
    const rec = htmlRec.get(node);
    if (rec) { if (norm(node.innerHTML) === rec.en) node.innerHTML = rec.hu; htmlRec.delete(node); return; }
    if (node.shadowRoot) toHu(node.shadowRoot);
  }
  for (const k of node.childNodes) toHu(k);
}

// ---- watch the page (and the embedded apps' shadow roots) for content rendered later
const watched = new WeakSet();
const observer = new MutationObserver((list) => {
  if (lang !== 'en') return;
  // re-check each changed element as a whole, so a re-rendered paragraph is matched as one block
  const targets = new Set();
  for (const m of list) targets.add(m.type === 'characterData' ? m.target.parentNode : m.target);
  for (const t of targets) if (t && t.isConnected) toEn(t);
});
function watch(root) {
  if (watched.has(root)) return;
  watched.add(root);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}
setInterval(() => {   // shadow roots appear when an app first opens
  if (lang !== 'en') return;
  for (const host of document.querySelectorAll('.blob-host, .commuter-host, #blob-host, #commuter-host')) {
    if (host.shadowRoot && !watched.has(host.shadowRoot)) { watch(host.shadowRoot); toEn(host.shadowRoot); }
  }
}, 1500);

let loading = null;
async function loadDict() {
  if (!loading) loading = fetch(DICT_URL).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) dict = { text: d.text || {}, html: d.html || {}, attr: d.attr || {} }; }).catch(() => {});
  return loading;
}

function paintToggle() {
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}
export async function setLang(next) {
  lang = next === 'en' ? 'en' : 'hu';
  remember(lang);
  document.documentElement.lang = lang;
  paintToggle();
  if (lang === 'en') { await loadDict(); if (lang === 'en') toEn(document.body); }
  else toHu(document.body);
  document.dispatchEvent(new CustomEvent('bo:lang', { detail: { lang } }));
}

watch(document.body);
document.addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });
paintToggle();
if (lang === 'en') setLang('en');
