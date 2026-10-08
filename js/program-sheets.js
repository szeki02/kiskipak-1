// Topic 04: the four programme sheets (Programterv lapok, PDFs in assets/program/) under the blob diagram.
// Each row is one space of the diagram (id = program.json space id). Text in {id|words} marks a space the sheet
// mentions: hovering it or its row highlights that blob, clicking selects it. Selecting a blob in the diagram
// opens its sheet and marks the row. Talks to the diagram through window.__oblob and its "oblob:panel" event
// (js/blob-diagram.js); tools/blob-hub.js adds the sheet text to the diagram's side panel.
// Text follows the sheets of 2026-10-07; obvious typos fixed, the law number corrected to CLXXXV.
(() => {
  const SHEETS = [
    { key: 'publikus', title: 'Publikus terek', color: '#6365a6', pdf: 'assets/program/publikus_terek.pdf', inside: 150, outside: 10236, rows: [
      { id: 'mosdo', name: 'Publikus mosdó', m2: 45,
        text: 'A női/férfi arányok figyelembe vétele. A földszinten elhelyezendő, a {kavezo|kávézóval} és a kültérrel kapcsolódnia kell. A nagyobb publikum számára elérhetőnek kell lennie.',
        links: [['multiuse_terem', 'multifunkcionális tér'], ['info', 'infópult/porta'], ['kavezo', 'kávézó']] },
      { id: 'kulteri_mosdo', name: 'Kültéri mosdó', m2: 30,
        text: 'Park nyitvatartását követő, publikum által használt mosdó. A {kozpark|parkban} elhelyezendő.',
        links: [['sportpalya', 'multifunkcionális tér'], ['info', 'infópult/porta']] },
      { id: 'kavezo', name: 'Fedett-nyitott tér/kávézó', m2: 112,
        text: 'Benti kiszolgáló terület. A teljes kiterjedése a beltérre és kültérre is vonatkozik. A {mosdo|mosdókat} a többi funkcióval organizálva kell.' },
      { id: 'info', name: 'Infó pult/porta', m2: 8,
        text: 'A porta és infó pult egyben értelmezendő. Hirdető felület kialakítása: egyéni meghatározás.' },
      { id: 'kozpark', name: 'Közpark', m2: 8600,
        text: 'Terjedelmét az N épület előtti zöld felület, a mostani focipálya területe, az O épület és Polinszky terem közti rész a Bukta pékségig.' },
      { id: 'bicikli', name: 'Biciklitároló', m2: 86,
        text: 'Fedett, nyitott bicikli tároló, bicikli szervizállomás felszereléssel (pumpa, kulcsok, egyéb szerszámok).' },
      { id: 'sportpalya', name: 'Multifunkcionális sportpálya/amfiteátrum', m2: 450,
        text: 'A tanuló terektől megfelelő távolságra elhelyezve akár tanulási időszak közben is működhető kialakítás. Újrahasznosított anyagok igénybevétele, illetve környezeti elemek elhelyezése. A megfelelő tanulási környezet kialakítása érdekében publikusan is elérhető.' },
      { id: 'parkolo', name: 'Parkoló', m2: 1100,
        text: 'A lehető legtávolabb elhelyezni a zajra és szagra érzékeny közegektől (pl.: {sportpalya|amfiteátrum}, {kavezo|kávézó}), a lehetséges minimális m² elfoglalással és a kampusz területén elosztva. A struktúra szabadon kezelhető.' },
    ] },
    { key: 'felpublikus', title: 'Félpublikus terek', color: '#676d5f', pdf: 'assets/program/felpublikus_terek.pdf', inside: 406, outside: 50, rows: [
      { id: 'multiuse_terem', name: 'Multifunkcionális terem', m2: 176,
        text: 'Moduláris elrendezés és több felhasználói eset kielégítésére is alkalmasnak kell lennie. Publikum az egyetem által meghatározott eseményeken lehet jelen (nyitott workshopok, előadások stb.).' },
      { id: 'coworking', name: 'Co-working/olvasó', m2: 230,
        text: 'A {kavezo|kávézó} területe is beletartozik; nyitvatartástól függően a nagyobb publikum által is látogatható közösségi tér.' },
      { id: 'kert', name: 'Közösségi kert', m2: 50,
        text: 'Publikum által limitáltan elérhető, egyetemi polgárság által gondozott kertrész. Fontos az egyértelmű elválasztása a {kozpark|parkosított, 100%-ban publikus kertrészektől} (pl.: magaságyás).' },
    ] },
    { key: 'privat', title: 'Privát terek', color: '#c56e60', pdf: 'assets/program/privat_terek.pdf', inside: 792.5, outside: 0, rows: [
      { id: 'lobbi', name: 'Lobby', m2: 92,
        text: 'A lépcsőn felérve ebbe az elosztó/szociális térbe kerül minden első emeletet használó személy. Első emeleten kell elhelyezni.',
        links: [['szeminarium', 'szemináriumi termek'], ['em_mosdo', '1E mosdók'], ['konyha', 'közösségi konyha'], ['admin', 'admin iroda']] },
      { id: 'szeminarium', name: 'Szemináriumi termek', m2: 770,
        text: 'Tematikák alapján tervezett foglalkoztató terek, a frontális oktatás enyhítése. 21. századhoz megfelelő oktatási berendezés. Megfelelő szellőzés, árnyékolás, fűtés-hűtés biztosítása. Első emeleten kell elhelyezni, de lehet javaslatot tenni a földszinti elhelyezésre. Fontos figyelembe venni a 2,2 m²/fő alapterületet.' },
      { id: 'admin', name: 'Adminisztrációs iroda', m2: 22.5,
        text: 'A földszinten működő {multiuse_terem|flexibilis terem} beosztásának/használatának, az {sportpalya|amfiteátrumnak}, illetve az első emeleti tanuló tereknek az adminisztrációját ellátó munkatársak irodája. Ha létszámnövekedés indokolt, javaslatot lehet tenni a tér bővítésére és áthelyezésére a földszintre.' },
      { id: 'konyha', name: 'Közösségi konyha', m2: 20,
        text: 'Elhelyezése fontos, hogy ne zavarja a dedikált koncentrációra tervezett tanulási tereket ({szeminarium|szemináriumi termek}, {admin|iroda} stb.). Meleg konyha kialakítása az OTSZ rendeletei szerint. Tartalmaznia kell melegítésre alkalmas konyhai eszközöket.' },
      { id: 'em_mosdo', name: 'Egyetemi exkluzív mosdó', m2: 49,
        text: 'Csak az első szintre belépést kapó személyek számára fenntartott mosdóhelyiség. A többi mosdóra vonatkozó leírást figyelembe kell venni. Elhelyezkedése az első emeleten.',
        links: [['lobbi', 'Lobby']] },
    ] },
    { key: 'technikai', title: 'Technikai terek', color: '#5b5b5b', pdf: 'assets/program/technikai_terek.pdf', inside: 63.5, outside: 6, rows: [
      { id: 'gepeszet', name: 'Gépészet', m2: 15,
        text: 'A gépészeti helyiséget úgy kell tervezni és kialakítani, hogy a berendezés karbantartásához szükséges hely biztosított legyen.' },
      { id: 'boh', name: 'Back of house', m2: 28.5,
        text: 'Az épület nyugati homlokzata felé érdemes ki-bejáratot tervezni a benapozottság, illetve a szervizút elhelyezkedése miatt.' },
      { id: 'tarolo', name: 'Raktárhelyiségek', m2: 20,
        text: 'Könnyen elérhető, ki-be rámolható. Direkt összeköttetésben áll a {multiuse_terem|multi-use térrel}.' },
      { id: 'szemet', name: 'Hulladéktároló', m2: 6,
        text: '2012. évi CLXXXV. törvény a hulladékról.' },
    ] },
  ];

  const index = new Map();
  for (const sh of SHEETS) for (const row of sh.rows) index.set(row.id, { sheet: sh, row });

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => {   // 8 600, 22,5 – as on the sheets
    const [i, d] = String(Math.round(n * 10) / 10).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? ',' + d : '');
  };
  const plain = (t) => t.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
  const api = () => window.__oblob;
  const space = (id) => api()?.S().spaces.find((s) => s.id === id);
  const spaceName = (id) => space(id)?.name || index.get(id)?.row.name || id;
  const mention = (id, words) => `<button type="button" class="ment" data-ref="${esc(id)}" title="${esc(spaceName(id))} – kijelölés a diagramon">${esc(words)}</button>`;
  const rich = (t) => esc(t).replace(/\{([^|}]+)\|([^}]+)\}/g, (_, id, w) => mention(id, w));

  const box = document.getElementById('prog-sheets');
  if (!box) return;
  const tabsEl = box.querySelector('#sheet-tabs'), body = box.querySelector('#sheet-body');
  let current = SHEETS[0].key, selected = null;
  try { const k = localStorage.getItem('bo-sheet'); if (SHEETS.some((s) => s.key === k)) current = k; } catch { /* no storage */ }

  function status(row) {
    const S = api()?.S();
    if (!S) return '<span class="srow__diag is-wait">–</span>';
    const sp = S.spaces.find((s) => s.id === row.id);
    if (!sp) return '<span class="srow__diag is-off" title="Ez a tér most nincs a diagramon (Kivett terek).">nincs a diagramon</span>';
    const a = +sp.area_m2 > 0 ? +sp.area_m2 : null;
    if (a !== null && Math.abs(a - row.m2) < 0.05) return `<span class="srow__diag is-ok" title="A blob mérete a lap szerinti terület.">${fmt(a)} m² ✓</span>`;
    return `<span class="srow__diag is-diff" title="A diagramon ${a === null ? 'nincs megadva terület' : fmt(a) + ' m²'}, a lapon ${fmt(row.m2)} m².">${a === null ? '– m²' : fmt(a) + ' m²'} ≠</span>`;
  }

  function render() {
    tabsEl.innerHTML = SHEETS.map((sh) => `<button type="button" role="tab" class="sheet-tab" data-sheet="${sh.key}" aria-selected="${sh.key === current}" style="--sheet:${sh.color}"><span class="sheet-tab__sw" aria-hidden="true"></span>${esc(sh.title)}<span class="sheet-tab__n">${sh.rows.length}</span></button>`).join('');
    const sh = SHEETS.find((s) => s.key === current);
    const sum = sh.rows.reduce((t, r) => t + r.m2, 0), stated = sh.inside + sh.outside;
    body.style.setProperty('--sheet', sh.color);
    body.innerHTML = `
      <div class="sheet__band"><h4>${esc(sh.title)}</h4><a href="${sh.pdf}" target="_blank" rel="noopener">Eredeti lap (PDF)</a></div>
      <div class="sheet__cols" aria-hidden="true"><span>Tér · terület</span><span>Leírás</span><span>Diagramon</span></div>
      ${sh.rows.map((r) => `
        <div class="srow${r.id === selected ? ' is-on' : ''}" id="sheet-row-${r.id}" data-id="${r.id}" tabindex="0" role="button" aria-pressed="${r.id === selected}" aria-label="${esc(r.name)}, ${fmt(r.m2)} m² – kijelölés a diagramon">
          <div class="srow__name"><b>${esc(r.name)}</b><span class="srow__m2">${fmt(r.m2)} m²</span></div>
          <div class="srow__text"><p>${rich(r.text)}</p>${r.links ? `<p class="srow__links"><span>Tér kapcsolatok:</span> ${r.links.map(([id, w]) => mention(id, w)).join(' ')}</p>` : ''}</div>
          ${status(r)}
        </div>`).join('')}
      <div class="sheet__sum"><span>Össz beltér: <b>${fmt(sh.inside)} m²</b></span><span>Össz kültér: <b>${fmt(sh.outside)} m²</b></span>${Math.abs(sum - stated) > 0.05 ? `<span class="sheet__note">A lap összesítője ${fmt(stated)} m², a sorok összege ${fmt(sum)} m².</span>` : ''}</div>`;
    markMentions();
  }
  const markMentions = () => box.querySelectorAll('.ment').forEach((b) => b.classList.toggle('is-on', b.dataset.ref === selected));

  function show(id) {   // select a space on the diagram and bring the diagram into view if it is mostly scrolled away
    const a = api(); if (!a || !space(id)) return;
    a.select(id);
    const S = a.S(), sp = space(id), lv = S.meta.levels?.[sp.level];
    const z = sp.enclosure === 'belso' && lv ? +lv.slab_z || 0 : 0;
    const r = Math.sqrt((+sp.area_m2 > 0 ? +sp.area_m2 : 40) / Math.PI), d = Math.max(34, r * 5.5);
    a.look(sp.x, sp.y, z + 1, sp.x - d * 0.45, sp.y - d * 0.78, z + d * 0.62);
    const host = document.getElementById('blob-host'), rc = host.getBoundingClientRect();
    const seen = Math.max(0, Math.min(rc.bottom, innerHeight) - Math.max(rc.top, 0));
    if (seen < Math.min(rc.height, innerHeight) * 0.5) host.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // highlight on hover/focus, select on click (a mention inside a row wins over the row)
  const target = (e) => e.target.closest?.('.ment, .srow');
  const idOf = (el) => el?.dataset.ref || el?.dataset.id;
  box.addEventListener('pointerover', (e) => { const el = target(e); api()?.hint(idOf(el) || null); });
  box.addEventListener('pointerleave', () => api()?.hint(null));
  box.addEventListener('focusin', (e) => api()?.hint(idOf(target(e)) || null));
  box.addEventListener('focusout', () => api()?.hint(null));
  box.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-sheet]');
    if (tab) { current = tab.dataset.sheet; try { localStorage.setItem('bo-sheet', current); } catch { /* ignore */ } render(); return; }
    const el = target(e); if (el) show(idOf(el));
  });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.srow'); if (!el || e.target !== el) return;
    e.preventDefault(); show(el.dataset.id);
  });

  // the diagram's side panel changed: follow its selection (open that space's sheet once, mark the row)
  window.addEventListener('oblob:panel', (e) => {
    const id = e.detail?.selected || null, changed = id !== selected;
    selected = id;
    if (changed && id && index.has(id) && index.get(id).sheet.key !== current) current = index.get(id).sheet.key;
    render();
  });
  // area edits in the diagram's form don't re-render its panel; refresh the "Diagramon" column
  let t = 0;
  document.getElementById('blob-host')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 250); });

  window.PROGRAM_SHEETS = {
    sheets: SHEETS, plain, fmt,
    find: (id) => index.get(id) || null,
    reveal(id) {   // scroll to a space's row and flash it
      const hit = index.get(id); if (!hit) return;
      if (hit.sheet.key !== current) { current = hit.sheet.key; render(); }
      const row = document.getElementById('sheet-row-' + id);
      row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
      row.focus({ preventScroll: true });
    },
  };
  render();
})();
