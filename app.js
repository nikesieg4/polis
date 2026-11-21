/* POLIS – Polizei-Datenbank für Berlin City Roleplay (Testversion)
   Alle Daten liegen nur im localStorage dieses Browsers. */
(function () {
  'use strict';

  var STORE_KEY = 'polis.v1';

  var KATALOG = [
    { id: 'k1', name: 'Geschwindigkeitsüberschreitung', geld: 1500, haft: 0 },
    { id: 'k2', name: 'Fahren ohne Fahrerlaubnis', geld: 3000, haft: 5 },
    { id: 'k3', name: 'Fahrerflucht', geld: 4500, haft: 10 },
    { id: 'k4', name: 'Widerstand gg. Beamte', geld: 2500, haft: 15 },
    { id: 'k5', name: 'Illegaler Waffenbesitz', geld: 10000, haft: 20 },
    { id: 'k6', name: 'Raubüberfall', geld: 8000, haft: 25 },
    { id: 'k7', name: 'Banküberfall', geld: 15000, haft: 40 }
  ];

  var STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];

  function demoData() {
    function e(delikt, geld, haft, datum) {
      return { delikt: delikt, geld: geld, haft: haft, datum: datum, beamter: 'Demo' };
    }
    return {
      officer: { name: '', nr: '' },
      nextId: 1100,
      people: [
        { id: 'P-1042', name: 'Kevin Schulz', roblox: 'kevin_bln98', status: 'Fahndung', danger: true },
        { id: 'P-1043', name: 'Lena Hoffmann', roblox: 'lenah0ff', status: 'Sauber', danger: false },
        { id: 'P-1051', name: 'Murat Yilmaz', roblox: 'muratyy95', status: 'Bewährung', danger: false },
        { id: 'P-1060', name: 'Sophie Wagner', roblox: 'sophiew_rp', status: 'Sauber', danger: false },
        { id: 'P-1077', name: 'Dennis Krüger', roblox: 'dkrueger_x', status: 'Fahndung', danger: true },
        { id: 'P-1082', name: 'Aylin Demir', roblox: 'aylin.dmr', status: 'Sauber', danger: false }
      ],
      akten: {
        'P-1042': [e('Raubüberfall', 8000, 25, '18.11.2026'), e('Fahrerflucht', 4500, 10, '21.10.2026'), e('Widerstand gg. Beamte', 2500, 15, '03.10.2026')],
        'P-1043': [],
        'P-1051': [e('Fahren ohne Fahrerlaubnis', 3000, 5, '19.11.2026'), e('Geschwindigkeitsüberschreitung', 1500, 0, '02.11.2026')],
        'P-1060': [],
        'P-1077': [e('Banküberfall', 15000, 40, '19.11.2026'), e('Illegaler Waffenbesitz', 10000, 20, '28.10.2026')],
        'P-1082': [e('Geschwindigkeitsüberschreitung', 1500, 0, '18.11.2026')]
      },
      shift: { state: 'off', start: 0, pausedAt: 0, pausedMs: 0 },
      shifts: []
    };
  }

  // ---------- Speicher ----------
  var data;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (err) { data = null; }
  if (!data || !Array.isArray(data.people)) data = demoData();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (err) { /* privater Modus o. ä. */ }
  }

  var ui = { q: '', selId: data.people[0] ? data.people[0].id : null, checked: {}, saved: false };

  // ---------- Helfer ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60);
  }
  function fmtH(ms) { var m = Math.floor(Math.max(0, ms) / 60000); return Math.floor(m / 60) + ':' + pad(m % 60) + ' h'; }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function today() { var d = new Date(); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function euro(n) { return n.toLocaleString('de-DE') + ' €'; }
  function initials(n) {
    var s = n.replace(/^@/, '').split(/[\s_.]+/).filter(Boolean).map(function (w) { return w[0]; }).join('');
    return (s || '?').slice(0, 2).toUpperCase();
  }
  function strafeText(e) { return euro(e.geld) + (e.haft ? ' · ' + e.haft + ' Min. Haft' : ''); }
  function chipClass(status) {
    return { 'Fahndung': 'chip-amber', 'Pause': 'chip-amber', 'Bewährung': 'chip-blue', 'Sauber': 'chip-green', 'Im Dienst': 'chip-green' }[status] || '';
  }
  function officerLabel() {
    var o = data.officer || {};
    return [o.name, o.nr].filter(Boolean).join(' · ') || 'Unbekannt';
  }
  function findPerson(id) { return data.people.find(function (p) { return p.id === id; }) || null; }

  var ICON_WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  // ---------- Schicht ----------
  function runningMs() {
    var s = data.shift;
    if (s.state === 'off') return 0;
    var end = s.state === 'pause' ? s.pausedAt : Date.now();
    return end - s.start - s.pausedMs;
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeek() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var day = (d.getDay() + 6) % 7; // Montag = 0
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  function sumSince(ts) {
    return data.shifts.reduce(function (a, s) { return s.start >= ts ? a + s.ms : a; }, 0);
  }
  function dayLabel(ts) {
    if (ts >= startOfToday()) return 'Heute';
    if (ts >= startOfToday() - 864e5) return 'Gestern';
    var d = new Date(ts);
    return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
  }

  function renderShiftClock() {
    var s = data.shift;
    var run = runningMs();
    var label = s.state === 'on' ? 'Im Dienst' : s.state === 'pause' ? 'Pause' : 'Außer Dienst';
    var chip = $('shiftChip');
    chip.className = 'chip ' + chipClass(label);
    chip.innerHTML = '<span class="dot"></span>' + label;
    $('clock').textContent = fmtClock(run);
    $('clockSub').textContent = s.state === 'off' ? 'Keine aktive Schicht' : 'Seit ' + hhmm(s.start) + ' Uhr';
    var runToday = s.state !== 'off' && s.start >= startOfToday() ? run : 0;
    var runWeek = s.state !== 'off' && s.start >= startOfWeek() ? run : 0;
    $('todayTotal').textContent = fmtH(sumSince(startOfToday()) + runToday);
    $('weekTotal').textContent = fmtH(sumSince(startOfWeek()) + runWeek);
  }

  function renderShift() {
    var s = data.shift;
    $('shiftButtons').innerHTML = s.state === 'off'
      ? '<button type="button" class="btn btn-primary full" data-action="shift-start">Schicht starten</button>'
      : '<div class="grid2"><button type="button" class="btn btn-amber" data-action="shift-pause">' + (s.state === 'pause' ? 'Fortsetzen' : 'Pause') + '</button>' +
        '<button type="button" class="btn btn-red" data-action="shift-end">Beenden</button></div>';
    var list = data.shifts.slice(0, 5);
    $('shiftList').innerHTML = list.length ? list.map(function (sh) {
      return '<div class="shift-row"><span><span>' + dayLabel(sh.start) + '</span><span class="muted small mono">' + hhmm(sh.start) + ' – ' + hhmm(sh.end) + '</span></span>' +
        '<span class="mono">' + fmtH(sh.ms) + '</span></div>';
    }).join('') : '<span class="empty-note">Noch keine Schicht beendet.</span>';
    renderShiftClock();
  }

  // ---------- Suche ----------
  function parseQuery() {
    var raw = ui.q.trim().toLowerCase();
    var isAt = raw.charAt(0) === '@';
    var q = raw.replace(/^@+/, '');
    return { q: q, isAt: isAt };
  }

  function renderResults() {
    var pq = parseQuery();
    var q = pq.q;
    var list = data.people.filter(function (p) {
      if (!q) return true;
      if (p.roblox.toLowerCase().indexOf(q) !== -1) return true;
      if (pq.isAt) return false;
      return p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = list.length + (list.length === 1 ? ' Treffer' : ' Treffer');
    $('results').innerHTML = list.map(function (p) {
      var n = (data.akten[p.id] || []).length;
      return '<button type="button" class="person' + (p.id === ui.selId ? ' selected' : '') + '" data-action="select" data-id="' + esc(p.id) + '">' +
        '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
        '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + ' · ' + esc(p.id) + '</span></span>' +
        '<span class="person-count">' + n + ' Einträge</span>' +
        '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></button>';
    }).join('');

    var handle = /^[a-z0-9_.]{3,20}$/.test(q) ? q : '';
    var exact = data.people.some(function (p) { return p.roblox.toLowerCase() === q; });
    var create = $('create');
    if (handle && !exact) {
      if (!create.dataset.handle || create.dataset.handle !== handle) {
        create.dataset.handle = handle;
        create.innerHTML = '<div class="create-box">' +
          '<div><strong>@' + esc(handle) + '</strong> ist noch nicht erfasst<div class="muted" style="font-size:13px;margin-top:2px">Spieler jetzt in der Datenbank anlegen.</div></div>' +
          '<div class="create-row"><label class="field">RP-Name (optional)<input id="newName" type="text" placeholder="z. B. Max Becker" autocomplete="off"></label>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="create">Spieler erfassen</button></div></div>';
      }
    } else {
      create.dataset.handle = '';
      create.innerHTML = list.length ? '' : '<div class="placeholder">Keine Person gefunden.</div>';
    }
  }

  // ---------- Strafregister ----------
  function renderRecord() {
    var box = $('record');
    var p = findPerson(ui.selId);
    if (!p) {
      box.innerHTML = '<div class="placeholder">Person in der Suche auswählen, um das Strafregister zu öffnen.</div>';
      return;
    }
    var akte = data.akten[p.id] || [];
    var geld = akte.reduce(function (a, e) { return a + e.geld; }, 0);
    var haft = akte.reduce(function (a, e) { return a + e.haft; }, 0);
    var picked = KATALOG.filter(function (c) { return ui.checked[c.id]; });
    var sGeld = picked.reduce(function (a, c) { return a + c.geld; }, 0);
    var sHaft = picked.reduce(function (a, c) { return a + c.haft; }, 0);

    box.innerHTML =
      '<section class="card flush">' +
        (p.danger ? '<div class="alert" role="alert">' + ICON_WARN + 'Bewaffnet und gefährlich</div>' : '') +
        '<div class="record-body">' +
          '<div class="record-head"><span class="avatar">' + esc(initials(p.name)) + '</span>' +
            '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0"><h2>' + esc(p.name) + '</h2>' +
            '<span class="muted small mono">@' + esc(p.roblox) + ' · ' + esc(p.id) + '</span></div>' +
            '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px">Status ' +
              '<select class="status-select" data-action="status">' + STATUSES.map(function (s) {
                return '<option' + (s === p.status ? ' selected' : '') + '>' + s + '</option>';
              }).join('') + '</select></label>' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer">' +
              '<input type="checkbox" data-action="danger"' + (p.danger ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:#FF6B6B;margin:0"> Gefährlich</label>' +
          '</div>' +
          '<dl class="stats"><div><dt>Einträge</dt><dd>' + akte.length + '</dd></div>' +
            '<div><dt>Geldstrafen</dt><dd>' + euro(geld) + '</dd></div>' +
            '<div><dt>Haftzeit</dt><dd>' + haft + ' Min.</dd></div></dl>' +
          '<div class="entries"><h3>Strafregister</h3>' +
            (akte.length ? akte.map(function (e) {
              return '<div class="entry"><div class="entry-top"><strong>' + esc(e.delikt) + '</strong><span>' + esc(e.datum) + '</span></div>' +
                '<span class="strafe">' + esc(strafeText(e)) + '</span><span class="by">Beamter ' + esc(e.beamter) + '</span></div>';
            }).join('') : '<span class="clean">Keine Einträge – Person ist unbescholten.</span>') +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="card">' +
        '<h2>Strafe eintragen</h2>' +
        '<div class="catalog">' + KATALOG.map(function (c) {
          var on = !!ui.checked[c.id];
          return '<label class="charge' + (on ? ' on' : '') + '"><input type="checkbox" data-action="charge" data-id="' + c.id + '"' + (on ? ' checked' : '') + '>' +
            '<span class="name">' + esc(c.name) + '</span><span class="price">' + esc(strafeText(c)) + '</span></label>';
        }).join('') + '</div>' +
        '<div class="sum"><span class="muted" style="font-size:13px">Summe</span><span>' + (picked.length ? euro(sGeld) + ' · ' + sHaft + ' Min. Haft' : '–') + '</span></div>' +
        '<button type="button" class="btn btn-primary full" data-action="add"' + (picked.length ? '' : ' disabled') + '>Ins Strafregister eintragen</button>' +
        (ui.saved ? '<span class="saved" role="status">Eintrag gespeichert.</span>' : '') +
      '</section>';
  }

  function renderAll() { renderShift(); renderResults(); renderRecord(); }

  // ---------- Events ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    var s = data.shift;

    if (a === 'shift-start') {
      data.shift = { state: 'on', start: Date.now(), pausedAt: 0, pausedMs: 0 };
      save(); renderShift();
    } else if (a === 'shift-pause') {
      if (s.state === 'on') { s.state = 'pause'; s.pausedAt = Date.now(); }
      else if (s.state === 'pause') { s.pausedMs += Date.now() - s.pausedAt; s.state = 'on'; s.pausedAt = 0; }
      save(); renderShift();
    } else if (a === 'shift-end') {
      var ms = runningMs();
      data.shifts.unshift({ start: s.start, end: Date.now(), ms: ms });
      data.shifts = data.shifts.slice(0, 50);
      data.shift = { state: 'off', start: 0, pausedAt: 0, pausedMs: 0 };
      save(); renderShift();
    } else if (a === 'select') {
      ui.selId = el.dataset.id; ui.saved = false; ui.checked = {};
      renderResults(); renderRecord();
    } else if (a === 'create') {
      var handle = $('create').dataset.handle;
      if (!handle || data.people.some(function (p) { return p.roblox.toLowerCase() === handle; })) return;
      var name = ($('newName') && $('newName').value.trim()) || '@' + handle;
      var id = 'P-' + data.nextId++;
      data.people.unshift({ id: id, name: name.slice(0, 60), roblox: handle, status: 'Sauber', danger: false });
      data.akten[id] = [];
      ui.selId = id; ui.checked = {}; ui.saved = false;
      ui.q = '@' + handle; $('q').value = ui.q;
      save(); renderResults(); renderRecord();
    } else if (a === 'add') {
      var p = findPerson(ui.selId);
      var picked = KATALOG.filter(function (c) { return ui.checked[c.id]; });
      if (!p || !picked.length) return;
      var d = today();
      var by = officerLabel();
      var entries = picked.map(function (c) { return { delikt: c.name, geld: c.geld, haft: c.haft, datum: d, beamter: by }; });
      data.akten[p.id] = entries.concat(data.akten[p.id] || []);
      ui.checked = {}; ui.saved = true;
      save(); renderResults(); renderRecord();
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var a = el.dataset && el.dataset.action;
    var p = findPerson(ui.selId);
    if (a === 'charge') {
      ui.checked[el.dataset.id] = el.checked; ui.saved = false;
      renderRecord();
    } else if (a === 'status' && p) {
      p.status = el.value; save(); renderResults(); renderRecord();
    } else if (a === 'danger' && p) {
      p.danger = el.checked; save(); renderRecord();
    }
  });

  $('q').addEventListener('input', function (ev) { ui.q = ev.target.value; renderResults(); });
  $('q').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && $('create').dataset.handle) {
      var btn = $('create').querySelector('[data-action="create"]');
      if (btn) btn.click();
    }
  });

  var officerName = $('officerName');
  var officerNr = $('officerNr');
  officerName.value = (data.officer && data.officer.name) || '';
  officerNr.value = (data.officer && data.officer.nr) || '';
  function saveOfficer() { data.officer = { name: officerName.value.trim().slice(0, 40), nr: officerNr.value.trim().slice(0, 20) }; save(); }
  officerName.addEventListener('input', saveOfficer);
  officerNr.addEventListener('input', saveOfficer);

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Alle Einträge in diesem Browser löschen und Demo-Daten wiederherstellen?')) return;
    data = demoData();
    ui = { q: '', selId: data.people[0].id, checked: {}, saved: false };
    $('q').value = ''; officerName.value = ''; officerNr.value = '';
    save(); renderAll();
  });

  setInterval(function () { if (data.shift.state === 'on') renderShiftClock(); }, 1000);
  renderAll();
})();
