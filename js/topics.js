// Topic tabs: one <main class="topic-body"> per topic, chosen by the page's #anchor (#local-site, #docs, #culture, #commuting, #programme).
// Topic 02 (survey drawings slideshow, js/docs.js) and 03 (city map with places, js/culture.js, three 0.160) are ES modules
// imported on first open. Topics 04 (commuter simulation, js/commuters.js) and 05 (functional blob diagram, js/blob-diagram.js) run on
// three r128 globals, loaded on first open only. Each script loads once, so both apps share one THREE.
const tabs = [...document.querySelectorAll('.topics [data-topic]')];
const bodies = Object.fromEntries(tabs.map((t) => [t.dataset.topic, document.getElementById(t.dataset.topic)]));
const DEFAULT = 'local-site';

const THREE_R128 = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
];
const APPS = {
  docs: {   // topic 02: survey drawings slideshow (js/docs.js, plain module)
    note: 'doc-loading', what: 'dokumentáció', module: './docs.js', init: 'initDocs', scripts: [],
  },
  culture: {   // topic 03: city map (three 0.160 module) on the commuter project's terrain and basemap
    note: 'cul-loading', what: 'várostérkép', module: './culture.js', init: 'initCulture',
    scripts: ['js/commuter-basemap.js', 'js/commuter-topo.js'],
    also: [['./culture-venues.js', 'initCultureVenues']],   // the scale tabs under the map: shown at once, before the map loads
  },
  commuting: {
    host: 'commuter-host', note: 'commuter-loading', what: 'szimuláció', init: 'initCommuters',
    scripts: [...THREE_R128, 'js/commuter-basemap.js', 'js/commuter-topo.js', 'js/commuter-data.js', 'js/commuters.js'],
  },
  programme: {
    host: 'blob-host', note: 'blob-loading', what: 'diagram', init: 'initBlobDiagram',
    scripts: [...THREE_R128, 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/renderers/CSS2DRenderer.js', 'js/program-sheets.js', 'js/blob-diagram.js'],
    also: [['./multiuse.js', 'initMultiuse']],   // the multi-use room layouts (three 0.160 module, loads alongside)
  },
};

const loaded = new Map();   // src -> promise
const loadScript = (src) => {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { loaded.delete(src); s.remove(); reject(new Error(src)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
};
const started = {};
function startApp(id) {
  const app = APPS[id];
  if (!app || started[id]) return;
  const host = app.host && document.getElementById(app.host), note = document.getElementById(app.note);
  (app.also || []).forEach(([mod, fn]) => import(mod).then((m) => m[fn]()).catch((err) => console.error(mod, err)));   // shows its own error
  started[id] =app.scripts.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
    .then(() => (app.module ? import(app.module).then((m) => m[app.init]()) : window[app.init](host)))
    .then(() => { note.hidden = true; })
    .catch((err) => { started[id] = null; note.textContent = `A(z) ${app.what} nem töltődött be (${err.message}). Ellenőrizd a kapcsolatot, és nyisd meg újra a fület.`; });
}

function show(id) {
  if (!bodies[id]) id = DEFAULT;
  for (const t of tabs) {
    const on = t.dataset.topic === id;
    t.classList.toggle('is-active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    bodies[t.dataset.topic].hidden = !on;
  }
  startApp(id);
}

tabs.forEach((t) => t.addEventListener('click', (e) => {
  e.preventDefault();
  try { if (location.hash !== '#' + t.dataset.topic) history.pushState(null, '', '#' + t.dataset.topic); } catch { /* sandboxed viewer */ }
  show(t.dataset.topic);
}));
window.addEventListener('popstate', () => show(location.hash.slice(1)));

// in-page jumps (source references, step buttons) scroll instead of changing the #topic anchor
document.addEventListener('click', (e) => {
  const el = e.target.closest('a[href^="#"], [data-step]');
  if (!el || el.closest('.topics')) return;
  const id = el.dataset.step || el.getAttribute('href').slice(1);
  const target = id && !bodies[id] && document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
show(location.hash.slice(1));
// a link straight to a topic (#docs, #culture, …) skips the opening page
if (bodies[location.hash.slice(1)]) requestAnimationFrame(() => document.getElementById('topics')?.scrollIntoView({ block: 'start' }));
