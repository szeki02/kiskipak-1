// Where survey records come from.
//
// Home server (window.BUILDING_O_SERVER, server/HubServer.cs): /api/records + /api/upload on the owner's PC.
// Public page: data/observations.json, read-only.
// Editor page (window.BUILDING_O_EDITOR, published with the db + assets + user capabilities):
//   records live in the artifact's database, collection "records", one document per record id;
//   uploaded images are artifact assets, referenced by id from the record ("/_blob/<id>").
//
// Record shape (both sources):
//   { id: "P-016", type: "photo" | "sketch", level: "ground" | "first" | "roof" | "site",
//     position: [x, y] | null (null = uploaded, not placed yet), z: floor height (m, model) | undefined,
//     direction: degrees in plan, 0 = +X, counter-clockwise,
//     elements: [element ids], title, note, author, date,
//     images: [{ src | asset, name, direction, caption }] }
const DATA_URL = 'data/observations.json';

export const imageUrl = (img) => (img.asset ? '/_blob/' + img.asset : img.src);

// Older records carry a single "image" path; newer ones a list of images (several views from one spot).
export function normalise(r) {
  const images = Array.isArray(r.images) ? r.images.slice()
    : r.image ? [{ src: r.image, direction: r.direction ?? 0 }] : [];
  return {
    id: String(r.id), type: r.type === 'sketch' ? 'sketch' : 'photo', level: r.level || 'first',
    position: Array.isArray(r.position) ? [Number(r.position[0]), Number(r.position[1])] : null,
    z: typeof r.z === 'number' ? r.z : undefined,
    direction: Number(r.direction ?? 0), elements: Array.isArray(r.elements) ? r.elements.slice() : [],
    title: r.title || '', note: r.note || '', author: r.author || '', date: r.date || '',
    images: images.map((i) => ({ ...i, direction: i.direction ?? r.direction ?? 0 })),
    sample: !!r.sample,
  };
}

/** Static records: resolves { records, sample, editable: false } */
async function staticStore(url = DATA_URL, key = 'observations', norm = normalise) {
  let records = [], sample = false;
  try {
    const data = await fetch(url).then((r) => (r.ok ? r.json() : {}));
    records = (data[key] || []).map(norm);
    sample = !!data.meta?.sample;
  } catch { /* no records yet */ }
  return { editable: false, sample, subscribe(fn) { fn(records); return () => {}; } };
}

/** Live records for the editor page, or null when this view cannot write them. */
async function liveStore() {
  const use = window.claude?.use;
  if (!use) return null;
  const [db, assets, user] = await Promise.all([use('db'), use('assets'), use('user')]);
  if (!db) return null;
  const writable = user ? await user.can('data.write') : null;
  const col = db.collection('records');
  const inflight = new Map();   // one write at a time per document; the latest body wins
  async function write(id, body) {
    if (inflight.has(id)) { inflight.get(id).next = body; return inflight.get(id).done; }
    const slot = { next: null };
    slot.done = (async () => {
      let b = body;
      try {
        while (b) { await col.doc(id).set(b); b = slot.next; slot.next = null; }
      } finally { inflight.delete(id); }
    })();
    inflight.set(id, slot);
    return slot.done;
  }
  return {
    editable: writable !== false,
    canUpload: !!assets,
    sample: false,
    subscribe(fn, onError) {
      return col.onSnapshot((snap) => fn(snap.docs.map((d) => normalise({ ...d.data(), id: d.id }))), onError);
    },
    save(rec) {
      const body = JSON.parse(JSON.stringify({ ...rec, updatedAt: new Date().toISOString() }));
      delete body.sample; delete body._new;
      if (rec.sample) body.sample = true;
      return write(rec.id, body);
    },
    async remove(rec) {
      for (const img of rec.images) if (img.asset && assets) await assets.delete(img.asset).catch(() => {});
      await col.doc(rec.id).delete();
    },
    async upload(blob) { return assets.upload(blob); },
    async deleteImage(img) { if (img.asset && assets) await assets.delete(img.asset).catch(() => {}); },
  };
}

/** Home server (server/HubServer.cs, window.BUILDING_O_SERVER): records and uploads on the owner's PC.
 *  Anyone can read; writing needs the editor key, which arrives once in the link (?key=…) and is then
 *  kept in this browser. Other people's changes arrive by polling every few seconds. */
