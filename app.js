/* POLIS: Strafregister der Polizei Berlin City Roleplay
   Online-Modus: geteilte Cloudflare-D1-Datenbank über /api (mit Dienstschlüssel).
   Lokaler Modus: Fallback ohne Server (z. B. GitHub Pages), Daten nur im localStorage. */
(function () {
  'use strict';

  var LOCAL_KEY = 'polis.v1';
  var KEY_STORE = 'polis.key';
  var PREFS_KEY = 'polis.prefs';

  // Strafgesetzbuch Berlin City Roleplay, Spannen als [min, max]
  var KATALOG = [
    { id: 'p1', group: 'Straftaten gegen das Leben & die Person', para: '§ 1', name: 'Körperverletzung', geld: [2000, 5000], haft: [10, 20] },
    { id: 'p2', group: 'Straftaten gegen das Leben & die Person', para: '§ 2', name: 'Versuchter / Vollendeter Totschlag / Mord', geld: [15000, 30000], haft: [30, 60] },
    { id: 'p3', group: 'Straftaten gegen das Leben & die Person', para: '§ 3', name: 'Geiselnahme / Entführung', geld: [10000, 20000], haft: [25, 45] },
    { id: 'p4', group: 'Straftaten gegen die Staatsgewalt', para: '§ 4', name: 'Widerstand gegen Vollstreckungsbeamte', geld: [3000, 7000], haft: [15, 25] },
    { id: 'p5', group: 'Straftaten gegen die Staatsgewalt', para: '§ 5', name: 'Amtsanmaßung', geld: [5000, 10000], haft: [15, 30] },
    { id: 'p6', group: 'Straftaten gegen die Staatsgewalt', para: '§ 6', name: 'Bestechung / Korruption', geld: [8000, 15000], haft: [20, 35] },
    { id: 'p7', group: 'Eigentums- & Vermögensdelikte', para: '§ 7', name: 'Diebstahl & Raub', geld: [4000, 10000], haft: [15, 30] },
    { id: 'p8', group: 'Eigentums- & Vermögensdelikte', para: '§ 8', name: 'Laden- & Bankraub', geld: [12000, 25000], haft: [30, 50] },
    { id: 'p9', group: 'Betäubungsmittel & Waffen', para: '§ 9', name: 'Drogenbesitz & -handel', geld: [3000, 12000], haft: [10, 30] },
    { id: 'p10', group: 'Betäubungsmittel & Waffen', para: '§ 10', name: 'Verstoß gegen das Waffengesetz', geld: [6000, 15000], haft: [20, 40] }
  ];
  function rangeText(c) {
    return euro(c.geld[0]) + ' bis ' + euro(c.geld[1]) + ', ' + c.haft[0] + ' bis ' + c.haft[1] + ' Min. Haft';
  }
  function clampInt(v, r) { v = Math.round(Number(v)); if (!isFinite(v)) v = r[0]; return Math.min(r[1], Math.max(r[0], v)); }
  function pickedCharges() {
    return KATALOG.filter(function (c) { return ui.checked[c.id]; }).map(function (c) {
      var v = ui.checked[c.id];
      return { c: c, geld: v.geld, haft: v.haft };
    });
  }
  var STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];

  // ---------- Helfer ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function euro(n) { return Number(n).toLocaleString('de-DE') + ' €'; }
  function initials(n) {
    var s = String(n).replace(/^@/, '').split(/[\s_.]+/).filter(Boolean).map(function (w) { return w[0]; }).join('');
    return (s || '?').slice(0, 2).toUpperCase();
  }
  function strafeText(e) { return euro(e.geld) + (e.haft ? ', ' + e.haft + ' Min. Haft' : ''); }
  function chipClass(status) {
    return { 'Fahndung': 'chip-amber', 'Bewährung': 'chip-blue', 'Sauber': 'chip-green' }[status] || '';
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignorieren */ } }
  function avatarHtml(p) {
    if (p.robloxId) {
      return '<img src="/api/avatar/' + encodeURIComponent(p.robloxId) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + esc(initials(p.name)) + '\'))">';
    }
    return esc(initials(p.name));
  }

  // ---------- Name und Dienstnummer (nur in diesem Browser) ----------
  var prefs = lsGet(PREFS_KEY) || {};
  var legacy = lsGet(LOCAL_KEY);
  if (!prefs.officer) prefs.officer = (legacy && legacy.officer) || { name: '', nr: '' };
  delete prefs.shift; delete prefs.shifts;
  function savePrefs() { lsSet(PREFS_KEY, prefs); }
  function officerLabel() {
    var o = prefs.officer || {};
    if (o.name && o.nr) return o.name + ' (' + o.nr + ')';
    return o.name || o.nr || 'Unbekannt';
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
        'P-1042': [e('§ 7 Diebstahl & Raub', 8000, 25, '18.11.2026'), e('§ 4 Widerstand gegen Vollstreckungsbeamte', 4000, 15, '03.10.2026')],
        'P-1051': [e('§ 9 Drogenbesitz & -handel', 3000, 10, '19.11.2026')],
        'P-1077': [e('§ 8 Laden- & Bankraub', 20000, 40, '19.11.2026'), e('§ 10 Verstoß gegen das Waffengesetz', 10000, 25, '28.10.2026')],
        'P-1082': [e('§ 1 Körperverletzung', 2000, 10, '18.11.2026')]
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

  // ---------- Suche ----------
  function parseQuery() {
    var raw = ui.q.trim().toLowerCase();
    return { q: raw.replace(/^@+/, ''), isAt: raw.charAt(0) === '@' };
  }
  function renderResults() {
    var pq = parseQuery(), q = pq.q;
    if (ui.loading) {
      $('count').textContent = 'Wird geladen';
      $('results').innerHTML = '';
      return;
    }
    var list = people.filter(function (p) {
      if (!q) return true;
      if (p.roblox.toLowerCase().indexOf(q) !== -1) return true;
      if (pq.isAt) return false;
      return p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = list.length + ' Treffer' + (ui.error ? '. ' + ui.error : '');
    $('results').innerHTML = list.map(function (p) {
      return '<button type="button" class="person' + (p.id === ui.selId ? ' selected' : '') + '" data-action="select" data-id="' + esc(p.id) + '">' +
        '<span class="avatar">' + avatarHtml(p) + '</span>' +
        '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + '  ' + esc(p.id) + '</span></span>' +
        '<span class="person-count">' + (p.count || 0) + (p.count === 1 ? ' Eintrag' : ' Einträge') + '</span>' +
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
          '<div><strong>@' + esc(handle) + '</strong> ist nicht im Register.</div>' +
          '<div class="create-row"><label class="field">RP-Name (optional)<input id="newName" type="text" placeholder="z. B. Max Becker" autocomplete="off" value="' + esc(prevName) + '"></label>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="create"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Bitte warten' : 'Anlegen') + '</button></div>' +
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
      box.innerHTML = '<div class="placeholder">' + (ui.loading ? 'Wird geladen' : 'Keine Person ausgewählt.') + '</div>';
      return;
    }
    var akte = akten[p.id];
    var loaded = Array.isArray(akte);
    akte = akte || [];
    var geld = akte.reduce(function (a, e) { return a + e.geld; }, 0);
    var haft = akte.reduce(function (a, e) { return a + e.haft; }, 0);
    var picked = pickedCharges();
    var sGeld = picked.reduce(function (a, x) { return a + x.geld; }, 0);
    var sHaft = picked.reduce(function (a, x) { return a + x.haft; }, 0);
    var lastGroup = '';
    var catalogHtml = KATALOG.map(function (c) {
      var v = ui.checked[c.id];
      var head = '';
      if (c.group !== lastGroup) { lastGroup = c.group; head = '<h4 class="cat-group">' + esc(c.group) + '</h4>'; }
      return head + '<div class="charge-wrap' + (v ? ' on' : '') + '">' +
        '<label class="charge"><input type="checkbox" data-action="charge" data-id="' + c.id + '"' + (v ? ' checked' : '') + '>' +
        '<span class="name"><span class="para">' + esc(c.para) + '</span> ' + esc(c.name) + '</span>' +
        '<span class="price">' + esc(rangeText(c)) + '</span></label>' +
        (v ? '<div class="amounts">' +
          '<label>Geldstrafe (€)<input type="number" inputmode="numeric" data-action="amt" data-field="geld" data-id="' + c.id + '" min="' + c.geld[0] + '" max="' + c.geld[1] + '" step="500" value="' + v.geld + '"></label>' +
          '<label>Haft (Min.)<input type="number" inputmode="numeric" data-action="amt" data-field="haft" data-id="' + c.id + '" min="' + c.haft[0] + '" max="' + c.haft[1] + '" step="1" value="' + v.haft + '"></label>' +
        '</div>' : '') +
      '</div>';
    }).join('');

    box.innerHTML =
      '<section class="card flush">' +
        (p.danger ? '<div class="alert" role="alert">GEFÄHRLICH</div>' : '') +
        '<div class="record-body">' +
          '<div class="record-head"><span class="avatar">' + avatarHtml(p) + '</span>' +
            '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0"><h2>' + esc(p.name) + '</h2>' +
            '<span class="muted small mono">@' + esc(p.roblox) + '  ' + esc(p.id) + '</span></div>' +
            '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px">Status ' +
              '<select class="status-select" data-action="status">' + STATUSES.map(function (s) {
                return '<option' + (s === p.status ? ' selected' : '') + '>' + s + '</option>';
              }).join('') + '</select></label>' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer">' +
              '<input type="checkbox" data-action="danger"' + (p.danger ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:#FF6B6B;margin:0"> Gefährlich</label>' +
          '</div>' +
          (loaded && akte.length ? '<p class="totals-line">Gesamt: ' + euro(geld) + ', ' + haft + ' Min. Haft</p>' : '') +
          '<div class="entries"><h3>Strafregister</h3>' +
            (!loaded ? '<span class="empty-note">Wird geladen</span>' : akte.length ? akte.map(function (e) {
              return '<div class="entry"><div class="entry-top"><strong>' + esc(e.delikt) + '</strong><span>' + esc(e.datum) + '</span></div>' +
                '<span class="strafe">' + esc(strafeText(e)) + '</span><span class="by">Beamter ' + esc(e.beamter || 'Unbekannt') + '</span></div>';
            }).join('') : '<span class="empty-note">Keine Einträge.</span>') +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="card">' +
        '<h2>Strafe eintragen</h2>' +
        '<div class="catalog">' + catalogHtml + '</div>' +
        '<p class="hint">Das Strafmaß liegt im Ermessen der zuständigen Beamten und kann bei Einsicht angepasst werden.</p>' +
        '<div class="sum"><span class="muted" style="font-size:13px">Summe</span><span>' + (picked.length ? euro(sGeld) + ', ' + sHaft + ' Min. Haft' : '0 €') + '</span></div>' +
        '<button type="button" class="btn btn-primary full" data-action="add"' + (picked.length && !ui.busy ? '' : ' disabled') + '>' + (ui.busy ? 'Bitte warten' : 'Eintragen') + '</button>' +
        (ui.saved ? '<span class="saved" role="status">Gespeichert.</span>' : '') +
        (ui.error ? '<span class="error-msg" role="alert">' + esc(ui.error) + '</span>' : '') +
      '</section>';
  }

  // ---------- Modus / Login ----------
  function renderMode() {
    var note = $('modeNote');
    note.hidden = mode === 'server';
    note.textContent = 'Lokaler Modus';
    $('resetBtn').hidden = mode === 'server';
    $('logoutBtn').hidden = mode !== 'server';
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
    $('gateError').textContent = '';
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

    if (a === 'select') {
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
      var picked = pickedCharges();
      if (!p || !picked.length || ui.busy) return;
      ui.busy = true; ui.error = ''; renderRecord();
      store.addEntries(p.id, picked.map(function (x) {
        return { delikt: x.c.para + ' ' + x.c.name, geld: clampInt(x.geld, x.c.geld), haft: clampInt(x.haft, x.c.haft) };
      }))
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
      var c = KATALOG.find(function (k) { return k.id === el.dataset.id; });
      if (el.checked && c) ui.checked[c.id] = { geld: c.geld[0], haft: c.haft[0] };
      else delete ui.checked[el.dataset.id];
      ui.saved = false; renderRecord();
    } else if (a === 'amt') {
      var k = KATALOG.find(function (x) { return x.id === el.dataset.id; });
      var cur = ui.checked[el.dataset.id];
      if (k && cur) {
        cur[el.dataset.field] = clampInt(el.value, k[el.dataset.field]);
        ui.saved = false; renderRecord();
      }
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

  // Andere Beamte sehen Änderungen nach spätestens 20 Sekunden
  setInterval(function () {
    if (mode === 'server' && !document.hidden && $('gate').hidden) {
      refreshPeople(); if (ui.selId) loadAkte(ui.selId, true);
    }
  }, 20000);

  // ---------- Start ----------
  savePrefs();
  renderResults(); renderRecord();
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
          ui.error = !h.db ? 'Datenbank nicht verbunden.' : 'Dienstschlüssel auf dem Server fehlt.';
          renderResults();
        }
      }
    });
})();
