// Topic 02 "Műszaki dokumentáció": the team's survey drawings (felmérési terv, A2; PDFs from the shared Drive, 2026-10-07,
// completed 2026-10-08 with the site plan, roof plan and elevations) as a slideshow. Each sheet is rendered by pdftoppm
// at 200 dpi (assets/docs/<id>.png, 4677 × 3307 px) with a 560 px thumbnail; the original PDF sits next to it.
// Arrows / thumbnails / ← → switch sheets; the drawing zooms with the wheel, a pinch, the + / − buttons or a click
// (click again = fit) and pans by dragging. The site plan's title block says "Homlokzatok, 1:100" (copied from the
// elevations); measured on Building O's 27 m it is about 1:500, so that is what the bar shows.
const SHEETS = [
  { id: 'helyszinrajz', title: 'Helyszínrajz', level: 'telek és környezet', scale: '≈ 1:500', note: 'Az O épület a telekkel, a fákkal és a szomszédos campusépületekkel; szaggatott vonal: telekhatár.' },
  { id: 'fsz-alaprajz', title: 'Földszinti alaprajz', level: '±0,00', scale: '1:100', note: 'A-A és B-B metszetvonallal, pillérkiosztás 5,40 m.' },
  { id: 'emelet-alaprajz', title: 'Emeleti alaprajz', level: '+3,90', scale: '1:100', note: 'Az első emelet a lépcsővel és a tetőfelülvilágítókkal.' },
  { id: 'teto', title: 'Tetőfelülnézet', level: '+7,22', scale: '1:100', note: 'A lapostető a felülvilágítókkal, a pillérrenddel és a metszetvonalakkal.' },
  { id: 'metszetek', title: 'Metszetek', level: 'A-A · B-B', scale: '1:100', note: 'Két metszet a födémekkel, a lépcsővel, a felülvilágítókkal és az alapokkal.' },
  { id: 'homlokzat-eny-dny', title: 'Homlokzatok: DNy és ÉNy', level: 'délnyugati · északnyugati', scale: '1:100', note: 'A délnyugati és az északnyugati homlokzat az előtetővel, a kéménnyel és a bejáratokkal.' },
  { id: 'homlokzat-dk-ek', title: 'Homlokzatok: ÉK és DK', level: 'északkeleti · délkeleti', scale: '1:100', note: 'Az északkeleti és a délkeleti homlokzat a szalagablakokkal.' },
];
const FORMAT = 'A2';const MAX_ZOOM = 6;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const src = (sh, kind = '') => `assets/docs/${sh.id}${kind}.png`;

