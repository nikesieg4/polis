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
  var STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];
  var TEAMTAG = '@Präsidium-Team';

  // ---------- Helfer ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dateTime(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' Uhr';
  }
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
  function migrateLocal() {
    local.nextEntry = local.nextEntry || 1;
    local.haftbefehle = local.haftbefehle || [];
    local.nextHb = local.nextHb || 1;
    Object.keys(local.akten).forEach(function (pid) {
      local.akten[pid].forEach(function (e) {
        if (!e.id) e.id = local.nextEntry++;
        if (e.erledigt == null) e.erledigt = 1; // alte Einträge gelten als erledigt
      });
    });
  }
  migrateLocal();
  function saveLocal() { lsSet(LOCAL_KEY, local); }
  function localEntry(pid, eid) {
    return (local.akten[pid] || []).find(function (e) { return e.id === eid; });
  }

  var LocalStore = {
    list: function () {
      return Promise.resolve(local.people.map(function (p) {
        var a = local.akten[p.id] || [];
        var hb = local.haftbefehle.filter(function (h) { return h.personId === p.id && h.status === 'offen'; }).length;
        return Object.assign({}, p, { count: a.length, offen: a.filter(function (e) { return !e.erledigt; }).length, haftbefehle: hb });
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
      var rows = entries.map(function (x) {
        var c = KATALOG.find(function (k) { return k.para === x.para; });
        return { id: local.nextEntry++, delikt: c.para + ' ' + c.name, geld: c.geld[0], haft: c.haft[0], datum: d, beamter: by, erledigt: 0 };
      });
      local.akten[id] = rows.concat(local.akten[id] || []); saveLocal();
      return Promise.resolve();
    },
    setDone: function (id, eid, done) {
      var e = localEntry(id, eid); if (e) { e.erledigt = done ? 1 : 0; saveLocal(); }
      return Promise.resolve();
    },
    allDone: function (id) {
      (local.akten[id] || []).forEach(function (e) { e.erledigt = 1; }); saveLocal();
      return Promise.resolve();
    },
    remove: function (id, eid) {
      local.akten[id] = (local.akten[id] || []).filter(function (e) { return e.id !== eid || e.erledigt; }); saveLocal();
      return Promise.resolve();
    },
    hbWithPerson: function (h) {
      var p = local.people.find(function (x) { return x.id === h.personId; }) || {};
      return Object.assign({}, h, { name: p.name, roblox: p.roblox, robloxId: p.robloxId });
    },
    hbOpen: function () {
      return Promise.resolve(local.haftbefehle.filter(function (h) { return h.status === 'offen'; }).map(LocalStore.hbWithPerson));
    },
    hbForPerson: function (id) {
      return Promise.resolve(local.haftbefehle.filter(function (h) { return h.personId === id; }).map(LocalStore.hbWithPerson));
    },
    hbCreate: function (id, d) {
      var h = { id: local.nextHb++, personId: id, kennzeichen: d.kennzeichen, modell: d.modell, grund: d.grund, beweise: d.beweise,
        ausgestelltVon: d.beamter, createdAt: Date.now(), status: 'offen', closedAt: null, closedBy: '' };
      local.haftbefehle.unshift(h); saveLocal();
      return Promise.resolve(LocalStore.hbWithPerson(h));
    },
    hbSet: function (hid, status) {
      var h = local.haftbefehle.find(function (x) { return x.id === hid; });
      if (h) { h.status = status; h.closedAt = status === 'offen' ? null : Date.now(); h.closedBy = status === 'offen' ? '' : officerLabel(); saveLocal(); }
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
    },
    setDone: function (id, eid, done) {
      return api('people/' + encodeURIComponent(id) + '/akte/' + eid, { method: 'PATCH', body: { erledigt: done } });
    },
    allDone: function (id) {
      return api('people/' + encodeURIComponent(id) + '/akte', { method: 'PATCH', body: { erledigt: true } });
    },
    remove: function (id, eid) {
      return api('people/' + encodeURIComponent(id) + '/akte/' + eid, { method: 'DELETE' });
    },
    hbOpen: function () { return api('haftbefehle?status=offen').then(function (d) { return d.haftbefehle; }); },
    hbForPerson: function (id) { return api('people/' + encodeURIComponent(id) + '/haftbefehle').then(function (d) { return d.haftbefehle; }); },
    hbCreate: function (id, d) {
      return api('people/' + encodeURIComponent(id) + '/haftbefehle', { method: 'POST', body: d }).then(function (r) { return r.haftbefehl; });
    },
    hbSet: function (hid, status) {
      return api('haftbefehle/' + hid, { method: 'PATCH', body: { status: status, beamter: officerLabel() } });
    }
  };

  // ---------- Zustand ----------
  var mode = null; // 'server' | 'local'
  var store = LocalStore;
  var people = [];
  var akten = {};          // id -> Array (geladen) | undefined
  var ui = { q: '', sq: '', selId: null, msg: '', busy: false, error: '', createError: '', loading: true, tab: 'personen', hbMsg: '' };
  var hbOpenList = [];   // alle offenen Haftbefehle
  var hbByPerson = {};   // personId -> Array

  function findPerson(id) { return people.find(function (p) { return p.id === id; }) || null; }

  function refreshPeople() {
    return Promise.all([store.list(), store.hbOpen()]).then(function (r) {
      people = r[0]; hbOpenList = r[1];
      ui.loading = false;
      if (!ui.selId && people[0]) ui.selId = people[0].id;
      renderResults(); renderRecord();
    }).catch(function (e) { ui.loading = false; ui.error = e.message; renderResults(); });
  }
  function loadHb(id) {
    if (!id) return Promise.resolve();
    return store.hbForPerson(id).then(function (list) { hbByPerson[id] = list; if (id === ui.selId) renderHb(); })
      .catch(function (e) { ui.hbMsg = e.message; renderHb(); });
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
  function renderTabs() {
    var hb = ui.tab === 'hb';
    $('tabPersonen').classList.toggle('active', !hb); $('tabPersonen').setAttribute('aria-selected', String(!hb));
    $('tabHb').classList.toggle('active', hb); $('tabHb').setAttribute('aria-selected', String(hb));
    $('hbCount').textContent = hbOpenList.length ? String(hbOpenList.length) : '';
    $('results').hidden = hb; $('create').hidden = hb; $('hbResults').hidden = !hb;
  }
  function renderHbResults() {
    var pq = parseQuery(), q = pq.q;
    var list = hbOpenList.filter(function (h) {
      if (!q) return true;
      return (h.roblox || '').toLowerCase().indexOf(q) !== -1 || (!pq.isAt && ((h.name || '').toLowerCase().indexOf(q) !== -1 ||
        (h.kennzeichen || '').toLowerCase().replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) !== -1 || (h.grund || '').toLowerCase().indexOf(q) !== -1));
    });
    $('count').textContent = list.length + (list.length === 1 ? ' offener Haftbefehl' : ' offene Haftbefehle');
    $('hbResults').innerHTML = list.length ? list.map(function (h) {
      return '<button type="button" class="person hb-row' + (h.personId === ui.selId ? ' selected' : '') + '" data-action="select" data-id="' + esc(h.personId) + '">' +
        '<span class="avatar">' + avatarHtml({ name: h.name || h.roblox, robloxId: h.robloxId }) + '</span>' +
        '<span class="person-main"><strong>@' + esc(h.roblox) + '</strong><span>' + esc(h.grund) + (h.kennzeichen ? '  ' + esc(h.kennzeichen) : '') + '</span></span>' +
        '<span class="person-count">' + esc(dateTime(h.createdAt).slice(0, 10)) + '</span></button>';
    }).join('') : '<div class="placeholder">Keine offenen Haftbefehle.</div>';
  }
  function renderResults() {
    renderTabs();
    if (ui.tab === 'hb' && !ui.loading) { renderHbResults(); return; }
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
        (p.haftbefehle ? '<span class="person-hb">Haftbefehl</span>' : '') +
        (p.offen ? '<span class="person-open">ausstehend</span>' : '<span class="person-count">' + (p.count || 0) + (p.count === 1 ? ' Eintrag' : ' Einträge') + '</span>') +
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
    var box = $('record'), hist = $('history');
    var p = findPerson(ui.selId);
    $('strafeBox').hidden = !p;
    $('hbBox').hidden = !p;
    if (!p) {
      box.innerHTML = '<div class="placeholder">' + (ui.loading ? 'Wird geladen' : 'Keine Person ausgewählt.') + '</div>';
      hist.innerHTML = '';
      return;
    }
    var akte = akten[p.id];
    var loaded = Array.isArray(akte);
    akte = akte || [];
    var offen = akte.filter(function (e) { return !e.erledigt; });
    var oGeld = offen.reduce(function (a, e) { return a + e.geld; }, 0);
    var oHaft = offen.reduce(function (a, e) { return a + e.haft; }, 0);

    var openBox = !loaded ? '<div class="due due-none">Wird geladen</div>'
      : offen.length
        ? '<div class="due"><div class="due-label">Ausstehend</div>' +
            '<div class="due-values"><span><strong>' + euro(oGeld) + '</strong> Geldstrafe</span><span><strong>' + oHaft + ' Min.</strong> Haft</span></div>' +
            '<button type="button" class="btn btn-primary" data-action="all-done"' + (ui.busy ? ' disabled' : '') + '>Erledigt</button></div>'
        : '<div class="due due-none">Nichts ausstehend.</div>';

    box.innerHTML =
      '<section class="card flush">' +
        (p.haftbefehle ? '<div class="alert alert-hb" role="alert">OFFENER HAFTBEFEHL</div>' : '') +
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
          openBox +
          (ui.error ? '<span class="error-msg" role="alert">' + esc(ui.error) + '</span>' : '') +
        '</div>' +
      '</section>';

    hist.innerHTML = '<section class="card"><h2>Strafregister</h2><div class="entries">' +
      (!loaded ? '<span class="empty-note">Wird geladen</span>' : akte.length ? akte.map(function (e) {
        return '<div class="entry' + (e.erledigt ? ' done' : ' open') + '"><div class="entry-top"><strong>' + esc(e.delikt) + '</strong><span>' + esc(e.datum) + '</span></div>' +
          '<span class="strafe">' + esc(strafeText(e)) + '</span>' +
          '<div class="entry-foot"><span class="by">Beamter ' + esc(e.beamter || 'Unbekannt') + '</span>' +
          (e.erledigt
            ? '<span class="tag-done">Erledigt</span>'
            : '<span class="entry-actions"><span class="tag-open">Ausstehend</span>' +
              '<button type="button" class="mini" data-action="done" data-eid="' + e.id + '">Erledigt</button>' +
              '<button type="button" class="mini mini-danger" data-action="remove" data-eid="' + e.id + '">Entfernen</button></span>') +
          '</div></div>';
      }).join('') : '<span class="empty-note">Keine Einträge.</span>') +
      '</div></section>';
    renderStrafen();
    renderHb();
  }

  // ---------- Haftbefehle ----------
  function discordText(h) {
    return '🔗 • Haftbefehl • 🔗\n' +
      '👤 Wer: ' + (h.roblox || '') + '\n\n' +
      '🚗 Kennzeichen: ' + (h.kennzeichen || '-') + '\n\n' +
      '🚗 Auto Modell: ' + (h.modell || '-') + '\n\n' +
      '📜 Grund: ' + (h.grund || '') + '\n\n' +
      '🚨 Beweise: ' + (h.beweise || '-') + '\n\n' +
      '👤 Ausgeführt von: ' + (h.ausgestelltVon || '') + '\n' +
      '⸻⸻⸻\n' +
      '👤 Teamtag: ' + TEAMTAG;
  }
  function renderHb() {
    var p = findPerson(ui.selId);
    if (!p) return;
    var list = hbByPerson[p.id];
    var statusText = { offen: 'Offen', vollstreckt: 'Vollstreckt', aufgehoben: 'Aufgehoben' };
    $('hbList').innerHTML = (ui.hbMsg ? '<span class="saved hb-msg" role="status">' + esc(ui.hbMsg) + '</span>' : '') +
      (!list ? '<span class="empty-note">Wird geladen</span>' : list.length ? list.map(function (h) {
        var open = h.status === 'offen';
        return '<div class="hb' + (open ? ' hb-open' : '') + '">' +
          '<div class="entry-top"><strong>' + esc(h.grund) + '</strong><span class="hb-status hb-' + esc(h.status) + '">' + statusText[h.status] + '</span></div>' +
          '<dl class="hb-fields">' +
            '<div><dt>Kennzeichen</dt><dd class="mono">' + esc(h.kennzeichen || '-') + '</dd></div>' +
            '<div><dt>Auto Modell</dt><dd>' + esc(h.modell || '-') + '</dd></div>' +
            '<div class="wide"><dt>Beweise</dt><dd>' + esc(h.beweise || '-') + '</dd></div>' +
            '<div class="wide"><dt>Ausgestellt</dt><dd>' + esc(h.ausgestelltVon || 'Unbekannt') + ', ' + esc(dateTime(h.createdAt)) + '</dd></div>' +
            (!open && h.closedAt ? '<div class="wide"><dt>' + statusText[h.status] + '</dt><dd>' + esc(h.closedBy || 'Unbekannt') + ', ' + esc(dateTime(h.closedAt)) + '</dd></div>' : '') +
          '</dl>' +
          '<div class="entry-actions">' +
            '<button type="button" class="mini" data-action="hb-copy" data-hid="' + h.id + '">Für Discord kopieren</button>' +
            (open
              ? '<button type="button" class="mini" data-action="hb-set" data-status="vollstreckt" data-hid="' + h.id + '">Vollstreckt</button>' +
                '<button type="button" class="mini mini-danger" data-action="hb-set" data-status="aufgehoben" data-hid="' + h.id + '">Aufheben</button>'
              : '<button type="button" class="mini" data-action="hb-set" data-status="offen" data-hid="' + h.id + '">Wieder öffnen</button>') +
          '</div></div>';
      }).join('') : '<span class="empty-note">Keine Haftbefehle.</span>');
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('Kopieren nicht möglich.')); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  function afterHbChange(p) {
    return Promise.all([loadHb(p.id), store.hbOpen().then(function (l) { hbOpenList = l; })]).then(function () {
      p.haftbefehle = (hbByPerson[p.id] || []).filter(function (h) { return h.status === 'offen'; }).length;
      renderResults(); renderRecord();
    });
  }
  function closeHbForm() {
    $('hbForm').hidden = true; $('hbNewBtn').hidden = false; $('hbFormError').textContent = '';
    ['hbKz', 'hbModell', 'hbGrund', 'hbBeweise'].forEach(function (id) { $(id).value = ''; });
  }

  function renderStrafen() {
    var q = ui.sq.trim().toLowerCase().replace(/^§\s*/, '');
    var list = KATALOG.filter(function (c) {
      if (!q) return true;
      var num = c.para.replace('§ ', '');
      return num === q || c.name.toLowerCase().indexOf(q) !== -1 || c.group.toLowerCase().indexOf(q) !== -1;
    });
    $('strafeResults').innerHTML = list.length ? list.map(function (c) {
      return '<button type="button" class="strafe-btn" data-action="give" data-para="' + esc(c.para) + '"' + (ui.busy ? ' disabled' : '') + '>' +
        '<span class="name"><span class="para">' + esc(c.para) + '</span> ' + esc(c.name) + '</span>' +
        '<span class="price">' + esc(euro(c.geld[0]) + ', ' + c.haft[0] + ' Min.') + '</span></button>';
    }).join('') : '<span class="empty-note">Keine Strafe gefunden.</span>';
    $('strafeMsg').textContent = ui.msg;
  }

  function afterChange(p) {
    return loadAkte(p.id, true).then(function () {
      var a = akten[p.id] || [];
      p.count = a.length;
      p.offen = a.filter(function (e) { return !e.erledigt; }).length;
      ui.busy = false;
      renderResults(); renderRecord();
    });
  }
  function run(p, promise, msg) {
    ui.busy = true; ui.error = ''; ui.msg = ''; renderRecord();
    return promise.then(function () { ui.msg = msg || ''; return afterChange(p); })
      .catch(function (e) { ui.busy = false; ui.error = e.message; renderRecord(); });
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
    refreshPeople().then(function () { loadAkte(ui.selId); loadHb(ui.selId); });
  }
  function enterLocal() {
    mode = 'local'; store = LocalStore; ui.loading = true;
    renderMode();
    refreshPeople().then(function () { loadAkte(ui.selId); loadHb(ui.selId); });
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
      if (ui.selId !== el.dataset.id) closeHbForm();
      ui.selId = el.dataset.id; ui.msg = ''; ui.error = ''; ui.hbMsg = '';
      if (!findPerson(ui.selId)) { refreshPeople(); }
      renderResults(); renderRecord(); loadAkte(ui.selId, mode === 'server'); loadHb(ui.selId);
    } else if (a === 'create') {
      var handle = $('create').dataset.handle;
      if (!handle || ui.busy) return;
      var name = ($('newName') && $('newName').value.trim().slice(0, 60)) || '';
      ui.busy = true; ui.createError = ''; renderResults();
      store.create(handle, name).then(function (p) {
        ui.busy = false;
        if (!findPerson(p.id)) people.unshift(p);
        akten[p.id] = akten[p.id] || [];
        hbByPerson[p.id] = hbByPerson[p.id] || [];
        ui.selId = p.id; ui.msg = '';
        ui.q = '@' + p.roblox; $('q').value = ui.q;
        renderResults(); renderRecord();
        if (mode === 'server') loadAkte(p.id, true);
      }).catch(function (e) { ui.busy = false; ui.createError = e.message; renderResults(); });
    } else if (a === 'give') {
      var p = findPerson(ui.selId);
      var c = KATALOG.find(function (k) { return k.para === el.dataset.para; });
      if (!p || !c || ui.busy) return;
      run(p, store.addEntries(p.id, [{ para: c.para, geld: c.geld[0], haft: c.haft[0] }]), c.para + ' ' + c.name + ' vergeben.');
    } else if (a === 'all-done') {
      var p2 = findPerson(ui.selId);
      if (p2 && !ui.busy) run(p2, store.allDone(p2.id), '');
    } else if (a === 'done') {
      var p3 = findPerson(ui.selId);
      if (p3 && !ui.busy) run(p3, store.setDone(p3.id, Number(el.dataset.eid), true), '');
    } else if (a === 'hb-copy') {
      var p5 = findPerson(ui.selId);
      var h = p5 && (hbByPerson[p5.id] || []).find(function (x) { return x.id === Number(el.dataset.hid); });
      if (!h) return;
      copyText(discordText(h)).then(function () { ui.hbMsg = 'Kopiert. Jetzt in Discord einfügen.'; renderHb(); })
        .catch(function () { ui.hbMsg = 'Kopieren hat nicht geklappt.'; renderHb(); });
    } else if (a === 'hb-set') {
      var p6 = findPerson(ui.selId);
      if (!p6) return;
      var st = el.dataset.status;
      if (st === 'aufgehoben' && !confirm('Haftbefehl wirklich aufheben?')) return;
      ui.hbMsg = '';
      store.hbSet(Number(el.dataset.hid), st).then(function () {
        ui.hbMsg = st === 'vollstreckt' ? 'Als vollstreckt markiert. Strafe unten vergeben.' : st === 'aufgehoben' ? 'Haftbefehl aufgehoben.' : 'Haftbefehl wieder offen.';
        return afterHbChange(p6);
      }).catch(function (e) { ui.hbMsg = e.message; renderHb(); });
    } else if (a === 'remove') {
      var p4 = findPerson(ui.selId);
      if (p4 && !ui.busy) run(p4, store.remove(p4.id, Number(el.dataset.eid)), 'Eintrag entfernt.');
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var a = el.dataset && el.dataset.action;
    var p = findPerson(ui.selId);
    if ((a === 'status' || a === 'danger') && p) {
      var patch = a === 'status' ? { status: el.value } : { danger: el.checked };
      var before = { status: p.status, danger: p.danger };
      Object.assign(p, patch); renderResults(); renderRecord();
      store.update(p.id, patch).catch(function (e) {
        Object.assign(p, before); ui.error = e.message; renderResults(); renderRecord();
      });
    }
  });

  $('q').addEventListener('input', function (ev) { ui.q = ev.target.value; ui.createError = ''; renderResults(); });
  $('tabPersonen').addEventListener('click', function () { ui.tab = 'personen'; renderResults(); });
  $('tabHb').addEventListener('click', function () { ui.tab = 'hb'; renderResults(); });
  $('hbNewBtn').addEventListener('click', function () {
    $('hbForm').hidden = false; $('hbNewBtn').hidden = true; $('hbFormError').textContent = '';
    $('hbGrund').focus();
  });
  $('hbCancel').addEventListener('click', closeHbForm);
  $('hbGruende').innerHTML = KATALOG.map(function (c) { return '<option value="' + esc(c.para + ' ' + c.name) + '">'; }).join('');
  $('hbForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var p = findPerson(ui.selId);
    var grund = $('hbGrund').value.trim();
    if (!p) return;
    if (!grund) { $('hbFormError').textContent = 'Bitte einen Grund angeben.'; return; }
    var btn = $('hbForm').querySelector('[type="submit"]'); btn.disabled = true;
    store.hbCreate(p.id, {
      kennzeichen: $('hbKz').value.trim().toUpperCase(), modell: $('hbModell').value.trim(),
      grund: grund, beweise: $('hbBeweise').value.trim(), beamter: officerLabel()
    }).then(function () {
      btn.disabled = false; closeHbForm();
      ui.hbMsg = 'Haftbefehl ausgestellt.';
      return afterHbChange(p);
    }).catch(function (e) { btn.disabled = false; $('hbFormError').textContent = e.message; });
  });
  $('strafeQ').addEventListener('input', function (ev) { ui.sq = ev.target.value; ui.msg = ''; renderStrafen(); });
  $('strafeQ').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      var btns = $('strafeResults').querySelectorAll('[data-action="give"]');
      if (btns.length === 1) btns[0].click();
    }
  });
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
    local = demoData(); migrateLocal(); saveLocal(); hbByPerson = {}; akten = {}; ui.selId = null; ui.q = ''; $('q').value = '';
    enterLocal();
  });

  // Andere Beamte sehen Änderungen nach spätestens 20 Sekunden
  setInterval(function () {
    if (mode === 'server' && !document.hidden && $('gate').hidden) {
      refreshPeople(); if (ui.selId) { loadAkte(ui.selId, true); loadHb(ui.selId); }
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
