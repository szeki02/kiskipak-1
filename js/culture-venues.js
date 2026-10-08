// Topic 02: event venues by scale, from the team's list "Helyek események lista" (Word document, 2026-10-07), retyped as data.
// Three tabs under the city map (large / medium / small events). js/culture.js puts the open tab's venues on the map as pins
// and shows the selected one in its panel; the two talk through `bus` ('scale', 'select') and the shared `view`.
// Positions: site metres (Building O = 0,0), from the document's Google Maps links; FOTON, Papírkutya (its link in the
// document repeats FOTON's) and Veszprém Aréna (no link) from OpenStreetMap / Nominatim.
// Photos: the team's Drive folder (2026-10-08, every venue; replaced the 2026-10-07 "Képek" set), converted to JPEG ≤ 1600 px in
// assets/venues/<venue id>[-n].jpg by .sync\kepek2\convert.ps1 (duplicates dropped, EXIF rotation applied); the first is the card cover.
const gmaps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export const SCALES = [
  { id: 'l', tab: 'Nagy léptékű', when: 'Időszakos',
    lead: 'Az egész országot, akár a világot megmozgató események nagy befogadóképességű helyszínei.',
    intro: 'Minden korosztálynak és több kulturális rétegnek szólnak, zeneileg viszonylag sokszínű kínálattal. Időszakos programok, amelyek egyszerre nagy közönséget vonzanak.' },
  { id: 'm', tab: 'Közepes', when: 'Egész évben',
    lead: 'A várost és a Balaton-felvidék településeit megszólító események és helyszínek.',
    intro: 'Széles közönségnek, a város minden korosztályának kínálnak előadásokat, kulturális programokat, adott esetben szakköröket és workshopokat. Egész évben elérhetők.' },
  { id: 's', tab: 'Kicsi', when: 'Egész évben',
    lead: 'Egy korosztály vagy kulturális közeg terei: klubélet, kisebb rendezvények, workshopok.',
    intro: 'Egy-egy szubkultúra közösségi terei: zenei programok, előadások és a közös alkotás helyei. Egész évben elérhetők.' },
];