let started = false;
export function initDocs() {
  if (started) return; started = true;
  const stage = $('#doc-stage'), view = $('#doc-view'), img = $('#doc-img');
  const state = { i: 0, z: 1, x: 0, y: 0 };   // zoom 1 = fit; x, y = offset of the drawing's centre from the stage's centre (px)

  // ---- thumbnails
  $('#doc-thumbs').innerHTML = SHEETS.map((sh, i) => `
    <li><button type="button" class="doc-thumb" data-doc="${i}" aria-label="${i + 1}. lap: ${esc(sh.title)}">
      <img src="${esc(src(sh, '-thumb'))}" alt="" loading="lazy" decoding="async">
      <span class="doc-thumb__cap"><span class="doc-thumb__n">${String(i + 1).padStart(2, '0')}</span>${esc(sh.title)}</span>
    </button></li>`).join('');

  // ---- fit, zoom, pan (CSS transform on the image; the stage clips)
  const fitScale = () => {
    const r = view.getBoundingClientRect(), w = img.naturalWidth || 4677, h = img.naturalHeight || 3307;
    return Math.min(r.width / w, r.height / h);
  };
  function clamp() {
    const r = view.getBoundingClientRect(), s = fitScale() * state.z;
    const mx = Math.max(0, (img.naturalWidth * s - r.width) / 2), my = Math.max(0, (img.naturalHeight * s - r.height) / 2);
    state.x = Math.max(-mx, Math.min(mx, state.x)); state.y = Math.max(-my, Math.min(my, state.y));
  }
  function apply(animate = false) {
    clamp();
    const s = fitScale() * state.z;
    img.style.transition = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'transform 0.2s ease-out' : 'none';
    img.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${s})`;
    stage.classList.toggle('is-zoomed', state.z > 1.01);
    $('#doc-zoom').textContent = `${Math.round(state.z * 100)} %`;
  }
  // zoom to z keeping the drawing point under (px, py) (stage coordinates from the centre) in place
  function zoomAt(z, px = 0, py = 0, animate = false) {
    z = Math.max(1, Math.min(MAX_ZOOM, z));
    const k = z / state.z;
    state.x = px - (px - state.x) * k; state.y = py - (py - state.y) * k; state.z = z;
    apply(animate);
  }
  const local = (e) => { const r = view.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };

  // ---- sheets
  function show(i) {
    state.i = (i + SHEETS.length) % SHEETS.length;
    const sh = SHEETS[state.i];
    state.z = 1; state.x = 0; state.y = 0;
    stage.classList.add('is-loading');
    img.onload = () => { stage.classList.remove('is-loading'); apply(); };
    img.src = src(sh); img.alt = `${sh.title}, felmérési terv, ${sh.scale}`;
    if (img.complete && img.naturalWidth) img.onload();
    $('#doc-count').textContent = `${state.i + 1} / ${SHEETS.length}`;
    $('#doc-title').textContent = sh.title;
    $('#doc-meta').textContent = `${sh.level} · ${sh.scale} · ${FORMAT}`;
    $('#doc-note').textContent = sh.note;
    $('#doc-pdf').href = `assets/docs/${sh.id}.pdf`;
    for (const b of document.querySelectorAll('#doc-thumbs [data-doc]')) b.setAttribute('aria-current', String(Number(b.dataset.doc) === state.i));
    const next = SHEETS[(state.i + 1) % SHEETS.length];
    new Image().src = src(next);   // preload the next sheet
  }

  $('#doc-prev').addEventListener('click', () => show(state.i - 1));
  $('#doc-next').addEventListener('click', () => show(state.i + 1));
  $('#doc-thumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-doc]'); if (b) show(Number(b.dataset.doc)); });
  $('#doc-in').addEventListener('click', () => zoomAt(state.z * 1.6, 0, 0, true));
  $('#doc-out').addEventListener('click', () => zoomAt(state.z / 1.6, 0, 0, true));
  $('#doc-fit').addEventListener('click', () => { state.z = 1; state.x = 0; state.y = 0; apply(true); });
  stage.addEventListener('keydown', (e) => {
    if (e.target.closest('a, button') && (e.key === 'Enter' || e.key === ' ')) return;
    const k = { ArrowLeft: () => show(state.i - 1), ArrowRight: () => show(state.i + 1), '+': () => zoomAt(state.z * 1.6, 0, 0, true), '=': () => zoomAt(state.z * 1.6, 0, 0, true),
      '-': () => zoomAt(state.z / 1.6, 0, 0, true), 0: () => { state.z = 1; state.x = 0; state.y = 0; apply(true); } }[e.key];
    if (k) { e.preventDefault(); k(); }
  });

  // wheel = zoom at the cursor (only while the pointer is over the drawing, so the page still scrolls elsewhere)
  view.addEventListener('wheel', (e) => {
    if (state.z === 1 && e.deltaY > 0) return;   // zoomed out already: let the page scroll
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(state.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), px, py);
  }, { passive: false });

  // drag = pan, click = zoom in at the point / back to fit, two pointers = pinch
  const ptrs = new Map();
  let drag = null, pinch = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    view.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, local(e));
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: state.z }; drag = null;
    } else drag = { p: local(e), x: state.x, y: state.y, moved: false };
  });
  view.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, local(e));
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      zoomAt(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      return;
    }
    if (!drag) return;
    const [px, py] = local(e);
    if (Math.hypot(px - drag.p[0], py - drag.p[1]) > 4) drag.moved = true;
    if (drag.moved && state.z > 1) { state.x = drag.x + px - drag.p[0]; state.y = drag.y + py - drag.p[1]; apply(); }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; return; }
    if (drag && !drag.moved && e.type === 'pointerup') {
      const [px, py] = local(e);
      if (state.z > 1.01) { state.z = 1; state.x = 0; state.y = 0; apply(true); } else zoomAt(3, px, py, true);
    }
    drag = null;
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);

  // full screen where the browser allows it (not in every embedded viewer)
  const fs = $('#doc-full');
  if (stage.requestFullscreen && document.fullscreenEnabled) {
    fs.hidden = false;
    fs.addEventListener('click', () => { (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => { fs.hidden = true; }); });
    document.addEventListener('fullscreenchange', () => { fs.textContent = document.fullscreenElement ? 'Kilépés' : 'Teljes képernyő'; requestAnimationFrame(() => apply()); });
  }
  new ResizeObserver(() => apply()).observe(view);
  show(0);
}
