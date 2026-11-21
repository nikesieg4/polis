/* POLIS – Polizei-Datenbank für Berlin City Roleplay
   Online-Modus: geteilte Cloudflare-D1-Datenbank über /api (mit Dienstschlüssel).
   Lokaler Modus: Fallback ohne Server (z. B. GitHub Pages), Daten nur im localStorage. */
(function () {
  'use strict';

  var LOCAL_KEY = 'polis.v1';
  var KEY_STORE = 'polis.key';
  var PREFS_KEY = 'polis.prefs';

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
  function euro(n) { return Number(n).toLocaleString('de-DE') + ' €'; }
  function initials(n) {
    var s = String(n).replace(/^@/, '').split(/[\s_.]+/).filter(Boolean).map(function (w) { return w[0]; }).join('');
    return (s || '?').slice(0, 2).toUpperCase();
  }
  function strafeText(e) { return euro(e.geld) + (e.haft ? ' · ' + e.haft + ' Min. Haft' : ''); }
  function chipClass(status) {
    return { 'Fahndung': 'chip-amber', 'Pause': 'chip-amber', 'Bewährung': 'chip-blue', 'Sauber': 'chip-green', 'Im Dienst': 'chip-green' }[status] || '';
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignorieren */ } }
  function avatarHtml(p) {
    if (p.robloxId) {
      return '<img src="/api/avatar/' + encodeURIComponent(p.robloxId) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + esc(initials(p.name)) + '\'))">';
    }
    return esc(initials(p.name));
  }

  var ICON_WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  // ---------- Persönliche Einstellungen (Name, Schichten) – immer lokal ----------
  var prefs = lsGet(PREFS_KEY) || {};
  var legacy = lsGet(LOCAL_KEY);
  if (!prefs.shift) {
    prefs.officer = (legacy && legacy.officer) || { name: '', nr: '' };
    prefs.shift = (legacy && legacy.shift) || { state: 'off', start: 0, pausedAt: 0, pausedMs: 0 };
    prefs.shifts = (legacy && legacy.shifts) || [];
  }
  function savePrefs() { lsSet(PREFS_KEY, prefs); }
  function officerLabel() {
    var o = prefs.officer || {};
    return [o.name, o.nr].filter(Boolean).join(' · ') || 'Unbekannt';
  }

  // ---------- Lokaler Speicher (Fallback) ----------
  function demoData() {
    function e(delikt, geld, haft, datum) { return { delikt: delikt, geld: geld, haft: haft, datum: datum, beamter: 'Demo' }; }
    return {
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
        'P-1051': [e('Fahren ohne Fahrerlaubnis', 3000, 5, '19.11.2026'), e('Geschwindigkeitsüberschreitung', 1500, 0, '02.11.2026')],
        'P-1077': [e('Banküberfall', 15000, 40, '19.11.2026'), e('Illegaler Waffenbesitz', 10000, 20, '28.10.2026')],
        'P-1082': [e('Geschwindigkeitsüberschreitung', 1500, 0, '18.11.2026')]
      }
    };
  }
  var local = (legacy && Array.isArray(legacy.people)) ? legacy : demoData();
  function saveLocal() { lsSet(LOCAL_KEY, local); }

  var LocalStore = {
    list: function () {
      return Promise.resolve(local.people.map(function (p) {
        return Object.assign({}, p, { count: (local.akten[p.id] || []).length });
      }));
    },
    akte: function (id) { return Promise.resolve((local.akten[id] || []).slice()); },
    create: function (handle, name) {
      var id = 'P-' + local.nextId++;
      var p = { id: id, name: name || '@' + handle, roblox: handle, status: 'Sauber', danger: false };
      local.people.unshift(p); local.akten[id] = []; saveLocal();
      return Promise.resolve(Object.assign({ count: 0 }, p));
    },
    update: function (id, patch) {
      var p = local.people.find(function (x) { return x.id === id; });
      if (p) { Object.assign(p, patch); saveLocal(); }
      return Promise.resolve(p);
    },
    addEntries: function (id, entries) {
      var d = today(), by = officerLabel();
      var rows = entries.map(function (c) { return { delikt: c.delikt, geld: c.geld, haft: c.haft, datum: d, beamter: by }; });
      local.akten[id] = rows.concat(local.akten[id] || []); saveLocal();
      return Promise.resolve();
    }
  };

  // ---------- Server (Cloudflare D1) ----------
  var key = lsGet(KEY_STORE) || '';
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'x-polis-key': key };
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch('/api/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401) { showGate('Dienstschlüssel ungültig. Bitte neu anmelden.'); }
          if (!r.ok) { var err = new Error(d.error || ('Fehler ' + r.status)); err.status = r.status; throw err; }
          return d;
        });
      });
  }
  var ServerStore = {
    list: function () { return api('people').then(function (d) { return d.people; }); },
    akte: function (id) { return api('people/' + encodeURIComponent(id) + '/akte').then(function (d) { return d.akte; }); },
    create: function (handle, name) {
      return api('people', { method: 'POST', body: { roblox: handle, name: name, beamter: officerLabel() } }).then(function (d) { return d.person; });
    },
    update: function (id, patch) {
      return api('people/' + encodeURIComponent(id), { method: 'PATCH', body: patch }).then(function (d) { return d.person; });
    },
    addEntries: function (id, entries) {
      return api('people/' + encodeURIComponent(id) + '/akte', { method: 'POST', body: { entries: entries, beamter: officerLabel(), datum: today() } });
    }
  };

  // ---------- Zustand ----------
  var mode = null; // 'server' | 'local'
  var store = LocalStore;
  var people = [];
  var akten = {};          // id -> Array (geladen) | undefined
  var ui = { q: '', selId: null, checked: {}, saved: false, busy: false, error: '', createError: '', loading: true };

  function findPerson(id) { return people.find(function (p) { return p.id === id; }) || null; }

  function refreshPeople() {
    return store.list().then(function (list) {
      people = list;
      ui.loading = false;
      if (!ui.selId && people[0]) ui.selId = people[0].id;
      renderResults(); renderRecord();
    }).catch(function (e) { ui.loading = false; ui.error = e.message; renderResults(); });
  }
  function loadAkte(id, force) {
    if (!id || (akten[id] && !force)) return Promise.resolve();
    return store.akte(id).then(function (a) { akten[id] = a; if (id === ui.selId) renderRecord(); })
      .catch(function (e) { ui.error = e.message; renderRecord(); });
  }

  // ---------- Schicht ----------
  function runningMs() {
    var s = prefs.shift;
    if (s.state === 'off') return 0;
    var end = s.state === 'pause' ? s.pausedAt : Date.now();
    return end - s.start - s.pausedMs;
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeek() { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
  function sumSince(ts) { return prefs.shifts.reduce(function (a, s) { return s.start >= ts ? a + s.ms : a; }, 0); }
  function dayLabel(ts) {
    if (ts >= startOfToday()) return 'Heute';
    if (ts >= startOfToday() - 864e5) return 'Gestern';
    var d = new Date(ts);
    return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
  }
  function renderShiftClock() {
    var s = prefs.shift, run = runningMs();
    var label = s.state === 'on' ? 'Im Dienst' : s.state === 'pause' ? 'Pause' : 'Außer Dienst';
    var chip = $('shiftChip');
    chip.className = 'chip ' + chipClass(label);
    chip.innerHTML = '<span class="dot"></span>' + label;
    $('clock').textContent = fmtClock(run);
    $('clockSub').textContent = s.state === 'off' ? 'Keine aktive Schicht' : 'Seit ' + hhmm(s.start) + ' Uhr';
    $('todayTotal').textContent = fmtH(sumSince(startOfToday()) + (s.state !== 'off' && s.start >= startOfToday() ? run : 0));
    $('weekTotal').textContent = fmtH(sumSince(startOfWeek()) + (s.state !== 'off' && s.start >= startOfWeek() ? run : 0));
  }
  function renderShift() {
    var s = prefs.shift;
    $('shiftButtons').innerHTML = s.state === 'off'
      ? '<button type="button" class="btn btn-primary full" data-action="shift-start">Schicht starten</button>'
      : '<div class="grid2"><button type="button" class="btn btn-amber" data-action="shift-pause">' + (s.state === 'pause' ? 'Fortsetzen' : 'Pause') + '</button>' +
        '<button type="button" class="btn btn-red" data-action="shift-end">Beenden</button></div>';
    var list = prefs.shifts.slice(0, 5);
    $('shiftList').innerHTML = list.length ? list.map(function (sh) {
      return '<div class="shift-row"><span><span>' + dayLabel(sh.start) + '</span><span class="muted small mono">' + hhmm(sh.start) + ' – ' + hhmm(sh.end) + '</span></span>' +
        '<span class="mono">' + fmtH(sh.ms) + '</span></div>';
    }).join('') : '<span class="empty-note">Noch keine Schicht beendet.</span>';
    renderShiftClock();
  }

  // ---------- Suche ----------
  function parseQuery() {
    var raw = ui.q.trim().toLowerCase();
    return { q: raw.replace(/^@+/, ''), isAt: raw.charAt(0) === '@' };
  }
  function renderResults() {
    var pq = parseQuery(), q = pq.q;
    if (ui.loading) {
      $('count').textContent = 'Lade Datenbank …';
      $('results').innerHTML = '';
      return;
    }
    var list = people.filter(function (p) {
      if (!q) return true;
      if (p.roblox.toLowerCase().indexOf(q) !== -1) return true;
      if (pq.isAt) return false;
      return p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = list.length + ' Treffer' + (ui.error ? ' · ' + ui.error : '');
    $('results').innerHTML = list.map(function (p) {
      return '<button type="button" class="person' + (p.id === ui.selId ? ' selected' : '') + '" data-action="select" data-id="' + esc(p.id) + '">' +
        '<span class="avatar">' + avatarHtml(p) + '</span>' +
        '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + ' · ' + esc(p.id) + '</span></span>' +
        '<span class="person-count">' + (p.count || 0) + ' Einträge</span>' +
        '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></button>';
    }).join('');

    var handle = /^[a-z0-9_.]{3,20}$/.test(q) ? q : '';
    var exact = people.some(function (p) { return p.roblox.toLowerCase() === q; });
    var create = $('create');
    if (handle && !exact) {
      if (create.dataset.handle !== handle || create.dataset.err !== ui.createError || create.dataset.busy !== String(ui.busy)) {
        var prevName = $('newName') ? $('newName').value : '';
        create.dataset.handle = handle; create.dataset.err = ui.createError; create.dataset.busy = String(ui.busy);
        create.innerHTML = '<div class="create-box">' +
          '<div><strong>@' + esc(handle) + '</strong> ist noch nicht erfasst<div class="muted" style="font-size:13px;margin-top:2px">' +
          (mode === 'server' ? 'Der Account wird bei Roblox geprüft und dann angelegt.' : 'Spieler jetzt in der Datenbank anlegen.') + '</div></div>' +
          '<div class="create-row"><label class="field">RP-Name (optional)<input id="newName" type="text" placeholder="z. B. Max Becker" autocomplete="off" value="' + esc(prevName) + '"></label>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="create"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Prüfe …' : 'Spieler erfassen') + '</button></div>' +
          (ui.createError ? '<span class="error-msg" role="alert">' + esc(ui.createError) + '</span>' : '') + '</div>';
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
      box.innerHTML = '<div class="placeholder">' + (ui.loading ? 'Lade …' : 'Person in der Suche auswählen, um das Strafregister zu öffnen.') + '</div>';
      return;
    }
    var akte = akten[p.id];
    var loaded = Array.isArray(akte);
    akte = akte || [];
    var geld = akte.reduce(function (a, e) { return a + e.geld; }, 0);
    var haft = akte.reduce(function (a, e) { return a + e.haft; }, 0);
    var picked = KATALOG.filter(function (c) { return ui.checked[c.id]; });
    var sGeld = picked.reduce(function (a, c) { return a + c.geld; }, 0);
    var sHaft = picked.reduce(function (a, c) { return a + c.haft; }, 0);

    box.innerHTML =
      '<section class="card flush">' +
        (p.danger ? '<div class="alert" role="alert">' + ICON_WARN + 'Bewaffnet und gefährlich</div>' : '') +
        '<div class="record-body">' +
          '<div class="record-head"><span class="avatar">' + avatarHtml(p) + '</span>' +
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
          '<dl class="stats"><div><dt>Einträge</dt><dd>' + (loaded ? akte.length : (p.count || 0)) + '</dd></div>' +
            '<div><dt>Geldstrafen</dt><dd>' + (loaded ? euro(geld) : '…') + '</dd></div>' +
            '<div><dt>Haftzeit</dt><dd>' + (loaded ? haft + ' Min.' : '…') + '</dd></div></dl>' +
          '<div class="entries"><h3>Strafregister</h3>' +
            (!loaded ? '<span class="empty-note">Lade Strafregister …</span>' : akte.length ? akte.map(function (e) {
              return '<div class="entry"><div class="entry-top"><strong>' + esc(e.delikt) + '</strong><span>' + esc(e.datum) + '</span></div>' +
                '<span class="strafe">' + esc(strafeText(e)) + '</span><span class="by">Beamter ' + esc(e.beamter || 'Unbekannt') + '</span></div>';
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
        '<button type="button" class="btn btn-primary full" data-action="add"' + (picked.length && !ui.busy ? '' : ' disabled') + '>' + (ui.busy ? 'Speichere …' : 'Ins Strafregister eintragen') + '</button>' +
        (ui.saved ? '<span class="saved" role="status">Eintrag gespeichert.</span>' : '') +
        (ui.error ? '<span class="error-msg" role="alert">' + esc(ui.error) + '</span>' : '') +
      '</section>';
  }

  // ---------- Modus / Login ----------
  function renderMode() {
    var chip = $('modeChip');
    if (mode === 'server') {
      chip.className = 'chip chip-green'; chip.innerHTML = '<span class="dot"></span>Online · geteilte Datenbank';
      $('footerNote').textContent = 'Inoffizielles Roleplay-Tool · keine echten Daten · Strafregister in der geteilten Datenbank, Schichtzeit nur in diesem Browser';
      $('resetBtn').hidden = true; $('logoutBtn').hidden = false;
    } else {
      chip.className = 'chip chip-amber'; chip.innerHTML = '<span class="dot"></span>Lokal · nur dieser Browser';
      $('footerNote').textContent = 'Inoffizielles Roleplay-Tool · keine echten Daten · Daten werden nur in diesem Browser gespeichert';
      $('resetBtn').hidden = false; $('logoutBtn').hidden = true;
    }
  }
  function showGate(msg) {
    $('gate').hidden = false;
    $('gateError').textContent = msg || '';
    setTimeout(function () { $('gateKey').focus(); }, 0);
  }
  function enterServer() {
    mode = 'server'; store = ServerStore; people = []; akten = {}; ui.loading = true; ui.selId = null;
    renderMode(); renderResults(); renderRecord();
    refreshPeople().then(function () { loadAkte(ui.selId); });
  }
  function enterLocal() {
    mode = 'local'; store = LocalStore; ui.loading = true;
    renderMode();
    refreshPeople().then(function () { loadAkte(ui.selId); });
  }

  $('gateForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    key = $('gateKey').value.trim();
    $('gateError').textContent = 'Prüfe …';
    api('auth').then(function () {
      lsSet(KEY_STORE, key);
      $('gate').hidden = true; $('gateKey').value = '';
      enterServer();
    }).catch(function (e) { $('gateError').textContent = e.message; });
  });
  $('logoutBtn').addEventListener('click', function () {
    key = ''; lsSet(KEY_STORE, '');
    showGate('');
  });

  // ---------- Events ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    var s = prefs.shift;

    if (a === 'shift-start') {
      prefs.shift = { state: 'on', start: Date.now(), pausedAt: 0, pausedMs: 0 }; savePrefs(); renderShift();
    } else if (a === 'shift-pause') {
      if (s.state === 'on') { s.state = 'pause'; s.pausedAt = Date.now(); }
      else if (s.state === 'pause') { s.pausedMs += Date.now() - s.pausedAt; s.state = 'on'; s.pausedAt = 0; }
      savePrefs(); renderShift();
    } else if (a === 'shift-end') {
      prefs.shifts.unshift({ start: s.start, end: Date.now(), ms: runningMs() });
      prefs.shifts = prefs.shifts.slice(0, 50);
      prefs.shift = { state: 'off', start: 0, pausedAt: 0, pausedMs: 0 };
      savePrefs(); renderShift();
    } else if (a === 'select') {
      ui.selId = el.dataset.id; ui.saved = false; ui.checked = {}; ui.error = '';
      renderResults(); renderRecord(); loadAkte(ui.selId, mode === 'server');
    } else if (a === 'create') {
      var handle = $('create').dataset.handle;
      if (!handle || ui.busy) return;
      var name = ($('newName') && $('newName').value.trim().slice(0, 60)) || '';
      ui.busy = true; ui.createError = ''; renderResults();
      store.create(handle, name).then(function (p) {
        ui.busy = false;
        if (!findPerson(p.id)) people.unshift(p);
        akten[p.id] = akten[p.id] || [];
        ui.selId = p.id; ui.checked = {}; ui.saved = false;
        ui.q = '@' + p.roblox; $('q').value = ui.q;
        renderResults(); renderRecord();
        if (mode === 'server') loadAkte(p.id, true);
      }).catch(function (e) { ui.busy = false; ui.createError = e.message; renderResults(); });
    } else if (a === 'add') {
      var p = findPerson(ui.selId);
      var picked = KATALOG.filter(function (c) { return ui.checked[c.id]; });
      if (!p || !picked.length || ui.busy) return;
      ui.busy = true; ui.error = ''; renderRecord();
      store.addEntries(p.id, picked.map(function (c) { return { delikt: c.name, geld: c.geld, haft: c.haft }; }))
        .then(function () {
          ui.busy = false; ui.checked = {}; ui.saved = true;
          return loadAkte(p.id, true).then(function () {
            p.count = (akten[p.id] || []).length;
            renderResults(); renderRecord();
          });
        })
        .catch(function (e) { ui.busy = false; ui.error = e.message; renderRecord(); });
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var a = el.dataset && el.dataset.action;
    var p = findPerson(ui.selId);
    if (a === 'charge') {
      ui.checked[el.dataset.id] = el.checked; ui.saved = false; renderRecord();
    } else if ((a === 'status' || a === 'danger') && p) {
      var patch = a === 'status' ? { status: el.value } : { danger: el.checked };
      var before = { status: p.status, danger: p.danger };
      Object.assign(p, patch); renderResults(); renderRecord();
      store.update(p.id, patch).catch(function (e) {
        Object.assign(p, before); ui.error = e.message; renderResults(); renderRecord();
      });
    }
  });

  $('q').addEventListener('input', function (ev) { ui.q = ev.target.value; ui.createError = ''; renderResults(); });
  $('q').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      var btn = $('create').querySelector('[data-action="create"]');
      if (btn) btn.click();
    }
  });

  var officerName = $('officerName'), officerNr = $('officerNr');
  officerName.value = (prefs.officer && prefs.officer.name) || '';
  officerNr.value = (prefs.officer && prefs.officer.nr) || '';
  function saveOfficer() { prefs.officer = { name: officerName.value.trim().slice(0, 40), nr: officerNr.value.trim().slice(0, 20) }; savePrefs(); }
  officerName.addEventListener('input', saveOfficer);
  officerNr.addEventListener('input', saveOfficer);

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Alle lokalen Einträge in diesem Browser löschen und Demo-Daten wiederherstellen?')) return;
    local = demoData(); saveLocal(); akten = {}; ui.selId = null; ui.q = ''; $('q').value = '';
    enterLocal();
  });

  setInterval(function () { if (prefs.shift.state === 'on') renderShiftClock(); }, 1000);
  // Andere Beamte sehen Änderungen nach spätestens 20 Sekunden
  setInterval(function () {
    if (mode === 'server' && !document.hidden && $('gate').hidden) {
      refreshPeople(); if (ui.selId) loadAkte(ui.selId, true);
    }
  }, 20000);

  // ---------- Start ----------
  savePrefs();
  renderShift(); renderResults(); renderRecord();
  fetch('/api/health', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (h) {
      if (h && h.ok && h.db && h.keySet) {
        renderMode();
        mode = 'server';
        renderMode();
        if (!key) { showGate(''); return; }
        api('auth').then(enterServer).catch(function (e) { if (e.status !== 401) showGate(e.message); });
      } else {
        enterLocal();
        if (h && h.ok) {
          ui.error = !h.db ? 'Server erreichbar, aber D1-Datenbank nicht verbunden – lokaler Modus.' : 'Dienstschlüssel auf dem Server nicht eingerichtet – lokaler Modus.';
          renderResults();
        }
      }
    });
})();
