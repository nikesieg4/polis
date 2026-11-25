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
  // Wer ausstehende Strafen hat, ist automatisch in Fahndung; sonst gilt der eingestellte Status
  function offeneStrafen(p) {
    var a = akten[p.id];
    return Array.isArray(a) ? a.filter(function (e) { return !e.erledigt; }).length : (p.offen || 0);
  }
  function statusVon(p) { return offeneStrafen(p) > 0 ? 'Fahndung' : p.status; }
  function nachStatus(list) {
    return list.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      var ra = STATUS_RANG[statusVon(a.p)] != null ? STATUS_RANG[statusVon(a.p)] : 3;
      var rb = STATUS_RANG[statusVon(b.p)] != null ? STATUS_RANG[statusVon(b.p)] : 3;
      if (ra !== rb) return ra - rb;
      // Fahndung und Bewährung: neuester Eintrag (Strafe oder Haftbefehl) zuerst
      if (ra === 0 || ra === 1) return (b.p.letzterEintrag || 0) - (a.p.letzterEintrag || 0) || a.i - b.i;
      return a.i - b.i;
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
        return { id: local.nextEntry++, nr: c.nr, delikt: c.para + ' ' + c.name, geld: c.geld, haft: c.haft ? 1 : 0, datum: d, beamter: by, erledigt: 0, created_at: Date.now() };
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
          if (!r.ok) { var err = new Error(d.error || ('Fehler ' + r.status)); err.status = r.status; err.vorhandenId = d.vorhandenId; throw err; }
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
  var editMode = false;
  try { editMode = localStorage.getItem('polis.editMode') === '1'; } catch (e) { /* ignorieren */ }
  function kannBearbeiten() { return isAdmin || has('kripo_setzen'); }
  var ui = { akteAlle: false, edit: null, q: '', sq: '', selId: null, msg: '', busy: false, error: '', createError: '', loading: true, tab: 'personen', hbMsg: '' };
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
        '<span class="chip ' + chipClass(statusVon(p)) + '">' + esc(statusVon(p)) + '</span></button>';
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
    box.hidden = !(isAdmin && p && editMode);
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
    box.hidden = !p || !has('kripo_setzen') || !editMode;
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
        '<span class="chip ' + chipClass(statusVon(p)) + '">' + esc(statusVon(p)) + '</span></button>';
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
            '<span class="chip ' + chipClass(statusVon(p)) + '">' + esc(statusVon(p)) + '</span>' +
            (kannBearbeiten() ? '<button type="button" class="edit-toggle' + (editMode ? ' on' : '') + '" data-action="edit-mode" aria-pressed="' + editMode + '" title="Bearbeiten und Kripo-Markierung ein- oder ausblenden">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
              '<span>Bearbeitungsmodus</span></button>' : '') + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
            (offeneStrafen(p) > 0
              ? '<span class="small auto-fahndung">Fahndung automatisch wegen ausstehender Strafen</span>'
              : '<label class="small muted" style="display:flex;align-items:center;gap:8px">Status ' +
                '<select class="status-select" data-action="status"' + (has('personen') ? '' : ' disabled') + '>' + STATUSES.map(function (s) {
                  return '<option' + (s === p.status ? ' selected' : '') + '>' + s + '</option>';
                }).join('') + '</select></label>') +
            '<label class="small muted" style="display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer">' +
              '<input type="checkbox" data-action="danger"' + (p.danger ? ' checked' : '') + (has('personen') ? '' : ' disabled') + ' style="width:18px;height:18px;accent-color:#FF6B6B;margin:0"> Gefährlich</label>' +
          '</div>' +
          openBox +
          (ui.error ? '<span class="error-msg" role="alert">' + esc(ui.error) + '</span>' : '') +
        '</div>' +
      '</section>';

    var GEZEIGT = 3;
    var sichtbar = ui.akteAlle ? akte : akte.slice(0, GEZEIGT);
    hist.innerHTML = '<section class="card"><div class="row-between"><h2>Strafregister</h2>' +
      (loaded && akte.length ? '<span class="muted small">' + akte.length + (akte.length === 1 ? ' Eintrag' : ' Einträge') + '</span>' : '') + '</div><div class="entries">' +
      (!loaded ? '<span class="empty-note">Wird geladen</span>' : akte.length ? sichtbar.map(function (e) {
        return '<div class="entry' + (e.erledigt ? ' done' : ' open') + '"><div class="entry-top"><strong>' + esc(e.delikt) + '</strong><span>' + esc(e.created_at ? dateTime(e.created_at) : e.datum) + '</span></div>' +
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
      '</div>' +
      (loaded && akte.length > GEZEIGT ? '<button type="button" class="ausklappen" data-action="akte-alle" aria-expanded="' + !!ui.akteAlle + '">' +
        (ui.akteAlle ? 'Weniger anzeigen' : 'Alle ' + akte.length + ' Einträge anzeigen') + '</button>' : '') +
      '</section>';
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
      // Der ausstellende Beamte wird erwähnt (pingt), der Teamtag ist nur Text (pingt nicht)
      '👤 Ausgeführt von: ' + (h.ausgestelltDiscord
        ? (h.ausgestelltVon || '').replace(/\s*\(@[^)]*\)$/, '') + ' (<@' + h.ausgestelltDiscord + '>)'
        : (h.ausgestelltVon || '')) + '\n' +
      '⸻⸻⸻\n' +
      '👤 Teamtag: @Präsidium-Team';
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
      a.forEach(function (e) { if (e.created_at > (p.letzterEintrag || 0)) p.letzterEintrag = e.created_at; });
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

    if (a === 'edit-mode') {
      editMode = !editMode;
      try { localStorage.setItem('polis.editMode', editMode ? '1' : '0'); } catch (e) { /* ignorieren */ }
      renderRecord();
      return;
    }
    if (a === 'akte-alle') { ui.akteAlle = !ui.akteAlle; renderRecord(); return; }
    if (a === 'select') {
      if (ui.selId !== el.dataset.id) ui.akteAlle = false;
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
      p.letzterEintrag = Math.max(p.letzterEintrag || 0, Date.now());
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
    if (ui.selId !== id) ui.akteAlle = false;
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
          (p.haftbefehle ? '<span class="person-hb">Haftbefehl</span>' : '') + '<span class="chip ' + chipClass(statusVon(p)) + '">' + esc(statusVon(p)) + '</span></div>';
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
  // Bereiche: Datenbank, Schicht, Polizei-Register, Grundrisse, Rechte
  // ======================================================================
  var view = 'db';
  function renderPermUi() {
    var server = mode === 'server';
    var show = {
      schicht: server, // „Im Dienst“ sieht jeder; die eigene Uhr nur mit Recht „schicht“
      beamte: server && has('register_sehen'),
      plan: server && has('grundrisse'),
      rechte: server && authMode === 'discord' && has('rechte')
    };
    $('navSchicht').hidden = !show.schicht; $('navBeamte').hidden = !show.beamte; $('navRechte').hidden = !show.rechte;
    $('navPlan').hidden = !show.plan;
    $('mainNav').hidden = !(show.schicht || show.beamte || show.plan || show.rechte);
    if (view !== 'db' && !show[view]) view = 'db';
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      var on = b.dataset.view === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('viewDb').hidden = view !== 'db'; $('viewSchicht').hidden = view !== 'schicht';
    $('viewBeamte').hidden = view !== 'beamte'; $('viewRechte').hidden = view !== 'rechte';
    $('viewPlan').hidden = view !== 'plan';
    renderTabs(); renderRecord();
  }
  function setView(v) {
    view = v; renderPermUi();
    if (v === 'schicht') loadSchicht();
    if (v === 'beamte') loadBeamte();
    if (v === 'rechte') loadRechte();
    if (v === 'plan') { loadGrundrisse(); gRender(); }
  }
  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (view === 'plan' && b.dataset.view !== 'plan' && !gVerwerfenOk()) return;
      setView(b.dataset.view);
    });
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
          '<span class="einheit einheit-' + (x.einheit === 'SEK' ? 'sek' : 'polizei') + '"' +
            (x.grund != null ? ' title="' + esc('Bestimmt durch: ' + (x.grund || 'keine passende Rolle')) + '"' : '') + '>' + esc(x.einheit) + '</span>' +
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
    // Handy: Liste und Details stehen untereinander, also zu den Details springen
    if (window.innerWidth < 900) $('bDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      .catch(function (e) {
        $('bError').textContent = e.message;
        if (e.vorhandenId) {
          var a = document.createElement('button');
          a.type = 'button'; a.className = 'linkbtn'; a.textContent = 'Vorhandenen Eintrag öffnen';
          a.addEventListener('click', function () { bSel = e.vorhandenId; bEdit = null; renderBeamte(); });
          $('bError').appendChild(document.createTextNode(' ')); $('bError').appendChild(a);
        }
      });
  });
  $('bDelete').addEventListener('click', function () {
    var b = bData.beamte.find(function (x) { return x.id === bEdit; });
    if (!b || !confirm(b.name + ' aus dem Register entfernen?')) return;
    api('beamte/' + b.id, { method: 'DELETE' }).then(function () { bSel = null; bEdit = null; return loadBeamte(); })
      .catch(function (e) { $('bError').textContent = e.message; });
  });

  // ---------- Grundrisse (Recht „grundrisse“) ----------
  // Ein Plan besteht aus Elementen in Studs: Räume (Rechteck), Wände/Türen/Fenster (Linie), Markierungen (Punkt).
  var gMoebel = { Stuhl: { w: 3, h: 3 }, Schrank: { w: 4, h: 2 } }, gGeist = null, gDreh = 0;
  var gLetzteArt = 'Sonstiges', gList = null, gArten = [], gPlan = null, gSel = -1, gTool = 'sel', gDirty = false, gUndo = [], gDrag = null, gMess = null;
  var gV = { x: -5, y: -5, s: 14 }; // linke obere Ecke in Studs, Pixel pro Stud
  var GFARBE = { Eingang: '#5BE3A0', Tresor: '#F5B841', Kasse: '#8FB4FF', Vitrine: '#C3A6FF', Kamera: '#FF7A7A', Alarm: '#FF5C5C', Deckung: '#9AA6BF', Treppe: '#7FD6E8', Sonstiges: '#E6EBF5' };
  // Schrift-Umrandung in Pixeln: hängt vom Maßstab ab, deshalb als Funktion
  function gStyle(s) { return GSTYLE.replace('__HALO__', String(3 / s)); }
  var GSTYLE = '<style>' +
    '.g-raum{fill:rgba(76,141,255,.10);stroke:#4C8DFF;stroke-width:1.5px;vector-effect:non-scaling-stroke}' +
    '.g-wand{stroke:#E6EBF5;stroke-width:4px;stroke-linecap:square;vector-effect:non-scaling-stroke}' +
    '.g-tuer{stroke:#F5B841;stroke-width:4px;vector-effect:non-scaling-stroke}' +
    '.g-fenster{stroke:#7FD6E8;stroke-width:3px;stroke-dasharray:6 3;vector-effect:non-scaling-stroke}' +
    '.g-hit{stroke:transparent;stroke-width:16px;vector-effect:non-scaling-stroke}' +
    '.g-stuhl{fill:rgba(201,162,107,.22);stroke:#C9A26B;stroke-width:1.5px;vector-effect:non-scaling-stroke}' +
    '.g-schrank{fill:rgba(154,166,191,.18);stroke:#9AA6BF;stroke-width:1.5px;vector-effect:non-scaling-stroke}' +
    '.g-lehne{stroke-width:4px}' +
    '.g-geist{opacity:.45;pointer-events:none}' +
    '.g-sel .g-stuhl,.g-sel .g-schrank{stroke:#5BE3A0}' +
    '.g-mess{stroke:#5BE3A0;stroke-width:2px;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}' +
    '.g-neu{fill:rgba(91,227,160,.12);stroke:#5BE3A0;stroke-width:2px;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}' +
    '.g-sel .g-raum,.g-sel .g-wand,.g-sel .g-tuer,.g-sel .g-fenster{stroke:#5BE3A0}' +
    '.g-sel circle{stroke:#5BE3A0;stroke-width:3px}' +
    '.g-h{fill:#0A101C;stroke:#5BE3A0;stroke-width:2px;vector-effect:non-scaling-stroke;cursor:move}' +
    '.g-grid1{stroke:#162033;stroke-width:1px;vector-effect:non-scaling-stroke}' +
    '.g-grid10{stroke:#24304A;stroke-width:1px;vector-effect:non-scaling-stroke}' +
    '.g-achse{stroke:#3A4A6E;stroke-width:1px;vector-effect:non-scaling-stroke}' +
    'text{font-family:IBM Plex Sans,system-ui,sans-serif;fill:#E6EBF5;paint-order:stroke;stroke:#0A101C;stroke-width:__HALO__px;stroke-linejoin:round}' +
    '.g-mass{font-family:IBM Plex Mono,ui-monospace,monospace;fill:#9AA6BF}' +
    '.g-masstark{font-family:IBM Plex Mono,ui-monospace,monospace;fill:#5BE3A0}' +
    '</style>';

  function gNum(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
  function gLen(e) { return Math.sqrt(Math.pow(e.x2 - e.x1, 2) + Math.pow(e.y2 - e.y1, 2)); }
  function gSnapV() { return Number($('gSnap').value) || 1; }
  function gSnapN(n) { var r = gSnapV(); return Math.round(n / r) * r; }
  function gClone(o) { return JSON.parse(JSON.stringify(o)); }
  function gIstLinie(e) { return e && (e.t === 'wand' || e.t === 'tuer' || e.t === 'fenster'); }
  var G_NAMEN = { raum: 'Raum', wand: 'Wand', tuer: 'Tür', fenster: 'Fenster', punkt: 'Markierung', moebel: 'Möbel' };
  function gIstMoebelTool(t) { return !!gMoebel[t]; }
  // Grundfläche eines Möbelstücks (bei 90° und 270° Breite und Tiefe getauscht)
  function gFlaeche(e) {
    var m = gMoebel[e.art] || { w: 1, h: 1 }, quer = e.r === 90 || e.r === 270;
    return { w: quer ? m.h : m.w, h: quer ? m.w : m.h };
  }
  // Möbel um seine Mitte drehen; die Mitte bleibt stehen
  function gDrehen(e, r) {
    var a = gFlaeche(e), cx = e.x + a.w / 2, cy = e.y + a.h / 2;
    e.r = ((r % 360) + 360) % 360;
    var b = gFlaeche(e);
    e.x = Math.round((cx - b.w / 2) * 10) / 10; e.y = Math.round((cy - b.h / 2) * 10) / 10;
  }
  function gNeuesMoebel(art, p) {
    var e = { t: 'moebel', art: art, x: 0, y: 0, r: gDreh }, a = gFlaeche(e);
    e.x = gSnapN(p.x - a.w / 2); e.y = gSnapN(p.y - a.h / 2);
    return e;
  }

  function loadGrundrisse() {
    return api('grundrisse').then(function (d) { gList = d.grundrisse; gArten = d.arten || []; if (d.moebel) gMoebel = d.moebel; renderGList(); })
      .catch(function (e) { $('gList').innerHTML = '<div class="placeholder">' + esc(e.message) + '</div>'; });
  }
  function renderGList() {
    if (!gList) return;
    $('gList').innerHTML = gList.length ? gList.map(function (g) {
      return '<button type="button" class="person' + (gPlan && g.id === gPlan.id ? ' selected' : '') + '" data-gid="' + g.id + '">' +
        '<span class="person-main"><strong>' + esc(g.name) + '</strong><span>' + g.elemente + ' Elemente' +
        (g.updatedAt ? ', ' + esc(dateTime(g.updatedAt)) : '') + '</span></span></button>';
    }).join('') : '<div class="placeholder">Noch keine Grundrisse.</div>';
  }
  function gVerwerfenOk() { return !gDirty || confirm('Ungespeicherte Änderungen am Grundriss verwerfen?'); }
  $('gList').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-gid]');
    if (!b || (gPlan && Number(b.dataset.gid) === gPlan.id) || !gVerwerfenOk()) return;
    gOeffne(Number(b.dataset.gid));
  });
  function gOeffne(id) {
    $('gMsg').textContent = 'Wird geladen';
    return api('grundrisse/' + id).then(function (d) {
      gPlan = d.grundriss; gSel = -1; gUndo = []; gMess = null; gSetDirty(false);
      $('gName').value = gPlan.name; $('gNotizen').value = gPlan.notizen || '';
      $('gEmpty').hidden = true; $('gEditor').hidden = false; $('gMsg').textContent = '';
      renderGList(); gFit(); gProps();
    }).catch(function (e) { $('gMsg').textContent = e.message; });
  }
  $('gNewForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('gNewName').value.trim();
    if (!name || !gVerwerfenOk()) return;
    api('grundrisse', { method: 'POST', body: { name: name } }).then(function (d) {
      $('gNewName').value = '';
      return loadGrundrisse().then(function () { return gOeffne(d.grundriss.id); });
    }).catch(function (e) { alert(e.message); });
  });
  function gSetDirty(v) {
    gDirty = v;
    $('gSave').disabled = !v;
    if (v) $('gMsg').textContent = 'Nicht gespeichert';
  }
  function gAenderung() { gSetDirty(true); }
  function gMerke() {
    gUndo.push(JSON.stringify(gPlan.elemente));
    if (gUndo.length > 100) gUndo.shift();
  }
  function gRueckgaengig() {
    if (!gUndo.length) return;
    gPlan.elemente = JSON.parse(gUndo.pop()); gSel = -1; gAenderung(); gRender(); gProps();
  }
  function gSpeichern() {
    if (!gPlan || !gDirty) return;
    $('gSave').disabled = true; $('gMsg').textContent = 'Wird gespeichert';
    api('grundrisse/' + gPlan.id, { method: 'PUT', body: { stand: gPlan.updatedAt, name: $('gName').value, notizen: $('gNotizen').value, elemente: gPlan.elemente } })
      .then(function (d) {
        gPlan.updatedAt = d.grundriss.updatedAt; gPlan.name = d.grundriss.name; $('gName').value = gPlan.name;
        gSetDirty(false); $('gMsg').textContent = 'Gespeichert'; loadGrundrisse();
      })
      .catch(function (e) { $('gSave').disabled = false; $('gMsg').textContent = e.message; });
  }
  $('gSave').addEventListener('click', gSpeichern);
  $('gName').addEventListener('input', gAenderung);
  $('gNotizen').addEventListener('input', gAenderung);
  $('gDel').addEventListener('click', function () {
    if (!gPlan || !confirm('Grundriss „' + gPlan.name + '“ endgültig löschen?')) return;
    api('grundrisse/' + gPlan.id, { method: 'DELETE' }).then(function () {
      gPlan = null; gSetDirty(false); $('gEditor').hidden = true; $('gEmpty').hidden = false; loadGrundrisse();
    }).catch(function (e) { $('gMsg').textContent = e.message; });
  });
  window.addEventListener('beforeunload', function (ev) { if (gDirty) { ev.preventDefault(); ev.returnValue = ''; } });

  // Lauf-Rechner
  $('gTempo').value = prefs.gTempo || 16;
  function gRechne() {
    var t = Number(String($('gSek').value).replace(',', '.')) || 0, v = Number(String($('gTempo').value).replace(',', '.')) || 0;
    $('gErgebnis').textContent = '= ' + gNum(t * v) + ' Studs';
  }
  $('gSek').addEventListener('input', gRechne);
  $('gTempo').addEventListener('input', function () { prefs.gTempo = Number($('gTempo').value) || 16; savePrefs(); gRechne(); });

  // --- Zeichnen ---
  // Markup aller Elemente für den Maßstab s (Pixel pro Stud); auswahl = Index mit Griffen oder -1
  function gMarkup(els, s, auswahl, masse) {
    var f = 12 / s, r = 7 / s, hs = 5 / s, out = '';
    function txt(x, y, t, cls, gross) {
      return '<text x="' + x + '" y="' + y + '" font-size="' + (gross ? f * 1.1 : f * 0.95) + '" text-anchor="middle" dominant-baseline="middle"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(t) + '</text>';
    }
    function griff(x, y, h) { return '<rect class="g-h" data-h="' + h + '" x="' + (x - hs) + '" y="' + (y - hs) + '" width="' + 2 * hs + '" height="' + 2 * hs + '"/>'; }
    var reihen = { raum: [], moebel: [], linie: [], punkt: [] };
    els.forEach(function (e, i) { (reihen[e.t] || reihen.linie).push(i); });
    reihen.raum.concat(reihen.moebel, reihen.linie, reihen.punkt).forEach(function (i) {
      var e = els[i], sel = i === auswahl;
      out += '<g data-i="' + i + '"' + (sel ? ' class="g-sel"' : '') + '>';
      if (e.t === 'raum') {
        out += '<rect class="g-raum" x="' + e.x + '" y="' + e.y + '" width="' + e.w + '" height="' + e.h + '"/>';
        var cx = e.x + e.w / 2, cy = e.y + e.h / 2, platz = Math.min(e.w, e.h) * s > 34;
        if (e.name && platz) out += txt(cx, cy - (masse ? f * 0.7 : 0), e.name, '', true);
        if (masse && platz) out += txt(cx, cy + (e.name ? f * 0.7 : 0), gNum(e.w) + ' × ' + gNum(e.h), 'g-mass');
        else if (e.name && !platz) out += txt(cx, e.y - f * 0.8, e.name);
      } else if (e.t === 'moebel') {
        // in Grundstellung zeichnen und um die Mitte drehen; Lehne bzw. Rückwand liegt oben
        var m = gMoebel[e.art] || { w: 1, h: 1 }, fl = gFlaeche(e), mx0 = e.x + fl.w / 2, my0 = e.y + fl.h / 2;
        var lx = mx0 - m.w / 2, ly = my0 - m.h / 2, cls = e.art === 'Stuhl' ? 'g-stuhl' : 'g-schrank';
        out += '<g transform="rotate(' + (e.r || 0) + ' ' + mx0 + ' ' + my0 + ')">' +
          '<rect class="' + cls + '" x="' + lx + '" y="' + ly + '" width="' + m.w + '" height="' + m.h + '"' + (e.art === 'Stuhl' ? ' rx="0.4"' : '') + '/>' +
          '<line class="' + cls + ' g-lehne" x1="' + (lx + 0.15) + '" y1="' + (ly + 0.15) + '" x2="' + (lx + m.w - 0.15) + '" y2="' + (ly + 0.15) + '"/>' +
          (e.art === 'Schrank' ? '<line class="' + cls + '" x1="' + mx0 + '" y1="' + (ly + 0.3) + '" x2="' + mx0 + '" y2="' + (ly + m.h) + '"/>' : '') + '</g>';
        if (masse && Math.min(fl.w, fl.h) * s > 40) out += txt(mx0, my0 + f * 0.2, gNum(fl.w) + '×' + gNum(fl.h), 'g-mass');
      } else if (gIstLinie(e)) {
        var l = 'x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '"';
        out += '<line class="g-hit" ' + l + '/><line class="g-' + e.t + '" ' + l + '/>';
        if (masse && gLen(e) * s > 30) {
          var mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2, dx = e.x2 - e.x1, dy = e.y2 - e.y1, n = gLen(e);
          out += txt(mx - dy / n * f, my + dx / n * f, gNum(n), 'g-mass');
        }
      } else if (e.t === 'punkt') {
        var c = GFARBE[e.art] || GFARBE.Sonstiges;
        out += '<circle cx="' + e.x + '" cy="' + e.y + '" r="' + r + '" fill="' + c + '" fill-opacity=".25" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
          '<text x="' + e.x + '" y="' + e.y + '" font-size="' + f * 0.85 + '" text-anchor="middle" dominant-baseline="central" style="font-weight:700;fill:' + c + ';stroke:none">' + esc((e.art || '?')[0]) + '</text>';
        out += txt(e.x, e.y + r + f * 0.8, e.name || e.art);
      }
      if (sel) {
        if (e.t === 'raum') out += griff(e.x, e.y, 'nw') + griff(e.x + e.w, e.y, 'ne') + griff(e.x, e.y + e.h, 'sw') + griff(e.x + e.w, e.y + e.h, 'se');
        else if (gIstLinie(e)) out += griff(e.x1, e.y1, '1') + griff(e.x2, e.y2, '2');
      }
      out += '</g>';
    });
    return out;
  }
  function gRaster(x0, y0, x1, y1, s) {
    var out = '', schritt1 = s >= 5 ? 1 : 0, x, y;
    var a = Math.floor(x0), b = Math.ceil(x1), c = Math.floor(y0), d = Math.ceil(y1);
    if (schritt1) {
      for (x = a; x <= b; x++) if (x % 10) out += '<line class="g-grid1" x1="' + x + '" y1="' + c + '" x2="' + x + '" y2="' + d + '"/>';
      for (y = c; y <= d; y++) if (y % 10) out += '<line class="g-grid1" x1="' + a + '" y1="' + y + '" x2="' + b + '" y2="' + y + '"/>';
    }
    for (x = Math.floor(a / 10) * 10; x <= b; x += 10) out += '<line class="' + (x ? 'g-grid10' : 'g-achse') + '" x1="' + x + '" y1="' + c + '" x2="' + x + '" y2="' + d + '"/>';
    for (y = Math.floor(c / 10) * 10; y <= d; y += 10) out += '<line class="' + (y ? 'g-grid10' : 'g-achse') + '" x1="' + a + '" y1="' + y + '" x2="' + b + '" y2="' + y + '"/>';
    return out;
  }
  function gGroesse() { var r = $('gSvg').getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  function gRender() {
    if (!gPlan || $('gEditor').hidden) return;
    var g = gGroesse(), w = g.w / gV.s, h = g.h / gV.s, f = 12 / gV.s;
    var svg = $('gSvg');
    svg.setAttribute('viewBox', gV.x + ' ' + gV.y + ' ' + w + ' ' + h);
    var extra = '';
    if (gDrag && gDrag.art === 'neu') {
      var a = gDrag.a, b = gDrag.b;
      if (gDrag.tool === 'raum') {
        extra += '<rect class="g-neu" x="' + Math.min(a.x, b.x) + '" y="' + Math.min(a.y, b.y) + '" width="' + Math.abs(b.x - a.x) + '" height="' + Math.abs(b.y - a.y) + '"/>' +
          '<text class="g-masstark" font-size="' + f + '" x="' + b.x + '" y="' + (b.y + f * 1.3) + '" text-anchor="middle">' + gNum(Math.abs(b.x - a.x)) + ' × ' + gNum(Math.abs(b.y - a.y)) + '</text>';
      } else {
        extra += '<line class="' + (gDrag.tool === 'mess' ? 'g-mess' : 'g-' + gDrag.tool) + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' +
          '<text class="g-masstark" font-size="' + f * 1.1 + '" x="' + b.x + '" y="' + (b.y - f * 1.2) + '" text-anchor="middle">' + gNum(gLen({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) + '</text>';
      }
    }
    if (gGeist && gIstMoebelTool(gTool) && !gDrag) extra += gMarkup([gNeuesMoebel(gTool, gGeist)], gV.s, -1, false).replace('data-i="0"', 'class="g-geist"');
    if (gMess && !(gDrag && gDrag.art === 'neu')) {
      extra += '<line class="g-mess" x1="' + gMess.x1 + '" y1="' + gMess.y1 + '" x2="' + gMess.x2 + '" y2="' + gMess.y2 + '"/>' +
        '<text class="g-masstark" font-size="' + f * 1.1 + '" x="' + (gMess.x1 + gMess.x2) / 2 + '" y="' + ((gMess.y1 + gMess.y2) / 2 - f) + '" text-anchor="middle">' + gNum(gLen(gMess)) + ' Studs</text>';
    }
    svg.innerHTML = gStyle(gV.s) + gRaster(gV.x, gV.y, gV.x + w, gV.y + h, gV.s) + gMarkup(gPlan.elemente, gV.s, gSel, $('gMasse').checked) + extra;
    $('gInfo').textContent = gPlan.elemente.length + ' Elemente, ' + Math.round(gV.s * 10) / 10 + ' px pro Stud';
  }
  if (window.ResizeObserver) new ResizeObserver(function () { gRender(); }).observe($('gCanvas'));
  $('gMasse').addEventListener('change', gRender);

  function gGrenzen(els) {
    if (!els.length) return null;
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    function p(x, y) { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
    els.forEach(function (e) {
      if (e.t === 'raum') { p(e.x, e.y); p(e.x + e.w, e.y + e.h); }
      else if (gIstLinie(e)) { p(e.x1, e.y1); p(e.x2, e.y2); }
      else if (e.t === 'moebel') { var a = gFlaeche(e); p(e.x, e.y); p(e.x + a.w, e.y + a.h); }
      else p(e.x, e.y);
    });
    return b;
  }
  function gFit() {
    var g = gGroesse(), b = gGrenzen(gPlan ? gPlan.elemente : []);
    if (!b) { gV = { s: 14, x: -3, y: -3 }; gRender(); return; }
    var w = Math.max(10, b.x1 - b.x0) + 8, h = Math.max(10, b.y1 - b.y0) + 8;
    gV.s = Math.max(2, Math.min(60, Math.min(g.w / w, g.h / h)));
    gV.x = (b.x0 + b.x1) / 2 - g.w / gV.s / 2; gV.y = (b.y0 + b.y1) / 2 - g.h / gV.s / 2;
    gRender();
  }
  function gZoom(faktor, px, py) {
    var g = gGroesse();
    if (px == null) { px = g.w / 2; py = g.h / 2; }
    var sx = gV.x + px / gV.s, sy = gV.y + py / gV.s;
    gV.s = Math.max(2, Math.min(80, gV.s * faktor));
    gV.x = sx - px / gV.s; gV.y = sy - py / gV.s;
    gRender();
  }
  $('gZoomIn').addEventListener('click', function () { gZoom(1.3); });
  $('gZoomOut').addEventListener('click', function () { gZoom(1 / 1.3); });
  $('gFit').addEventListener('click', gFit);
  $('gUndoBtn').addEventListener('click', gRueckgaengig);
  $('gSvg').addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = $('gSvg').getBoundingClientRect();
    gZoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });

  function gWerkzeug(t) {
    gTool = t; gMess = null; gGeist = null;
    document.querySelectorAll('.tool-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === t); });
    $('gCanvas').classList.toggle('tool-sel', t === 'sel');
    gRender();
  }
  document.querySelectorAll('.tool-btn').forEach(function (b) { b.addEventListener('click', function () { gWerkzeug(b.dataset.tool); }); });
  gWerkzeug('sel');

  // Maus und Finger
  function gPunkt(ev) {
    var r = $('gSvg').getBoundingClientRect();
    return { x: gV.x + (ev.clientX - r.left) / gV.s, y: gV.y + (ev.clientY - r.top) / gV.s };
  }
  function gSnapP(p) { return { x: gSnapN(p.x), y: gSnapN(p.y) }; }
  var gZeiger = {};
  $('gSvg').addEventListener('pointerdown', function (ev) {
    if (!gPlan) return;
    gZeiger[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    // Zwei Finger: Zoomen und Verschieben statt Zeichnen
    var ids = Object.keys(gZeiger);
    if (ids.length === 2) {
      if (gDrag && gDrag.undo && !gDrag.bewegt) gUndo.pop();
      var p1 = gZeiger[ids[0]], p2 = gZeiger[ids[1]];
      gDrag = { art: 'pinch', d: Math.hypot(p1.x - p2.x, p1.y - p2.y), s: gV.s };
      gRender(); return;
    }
    if (ids.length > 2) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
    $('gSvg').setPointerCapture(ev.pointerId);
    var p = gPunkt(ev), sp = gSnapP(p);
    var hEl = ev.target.closest('[data-h]'), eEl = ev.target.closest('[data-i]');
    if (ev.button === 1 || gTool === 'sel' && !hEl && !eEl) {
      if (gTool === 'sel') { gSel = -1; gProps(); }
      gDrag = { art: 'pan', cx: ev.clientX, cy: ev.clientY, vx: gV.x, vy: gV.y };
      $('gCanvas').classList.add('panning');
    } else if (gTool === 'sel' && hEl && gSel >= 0) {
      gMerke(); gDrag = { art: 'griff', h: hEl.dataset.h, orig: gClone(gPlan.elemente[gSel]), undo: true };
    } else if (gTool === 'sel') {
      gSel = Number(eEl.dataset.i); gMerke();
      gDrag = { art: 'move', start: sp, orig: gClone(gPlan.elemente[gSel]), undo: true };
      gProps();
    } else if (gIstMoebelTool(gTool)) {
      gMerke();
      gPlan.elemente.push(gNeuesMoebel(gTool, p));
      gSel = gPlan.elemente.length - 1; gAenderung(); gProps();
      gDrag = { art: 'move', start: sp, orig: gClone(gPlan.elemente[gSel]), undo: true, bewegt: true };
    } else if (gTool === 'punkt') {
      gMerke();
      gPlan.elemente.push({ t: 'punkt', x: sp.x, y: sp.y, art: gLetzteArt, name: '' });
      gSel = gPlan.elemente.length - 1; gAenderung(); gProps();
      var nf = $('gpName'); if (nf && ev.pointerType === 'mouse') setTimeout(function () { nf.focus(); }, 0);
    } else {
      gMess = null;
      gDrag = { art: 'neu', tool: gTool, a: sp, b: sp };
    }
    gRender();
  });
  $('gSvg').addEventListener('pointermove', function (ev) {
    if (gZeiger[ev.pointerId]) gZeiger[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var p = gPunkt(ev), sp = gSnapP(p);
    $('gPos').textContent = 'X ' + gNum(sp.x) + '  Y ' + gNum(sp.y) + '  (Studs)';
    if (!gDrag) { if (gIstMoebelTool(gTool) && ev.pointerType === 'mouse') { gGeist = p; gRender(); } return; }
    if (gDrag.art === 'pinch') {
      var ids = Object.keys(gZeiger); if (ids.length < 2) return;
      var p1 = gZeiger[ids[0]], p2 = gZeiger[ids[1]], r = $('gSvg').getBoundingClientRect();
      var d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      gZoom((gDrag.s * d / gDrag.d) / gV.s, (p1.x + p2.x) / 2 - r.left, (p1.y + p2.y) / 2 - r.top);
      return;
    }
    if (gDrag.art === 'pan') {
      gV.x = gDrag.vx - (ev.clientX - gDrag.cx) / gV.s; gV.y = gDrag.vy - (ev.clientY - gDrag.cy) / gV.s;
    } else if (gDrag.art === 'move') {
      var dx = sp.x - gDrag.start.x, dy = sp.y - gDrag.start.y, o = gDrag.orig, e = gPlan.elemente[gSel];
      if (dx || dy) gDrag.bewegt = true;
      if (e.t === 'raum' || e.t === 'punkt' || e.t === 'moebel') { e.x = o.x + dx; e.y = o.y + dy; }
      else { e.x1 = o.x1 + dx; e.y1 = o.y1 + dy; e.x2 = o.x2 + dx; e.y2 = o.y2 + dy; }
      if (gDrag.bewegt) gAenderung();
    } else if (gDrag.art === 'griff') {
      var el = gPlan.elemente[gSel], og = gDrag.orig;
      gDrag.bewegt = true;
      if (el.t === 'raum') {
        var fx = gDrag.h.indexOf('w') !== -1 ? og.x + og.w : og.x, fy = gDrag.h.indexOf('n') !== -1 ? og.y + og.h : og.y;
        el.x = Math.min(fx, sp.x); el.y = Math.min(fy, sp.y);
        el.w = Math.max(gSnapV(), Math.abs(sp.x - fx)); el.h = Math.max(gSnapV(), Math.abs(sp.y - fy));
      } else if (gDrag.h === '1') { el.x1 = sp.x; el.y1 = sp.y; } else { el.x2 = sp.x; el.y2 = sp.y; }
      gAenderung();
    } else if (gDrag.art === 'neu') {
      var b = { x: sp.x, y: sp.y };
      // Wände gerade halten; Umschalt erlaubt schräge Linien
      if (gDrag.tool !== 'raum' && !ev.shiftKey) {
        if (Math.abs(b.x - gDrag.a.x) >= Math.abs(b.y - gDrag.a.y)) b.y = gDrag.a.y; else b.x = gDrag.a.x;
      }
      gDrag.b = b;
    }
    gRender();
    if (gDrag.art === 'move' || gDrag.art === 'griff') gPropsWerte();
  });
  function gLoslassen(ev) {
    delete gZeiger[ev.pointerId];
    if (!gDrag) return;
    if (gDrag.art === 'pinch') { if (!Object.keys(gZeiger).length) gDrag = null; return; }
    var d = gDrag; gDrag = null;
    $('gCanvas').classList.remove('panning');
    if (d.undo && !d.bewegt) gUndo.pop();
    if (d.art === 'neu') {
      var a = d.a, b = d.b;
      if (d.tool === 'mess') { if (a.x !== b.x || a.y !== b.y) gMess = { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
      else if (d.tool === 'raum') {
        if (a.x !== b.x && a.y !== b.y) {
          gMerke();
          gPlan.elemente.push({ t: 'raum', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), name: '' });
          gSel = gPlan.elemente.length - 1; gAenderung();
        }
      } else if (a.x !== b.x || a.y !== b.y) {
        gMerke();
        gPlan.elemente.push({ t: d.tool, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        gSel = gPlan.elemente.length - 1; gAenderung();
      }
      gProps();
    }
    gRender();
  }
  $('gSvg').addEventListener('pointerup', gLoslassen);
  $('gSvg').addEventListener('pointercancel', gLoslassen);
  $('gSvg').addEventListener('pointerleave', function () { $('gPos').textContent = 'Maße in Studs'; if (gGeist) { gGeist = null; gRender(); } });

  // Tastatur: nur in der Ansicht Grundrisse und nicht beim Tippen
  document.addEventListener('keydown', function (ev) {
    if (view !== 'plan' || !gPlan || $('gEditor').hidden) return;
    var tippt = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); gSpeichern(); return; }
    if (tippt) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); gRueckgaengig(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && gSel >= 0) { ev.preventDefault(); gLoeschen(); return; }
    if (ev.key === 'Escape') { gSel = -1; gMess = null; gProps(); gRender(); return; }
    if (ev.key.toLowerCase() === 'd') { gDrehTaste(); return; }
    var t = { v: 'sel', r: 'raum', w: 'wand', t: 'tuer', f: 'fenster', m: 'punkt', l: 'mess', s: 'Stuhl', k: 'Schrank' }[ev.key.toLowerCase()];
    if (t) gWerkzeug(t);
  });
  // D: ausgewähltes Möbel drehen, sonst die Drehung für das nächste Möbel
  function gDrehTaste() {
    var e = gSel >= 0 ? gPlan.elemente[gSel] : null;
    if (e && e.t === 'moebel') { gMerke(); gDrehen(e, (e.r || 0) + 90); gDreh = e.r; gAenderung(); gProps(); }
    else if (gIstMoebelTool(gTool)) gDreh = (gDreh + 90) % 360;
    gRender();
  }
  function gLoeschen() {
    if (gSel < 0) return;
    gMerke(); gPlan.elemente.splice(gSel, 1); gSel = -1; gAenderung(); gProps(); gRender();
  }

  // Eigenschaften des ausgewählten Elements: Zahlen direkt eintippen
  function gFeld(id, label, wert, extra) {
    return '<label class="field' + (extra || '') + '">' + label + '<input id="' + id + '" type="number" step="0.5" inputmode="decimal" value="' + (Math.round(wert * 10) / 10) + '"></label>';
  }
  function gProps() {
    var e = gPlan && gSel >= 0 ? gPlan.elemente[gSel] : null, h = '';
    if (!e) {
      h = '<p class="hint">Werkzeug wählen und im Plan ziehen. Ausgewähltes Element: Maße unten eintippen, mit Entf löschen. Ansicht verschieben: mit „Auswählen“ auf freie Fläche ziehen; zoomen mit Mausrad oder zwei Fingern. Möbel: „Stuhl“ (3 × 3) oder „Schrank“ (2 × 4) wählen und in den Plan klicken, D dreht um 90°. Tastenkürzel: V, R, W, T, F, M, S, K, L, D, Strg+Z, Strg+S.</p>';
    } else {
      h = '<strong class="small">' + G_NAMEN[e.t] + '</strong>';
      if (e.t === 'raum') {
        h += '<label class="field wide">Name<input id="gpName" type="text" maxlength="60" value="' + esc(e.name || '') + '" placeholder="z. B. Schalterhalle"></label>' +
          gFeld('gpX', 'X', e.x) + gFeld('gpY', 'Y', e.y) + gFeld('gpW', 'Breite', e.w) + gFeld('gpH', 'Tiefe', e.h);
      } else if (e.t === 'moebel') {
        var fm = gFlaeche(e);
        h += '<label class="field">Art<select id="gpArt">' + Object.keys(gMoebel).map(function (a) {
          return '<option' + (a === e.art ? ' selected' : '') + '>' + esc(a) + '</option>';
        }).join('') + '</select></label>' +
          gFeld('gpX', 'X', e.x) + gFeld('gpY', 'Y', e.y) +
          '<label class="field">Drehung<select id="gpR">' + [0, 90, 180, 270].map(function (r) {
            return '<option value="' + r + '"' + (r === (e.r || 0) ? ' selected' : '') + '>' + r + '°</option>';
          }).join('') + '</select></label>' +
          '<span class="muted small mono" id="gpFl">' + gNum(fm.w) + ' × ' + gNum(fm.h) + ' Studs</span>' +
          '<button type="button" id="gpDreh" class="btn-ghost">Drehen</button>';
      } else if (gIstLinie(e)) {
        h += '<label class="field">Art<select id="gpArt">' + ['wand', 'tuer', 'fenster'].map(function (t) {
          return '<option value="' + t + '"' + (t === e.t ? ' selected' : '') + '>' + G_NAMEN[t] + '</option>';
        }).join('') + '</select></label>' +
          gFeld('gpX1', 'X Start', e.x1) + gFeld('gpY1', 'Y Start', e.y1) + gFeld('gpX2', 'X Ende', e.x2) + gFeld('gpY2', 'Y Ende', e.y2) + gFeld('gpL', 'Länge', gLen(e));
      } else {
        h += '<label class="field">Art<select id="gpArt">' + gArten.map(function (a) {
          return '<option' + (a === e.art ? ' selected' : '') + '>' + esc(a) + '</option>';
        }).join('') + '</select></label>' +
          '<label class="field wide">Beschriftung<input id="gpName" type="text" maxlength="60" value="' + esc(e.name || '') + '" placeholder="z. B. Haupttresor"></label>' +
          gFeld('gpX', 'X', e.x) + gFeld('gpY', 'Y', e.y);
      }
      h += '<button type="button" id="gpDup" class="btn-ghost">Kopieren</button><button type="button" id="gpDel" class="btn-ghost btn-danger">Entfernen</button>';
    }
    $('gProps').innerHTML = h;
  }
  // Nur die Zahlen auffrischen (beim Ziehen), ohne das Feld mit dem Fokus zu überschreiben
  function gPropsWerte() {
    var e = gSel >= 0 ? gPlan.elemente[gSel] : null; if (!e) return;
    var w = e.t === 'raum' ? { gpX: e.x, gpY: e.y, gpW: e.w, gpH: e.h } : e.t === 'moebel' ? { gpX: e.x, gpY: e.y } : gIstLinie(e) ? { gpX1: e.x1, gpY1: e.y1, gpX2: e.x2, gpY2: e.y2, gpL: gLen(e) } : { gpX: e.x, gpY: e.y };
    Object.keys(w).forEach(function (k) { var f = $(k); if (f && f !== document.activeElement) f.value = Math.round(w[k] * 10) / 10; });
  }
  var gPropMerk = false;
  $('gProps').addEventListener('focusin', function () { gPropMerk = false; });
  $('gProps').addEventListener('input', function (ev) {
    var e = gSel >= 0 ? gPlan.elemente[gSel] : null, id = ev.target.id; if (!e) return;
    if (!gPropMerk) { gMerke(); gPropMerk = true; }
    var raw = ev.target.value, n = Number(String(raw).replace(',', '.'));
    if (id === 'gpName') e.name = raw.slice(0, 60);
    else if (id === 'gpArt' && e.t === 'moebel') {
      // anderes Möbel an derselben Stelle: Mitte bleibt
      var fa = gFlaeche(e), mx = e.x + fa.w / 2, my = e.y + fa.h / 2;
      e.art = raw; var fb = gFlaeche(e);
      e.x = Math.round((mx - fb.w / 2) * 10) / 10; e.y = Math.round((my - fb.h / 2) * 10) / 10; gProps();
    }
    else if (id === 'gpR') { gDrehen(e, Number(raw)); gDreh = e.r; gProps(); }
    else if (id === 'gpArt') { if (gIstLinie(e)) e.t = raw; else { e.art = raw; gLetzteArt = raw; } }
    else if (raw === '' || !isFinite(n)) return;
    else if (id === 'gpX') e.x = n; else if (id === 'gpY') e.y = n;
    else if (id === 'gpW') { if (n > 0) e.w = n; } else if (id === 'gpH') { if (n > 0) e.h = n; }
    else if (id === 'gpX1') e.x1 = n; else if (id === 'gpY1') e.y1 = n; else if (id === 'gpX2') e.x2 = n; else if (id === 'gpY2') e.y2 = n;
    else if (id === 'gpL' && n > 0) {
      // Länge ändern: Startpunkt bleibt, Richtung bleibt
      var l = gLen(e);
      if (l > 0) { e.x2 = Math.round((e.x1 + (e.x2 - e.x1) / l * n) * 10) / 10; e.y2 = Math.round((e.y1 + (e.y2 - e.y1) / l * n) * 10) / 10; }
    }
    gAenderung(); gRender();
    if (id !== 'gpL') { var lf = $('gpL'); if (lf && gIstLinie(e)) lf.value = Math.round(gLen(e) * 10) / 10; }
    else ['gpX2', 'gpY2'].forEach(function (k) { $(k).value = k === 'gpX2' ? e.x2 : e.y2; });
  });
  $('gProps').addEventListener('click', function (ev) {
    if (ev.target.id === 'gpDel') gLoeschen();
    if (ev.target.id === 'gpDreh') gDrehTaste();
    if (ev.target.id === 'gpDup' && gSel >= 0) {
      gMerke();
      var c = gClone(gPlan.elemente[gSel]), v = gSnapV() * 2;
      if (gIstLinie(c)) { c.x1 += v; c.y1 += v; c.x2 += v; c.y2 += v; } else { c.x += v; c.y += v; }
      gPlan.elemente.push(c); gSel = gPlan.elemente.length - 1; gAenderung(); gProps(); gRender();
    }
  });

  // Als PNG speichern (zum Teilen, z. B. auf Discord)
  $('gPng').addEventListener('click', function () {
    var b = gGrenzen(gPlan.elemente);
    if (!b) { $('gMsg').textContent = 'Der Plan ist noch leer.'; return; }
    var rand = 4, x0 = b.x0 - rand, y0 = b.y0 - rand - 3, w = b.x1 - b.x0 + 2 * rand, h = b.y1 - b.y0 + 2 * rand + 3;
    var s = Math.max(4, Math.min(24, 3000 / Math.max(w, h)));
    var W = Math.round(w * s), H = Math.round(h * s), name = $('gName').value || 'Grundriss';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + x0 + ' ' + y0 + ' ' + w + ' ' + h + '">' + gStyle(s) +
      '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="#0A101C"/>' + gRaster(x0, y0, x0 + w, y0 + h, s) +
      gMarkup(gPlan.elemente, s, -1, $('gMasse').checked) +
      '<text x="' + (x0 + 12 / s) + '" y="' + (y0 + 20 / s) + '" font-size="' + 16 / s + '" style="font-weight:600">' + esc(name) + '</text>' +
      '<text class="g-mass" x="' + (x0 + 12 / s) + '" y="' + (y0 + 38 / s) + '" font-size="' + 11 / s + '">Maße in Studs, Raster 1 Stud, dicke Linien alle 10 Studs</text></svg>';
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, '_') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      }, 'image/png');
    };
    img.onerror = function () { $('gMsg').textContent = 'Bild konnte nicht erstellt werden.'; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
    var rollen = rData.rollen;
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