export const VENUES = [
  { id: 'utcazene', images: ['utcazene.jpg', 'utcazene-2.jpg'], name: 'Veszprémi Utcazene Fesztivál', scales: ['l'], kind: 'fesztivál',
    parts: 'Belváros: Kossuth utca, Fortuna udvar, Szabadság tér, Vár Áruház Gizella udvar',
    desc: 'Szabadtéri koncertek: pop, alternatív, könnyű- és világzenei előadók.', who: 'széles tömegek, minden korosztály',
    sites: [{ name: 'Belváros', x: 430.1, y: 893.9, maps: 'https://maps.app.goo.gl/wg5ppk17tmRGpB7r5' }] },
  { id: 'veszpremfest', images: ['veszpremfest.jpg', 'veszpremfest-2.jpg', 'veszpremfest-3.jpg'], name: 'VeszprémFest', scales: ['l'], kind: 'fesztivál', parts: 'három helyszín',
    desc: 'Prémium jazz-, pop- és soul-nagykoncertek.', who: 'széles tömegek, minden korosztály',
    sites: [
      { name: 'História kert', x: 280.8, y: 1310.6, maps: 'https://maps.app.goo.gl/XkwNgYe15JdHE22b7' },
      { name: 'Óváros tér', x: 210.7, y: 982.2, maps: 'https://maps.app.goo.gl/Vf9mc5ZYbfN5smoq8' },
      { name: 'Jezsuita templom', x: -1194.2, y: 1467.9, maps: 'https://maps.app.goo.gl/4B8Rsjebd8hL4kwq9' },
    ] },
  { id: 'gyarkert', images: ['gyarkert.jpg', 'gyarkert-2.jpg', 'gyarkert-3.jpg'], name: 'Gyárkert Kultúrpark', scales: ['l', 'm'], kind: 'kultúrpark', osm: 'way/1192752780',
    desc: 'Pop-, rock- és alternatív zenei koncertek nagy közönségű előadókkal.', who: 'leginkább fiatalok',
    sites: [{ x: 972.1, y: 1063.4, maps: 'https://maps.app.goo.gl/WhLrSegVfrQ6oy6r8' }] },
  { id: 'hangvilla', images: ['hangvilla.jpg', 'hangvilla-2.jpg', 'hangvilla-3.jpg', 'hangvilla-4.jpg'], name: 'Hangvilla', scales: ['m'], kind: 'multifunkcionális közösségi tér', osm: 'way/340073659',
    desc: 'Kőszínházi és kortárs előadások, komolyzene, előadások.', who: 'minden korosztály',
    sites: [{ x: 432.9, y: 708.0, maps: 'https://maps.app.goo.gl/VMF4wGFXw23XySdQ8' }] },
  { id: 'muveszetek-haza', images: ['muveszetek-haza.jpg', 'muveszetek-haza-2.jpg', 'muveszetek-haza-3.jpg'], name: 'Művészetek Háza', scales: ['m'], kind: 'kiállítóhelyek',
    parts: 'több helyszín: Modern Képtár – Vass László Gyűjtemény, Csikász Galéria, Dubniczay-palota, Várgaléria, Magtár',
    desc: 'Kortárs képzőművészeti kiállítások, beszélgetések, műhelyek.', who: 'minden korosztály',
    sites: [{ name: 'Vár utca', x: 123.1, y: 1106.2, maps: 'https://maps.app.goo.gl/s5o4cnXcULXxpcdH8' }] },
  { id: 'agora', images: ['agora.jpg', 'agora-2.jpg'], name: 'Agóra Kulturális Központ', scales: ['m'], kind: 'kulturális központ', osm: 'way/152820963',
    desc: 'Közművelődés, szakkörök és hagyományőrzés.', who: 'minden korosztály',
    sites: [{ x: 786.0, y: 2292.5, maps: 'https://maps.app.goo.gl/p1gts6SQhJoN1oEU6' }] },
  { id: 'petofi', images: ['petofi.jpg', 'petofi-2.jpg'], name: 'Veszprémi Petőfi Színház', scales: ['m'], kind: 'színház', osm: 'way/152642849',
    desc: 'Kőszínházi előadások.', who: 'minden korosztály',
    sites: [{ x: 267.9, y: 708.0, maps: 'https://maps.app.goo.gl/6ARqnxwG1jyKbUCV8' }] },
  { id: 'arena', images: ['arena.jpg'], name: 'Veszprém Aréna', scales: ['m'], kind: 'sport- és rendezvénycsarnok',
    desc: 'Koncertek, színház, előadások.', who: 'széles közönség',
    sites: [{ x: 2330, y: 2249, maps: gmaps('Veszprém Aréna, Külső-Kádártai út') }] },
  { id: 'expresszo', images: ['expresszo.jpg'], name: 'Expresszó Klub', scales: ['m', 's'], kind: 'klub', addr: 'Brusznyai Árpád u. 2.',
    desc: 'Underground klubkoncertek és tematikus DJ-szettek.', who: 'fiatal felnőttek',
    sites: [{ x: 405.8, y: 746.5, maps: 'https://maps.app.goo.gl/K8UKpc5j8CZ3Jmmk6' }] },
  { id: 'foton', images: ['foton.jpg', 'foton-2.jpg', 'foton-3.jpg', 'foton-4.jpg', 'foton-5.jpg'], name: 'FOTON Audiovizuális Centrum', scales: ['s'], kind: 'művészmozi, galéria', addr: 'Vár u. 17.',
    desc: 'Művészmozi és fotókiállítások, beszélgetések.', who: 'minden korosztály, főleg fiatal felnőttek',
    sites: [{ x: 125, y: 1039, maps: 'https://maps.app.goo.gl/BWT6rkJHiU63j4Mx6' }] },
  { id: 'papirkutya', images: ['papirkutya.jpg'], name: 'Papírkutya', scales: ['s'], kind: 'kultúrbisztró', addr: 'Szabadság tér 9.',
    desc: 'Akusztikus koncertek és slam poetry.', who: 'intellektuális, alternatív fiatalok és felnőttek',
    sites: [{ x: 338, y: 817, maps: gmaps('Papírkutya kultúrbisztró, Szabadság tér 9, Veszprém') }] },
  { id: 'kunszt', images: ['kunszt.jpg', 'kunszt-2.jpg', 'kunszt-3.jpg'], name: 'KUNSZT!', scales: ['s'], kind: 'kreatív tér',
    desc: 'Kreatív workshopok és dizájn pop-upok.', who: 'alkotók és dizájnrajongók',
    sites: [{ x: 256.6, y: 935.3, maps: 'https://maps.app.goo.gl/3D3NUjQRK2ur482NA' }] },
  { id: 'pekedli', images: ['pekedli.jpg'], name: 'Pekedli Bár', scales: ['s'], kind: 'bár',
    desc: 'Elektronikus és lounge zene.', who: 'fiatal felnőttek és felnőttek',
    sites: [{ x: 307.7, y: 903.9, maps: 'https://maps.app.goo.gl/wKqkMD7bUASSFoTB9' }] },
];