async function serverStore(api = '/api/records', norm = normalise) {
  let key = '';
  try {
    const u = new URL(location.href);
    const k = u.searchParams.get('key');
    if (k) { localStorage.setItem('bo-editor-key', k); u.searchParams.delete('key'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    key = localStorage.getItem('bo-editor-key') || '';
  } catch { /* no storage: read-only */ }
  const headers = (extra = {}) => (key ? { 'X-Key': key, ...extra } : extra);
  const who = await fetch('/api/whoami', { headers: headers(), cache: 'no-store' }).then((r) => r.json()).catch(() => ({ editable: false }));
  if (key && !who.editable) { try { localStorage.removeItem('bo-editor-key'); } catch { /* ignore */ } }   // an old key
  const fail = (res) => {
    const code = { 403: 'forbidden', 413: 'too_large', 415: 'unsupported_type' }[res.status] || `http_${res.status}`;
    throw Object.assign(new Error(code), { code });
  };

  let rev = '', timer = null;
  const listeners = new Set();
  async function poll() {
    const res = await fetch(`${api}?since=${rev}`, { cache: 'no-store' });
    if (res.status === 204 || !res.ok) return;
    const d = await res.json();
    rev = String(d.rev);
    const list = d.records.map(norm);
    listeners.forEach((fn) => fn(list));
  }
  const loop = async () => {
    try { if (!document.hidden || !rev) await poll(); } catch (e) { console.warn('records poll failed', e); }   // background tabs skip polls after the first
    timer = setTimeout(loop, 4000);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) { clearTimeout(timer); loop(); } });

  let chain = Promise.resolve();   // writes go out one at a time, in order
  const queue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  return {
    editable: !!who.editable,
    canUpload: !!who.editable,
    sample: false,
    readOnlyMessage: 'Ezzel a linkkel csak megtekinteni lehet. Hozzáadáshoz vagy módosításhoz nyisd meg a szerkesztő linket.',
    subscribe(fn) {
      listeners.add(fn);
      if (!timer) loop();
      return () => listeners.delete(fn);
    },
    save(rec) {
      return queue(async () => {
        const body = JSON.parse(JSON.stringify({ ...rec, updatedAt: new Date().toISOString() }));
        delete body.sample; delete body._new;
        const res = await fetch(rec._new ? api : `${api}/${encodeURIComponent(rec.id)}`, {
          method: rec._new ? 'POST' : 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
        });
        if (!res.ok) fail(res);
        const saved = await res.json();
        delete rec._new;
        if (saved.id && saved.id !== rec.id) rec.id = saved.id;   // someone else took that number first
        poll().catch(() => {});
      });
    },
    async remove(rec) {
      await queue(async () => {
        const res = await fetch(`${api}/${encodeURIComponent(rec.id)}`, { method: 'DELETE', headers: headers() });
        if (!res.ok) fail(res);
      });
      for (const img of rec.images) if (img.asset) await fetch(`/api/upload/${img.asset}`, { method: 'DELETE', headers: headers() }).catch(() => {});
      poll().catch(() => {});
    },
    async upload(blob) {
      const res = await fetch('/api/upload', { method: 'POST', headers: headers({ 'Content-Type': blob.type || 'application/octet-stream' }), body: blob });
      if (!res.ok) fail(res);
      return res.json();
    },
    async deleteImage(img) {
      if (img.asset) await fetch(`/api/upload/${img.asset}`, { method: 'DELETE', headers: headers() }).catch(() => {});
    },
  };
}

// Places of topic 02 (Kulturális élet): pins on the city map with text and photos.
//   { id: "C-001", position: [x, y] | null (site metres, Building O = 0,0), z: m relative to its ground floor,
//     title, category, note, link, author, date, images: [{ src | asset, name, caption }] }
export function normalisePlace(p) {
  return {
    id: String(p.id), position: Array.isArray(p.position) ? [Number(p.position[0]), Number(p.position[1])] : null,
    z: typeof p.z === 'number' ? p.z : undefined,
    title: p.title || '', category: p.category || '', note: p.note || '', link: p.link || '',
    author: p.author || '', date: p.date || '', images: Array.isArray(p.images) ? p.images.slice() : [],
  };
}
/** Places: live on the home server (editable with the editor key), else data/places.json (read-only). */
export async function openPlaces() {
  if (window.BUILDING_O_SERVER) return serverStore('/api/places', normalisePlace);
  return staticStore('data/places.json', 'places', normalisePlace);
}

export async function openStore() {
  if (window.BUILDING_O_SERVER) return serverStore();
  if (window.BUILDING_O_EDITOR) {
    const live = await liveStore();
    if (live) return live;
  }
  return staticStore();
}

// iPhone HEIC/HEIF photos: only Safari decodes them natively; elsewhere heic2any (libheif, MIT) turns them into a JPEG
// first. The ~1 MB decoder loads only when the first HEIC file arrives.
const HEIC2ANY = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
let heicLib = null;
function loadHeic() {
  heicLib ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = HEIC2ANY;
    s.onload = () => (window.heic2any ? res(window.heic2any) : rej(new Error('heic2any')));
    s.onerror = () => { heicLib = null; rej(new Error('heic2any')); };
    document.head.append(s);
  });
  return heicLib;
}
const isHeic = (file) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
async function heicToJpeg(file) {
  try {
    const out = await (await loadHeic())({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;   // a burst or Live Photo container: the first frame
  } catch {
    throw new Error(`${file.name}: a HEIC képet nem sikerült átalakítani. Exportáld JPG-be, és töltsd fel úgy.`);
  }
}

// Make an uploaded photo or scan web-sized: at most 2400 px on the long side, rotated per its EXIF,
// JPEG unless it is a small PNG/WebP (drawings keep their crisp edges). PDFs go up as they are; HEIC becomes JPEG.
export async function prepareUpload(file) {
  if (file.type === 'application/pdf') return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (!isHeic(file)) throw new Error(`${file.name}: ez a böngésző nem tudja beolvasni ezt a képet.`);
    try {
      bmp = await createImageBitmap(await heicToJpeg(file), { imageOrientation: 'from-image' });
    } catch (e) {
      throw e.message?.startsWith(file.name) ? e : new Error(`${file.name}: a HEIC képet nem sikerült beolvasni.`);
    }
  }
  const max = 2400, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const keep = s === 1 && file.size < 4e6 && /^image\/(jpeg|png|webp)$/.test(file.type);
  if (keep) { bmp.close?.(); return file; }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(`${file.name}: nem sikerült átalakítani.`))), 'image/jpeg', 0.86));
}
