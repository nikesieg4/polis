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
  var TEAMTAG = '<@&1476650119700156618>'; // Rolle @Präsidium-Team

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
  var authMode = 'key'; // 'key' | 'discord'
  var me = null;        // angemeldetes Discord-Mitglied
  function officerLabel() {
    if (authMode === 'discord') return me ? me.name + ' (@' + me.username + ')' : 'Unbekannt';
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
    local.log = local.log || [];
    local.nextLog = local.nextLog || 1;
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

  function llog(aktion, pid, details) {
    var o = prefs.officer || {};
    local.log.unshift({ id: local.nextLog++, ts: Date.now(), name: o.name, nr: o.nr, aktion: aktion, personId: pid || null, details: details || '' });
    local.log = local.log.slice(0, 500);
  }
  function localName(pid) { var p = local.people.find(function (x) { return x.id === pid; }); return p || {}; }

  var LocalStore = {
    log: function () {
      return Promise.resolve(local.log.map(function (l) {
        var p = localName(l.personId);
        return Object.assign({}, l, { personName: p.name || '', roblox: p.roblox || '' });
      }));
    },
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
      local.people.unshift(p); local.akten[id] = []; llog('Person angelegt', id, '@' + handle + (name ? ' als ' + name : '')); saveLocal();
      return Promise.resolve(Object.assign({ count: 0 }, p));
    },
    update: function (id, patch) {
      var p = local.people.find(function (x) { return x.id === id; });
      if (p) {
        var ch = [];
        if (patch.status != null && patch.status !== p.status) ch.push('Status: ' + p.status + ' zu ' + patch.status);
        if (patch.danger != null && patch.danger !== p.danger) ch.push(patch.danger ? 'als gefährlich markiert' : 'nicht mehr gefährlich');
        Object.assign(p, patch);
        if (ch.length) llog('Person geändert', id, ch.join(', '));
        saveLocal();
      }
      return Promise.resolve(p);
    },
    addEntries: function (id, entries) {
      var d = today(), by = officerLabel();
      var rows = entries.map(function (x) {
        var c = KATALOG.find(function (k) { return k.para === x.para; });
        return { id: local.nextEntry++, delikt: c.para + ' ' + c.name, geld: c.geld[0], haft: c.haft[0], datum: d, beamter: by, erledigt: 0 };
      });
      local.akten[id] = rows.concat(local.akten[id] || []);
      rows.forEach(function (r) { llog('Strafe vergeben', id, r.delikt + ': ' + euro(r.geld) + ', ' + r.haft + ' Min.'); });
      saveLocal();
      return Promise.resolve();
    },
    setDone: function (id, eid, done) {
      var e = localEntry(id, eid); if (e) { e.erledigt = done ? 1 : 0; llog(done ? 'Strafe erledigt' : 'Strafe wieder ausstehend', id, e.delikt); saveLocal(); }
      return Promise.resolve();
    },
    allDone: function (id) {
      var n = 0;
      (local.akten[id] || []).forEach(function (e) { if (!e.erledigt) n++; e.erledigt = 1; });
      if (n) llog('Strafen erledigt', id, n === 1 ? '1 ausstehende Strafe' : n + ' ausstehende Strafen');
      saveLocal();
      return Promise.resolve();
    },
    remove: function (id, eid) {
      var gone = localEntry(id, eid);
      local.akten[id] = (local.akten[id] || []).filter(function (e) { return e.id !== eid || e.erledigt; });
      if (gone && !gone.erledigt) llog('Strafe entfernt', id, gone.delikt + ': ' + euro(gone.geld) + ', ' + gone.haft + ' Min.');
      saveLocal();
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
      local.haftbefehle.unshift(h); llog('Haftbefehl ausgestellt', id, d.grund); saveLocal();
      return Promise.resolve(LocalStore.hbWithPerson(h));
    },
    hbSet: function (hid, status) {
      var h = local.haftbefehle.find(function (x) { return x.id === hid; });
      if (h) {
        h.status = status; h.closedAt = status === 'offen' ? null : Date.now(); h.closedBy = status === 'offen' ? '' : officerLabel();
        llog('Haftbefehl ' + { offen: 'wieder geöffnet', vollstreckt: 'vollstreckt', aufgehoben: 'aufgehoben' }[status], h.personId, h.grund);
        saveLocal();
      }
      return Promise.resolve();
    }
  };

  // ---------- Server (Cloudflare D1) ----------
  var key = lsGet(KEY_STORE) || '';
  // Admin-Passwort nur für diese Browser-Sitzung (wird beim Schließen des Tabs vergessen)
  var adminKey = '';
  try { adminKey = sessionStorage.getItem('polis.admin') || ''; } catch (e) { /* ignorieren */ }
  var isAdmin = false, adminAvailable = false;
  function setAdminKey(k) { adminKey = k; try { k ? sessionStorage.setItem('polis.admin', k) : sessionStorage.removeItem('polis.admin'); } catch (e) { /* ignorieren */ } }
  function api(path, opts) {
    opts = opts || {};
    var o = prefs.officer || {};
    var headers = { 'x-polis-key': encodeURIComponent(key), 'x-polis-name': encodeURIComponent(o.name || ''), 'x-polis-nr': encodeURIComponent(o.nr || '') };
    if (adminKey) headers['x-polis-admin'] = encodeURIComponent(adminKey);
    if (opts.body) headers['content-type'] = 'application/json';
    headers['x-polis'] = '1';
    if (authMode === 'discord') headers = { 'x-polis': '1', 'content-type': headers['content-type'] || 'application/json' };
    return fetch('/api/' + path, { method: opts.method || 'GET', headers: headers, credentials: 'same-origin', body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (authMode === 'discord' && (r.status === 401 || (r.status === 403 && d.login))) { me = null; showDiscordGate(d.error); }
          else if (r.status === 401 && path !== 'admin') { showGate('Dienstschlüssel ungültig. Bitte neu anmelden.'); }
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
    log: function () { return api('log?limit=300').then(function (d) { return d.log; }); },
    hbOpen: function () { return api('haftbefehle?status=offen').then(function (d) { return d.haftbefehle; }); },
    hbForPerson: function (id) { return api('people/' + encodeURIComponent(id) + '/haftbefehle').then(function (d) { return d.haftbefehle; }); },
    hbCreate: function (id, d) {
      return api('people/' + encodeURIComponent(id) + '/haftbefehle', { method: 'POST', body: d }).then(function (r) { return r.haftbefehl; });
    },
    hbSet: function (hid, status) {
      return api('haftbefehle/' + hid, { method: 'PATCH', body: { status: status, beamter: officerLabel() } });
    },
    hbDelete: function (hid) { return api('haftbefehle/' + hid, { method: 'DELETE' }); },
    deletePerson: function (id) { return api('people/' + encodeURIComponent(id), { method: 'DELETE' }); }
  };

  // ---------- Zustand ----------
  var mode = null; // 'server' | 'local'
  var store = LocalStore;
  var people = [];
  var akten = {};          // id -> Array (geladen) | undefined
  var ui = { q: '', sq: '', selId: null, msg: '', busy: false, error: '', createError: '', loading: true, tab: 'personen', hbMsg: '' };
  var hbOpenList = [];   // alle offenen Haftbefehle
  var logList = null;    // Protokoll (null = noch nicht geladen)
  function officerOk() {
    if (authMode === 'discord') return !!me;
    var o = prefs.officer || {}; return !!(o.name && o.nr);
  }
  function loadLog() {
    return store.log().then(function (l) { logList = l; if (ui.tab === 'log') renderResults(); })
      .catch(function (e) { ui.error = e.message; if (ui.tab === 'log') renderResults(); });
  }
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
    [['tabPersonen', 'personen'], ['tabHb', 'hb'], ['tabLog', 'log']].forEach(function (t) {
      var on = ui.tab === t[1];
      $(t[0]).classList.toggle('active', on); $(t[0]).setAttribute('aria-selected', String(on));
    });
    $('hbCount').textContent = hbOpenList.length ? String(hbOpenList.length) : '';
    $('results').hidden = ui.tab !== 'personen'; $('create').hidden = ui.tab !== 'personen';
    $('hbResults').hidden = ui.tab !== 'hb'; $('logResults').hidden = ui.tab !== 'log';
  }
  function renderLogResults() {
    var q = ui.q.trim().toLowerCase().replace(/^@+/, '');
    if (!logList) { $('count').textContent = 'Wird geladen'; $('logResults').innerHTML = ''; return; }
    var list = logList.filter(function (l) {
      if (!q) return true;
      return [l.name, l.nr, l.aktion, l.details, l.personName, l.roblox, l.personId].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = list.length + (list.length === 1 ? ' Eintrag' : ' Einträge') + ' im Protokoll';
    $('logResults').innerHTML = list.length ? list.map(function (l) {
      var who = l.personId ? '<button type="button" class="log-person" data-action="select" data-id="' + esc(l.personId) + '">' +
        esc(l.personName || l.personId) + (l.roblox ? ' (@' + esc(l.roblox) + ')' : '') + '</button>' : '';
      return '<div class="log-row"><div class="log-top"><strong>' + esc(l.aktion) + '</strong><span>' + esc(dateTime(l.ts)) + '</span></div>' +
        (who || l.details ? '<div class="log-what">' + who + (who && l.details ? ': ' : '') + esc(l.details) + '</div>' : '') +
        '<div class="log-by">' + esc(l.name || '?') + ' (' + esc(l.nr || '?') + ')</div></div>';
    }).join('') : '<div class="placeholder">Keine Einträge im Protokoll.</div>';
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
    if (ui.tab === 'log' && !ui.loading) { renderLogResults(); return; }
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
  function renderAdmin() {
    var p = findPerson(ui.selId);
    var box = $('adminBox');
    box.hidden = !(isAdmin && p);
    $('adminBadge').hidden = !isAdmin;
    $('adminBtn').hidden = !(mode === 'server' && adminAvailable);
    $('adminBtn').textContent = isAdmin ? 'Admin beenden' : 'Admin';
    if (!p || !isAdmin) { box.dataset.pid = ''; return; }
    if (box.dataset.pid !== p.id) {
      box.dataset.pid = p.id;
      $('admName').value = p.name; $('admRoblox').value = p.roblox; $('admMsg').textContent = '';
    }
  }
  function renderRecord() {
    renderAdmin();
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
            ? '<span class="entry-actions"><span class="tag-done">Erledigt</span>' +
              (isAdmin ? '<button type="button" class="mini mini-danger" data-action="remove" data-done="1" data-eid="' + e.id + '">Löschen</button>' : '') + '</span>'
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
            (isAdmin ? '<button type="button" class="mini mini-danger" data-action="hb-delete" data-hid="' + h.id + '">Löschen</button>' : '') +
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
    renderAdmin();
  }
  function openAdminGate() {
    $('adminGate').hidden = false; $('adminError').textContent = '';
    setTimeout(function () { $('adminKey').focus(); }, 0);
  }
  $('adminBtn').addEventListener('click', function () {
    if (isAdmin) { isAdmin = false; setAdminKey(''); renderRecord(); return; }
    openAdminGate();
  });
  $('adminCancel').addEventListener('click', function () { $('adminGate').hidden = true; $('adminKey').value = ''; });
  $('adminForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var prev = adminKey;
    setAdminKey($('adminKey').value.trim());
    api('admin').then(function () {
      isAdmin = true; $('adminGate').hidden = true; $('adminKey').value = '';
      renderRecord();
    }).catch(function (e) { setAdminKey(prev); $('adminError').textContent = e.message; });
  });
  function checkAdmin() {
    if (authMode === 'discord' || !adminKey || mode !== 'server') return;
    api('admin').then(function () { isAdmin = true; renderRecord(); })
      .catch(function () { isAdmin = false; setAdminKey(''); renderRecord(); });
  }
  $('admSave').addEventListener('click', function (ev) {
    if (blockIfNoOfficer(ev)) return;
    var p = findPerson(ui.selId);
    if (!p) return;
    var patch = {};
    var n = $('admName').value.trim(), r = $('admRoblox').value.trim().replace(/^@+/, '');
    if (n && n !== p.name) patch.name = n;
    if (r && r.toLowerCase() !== p.roblox.toLowerCase()) patch.roblox = r;
    if (!Object.keys(patch).length) { $('admMsg').textContent = 'Keine Änderung.'; return; }
    $('admMsg').textContent = 'Bitte warten';
    store.update(p.id, patch).then(function (np) {
      Object.assign(p, { name: np.name, roblox: np.roblox, robloxId: np.robloxId });
      $('adminBox').dataset.pid = '';
      renderResults(); renderRecord();
      $('admMsg').textContent = 'Gespeichert.';
      loadHb(p.id);
    }).catch(function (e) { $('admMsg').textContent = e.message; });
  });
  $('admDelete').addEventListener('click', function (ev) {
    if (blockIfNoOfficer(ev)) return;
    var p = findPerson(ui.selId);
    if (!p) return;
    if (!confirm(p.name + ' (@' + p.roblox + ') mit allen Strafen und Haftbefehlen endgültig löschen?')) return;
    store.deletePerson(p.id).then(function () {
      people = people.filter(function (x) { return x.id !== p.id; });
      delete akten[p.id]; delete hbByPerson[p.id];
      ui.selId = people[0] ? people[0].id : null;
      refreshPeople().then(function () { if (ui.selId) { loadAkte(ui.selId, true); loadHb(ui.selId); } });
      if (ui.tab === 'log') loadLog();
    }).catch(function (e) { $('admMsg').textContent = e.message; });
  });
  var LOGIN_REASONS = {
    'keine-rolle': 'Dir fehlt die Polizei-Rolle auf dem Discord-Server.',
    'abgebrochen': 'Anmeldung abgebrochen.',
    'ungueltig': 'Anmeldung abgelaufen. Bitte noch einmal versuchen.',
    'fehler': 'Anmeldung bei Discord fehlgeschlagen. Bitte noch einmal versuchen.'
  };
  function showDiscordGate(msg) {
    $('discordGate').hidden = false;
    $('discordError').textContent = msg || '';
  }
  function renderMe() {
    var d = authMode === 'discord';
    $('meBox').hidden = !(d && me);
    document.querySelectorAll('.officer-field').forEach(function (f) { f.hidden = d; });
    if (d && me) {
      $('meName').textContent = me.name;
      $('meAvatar').hidden = !me.avatar;
      if (me.avatar) $('meAvatar').src = me.avatar;
    }
  }
  function enterDiscord() {
    authMode = 'discord'; mode = 'server';
    var reason = new URLSearchParams(location.search).get('login');
    if (reason) history.replaceState(null, '', location.pathname);
    renderMe();
    api('me').then(function (m) {
      me = m; isAdmin = !!m.admin;
      $('discordGate').hidden = true;
      renderMe(); renderOfficer();
      enterServer();
    }).catch(function (e) {
      showDiscordGate(reason ? (LOGIN_REASONS[reason] || '') : (e.status === 401 ? '' : e.message));
    });
  }
  function showGate(msg) {
    $('gate').hidden = false;
    $('gateError').textContent = msg || '';
    setTimeout(function () { $('gateKey').focus(); }, 0);
  }
  function enterServer() {
    logList = null;
    mode = 'server'; store = ServerStore; people = []; akten = {}; ui.loading = true; ui.selId = null;
    renderMode(); renderResults(); renderRecord();
    refreshPeople().then(function () { loadAkte(ui.selId); loadHb(ui.selId); });
    checkAdmin();
  }
  function enterLocal() {
    logList = null;
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
    if (authMode === 'discord') {
      api('auth/logout', { method: 'POST' }).catch(function () {}).then(function () { me = null; isAdmin = false; renderMe(); showDiscordGate(''); });
      return;
    }
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
    } else if (a === 'hb-delete') {
      var p7 = findPerson(ui.selId);
      if (!p7 || !confirm('Haftbefehl endgültig löschen?')) return;
      store.hbDelete(Number(el.dataset.hid)).then(function () { ui.hbMsg = 'Haftbefehl gelöscht.'; return afterHbChange(p7); })
        .catch(function (e) { ui.hbMsg = e.message; renderHb(); });
    } else if (a === 'remove') {
      var p4 = findPerson(ui.selId);
      if (el.dataset.done && !confirm('Erledigte Strafe endgültig löschen?')) return;
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
  $('tabLog').addEventListener('click', function () { ui.tab = 'log'; renderResults(); loadLog(); });
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
  function saveOfficer() { prefs.officer = { name: officerName.value.trim().slice(0, 40), nr: officerNr.value.trim().slice(0, 20) }; savePrefs(); renderOfficer(); }
  function renderOfficer() {
    var o = prefs.officer || {};
    var ok = officerOk();
    document.body.classList.toggle('no-officer', !ok);
    $('officerWarn').hidden = ok || authMode === 'discord';
    officerName.classList.toggle('missing', !o.name);
    officerNr.classList.toggle('missing', !o.nr);
  }
  var WRITE_ACTIONS = ['create', 'give', 'all-done', 'done', 'remove', 'hb-set', 'hb-delete'];
  function blockIfNoOfficer(ev) {
    if (officerOk()) return false;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var warn = $('officerWarn');
    warn.hidden = false; warn.classList.remove('shake'); void warn.offsetWidth; warn.classList.add('shake');
    if (authMode === 'discord') { showDiscordGate(''); return true; }
    ((prefs.officer || {}).name ? officerNr : officerName).focus();
    return true;
  }
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action], #hbNewBtn');
    if (!el) return;
    if (el.id === 'hbNewBtn' || WRITE_ACTIONS.indexOf(el.dataset.action) !== -1) blockIfNoOfficer(ev);
  }, true);
  document.addEventListener('change', function (ev) {
    var a = ev.target.dataset && ev.target.dataset.action;
    if ((a === 'status' || a === 'danger') && blockIfNoOfficer(ev)) renderRecord();
  }, true);
  $('hbForm').addEventListener('submit', function (ev) { blockIfNoOfficer(ev); }, true);
  officerName.addEventListener('input', saveOfficer);
  renderOfficer();
  officerNr.addEventListener('input', saveOfficer);

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Alle lokalen Einträge in diesem Browser löschen und Demo-Daten wiederherstellen?')) return;
    local = demoData(); migrateLocal(); saveLocal(); hbByPerson = {}; akten = {}; ui.selId = null; ui.q = ''; $('q').value = '';
    enterLocal();
  });

  // Andere Beamte sehen Änderungen nach spätestens 20 Sekunden
  setInterval(function () {
    if (mode === 'server' && !document.hidden && $('gate').hidden && $('discordGate').hidden) {
      refreshPeople(); if (ui.selId) { loadAkte(ui.selId, true); loadHb(ui.selId); }
      if (ui.tab === 'log') loadLog();
      if (authMode === 'discord') api('me').then(function (m) { me = m; isAdmin = !!m.admin; renderMe(); renderRecord(); }).catch(function () {});
    }
  }, 20000);

  // ---------- Start ----------
  savePrefs();
  renderResults(); renderRecord();
  fetch('/api/health', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (h) {
      if (h && h.ok && h.db && h.auth === 'discord') {
        enterDiscord();
      } else if (h && h.ok && h.db && h.keySet) {
        adminAvailable = !!h.adminSet;
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