export const bus = new EventTarget();
export const view = { scale: 'l', id: null };
export const venueById = new Map(VENUES.map((v) => [v.id, v]));
export const inScale = (s) => VENUES.filter((v) => v.scales.includes(s));
export const numberOf = (v, s = view.scale) => inScale(s).indexOf(v) + 1;
export const photoUrl = (f) => `assets/venues/${f}`;
export const km =(x, y) => { const d = Math.hypot(x, y); return d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} km`; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s) => document.querySelector(s);
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

export function setScale(s, { user = false } = {}) {
  if (!SCALES.some((x) => x.id === s)) return;
  view.scale = s; remember('bo-cul-scale', s);
  render();
  bus.dispatchEvent(new CustomEvent('scale', { detail: { scale: s, user } }));
}
// select (or clear with null) from the list or a map pin; fly = move the map camera to it
export function selectVenue(id, { fly = false } = {}) {
  view.id = venueById.has(id) ? id : null;
  render();
  bus.dispatchEvent(new CustomEvent('select', { detail: { id: view.id, fly } }));
}
// cleared by the map when a place or OSM venue is selected instead (no event back)
export function clearVenue() { if (view.id) { view.id = null; render(); } }

function render() {
  const tabs = $('#cul-scales'), list = $('#cul-venues');
  if (!tabs || !list) return;
  const sc = SCALES.find((x) => x.id === view.scale);
  tabs.innerHTML = SCALES.map((x) => `
    <button type="button" class="sheet-tab scale-tab scale--${x.id}" role="tab" id="cul-scale-${x.id}" aria-controls="cul-venues-panel"
      aria-selected="${x.id === view.scale}" tabindex="${x.id === view.scale ? 0 : -1}" data-scale="${x.id}">
      <span class="sheet-tab__sw" aria-hidden="true"></span>${esc(x.tab)} <span class="sheet-tab__n">${inScale(x.id).length}</span></button>`).join('');
  $('#cul-venues-panel').setAttribute('aria-labelledby', `cul-scale-${sc.id}`);
  $('#cul-venues-panel').className = `venues scale--${sc.id}`;
  $('#cul-scale-lead').innerHTML = `<strong>${esc(sc.lead)}</strong> ${esc(sc.intro)}`;
  // cards: only the photo (opens the viewer) and the name, which shows the place on the map (user, 2026-10-08)
  list.innerHTML = inScale(sc.id).map((v, i) => `
    <li class="venue${v.id === view.id ? ' is-on' : ''}${v.images?.length ? ' venue--photo' : ''}" data-venue="${esc(v.id)}">
      ${v.images?.length ? `<button type="button" class="venue__img" data-venue-photo="${esc(v.id)}" aria-label="${esc(v.name)}: fotók (${v.images.length})">
        <img src="${esc(photoUrl(v.images[0]))}" alt="" loading="lazy" decoding="async">${v.images.length > 1 ? `<span class="venue__count">${v.images.length} fotó</span>` : ''}</button>` : ''}
      <span class="venue__n" aria-hidden="true">${i + 1}</span>
      <h4 class="venue__body"><button type="button" class="venue__name" data-venue-fly="${esc(v.id)}" title="Mutasd a térképen">${esc(v.name)}<span class="venue__pin" aria-hidden="true">↗</span></button></h4>
    </li>`).join('');
}

// photo viewer (its own dialog: the places' lightbox belongs to js/culture.js)
const lb = { id: null, i: 0 };
function showPhoto() {
  const v = venueById.get(lb.id); if (!v?.images?.length) return;
  const n = v.images.length;
  $('#cul-vlb-media').innerHTML = `<img src="${esc(photoUrl(v.images[lb.i]))}" alt="${esc(v.name)}, ${lb.i + 1}. fotó">`;
  $('#cul-vlb-kind').textContent = `${v.kind}${n > 1 ? ` · ${lb.i + 1}. fotó / ${n}` : ''}`;
  $('#cul-vlb-title').textContent = v.name;
  $('#cul-vlb-note').textContent = v.sites.map((st) => st.name).filter(Boolean).join(' · ');
  $('#cul-vlb-prev').hidden = $('#cul-vlb-next').hidden = n < 2;
}
export function openVenuePhotos(id, i = 0) {
  const d = $('#cul-vlb'); if (!d || !venueById.get(id)?.images?.length) return;
  lb.id = id; lb.i = i; showPhoto();
  if (!d.open) d.showModal();
}
const stepPhoto = (k) => { const v = venueById.get(lb.id); if (!v) return; lb.i = (lb.i + k + v.images.length) % v.images.length; showPhoto(); };

let started = false;
export function initCultureVenues() {
  if (started) return; started = true;
  const saved = recall('bo-cul-scale');
  if (SCALES.some((x) => x.id === saved)) view.scale = saved;
  render();
  const d = $('#cul-vlb');
  $('#cul-vlb-close').addEventListener('click', () => d.close());
  $('#cul-vlb-prev').addEventListener('click', () => stepPhoto(-1));
  $('#cul-vlb-next').addEventListener('click', () => stepPhoto(1));
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
  d.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowLeft') stepPhoto(-1); if (ev.key === 'ArrowRight') stepPhoto(1); });
  const tabs = $('#cul-scales');
  tabs.addEventListener('click', (ev) => { const b = ev.target.closest('[data-scale]'); if (b) setScale(b.dataset.scale, { user: true }); });
  tabs.addEventListener('keydown', (ev) => {   // arrow keys move between the tabs
    const i = SCALES.findIndex((x) => x.id === view.scale), d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    ev.preventDefault();
    setScale(SCALES[(i + d + SCALES.length) % SCALES.length].id, { user: true });
    $(`#cul-scale-${view.scale}`)?.focus();
  });
  $('#cul-venues').addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const ph = ev.target.closest('[data-venue-photo]');
    if (ph) { openVenuePhotos(ph.dataset.venuePhoto); return; }
    const fly = ev.target.closest('[data-venue-fly]');
    if (fly) {
      selectVenue(fly.dataset.venueFly, { fly: true });
      $('#cul-stage')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    const li = ev.target.closest('[data-venue]');   // anywhere else on the card: show it on the map too
    if (li) {
      selectVenue(li.dataset.venue, { fly: true });
      $('#cul-stage')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    }
  });
}
