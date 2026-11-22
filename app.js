/* POLIS: Strafregister der Polizei Berlin City Roleplay
   Online-Modus: geteilte Cloudflare-D1-Datenbank über /api (mit Dienstschlüssel).
   Lokaler Modus: Fallback ohne Server (z. B. GitHub Pages), Daten nur im localStorage. */
(function () {
  'use strict';

  var LOCAL_KEY = 'polis.v1';
  var KEY_STORE = 'polis.key';
  var PREFS_KEY = 'polis.prefs';

  // Strafkatalog: wird vom Server geladen (lib/katalog.js), siehe loadKatalog()
  var KATALOG = [];
  function loadKatalog() {
    return fetch('/api/katalog').then(function (r) { return r.ok ? r.json() : { katalog: [] }; })
      .catch(function () { return { katalog: [] }; })
      .then(function (d) {
        KATALOG = d.katalog || [];
        $('hbGruende').innerHTML = KATALOG.map(function (c) { return '<option value="' + esc(c.para + ' ' + c.name) + '">'; }).join('');
        renderStrafen();
      });
  }
  var STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];
  // Reihenfolge in Listen: Fahndung oben, dann Bewährung, dann Sauber; innerhalb gleich bleibt die bisherige Reihenfolge
  var STATUS_RANG = { 'Fahndung': 0, 'Bewährung': 1, 'Sauber': 2 };
  function nachStatus(list) {
    return list.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      var ra = STATUS_RANG[a.p.status] != null ? STATUS_RANG[a.p.status] : 3;
      var rb = STATUS_RANG[b.p.status] != null ? STATUS_RANG[b.p.status] : 3;
      return ra - rb || a.i - b.i;
    }).map(function (x) { return x.p; });
  }
  // Registereintrag -> Katalogeintrag (über die Nummer, sonst über den Text)
  function catFor(e) {
    if (!e) return null;
    if (e.nr) { var byNr = KATALOG.find(function (c) { return c.nr === e.nr; }); if (byNr) return byNr; }
    return KATALOG.find(function (c) { return c.para + ' ' + c.name === e.delikt; }) || null;
  }
  function katalogPreis(c) {
    return euro(c.geld) + (c.haft ? ' + Haft' : '');
  }
  function clampTo(v, r) { v = Math.round(Number(v)); if (!isFinite(v)) v = r[0]; return Math.min(r[1], Math.max(r[0], v)); }
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
    // nur Wörter, die mit einem Buchstaben beginnen („POK [44] Becker“ -> „PB“)
    var s = String(n).replace(/^@/, '').split(/[^A-Za-zÄÖÜäöüß0-9]+/).filter(function (w) { return /^[A-Za-zÄÖÜäöüß]/.test(w); })
      .map(function (w) { return w[0]; }).join('');
    return (s || '?').slice(0, 2).toUpperCase();
  }
  function strafeText(e) {
    var c = catFor(e);
    // haft: 1 = ins Gefängnis bringen; ältere Einträge hatten Minuten
    var t = euro(e.geld) + (c ? (e.haft ? ' + Haft' : '') : (e.haft ? ', ' + e.haft + ' Min. Haft' : ''));
    return t + (c && c.zusatz ? ', ' + c.zusatz : '');
  }
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
  // Rechte des angemeldeten Beamten (vom Server, siehe lib/rechte.js)
  var perms = [];
  var LOCAL_PERMS = ['zugriff', 'personen', 'strafen', 'beschreibung', 'haftbefehle', 'gruppen', 'protokoll'];
  function has(k) { return (mode === 'local' ? LOCAL_PERMS : perms).indexOf(k) !== -1; }
  function setPerms(m) { perms = (m && m.perms) || []; isAdmin = has('admin'); }
  function loadPerms() {
    return api('me').then(function (m) { setPerms(m); if (authMode === 'discord') me = m; renderPermUi(); })
      .catch(function () {});
  }
  function canHb() { return has('haftbefehle'); }
  function canGruppe() { return has('gruppen'); }
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
        if (patch.gruppe != null && patch.gruppe !== (p.gruppe || '')) ch.push('Gruppierung: ' + (p.gruppe || 'leer') + ' zu ' + (patch.gruppe || 'leer'));
        if (patch.gruppeRang != null && patch.gruppeRang !== (p.gruppeRang || '')) ch.push('Rang: ' + (p.gruppeRang || 'leer') + ' zu ' + (patch.gruppeRang || 'leer'));
        if (patch.beschreibung != null && patch.beschreibung !== (p.beschreibung || '')) ch.push('Beschreibung geändert');
        Object.assign(p, patch);
        if (ch.length) llog('Person geändert', id, ch.join(', '));
        saveLocal();
      }
      return Promise.resolve(p);
    },
    addEntries: function (id, entries) {
      var d = today(), by = officerLabel();
      var rows = entries.map(function (x) {
        var c = KATALOG.find(function (k) { return k.nr === x.nr; });
        return { id: local.nextEntry++, nr: c.nr, delikt: c.para + ' ' + c.name, geld: c.geld, haft: c.haft ? 1 : 0, datum: d, beamter: by, erledigt: 0 };
      });
      local.akten[id] = rows.concat(local.akten[id] || []);
      rows.forEach(function (r) { llog('Strafe vergeben', id, r.delikt + ': ' + euro(r.geld) + (r.haft ? ' + Haft' : '')); });
      saveLocal();
      return Promise.resolve();
    },
    adjust: function (id, eid, geld, haft) {
      var e = localEntry(id, eid), c = catFor(e);
      if (e && c) {
        var g = c.geld, h = c.haft ? clampTo(haft, c.haft) : 0;
        if (g !== e.geld || h !== e.haft) {
          llog('Strafe angepasst', id, e.delikt + ': ' + euro(e.geld) + ' zu ' + euro(g) + ', ' + e.haft + ' zu ' + h + ' Min.');
          e.geld = g; e.haft = h; saveLocal();
        }
      }
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
      if (gone && !gone.erledigt) llog('Strafe entfernt', id, gone.delikt + ': ' + euro(gone.geld) + (gone.haft ? ' + Haft' : ''));
      saveLocal();
      return Promise.resolve();
    },
    hbWithPerson: function (h) {
      var p = local.people.find(function (x) { return x.id === h.personId; }) || {};
      return Object.assign({}, h, { name: p.name, roblox: p.roblox, robloxId: p.robloxId });
    },
    gruppen: function () {
      var m = {};
      local.people.forEach(function (p) {
        if (!p.gruppe) return;
        var k = p.gruppe.toLowerCase();
        m[k] = m[k] || { name: p.gruppe, count: 0 }; m[k].count++;
      });
      Object.keys(local.gruppen || {}).forEach(function (k) {
        if (!m[k] && local.gruppen[k].beschreibung) m[k] = { name: local.gruppen[k].name, count: 0 };
      });
      return Promise.resolve(Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); }));
    },
    gruppe: function (name) {
      var k = name.toLowerCase(), g = (local.gruppen || {})[k] || {};
      return LocalStore.list().then(function (all) {
        var mit = all.filter(function (p) { return (p.gruppe || '').toLowerCase() === k; });
        return { name: mit[0] ? mit[0].gruppe : (g.name || name), beschreibung: g.beschreibung || '', updatedAt: g.updatedAt || null, updatedBy: g.updatedBy || '', mitglieder: mit };
      });
    },
    gruppeSave: function (name, text) {
      local.gruppen = local.gruppen || {};
      local.gruppen[name.toLowerCase()] = { name: name, beschreibung: text, updatedAt: Date.now(), updatedBy: officerLabel() };
      llog('Gruppierung beschrieben', null, name + (text ? '' : ' (Beschreibung gelöscht)'));
      saveLocal();
      return Promise.resolve();
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
    adjust: function (id, eid, geld, haft) {
      return api('people/' + encodeURIComponent(id) + '/akte/' + eid, { method: 'PATCH', body: { geld: geld, haft: haft } });
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
    gruppen: function () { return api('gruppen').then(function (d) { return d.gruppen; }); },
    gruppe: function (name) { return api('gruppen/' + encodeURIComponent(name)); },
    gruppeSave: function (name, text) { return api('gruppen/' + encodeURIComponent(name), { method: 'PUT', body: { beschreibung: text } }); },
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
  var ui = { edit: null, q: '', sq: '', selId: null, msg: '', busy: false, error: '', createError: '', loading: true, tab: 'personen', hbMsg: '' };
  var hbOpenList = [];   // alle offenen Haftbefehle
  var logList = null;    // Protokoll (null = noch nicht geladen)
  var gruppenList = null; // Gruppierungen (null = noch nicht geladen)
  var gruppeData = null;  // geöffnete Gruppierung
  function loadGruppen() {
    return store.gruppen().then(function (l) { gruppenList = l; if (ui.tab === 'gruppen') renderResults(); })
      .catch(function (e) { ui.error = e.message; if (ui.tab === 'gruppen') renderResults(); });
  }
  function openGruppe(name) {
    ui.view = 'gruppe'; ui.gruppe = name; gruppeData = null; closeGruppeForm();
    renderResults(); renderRecord();
    return store.gruppe(name).then(function (d) { if (ui.view === 'gruppe' && ui.gruppe === name) { gruppeData = d; renderRecord(); } })
      .catch(function (e) { gruppeData = { name: name, error: e.message, mitglieder: [] }; renderRecord(); });
  }
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
    [['tabPersonen', 'personen'], ['tabHb', 'hb'], ['tabGruppen', 'gruppen'], ['tabLog', 'log']].forEach(function (t) {
      var on = ui.tab === t[1];
      $(t[0]).classList.toggle('active', on); $(t[0]).setAttribute('aria-selected', String(on));
    });
    $('hbCount').textContent = hbOpenList.length ? String(hbOpenList.length) : '';
    $('results').hidden = ui.tab !== 'personen'; $('create').hidden = ui.tab !== 'personen';
    $('hbResults').hidden = ui.tab !== 'hb'; $('logResults').hidden = ui.tab !== 'log';
    $('gruppenResults').hidden = ui.tab !== 'gruppen';
    $('tabLog').hidden = !has('protokoll');
  }
  function renderGruppenResults() {
    var q = ui.q.trim().toLowerCase();
    if (!gruppenList) { $('count').textContent = 'Wird geladen'; $('gruppenResults').innerHTML = ''; return; }
    var list = gruppenList.filter(function (g) { return !q || g.name.toLowerCase().indexOf(q) !== -1; });
    $('count').textContent = list.length + (list.length === 1 ? ' Gruppierung' : ' Gruppierungen');
    $('gruppenResults').innerHTML = list.length ? list.map(function (g) {
      var on = ui.view === 'gruppe' && (ui.gruppe || '').toLowerCase() === g.name.toLowerCase();
      return '<button type="button" class="person' + (on ? ' selected' : '') + '" data-action="open-gruppe" data-gruppe="' + esc(g.name) + '">' +
        '<span class="avatar">' + esc(initials(g.name)) + '</span>' +
        '<span class="person-main"><strong>' + esc(g.name) + '</strong></span>' +
        '<span class="person-count">' + g.count + (g.count === 1 ? ' Mitglied' : ' Mitglieder') + '</span></button>';
    }).join('') : '<div class="placeholder">Noch keine Gruppierungen. Bei einer Person unter „Beschreibung“ eine Gruppierung eintragen.</div>';
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
    if (ui.tab === 'gruppen' && !ui.loading) { renderGruppenResults(); return; }
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
      return p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1 ||
        (p.gruppe || '').toLowerCase().indexOf(q) !== -1;
    });
    list = nachStatus(list);
    $('count').textContent = list.length + ' Treffer' + (ui.error ? '. ' + ui.error : '');
    $('results').innerHTML = list.map(function (p) {
      return '<button type="button" class="person' + (p.id === ui.selId ? ' selected' : '') + '" data-action="select" data-id="' + esc(p.id) + '">' +
        '<span class="avatar">' + avatarHtml(p) + '</span>' +
        '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + '  ' + esc(p.id) +
          (p.gruppe ? '  ' + esc(p.gruppe) + (p.gruppeRang ? ' (' + esc(p.gruppeRang) + ')' : '') : '') + '</span></span>' +
(p.kripo ? '<span class="person-kripo" title="' + esc(p.kripoHinweis || 'Kripo') + '">Kripo</span>' : '') +
        (p.haftbefehle ? '<span class="person-hb">Haftbefehl</span>' : '') +
        (p.offen ? '<span class="person-open">ausstehend</span>' : '<span class="person-count">' + (p.count || 0) + (p.count === 1 ? ' Eintrag' : ' Einträge') + '</span>') +
        '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></button>';
    }).join('');

    var handle = /^[a-z0-9_.]{3,20}$/.test(q) ? q : '';
    var exact = people.some(function (p) { return p.roblox.toLowerCase() === q; });
    var create = $('create');
    if (handle && !exact && !has('personen')) {
      create.dataset.handle = '';
      create.innerHTML = '<div class="placeholder">@' + esc(handle) + ' ist nicht im Register. Personen anlegen darf deine Rolle nicht.</div>';
    } else if (handle && !exact) {
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
    $('adminBtn').hidden = !(mode === 'server' && adminAvailable && authMode !== 'discord');
    $('adminBtn').textContent = isAdmin ? 'Admin beenden' : 'Admin';
    if (!p || !isAdmin) { box.dataset.pid = ''; return; }
    if (box.dataset.pid !== p.id) {
      box.dataset.pid = p.id;
      $('admName').value = p.name; $('admRoblox').value = p.roblox; $('admMsg').textContent = '';
    }
  }
  function renderKripo() {
    var p = findPerson(ui.selId);
    var box = $('kripoBox');
    box.hidden = !p || !has('kripo_setzen');
    if (box.hidden) { box.dataset.pid = ''; return; }
    if (box.dataset.pid !== p.id) {
      box.dataset.pid = p.id;
      $('kripoAktiv').checked = !!p.kripo; $('kripoHinweis').value = p.kripoHinweis || ''; $('kripoMsg').textContent = '';
    }
  }
  $('kripoSave').addEventListener('click', function (ev) {
    if (blockIfNoOfficer(ev)) return;
    var p = findPerson(ui.selId);
    if (!p) return;
    $('kripoSave').disabled = true;
    api('people/' + encodeURIComponent(p.id) + '/kripo', { method: 'PUT', body: { aktiv: $('kripoAktiv').checked, hinweis: $('kripoHinweis').value.trim() } })
      .then(function (d) {
        $('kripoSave').disabled = false;
        p.kripo = !!d.person.kripo; p.kripoHinweis = d.person.kripoHinweis || '';
        $('kripoMsg').textContent = p.kripo ? 'Markierung gespeichert.' : 'Markierung entfernt.';
        renderResults(); renderRecord();
        if (ui.tab === 'log') loadLog();
      }).catch(function (e) { $('kripoSave').disabled = false; $('kripoMsg').textContent = e.message; });
  });
  function renderInfo() {
    var p = findPerson(ui.selId);
    var box = $('infoBox');
    box.hidden = !p;
    if (!p) { box.dataset.pid = ''; return; }
    if (box.dataset.pid !== p.id) { box.dataset.pid = p.id; closeInfoForm(); }
    if ($('infoForm').hidden) $('infoEditBtn').hidden = !has('beschreibung');
    var hasAny = p.gruppe || p.gruppeRang || p.beschreibung;
    $('infoView').hidden = !$('infoForm').hidden;
    $('infoView').innerHTML = hasAny
      ? '<dl class="hb-fields">' +
          '<div><dt>Gruppierung</dt><dd>' + (p.gruppe ? '<button type="button" class="log-person" data-action="find-gruppe" data-gruppe="' + esc(p.gruppe) + '">' + esc(p.gruppe) + '</button>' : '-') + '</dd></div>' +
          '<div><dt>Rang</dt><dd>' + esc(p.gruppeRang || '-') + '</dd></div>' +
          (p.beschreibung ? '<div class="wide"><dt>Beschreibung</dt><dd class="info-text">' + esc(p.beschreibung) + '</dd></div>' : '') +
        '</dl>'
      : '<span class="empty-note">Noch keine Beschreibung.</span>';
  }
  function openInfoForm() {
    var p = findPerson(ui.selId);
    if (!p) return;
    $('infoGruppe').value = p.gruppe || ''; $('infoRang').value = p.gruppeRang || ''; $('infoText').value = p.beschreibung || '';
    var gruppen = {};
    people.forEach(function (x) { if (x.gruppe) gruppen[x.gruppe] = true; });
    $('gruppenListe').innerHTML = Object.keys(gruppen).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join('');
    $('infoForm').hidden = false; $('infoView').hidden = true; $('infoEditBtn').hidden = true; $('infoError').textContent = '';
    $('infoGruppe').focus();
  }
  function closeInfoForm() {
    $('infoForm').hidden = true; $('infoView').hidden = false; $('infoEditBtn').hidden = false; $('infoError').textContent = '';
  }
  function closeGruppeForm() {
    $('gruppeForm').hidden = true; $('gruppeView').hidden = false; $('gruppeError').textContent = '';
    $('gruppeEditBtn').hidden = !canGruppe();
  }
  function renderGruppe() {
    var d = gruppeData;
    $('gruppeName').textContent = d ? d.name : ui.gruppe;
    $('gruppeCount').textContent = d && !d.error ? d.mitglieder.length + (d.mitglieder.length === 1 ? ' Mitglied' : ' Mitglieder') : '';
    var ok = canGruppe();
    if ($('gruppeForm').hidden) $('gruppeEditBtn').hidden = !ok;
    $('gruppeRankNote').hidden = ok;
    $('gruppeRankNote').textContent = 'Ändern ab A' + ((me && me.gruppeMinRank) || 6) + '.';
    if (!d) { $('gruppeView').innerHTML = '<span class="empty-note">Wird geladen</span>'; $('gruppeMembers').innerHTML = ''; return; }
    if (d.error) { $('gruppeView').innerHTML = '<span class="error-msg">' + esc(d.error) + '</span>'; $('gruppeMembers').innerHTML = ''; return; }
    $('gruppeView').innerHTML = d.beschreibung
      ? '<p class="info-text gruppe-text">' + esc(d.beschreibung) + '</p>' +
        (d.updatedBy ? '<span class="muted small">Zuletzt geändert von ' + esc(d.updatedBy) + (d.updatedAt ? ', ' + esc(dateTime(d.updatedAt)) : '') + '</span>' : '')
      : '<span class="empty-note">Noch keine Beschreibung.</span>';
    $('gruppeMembers').innerHTML = d.mitglieder.length ? nachStatus(d.mitglieder).map(function (p) {
      return '<button type="button" class="person" data-action="select" data-id="' + esc(p.id) + '">' +
        '<span class="avatar">' + avatarHtml(p) + '</span>' +
        '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + '  ' + esc(p.id) + '</span></span>' +
        '<span class="person-count">' + esc(p.gruppeRang || 'ohne Rang') + '</span>' +
(p.kripo ? '<span class="person-kripo" title="' + esc(p.kripoHinweis || 'Kripo') + '">Kripo</span>' : '') +
        (p.haftbefehle ? '<span class="person-hb">Haftbefehl</span>' : '') +
        '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></button>';
    }).join('') : '<span class="empty-note">Keine Mitglieder eingetragen.</span>';
  }
  function renderRecord() {
    var gv = ui.view === 'gruppe';
    $('gruppeBox').hidden = !gv;
    $('record').hidden = gv; $('history').hidden = gv;
    if (gv) {
      ['infoBox', 'hbBox', 'strafeBox', 'adminBox', 'kripoBox'].forEach(function (id) { $(id).hidden = true; });
      renderGruppe();
      return;
    }
    renderAdmin();
    renderInfo();
    renderKripo();
    var box = $('record'), hist = $('history');
    var p = findPerson(ui.selId);
    $('strafeBox').hidden = !p || !has('strafen');
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
    var oHaft = offen.some(function (e) { return e.haft > 0; });

    var openBox = !loaded ? '<div class="due due-none">Wird geladen</div>'
      : offen.length
        ? '<div class="due"><div class="due-label">Ausstehend</div>' +
            '<div class="due-values"><span><strong>' + euro(oGeld) + '</strong> Geldstrafe</span>' +
              (oHaft ? '<span class="due-haft"><strong>Haft</strong> ins Gefängnis bringen</span>' : '<span class="muted">keine Haft</span>') + '</div>' +
            (has('strafen') ? '<button type="button" class="btn btn-primary" data-action="all-done"' + (ui.busy ? ' disabled' : '') + '>Erledigt</button>' : '') + '</div>'
        : '<div class="due due-none">Nichts ausstehend.</div>';

    box.innerHTML =
      '<section class="card flush">' +
        (p.kripo ? '<div class="alert alert-kripo" role="alert"><span class="alert-title">KRIPO</span>' +
          (p.kripoHinweis ? '<span class="alert-sub">' + esc(p.kripoHinweis) + '</span>' : '') + '</div>' : '') +
        (p.haftbefehle ? '<div class="alert alert-hb" role="alert">OFFENER HAFTBEFEHL</div>' : '') +
        (p.danger ? '<div class="alert" role="alert">GEFÄHRLICH</div>' : '') +
        '<div class="record-body">' +
          '<div class="record-head"><span class="avatar">' + avatarHtml(p) + '</span>' +
            '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0"><h2>' + esc(p.name) + '</h2>' +
            '<span class="muted small mono">@' + esc(p.roblox) + '  ' + esc(p.id) + '</span></div>' +
            '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px">Status ' +
              '<select class="status-select" data-action="status"' + (has('personen') ? '' : ' disabled') + '>' + STATUSES.map(function (s) {
                return '<option' + (s === p.status ? ' selected' : '') + '>' + s + '</option>';
              }).join('') + '</select></label>' +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer">' +
              '<input type="checkbox" data-action="danger"' + (p.danger ? ' checked' : '') + (has('personen') ? '' : ' disabled') + ' style="width:18px;height:18px;accent-color:#FF6B6B;margin:0"> Gefährlich</label>' +
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
          (!e.erledigt && ui.edit && ui.edit.eid === e.id ? '' : e.erledigt
            ? '<span class="entry-actions"><span class="tag-done">Erledigt</span>' +
              (isAdmin ? '<button type="button" class="mini mini-danger" data-action="remove" data-done="1" data-eid="' + e.id + '">Löschen</button>' : '') + '</span>'
            : !has('strafen') ? '<span class="entry-actions"><span class="tag-open">Ausstehend</span></span>'
            : '<span class="entry-actions"><span class="tag-open">Ausstehend</span>' +
              '<button type="button" class="mini" data-action="done" data-eid="' + e.id + '">Erledigt</button>' +
              '<button type="button" class="mini mini-danger" data-action="remove" data-eid="' + e.id + '">Entfernen</button></span>') +
          '</div>' + adjustForm(e) + '</div>';
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
    var hbOk = canHb();
    $('hbNewBtn').hidden = !hbOk || !$('hbForm').hidden;
    $('hbRankNote').hidden = hbOk;
    $('hbRankNote').textContent = 'Haftbefehle ausstellen und bearbeiten ab A' + ((me && me.hbMinRank) || 4) + '.';
    if (!hbOk) $('hbForm').hidden = true;
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
            (!hbOk ? '' : open
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
    $('hbForm').hidden = true; $('hbNewBtn').hidden = !canHb(); $('hbFormError').textContent = '';
    ['hbKz', 'hbModell', 'hbGrund', 'hbBeweise'].forEach(function (id) { $(id).value = ''; });
  }

  // Strafen sind laut Katalog fest; Anpassen gibt es nicht mehr
  function adjustForm() { return ''; }

  function renderStrafen() {
    var q = ui.sq.trim().toLowerCase().replace(/^§\s*/, '');
    var list = KATALOG.filter(function (c) {
      if (!q) return true;
      // Nummer laut Aushang, Paragraph („249“, „StVO“) oder Name
      return String(c.nr) === q || c.para.toLowerCase().replace(/§\s*/g, '').indexOf(q) !== -1 ||
        c.name.toLowerCase().indexOf(q) !== -1 || c.gruppe.toLowerCase().indexOf(q) !== -1 ||
        (c.hinweis || '').toLowerCase().indexOf(q) !== -1 || (c.zusatz || '').toLowerCase().indexOf(q) !== -1;
    });
    var last = '';
    $('strafeResults').innerHTML = !KATALOG.length ? '<span class="empty-note">Strafkatalog wird geladen</span>' : list.length ? list.map(function (c) {
      var head = c.gruppe !== last ? '<h4 class="cat-group">' + esc(c.gruppe) + '</h4>' : '';
      last = c.gruppe;
      return head + '<button type="button" class="strafe-btn" data-action="give" data-nr="' + c.nr + '"' + (ui.busy ? ' disabled' : '') + '>' +
        '<span class="name"><span class="nr">' + c.nr + '</span> <span class="para">' + esc(c.para) + '</span> ' + esc(c.name) +
          (c.hinweis ? ' <span class="strafe-hinweis">' + esc(c.hinweis) + '</span>' : '') + '</span>' +
        '<span class="price">' + esc(katalogPreis(c)) + (c.zusatz ? '<span class="strafe-zusatz">' + esc(c.zusatz) + '</span>' : '') + '</span></button>';
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
    if (isAdmin) { setAdminKey(''); loadPerms().then(renderRecord); return; }
    openAdminGate();
  });
  $('adminCancel').addEventListener('click', function () { $('adminGate').hidden = true; $('adminKey').value = ''; });
  $('adminForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var prev = adminKey;
    setAdminKey($('adminKey').value.trim());
    api('admin').then(function () {
      $('adminGate').hidden = true; $('adminKey').value = '';
      loadPerms().then(renderRecord);
    }).catch(function (e) { setAdminKey(prev); $('adminError').textContent = e.message; });
  });
  function checkAdmin() {
    if (authMode === 'discord' || !adminKey || mode !== 'server') return;
    api('admin').then(function () { return loadPerms(); }).then(renderRecord)
      .catch(function () { setAdminKey(''); loadPerms().then(renderRecord); });
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
    'keine-rolle': 'Kein Zugriff: Deine Discord-Rollen haben kein Recht, die Datenbank zu öffnen.',
    'abgebrochen': 'Anmeldung abgebrochen.',
    'ungueltig': 'Anmeldung abgelaufen. Bitte noch einmal versuchen.',
    'fehler': 'Anmeldung bei Discord fehlgeschlagen. Bitte noch einmal versuchen.'
  };
  var keyLoginAllowed = false;
  var AUTH_CHOICE = 'polis.authChoice';
  function showDiscordGate(msg) {
    $('discordGate').hidden = false;
    $('discordError').textContent = msg || '';
    $('keyLoginBtn').hidden = !keyLoginAllowed;
  }
  // Testphase: Anmeldung mit Dienstschlüssel statt Discord
  function enterKeyLogin() {
    authMode = 'key'; me = null; mode = 'server';
    lsSet(AUTH_CHOICE, 'key');
    $('discordGate').hidden = true;
    renderMe(); renderOfficer(); renderMode();
    if (!key) { showGate(''); return; }
    api('auth').then(function () { enterServer(); })
      .catch(function (e) { if (e.status !== 401) showGate(e.message); });
  }
  $('keyLoginBtn').addEventListener('click', enterKeyLogin);
  $('gateBackBtn').addEventListener('click', function () {
    lsSet(AUTH_CHOICE, '');
    $('gate').hidden = true;
    enterDiscord();
  });
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
      me = m; setPerms(m);
      $('discordGate').hidden = true;
      renderMe(); renderOfficer();
      enterServer();
    }).catch(function (e) {
      showDiscordGate(reason ? (LOGIN_REASONS[reason] || '') : (e.status === 401 ? '' : e.message));
    });
  }
  function showGate(msg) {
    $('gateBackBtn').hidden = !keyLoginAllowed;
    $('gate').hidden = false;
    $('gateError').textContent = msg || '';
    setTimeout(function () { $('gateKey').focus(); }, 0);
  }
  function enterServer() {
    logList = null;
    mode = 'server'; store = ServerStore; people = []; akten = {}; ui.loading = true; ui.selId = null;
    renderMode(); renderResults(); renderRecord();
    refreshPeople().then(function () { loadAkte(ui.selId); loadHb(ui.selId); });
    if (authMode === 'discord') renderPermUi(); else loadPerms();
    checkAdmin();
  }
  function enterLocal() {
    logList = null;
    mode = 'local'; store = LocalStore; ui.loading = true;
    renderMode(); renderPermUi();
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
    if (keyLoginAllowed) { lsSet(AUTH_CHOICE, ''); isAdmin = false; enterDiscord(); return; }
    showGate('');
  });

  // ---------- Events ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;

    if (a === 'select') {
      ui.view = 'person';
      if (ui.selId !== el.dataset.id) closeHbForm();
      ui.edit = null;
      ui.selId = el.dataset.id; ui.msg = ''; ui.error = ''; ui.hbMsg = '';
      if (!findPerson(ui.selId)) { refreshPeople(); }
      renderResults(); renderRecord(); loadAkte(ui.selId, mode === 'server'); loadHb(ui.selId);
    } else if (a === 'create') {
      createPerson($('create').dataset.handle, ($('newName') && $('newName').value.trim().slice(0, 60)) || '');
    } else if (a === 'give') {
      var p = findPerson(ui.selId);
      var c = KATALOG.find(function (k) { return k.nr === Number(el.dataset.nr); });
      if (!p || !c || ui.busy) return;
      run(p, store.addEntries(p.id, [{ nr: c.nr }]), c.para + ' ' + c.name + ' vergeben.' + (c.haft ? ' Person ins Gefängnis bringen.' : ''));
    } else if (a === 'all-done') {
      var p2 = findPerson(ui.selId);
      if (p2 && !ui.busy) run(p2, store.allDone(p2.id), '');
    } else if (a === 'find-gruppe' || a === 'open-gruppe') {
      if (a === 'find-gruppe') { ui.tab = 'gruppen'; ui.q = ''; $('q').value = ''; if (!gruppenList) loadGruppen(); }
      openGruppe(el.dataset.gruppe);
    } else if (a === 'adjust') {
      var pa = findPerson(ui.selId);
      var ea = pa && (akten[pa.id] || []).find(function (x) { return x.id === Number(el.dataset.eid); });
      if (!ea) return;
      ui.edit = { eid: ea.id, geld: ea.geld, haft: ea.haft };
      renderRecord();
      var f = $('adjHaft'); if (f) f.focus();
    } else if (a === 'adj-cancel') {
      ui.edit = null; renderRecord();
    } else if (a === 'adj-save') {
      var ps = findPerson(ui.selId);
      var es = ps && (akten[ps.id] || []).find(function (x) { return x.id === Number(el.dataset.eid); });
      var cs = es && catFor(es);
      if (!es || !cs || !cs.haft || ui.busy) return;
      var h = clampTo($('adjHaft').value, cs.haft);
      ui.edit = null;
      run(ps, store.adjust(ps.id, es.id, cs.geld, h), 'Haftzeit gespeichert: ' + h + ' Min.');
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
  $('tabGruppen').addEventListener('click', function () { ui.tab = 'gruppen'; renderResults(); loadGruppen(); });
  $('gruppeEditBtn').addEventListener('click', function (ev) {
    if (blockIfNoOfficer(ev) || !gruppeData || gruppeData.error) return;
    $('gruppeText').value = gruppeData.beschreibung || '';
    $('gruppeForm').hidden = false; $('gruppeView').hidden = true; $('gruppeEditBtn').hidden = true;
    $('gruppeText').focus();
  });
  $('gruppeCancel').addEventListener('click', closeGruppeForm);
  $('gruppeForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (blockIfNoOfficer(ev) || !gruppeData) return;
    var name = gruppeData.name, btn = $('gruppeForm').querySelector('[type="submit"]');
    btn.disabled = true;
    store.gruppeSave(name, $('gruppeText').value.trim()).then(function () {
      btn.disabled = false; closeGruppeForm();
      openGruppe(name); loadGruppen();
      if (ui.tab === 'log') loadLog();
    }).catch(function (e) { btn.disabled = false; $('gruppeError').textContent = e.message; });
  });
  $('hbNewBtn').addEventListener('click', function () {
    $('hbForm').hidden = false; $('hbNewBtn').hidden = true; $('hbFormError').textContent = '';
    $('hbGrund').focus();
  });
  $('hbCancel').addEventListener('click', closeHbForm);
  loadKatalog();
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
  function selectPerson(id) {
    ui.view = 'person'; ui.tab = 'personen'; ui.edit = null;
    if (ui.selId !== id) closeHbForm();
    ui.selId = id; ui.msg = ''; ui.error = ''; ui.hbMsg = '';
    renderResults(); renderRecord(); loadAkte(id, mode === 'server'); loadHb(id);
  }

  // ---------- Vorschläge beim Tippen (Personensuche) ----------
  var sug = { items: [], active: -1, timer: null, seq: 0, roblox: [], q: '', zu: false }; // zu = vom Nutzer geschlossen
  function sugAvatar(url, name) {
    return '<span class="avatar sug-avatar">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : esc(initials(name))) + '</span>';
  }
  function closeSuggest() {
    $('suggest').hidden = true; $('q').setAttribute('aria-expanded', 'false'); $('q').removeAttribute('aria-activedescendant');
    sug.active = -1;
  }
  function renderSuggest() {
    var raw = $('q').value.trim(), q = raw.toLowerCase().replace(/^@+/, '');
    if (q.length < 2 || ui.tab !== 'personen') { closeSuggest(); return; }
    var db = people.filter(function (p) {
      return p.roblox.toLowerCase().indexOf(q) !== -1 || p.name.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 5);
    var dbIds = {}; db.forEach(function (p) { dbIds[p.id] = true; });
    var rb = sug.q === q ? sug.roblox.filter(function (u) { return !u.personId || !dbIds[u.personId]; }).slice(0, 8) : [];
    sug.items = db.map(function (p) { return { type: 'person', id: p.id }; })
      .concat(rb.map(function (u) { return u.personId ? { type: 'person', id: u.personId } : { type: 'roblox', name: u.name }; }));
    var i = -1, html = '';
    if (db.length) {
      html += '<div class="sug-head">In der Datenbank</div>' + db.map(function (p) {
        i++;
        return '<div class="sug-item" role="option" id="sug' + i + '" data-i="' + i + '">' + sugAvatar(p.robloxId ? '/api/avatar/' + p.robloxId : '', p.name) +
          '<span class="person-main"><strong>' + esc(p.name) + '</strong><span>@' + esc(p.roblox) + '</span></span>' +
          (p.haftbefehle ? '<span class="person-hb">Haftbefehl</span>' : '') + '<span class="chip ' + chipClass(p.status) + '">' + esc(p.status) + '</span></div>';
      }).join('');
    }
    if (mode === 'server' && q.length >= 3) {
      html += '<div class="sug-head">Roblox-Accounts' + (sug.q !== q ? ' <span class="muted">(suche …)</span>' : '') + '</div>';
      if (sug.q === q && sug.quelle === 'exakt') html += '<div class="sug-empty">Die Roblox-Suche antwortet gerade nicht, deshalb wird nur der exakt getippte Name geprüft.</div>';
      else if (sug.q === q && !rb.length) html += '<div class="sug-empty">Kein weiterer Roblox-Account gefunden.</div>';
      html += rb.map(function (u) {
        i++;
        var tag = u.personId ? '<span class="sug-tag">erfasst</span>' : has('personen') ? '<span class="sug-tag sug-new">anlegen</span>' : '';
        return '<div class="sug-item" role="option" id="sug' + i + '" data-i="' + i + '">' + sugAvatar(u.avatar, u.name) +
          '<span class="person-main"><strong>' + esc(u.displayName || u.name) + '</strong><span>@' + esc(u.name) + '</span></span>' + tag + '</div>';
      }).join('');
    }
    if (!html) { closeSuggest(); return; }
    $('suggest').innerHTML = html;
    $('suggest').hidden = false; $('q').setAttribute('aria-expanded', 'true');
    if (sug.active >= sug.items.length) sug.active = -1;
    markActive();
  }
  function markActive() {
    document.querySelectorAll('#suggest .sug-item').forEach(function (el) {
      var on = Number(el.dataset.i) === sug.active;
      el.classList.toggle('active', on); el.setAttribute('aria-selected', String(on));
      if (on) { $('q').setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function pickSuggest(i) {
    var it = sug.items[i];
    if (!it) return;
    closeSuggest();
    if (it.type === 'person') {
      if (!findPerson(it.id)) { refreshPeople().then(function () { selectPerson(it.id); }); return; }
      selectPerson(it.id);
    } else if (has('personen')) {
      if (blockIfNoOfficer({ preventDefault: function () {}, stopImmediatePropagation: function () {} })) return;
      ui.q = '@' + it.name; $('q').value = ui.q; renderResults();
      createPerson(it.name.toLowerCase(), '');
    } else {
      ui.q = '@' + it.name; $('q').value = ui.q; renderResults();
    }
  }
  function querySuggest() {
    var q = $('q').value.trim().toLowerCase().replace(/^@+/, '');
    clearTimeout(sug.timer);
    renderSuggest();
    if (mode !== 'server' || !/^[a-z0-9_.]{3,20}$/.test(q) || sug.q === q) return;
    var my = ++sug.seq;
    sug.timer = setTimeout(function () {
      api('roblox/suche?q=' + encodeURIComponent(q)).then(function (d) {
        if (my !== sug.seq) return; // inzwischen weitergetippt
        sug.q = q; sug.roblox = d.accounts || []; sug.quelle = d.quelle || '';
        if (!sug.zu && document.activeElement === $('q')) renderSuggest();
      }).catch(function () { if (my === sug.seq) { sug.q = q; sug.roblox = []; if (!sug.zu && document.activeElement === $('q')) renderSuggest(); } });
    }, 300);
  }
  $('suggest').addEventListener('mousedown', function (ev) {
    var el = ev.target.closest('.sug-item'); if (!el) return;
    ev.preventDefault(); pickSuggest(Number(el.dataset.i));
  });
  $('q').addEventListener('input', function () { sug.zu = false; querySuggest(); });
  $('q').addEventListener('focus', renderSuggest);
  $('q').addEventListener('blur', function () { setTimeout(closeSuggest, 150); });

  function createPerson(handle, name) {
      if (!handle || ui.busy) return;
      ui.busy = true; ui.createError = ''; renderResults();
      store.create(handle, name).then(function (p) {
        ui.busy = false;
        if (!findPerson(p.id)) people.unshift(p);
        akten[p.id] = akten[p.id] || [];
        hbByPerson[p.id] = hbByPerson[p.id] || [];
        ui.selId = p.id; ui.msg = ''; ui.view = 'person';
        ui.q = '@' + p.roblox; $('q').value = ui.q;
        renderResults(); renderRecord();
        if (mode === 'server') loadAkte(p.id, true);
      }).catch(function (e) { ui.busy = false; ui.createError = e.message; renderResults(); });
  }

  $('q').addEventListener('keydown', function (ev) {
    var open = !$('suggest').hidden && sug.items.length;
    if (ev.key === 'ArrowDown' && open) { ev.preventDefault(); sug.active = (sug.active + 1) % sug.items.length; markActive(); return; }
    if (ev.key === 'ArrowUp' && open) { ev.preventDefault(); sug.active = sug.active <= 0 ? sug.items.length - 1 : sug.active - 1; markActive(); return; }
    if (ev.key === 'Escape') { sug.zu = true; closeSuggest(); return; }
    if (ev.key === 'Enter') {
      if (open && sug.active >= 0) { ev.preventDefault(); pickSuggest(sug.active); return; }
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
  $('infoEditBtn').addEventListener('click', function (ev) { if (!blockIfNoOfficer(ev)) openInfoForm(); });
  $('infoCancel').addEventListener('click', closeInfoForm);
  $('infoForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (blockIfNoOfficer(ev)) return;
    var p = findPerson(ui.selId);
    if (!p) return;
    var patch = { gruppe: $('infoGruppe').value.trim(), gruppeRang: $('infoRang').value.trim(), beschreibung: $('infoText').value.trim() };
    var btn = $('infoForm').querySelector('[type="submit"]'); btn.disabled = true;
    store.update(p.id, patch).then(function (np) {
      btn.disabled = false;
      Object.assign(p, { gruppe: np.gruppe, gruppeRang: np.gruppeRang, beschreibung: np.beschreibung });
      closeInfoForm(); gruppenList = null; if (ui.tab === 'gruppen') loadGruppen(); renderResults(); renderRecord();
      if (ui.tab === 'log') loadLog();
    }).catch(function (e) { btn.disabled = false; $('infoError').textContent = e.message; });
  });
  var WRITE_ACTIONS = ['create', 'give', 'all-done', 'done', 'remove', 'hb-set', 'hb-delete', 'adjust', 'adj-save'];
  // Eingaben beim Anpassen merken, damit ein Neuzeichnen sie nicht verliert
  document.addEventListener('input', function (ev) {
    if (!ui.edit) return;
    if (ev.target.id === 'adjGeld') ui.edit.geld = ev.target.value;
    if (ev.target.id === 'adjHaft') ui.edit.haft = ev.target.value;
  });
  document.addEventListener('keydown', function (ev) {
    if (ui.edit && ev.key === 'Enter' && (ev.target.id === 'adjGeld' || ev.target.id === 'adjHaft')) {
      var b = document.querySelector('[data-action="adj-save"]'); if (b) b.click();
    } else if (ui.edit && ev.key === 'Escape') { ui.edit = null; renderRecord(); }
  });
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
      if (!ui.edit && $('infoForm').hidden) { refreshPeople(); if (ui.selId) { loadAkte(ui.selId, true); loadHb(ui.selId); } }
      if (ui.tab === 'log') loadLog();
      if (ui.tab === 'gruppen') loadGruppen();
      if (ui.view === 'gruppe' && $('gruppeForm').hidden) store.gruppe(ui.gruppe).then(function (d) { if (ui.view === 'gruppe') { gruppeData = d; renderRecord(); } }).catch(function () {});
      if (authMode === 'discord') api('me').then(function (m) { me = m; setPerms(m); renderMe(); renderPermUi(); renderRecord(); }).catch(function () {});
      if (view === 'schicht') loadSchicht();
      if (view === 'beamte' && !bEdit) loadBeamte();
    }
  }, 20000);

  // ======================================================================
  // Bereiche: Datenbank, Schicht, Polizei-Register, Rechte
  // ======================================================================
  var view = 'db';
  function renderPermUi() {
    var server = mode === 'server';
    var show = {
      schicht: server, // „Im Dienst“ sieht jeder; die eigene Uhr nur mit Recht „schicht“
      beamte: server && has('register_sehen'),
      rechte: server && authMode === 'discord' && has('rechte')
    };
    $('navSchicht').hidden = !show.schicht; $('navBeamte').hidden = !show.beamte; $('navRechte').hidden = !show.rechte;
    $('mainNav').hidden = !(show.schicht || show.beamte || show.rechte);
    if (view !== 'db' && !show[view]) view = 'db';
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      var on = b.dataset.view === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('viewDb').hidden = view !== 'db'; $('viewSchicht').hidden = view !== 'schicht';
    $('viewBeamte').hidden = view !== 'beamte'; $('viewRechte').hidden = view !== 'rechte';
    renderTabs(); renderRecord();
  }
  function setView(v) {
    view = v; renderPermUi();
    if (v === 'schicht') loadSchicht();
    if (v === 'beamte') loadBeamte();
    if (v === 'rechte') loadRechte();
  }
  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); });
  });

  // ---------- Schicht ----------
  var sData = null, mData = null, sWeek = '', sOffset = 0, sBusy = false, dData = null, dOffset = 0;
  function hm(ms) { var m = Math.floor(Math.max(0, ms) / 60000); return Math.floor(m / 60) + ':' + pad(m % 60) + ' h'; }
  function hms(ms) { var t = Math.floor(Math.max(0, ms) / 1000); return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60); }
  function hhmmTs(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayName(ts) { var d = new Date(ts); return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'; }
  // Woche aus dem Montag (YYYY-MM-DD, deutsche Zeit), unabhängig von der Zeitzone des Geräts
  function weekLabel(w) {
    var a = new Date(w.key + 'T00:00:00Z'), b = new Date(a.getTime() + 6 * 864e5);
    return pad(a.getUTCDate()) + '.' + pad(a.getUTCMonth() + 1) + '. bis ' + pad(b.getUTCDate()) + '.' + pad(b.getUTCMonth() + 1) + '.' + b.getUTCFullYear();
  }
  // laufende Zeit seit der Server-Antwort dazurechnen
  function live(sh) {
    if (!sh) return 0;
    return sh.dauerMs + (sh.status === 'aktiv' ? Date.now() - sOffset : 0);
  }
  function loadSchicht() {
    var q = sWeek ? '?woche=' + sWeek : '';
    var jobs = [api('schicht/aktiv').then(function (d) { dData = d; dOffset = Date.now(); })];
    // sOffset = Zeitpunkt der Antwort (Uhr dieses Geräts); laufende Zeit zählt ab da weiter
    if (has('schicht')) jobs.push(api('schicht' + q).then(function (d) { sData = d; sOffset = Date.now(); }));
    if (has('schicht_alle')) jobs.push(api('schicht/uebersicht' + q).then(function (d) { mData = d; if (!has('schicht')) sOffset = Date.now(); }));
    return Promise.all(jobs).then(function () { $('sError').textContent = ''; renderSchicht(); })
      .catch(function (e) { $('sError').textContent = e.message; renderSchicht(); });
  }
  function renderSchicht() {
    var own = has('schicht');
    $('sClock').closest('.card').hidden = !own; $('wLabel').closest('.card').hidden = !own && !has('schicht_alle');
    var d = sData;
    var a = own && d ? d.aktiv : null;
    var label = a ? (a.status === 'pause' ? 'Pause' : 'Im Dienst') : 'Außer Dienst';
    $('sStatus').className = 'chip ' + (a ? (a.status === 'pause' ? 'chip-amber' : 'chip-green') : '');
    $('sStatus').textContent = label;
    $('sClock').textContent = hms(live(a));
    $('sSub').textContent = !own ? 'Deine Rolle erfasst keine Schichtzeit.' : a ? 'Seit ' + hhmmTs(a.start) + ' Uhr' + (a.pauseMs ? ', Pausen ' + hm(a.pauseMs + (a.status === 'pause' ? Date.now() - sOffset : 0)) : '') : 'Keine laufende Schicht';
    $('sButtons').innerHTML = !own || !d ? '' : !a
      ? '<button type="button" class="btn btn-primary" data-schicht="start"' + (sBusy ? ' disabled' : '') + '>Schicht starten</button>'
      : '<button type="button" class="btn btn-amber" data-schicht="' + (a.status === 'pause' ? 'weiter' : 'pause') + '"' + (sBusy ? ' disabled' : '') + '>' + (a.status === 'pause' ? 'Fortsetzen' : 'Pause') + '</button>' +
        '<button type="button" class="btn btn-red" data-schicht="ende"' + (sBusy ? ' disabled' : '') + '>Beenden</button>';
    var w = (d && d.woche) || (mData && mData.woche);
    $('wLabel').textContent = w ? weekLabel(w) : '';
    var quote = d ? d.quoteMin : mData ? mData.quoteMin : 0;
    if (own && d) {
      var running = d.schichten.reduce(function (acc, x) { return acc + (x.status === 'aktiv' ? Date.now() - sOffset : 0); }, 0);
      var sum = d.summeMs + running;
      var pct = quote ? Math.min(100, Math.round(sum / (quote * 60000) * 100)) : 0;
      $('sWeek').innerHTML = '<div class="week-sum"><span class="mono">' + hm(sum) + '</span>' +
        (quote ? '<span class="muted"> von ' + hm(quote * 60000) + ' Quote</span>' : '<span class="muted"> (keine Quote festgelegt)</span>') + '</div>' +
        (quote ? '<div class="bar" role="img" aria-label="' + pct + ' Prozent der Quote"><span style="width:' + pct + '%"></span></div>' +
          '<span class="small ' + (sum >= quote * 60000 ? 'quote-ok' : 'muted') + '">' + (sum >= quote * 60000 ? 'Quote erfüllt' : 'Noch ' + hm(quote * 60000 - sum)) + '</span>' : '');
      $('sList').innerHTML = d.schichten.length ? d.schichten.map(function (x) {
        return '<div class="shift-row"><span><span>' + esc(dayName(x.start)) + '</span><span class="muted small mono">' + hhmmTs(x.start) + ' bis ' + (x.ende ? hhmmTs(x.ende) : 'läuft') + '</span></span>' +
          '<span class="mono">' + hm(x.dauerMs + (x.status === 'aktiv' ? Date.now() - sOffset : 0)) + '</span></div>';
      }).join('') : '<span class="empty-note">Keine Schichten in dieser Woche.</span>';
    } else {
      $('sWeek').innerHTML = ''; $('sList').innerHTML = '';
    }
    // Im Dienst (für alle)
    if (dData) {
      var list = dData.imDienst;
      var nSek = list.filter(function (x) { return x.einheit === 'SEK'; }).length;
      $('dienstCount').textContent = list.length ? list.length + ' im Dienst' + (nSek ? ' (' + (list.length - nSek) + ' Polizei, ' + nSek + ' SEK)' : '') : '';
      $('dienstList').innerHTML = list.length ? list.map(function (x) {
        var t = x.dauerMs + (x.status === 'aktiv' ? Date.now() - dOffset : 0);
        return '<div class="dienst-row' + (x.ich ? ' ich' : '') + '">' +
          '<span class="einheit einheit-' + (x.einheit === 'SEK' ? 'sek' : 'polizei') + '">' + esc(x.einheit) + '</span>' +
          '<span class="person-main"><strong>' + esc(x.name) + (x.ich ? ' <span class="muted">(du)</span>' : '') + '</strong>' +
          '<span>seit ' + hhmmTs(x.start) + ' Uhr</span></span>' +
          (x.status === 'pause' ? '<span class="chip chip-amber">Pause</span>' : '<span class="chip chip-green">Im Dienst</span>') +
          '<span class="mono dienst-zeit">' + hms(t) + '</span></div>';
      }).join('') : '<span class="empty-note">Gerade ist niemand im Dienst.</span>';
    }
    // Management
    var mg = has('schicht_alle');
    $('mgmtBox').hidden = !mg;
    $('quoteForm').hidden = !has('quote');
    if (mg && mData) {
      var q = mData.quoteMin * 60000;
      $('mgmtQuote').textContent = mData.quoteMin ? 'Quote ' + hm(q) : 'Keine Quote festgelegt';
      if (document.activeElement !== $('quoteInput')) $('quoteInput').value = mData.quoteMin ? String(mData.quoteMin / 60) : '';
      $('mgmtTable').innerHTML = '<thead><tr><th>Beamter</th><th>Zeit</th><th>Quote</th><th>Jetzt</th></tr></thead><tbody>' +
        (mData.beamte.length ? mData.beamte.map(function (b) {
          var t = b.summeMs + (b.aktiv && b.aktiv.status === 'aktiv' && b.aktiv.start >= mData.woche.start ? Date.now() - sOffset : 0);
          return '<tr><td>' + esc(b.name || b.uid) + '</td><td class="mono">' + hm(t) + '</td>' +
            '<td>' + (q ? (t >= q ? '<span class="quote-ok">erfüllt</span>' : '<span class="muted">fehlt ' + hm(q - t) + '</span>') : '<span class="muted">-</span>') + '</td>' +
            '<td>' + (b.aktiv ? '<span class="chip ' + (b.aktiv.status === 'pause' ? 'chip-amber' : 'chip-green') + '">' + (b.aktiv.status === 'pause' ? 'Pause' : 'Im Dienst') + '</span> ' +
              '<button type="button" class="mini mini-danger" data-schicht-end="' + b.aktiv.id + '" data-name="' + esc(b.name || '') + '">Beenden</button>' : '<span class="muted">-</span>') + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="muted">Noch keine Schichten erfasst.</td></tr>') + '</tbody>';
    }
  }
  $('sButtons').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-schicht]');
    if (!b || sBusy) return;
    sBusy = true; renderSchicht();
    api('schicht', { method: 'POST', body: { aktion: b.dataset.schicht } })
      .then(function () { sBusy = false; return loadSchicht(); })
      .catch(function (e) { sBusy = false; $('sError').textContent = e.message; renderSchicht(); });
  });
  $('mgmtTable').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-schicht-end]');
    if (!b || !confirm('Schicht von ' + b.dataset.name + ' jetzt beenden?')) return;
    api('schicht/beenden/' + b.dataset.schichtEnd, { method: 'POST' }).then(loadSchicht)
      .catch(function (e) { $('mgmtMsg').textContent = e.message; });
  });
  $('quoteForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var w = (sData && sData.woche) || (mData && mData.woche);
    api('schicht/quote', { method: 'PUT', body: { woche: w ? w.key : '', stunden: Number($('quoteInput').value) } })
      .then(function () { $('mgmtMsg').textContent = 'Quote gespeichert.'; $('quoteInput').blur(); return loadSchicht(); })
      .catch(function (e) { $('mgmtMsg').textContent = e.message; });
  });
  $('wPrev').addEventListener('click', function () { var w = (sData || mData || {}).woche; if (w) { sWeek = w.prev; loadSchicht(); } });
  $('wNext').addEventListener('click', function () { var w = (sData || mData || {}).woche; if (w) { sWeek = w.next; loadSchicht(); } });
  setInterval(function () { if (view === 'schicht' && !document.hidden) renderSchicht(); }, 1000);

  // ---------- Polizei-Register ----------
  var bData = null, bSel = null, bEdit = null; // bEdit: null | 'neu' | id
  function loadBeamte() {
    return api('beamte').then(function (d) { bData = d; renderBeamte(); })
      .catch(function (e) { $('bCount').textContent = e.message; });
  }
  function ausbList(t) { return String(t || '').split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function statusClass(st) { return { 'Aktiv': 'chip-green', 'In Ausbildung': 'chip-blue', 'Beurlaubt': 'chip-amber', 'Suspendiert': 'chip-red' }[st] || ''; }
  function renderBeamte() {
    var canEdit = has('register_bearbeiten');
    $('bNew').hidden = !canEdit || !!bEdit;
    if (!bData) { $('bCount').textContent = 'Wird geladen'; return; }
    var q = $('bQ').value.trim().toLowerCase();
    var list = bData.beamte.filter(function (b) {
      return !q || [b.name, b.dienstnummer, b.rang, b.discord, b.status, b.ausbildungen].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    $('bCount').textContent = list.length + (list.length === 1 ? ' Beamter' : ' Beamte');
    $('bList').innerHTML = list.length ? list.map(function (b) {
      return '<button type="button" class="person' + (b.id === bSel ? ' selected' : '') + '" data-bid="' + b.id + '">' +
        '<span class="avatar">' + esc(initials(b.name)) + '</span>' +
        '<span class="person-main"><strong>' + esc(b.name) + '</strong><span>' + esc([b.dienstnummer, b.rang].filter(Boolean).join('  ') || '-') + '</span></span>' +
        '<span class="chip ' + statusClass(b.status) + '">' + esc(b.status) + '</span></button>';
    }).join('') : '<div class="placeholder">' + (bData.beamte.length ? 'Kein Treffer.' : 'Noch niemand im Register.') + '</div>';
    var b = bData.beamte.find(function (x) { return x.id === bSel; });
    $('bFormBox').hidden = !bEdit;
    $('bDetail').hidden = !!bEdit || !b;
    if (b && !bEdit) {
      var ausb = ausbList(b.ausbildungen);
      $('bDetail').innerHTML = '<div class="row-between"><div><h2 class="gruppe-title">' + esc(b.name) + '</h2>' +
        '<span class="muted small mono">' + esc([b.dienstnummer, b.discord ? '@' + b.discord : ''].filter(Boolean).join('  ')) + '</span></div>' +
        '<span class="chip ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
        '<dl class="hb-fields"><div><dt>Rang</dt><dd>' + esc(b.rang || '-') + '</dd></div>' +
        '<div><dt>Eintritt</dt><dd>' + esc(b.eintritt ? b.eintritt.split('-').reverse().join('.') : '-') + '</dd></div>' +
        '<div class="wide"><dt>Ausbildungen</dt><dd>' + (ausb.length ? '<span class="tags">' + ausb.map(function (a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('') + '</span>' : '-') + '</dd></div>' +
        (b.notizen ? '<div class="wide"><dt>Notizen</dt><dd class="info-text">' + esc(b.notizen) + '</dd></div>' : '') + '</dl>' +
        (b.updatedBy ? '<span class="muted small">Zuletzt geändert von ' + esc(b.updatedBy) + (b.updatedAt ? ', ' + esc(dateTime(b.updatedAt)) : '') + '</span>' : '') +
        (canEdit ? '<div class="hb-form-actions"><button type="button" class="btn-ghost" id="bEditBtn">Bearbeiten</button></div>' : '');
    }
  }
  function openBForm(b) {
    bEdit = b ? b.id : 'neu';
    $('bFormTitle').textContent = b ? 'Beamten bearbeiten' : 'Beamten eintragen';
    $('bStatus').innerHTML = bData.status.map(function (st) { return '<option>' + esc(st) + '</option>'; }).join('');
    $('bName').value = b ? b.name : ''; $('bNr').value = b ? b.dienstnummer : ''; $('bRang').value = b ? b.rang : '';
    $('bStatus').value = b ? b.status : 'Aktiv'; $('bDiscord').value = b ? b.discord : ''; $('bEintritt').value = b ? b.eintritt : '';
    $('bAusb').value = b ? b.ausbildungen : ''; $('bNotizen').value = b ? b.notizen : '';
    $('bDelete').hidden = !b; $('bError').textContent = '';
    $('bDiscordNames').innerHTML = (bData.discord || []).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('');
    $('bDiscordUsers').innerHTML = (bData.discord || []).map(function (x) { return '<option value="' + esc(x.username) + '">'; }).join('');
    $('bRaenge').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option value="A' + n + '">'; }).join('');
    renderBeamte(); $('bName').focus();
  }
  // Discord-Nickname ausgewählt: Discord-Name automatisch ergänzen
  $('bName').addEventListener('change', function () {
    var m = ((bData && bData.discord) || []).find(function (x) { return x.name === $('bName').value; });
    if (m && !$('bDiscord').value) $('bDiscord').value = m.username;
  });
  $('bList').addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-bid]'); if (!el) return;
    bSel = Number(el.dataset.bid); bEdit = null; renderBeamte();
  });
  $('bDetail').addEventListener('click', function (ev) {
    if (ev.target.id === 'bEditBtn') openBForm(bData.beamte.find(function (x) { return x.id === bSel; }));
  });
  $('bNew').addEventListener('click', function () { openBForm(null); });
  $('bQ').addEventListener('input', renderBeamte);
  $('bCancel').addEventListener('click', function () { bEdit = null; renderBeamte(); });
  $('bForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = { name: $('bName').value.trim(), dienstnummer: $('bNr').value.trim(), rang: $('bRang').value.trim(), status: $('bStatus').value,
      discord: $('bDiscord').value.trim(), eintritt: $('bEintritt').value, ausbildungen: $('bAusb').value.trim(), notizen: $('bNotizen').value.trim() };
    var req = bEdit === 'neu' ? api('beamte', { method: 'POST', body: body }) : api('beamte/' + bEdit, { method: 'PUT', body: body });
    req.then(function (d) { bSel = d.beamter.id; bEdit = null; return loadBeamte(); })
      .catch(function (e) { $('bError').textContent = e.message; });
  });
  $('bDelete').addEventListener('click', function () {
    var b = bData.beamte.find(function (x) { return x.id === bEdit; });
    if (!b || !confirm(b.name + ' aus dem Register entfernen?')) return;
    api('beamte/' + b.id, { method: 'DELETE' }).then(function () { bSel = null; bEdit = null; return loadBeamte(); })
      .catch(function (e) { $('bError').textContent = e.message; });
  });

  // ---------- Rechte ----------
  var rData = null;
  function loadRechte() {
    $('rMsg').textContent = '';
    return api('rechte').then(function (d) { rData = d; renderRechte(); })
      .catch(function (e) { $('rMsg').textContent = e.message; });
  }
  function renderRechte() {
    if (!rData) return;
    var rollen = rData.rollen.filter(function (r) { return !r.admin; });
    // Rechte oben als Spalten, Rollen links als Zeilen
    $('rTable').innerHTML = '<thead><tr><th class="sticky corner" scope="col">Rolle</th>' + rData.perms.map(function (pm) {
      return '<th class="perm-col" scope="col" title="' + esc(pm.desc || '') + '"><span>' + esc(pm.label) + '</span></th>';
    }).join('') + '</tr></thead><tbody>' + rollen.map(function (r) {
      return '<tr><th class="sticky role-row" scope="row">' + esc(r.name) + '</th>' +
        rData.perms.map(function (pm) {
          var on = (rData.matrix[pm.key] || []).indexOf(r.id) !== -1;
          return '<td class="check-cell"><input type="checkbox" aria-label="' + esc(pm.label + ' für ' + r.name) + '" data-perm="' + pm.key + '" data-role="' + esc(r.id) + '"' + (on ? ' checked' : '') + '></td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody>';
    $('rLegend').innerHTML = rData.perms.map(function (pm) {
      return '<div><dt>' + esc(pm.label) + '</dt><dd>' + esc(pm.desc || '') + '</dd></div>';
    }).join('');
    $('rMsg').className = rData.gespeichert ? 'saved' : 'muted small';
    $('rMsg').textContent = rData.gespeichert ? '' : 'Noch nicht gespeichert: Angezeigt werden die Voreinstellungen.';
  }
  $('rSave').addEventListener('click', function () {
    var matrix = {};
    document.querySelectorAll('#rTable input[data-perm]').forEach(function (c) {
      matrix[c.dataset.perm] = matrix[c.dataset.perm] || [];
      if (c.checked) matrix[c.dataset.perm].push(c.dataset.role);
    });
    $('rSave').disabled = true;
    api('rechte', { method: 'PUT', body: { matrix: matrix } }).then(function () {
      $('rSave').disabled = false; return loadRechte().then(function () { $('rMsg').className = 'saved'; $('rMsg').textContent = 'Gespeichert. Gilt für alle nach spätestens 5 Minuten oder neuem Laden.'; });
    }).then(loadPerms).catch(function (e) { $('rSave').disabled = false; $('rMsg').textContent = e.message; });
  });

  // ---------- Start ----------
  savePrefs();
  renderResults(); renderRecord();
  fetch('/api/health', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (h) {
      if (h && h.ok && h.db && h.auth === 'discord') {
        keyLoginAllowed = !!h.keyLogin;
        adminAvailable = !!h.keyLogin && !!h.adminSet;
        if (keyLoginAllowed && lsGet(AUTH_CHOICE) === 'key') enterKeyLogin();
        else enterDiscord();
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
