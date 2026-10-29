/* Browser-local ArcGIS server history and bookmarks. URLs only; never credentials or tokens. */
(function () {
  'use strict';

  var STORAGE_KEY = 'gis-explorer-server-history-v1';
  var RECENT_LIMIT = 20;
  var SAVED_LIMIT = 75;
  var entries = [];
  var storageAvailable = true;
  var core = null;
  var panel, trigger, list, search, saveCurrent, status;
  var editing = '';
  var filter = '';
  var confirmingClear = false;

  function byId(id) { return document.getElementById(id); }
  function node(tag, className, value) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = value;
    return item;
  }
  function button(value, className, label, handler) {
    var item = node('button', className, value);
    item.type = 'button';
    if (label) { item.setAttribute('aria-label', label); item.title = label; }
    item.addEventListener('click', handler);
    return item;
  }
  function serverRoot(value) {
    try {
      var source = new URL(String(value).trim());
      if (source.username || source.password) return '';
      var clean = core.normalize(source.href);
      var root = core.rootOf(clean);
      if (!root) return '';
      var parsed = new URL(root);
      if (parsed.username || parsed.password) return '';
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch (e) {
      return '';
    }
  }
  function labelFor(item) {
    return item.name || new URL(item.url).host;
  }
  function trimEntries(items) {
    var saved = items.filter(function (item) { return item.saved; })
      .sort(function (a, b) { return b.lastVisited - a.lastVisited; }).slice(0, SAVED_LIMIT);
    var recent = items.filter(function (item) { return !item.saved; })
      .sort(function (a, b) { return b.lastVisited - a.lastVisited; }).slice(0, RECENT_LIMIT);
    return saved.concat(recent);
  }
  function load() {
    var raw;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      storageAvailable = true;
    } catch (e) {
      storageAvailable = false;
      return [];
    }
    if (!Array.isArray(raw)) return [];
    var unique = new Map();
    raw.forEach(function (item) {
      if (!item || typeof item !== 'object' || typeof item.url !== 'string') return;
      var url = serverRoot(item.url);
      if (!url) return;
      var next = {
        url: url,
        name: typeof item.name === 'string' ? item.name.trim().slice(0, 64) : '',
        saved: item.saved === true,
        lastVisited: Number.isFinite(item.lastVisited) && item.lastVisited > 0 ? item.lastVisited : 0
      };
      var old = unique.get(url);
      if (old) {
        next.saved = next.saved || old.saved;
        next.name = next.name || old.name;
        next.lastVisited = Math.max(next.lastVisited, old.lastVisited);
      }
      unique.set(url, next);
    });
    return trimEntries(Array.from(unique.values()));
  }
  function persist() {
    entries = trimEntries(entries);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      storageAvailable = true;
      return true;
    } catch (e) {
      storageAvailable = false;
      return false;
    }
  }
  function message(text) {
    if (!status) return;
    status.textContent = storageAvailable ? (text || '') :
      'Local storage is blocked or full. Changes will not survive a reload.';
  }
  function find(url) {
    return entries.find(function (item) { return item.url === url; });
  }
  function updateCurrentButton() {
    var url = serverRoot(core.getCurrent());
    var record = url && find(url);
    saveCurrent.disabled = !url;
    saveCurrent.textContent = record && record.saved ? '★ Saved' : '☆ Save current server';
    saveCurrent.setAttribute('aria-pressed', String(!!(record && record.saved)));
  }
  function lastUsed(item) {
    return item.lastVisited ? 'Used ' + new Date(item.lastVisited).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'Saved for later';
  }
  function openServer(url) {
    close();
    core.navigate(url);
  }
  function toggleSaved(url) {
    var item = find(url);
    if (!item) {
      if (entries.filter(function (x) { return x.saved; }).length >= SAVED_LIMIT) {
        message('Bookmark limit reached. Remove a saved server first.');
        return;
      }
      item = {url: url, name: '', saved: true, lastVisited: 0};
      entries.push(item);
    } else {
      if (!item.saved && entries.filter(function (x) { return x.saved; }).length >= SAVED_LIMIT) {
        message('Bookmark limit reached. Remove a saved server first.');
        return;
      }
      item.saved = !item.saved;
      // A bookmark that was never visited should not become fictitious history.
      if (!item.saved && !item.lastVisited) entries = entries.filter(function (x) { return x.url !== url; });
    }
    persist();
    message(item.saved ? 'Server bookmarked on this device.' : 'Bookmark removed.');
    render();
  }
  function rename(item, row) {
    editing = item.url;
    var fields = node('div', 'sh-rename');
    var input = node('input', 'sh-name-input');
    input.type = 'text';
    input.maxLength = 64;
    input.value = item.name;
    input.placeholder = new URL(item.url).host;
    input.setAttribute('aria-label', 'Server display name');
    var controls = node('div', 'sh-rename-actions');
    function cancel() { editing = ''; render(); }
    function save() {
      var name = input.value.trim().slice(0, 64);
      if (name && !item.saved && entries.filter(function (x) { return x.saved; }).length >= SAVED_LIMIT) {
        message('Bookmark limit reached. Remove a saved server first.');
        return;
      }
      item.name = name;
      // A custom name indicates an intentional bookmark, not temporary history.
      if (name) item.saved = true;
      editing = '';
      persist();
      message(name ? 'Server renamed and bookmarked.' : 'Custom name cleared.');
      render();
    }
    controls.appendChild(button('Save', 'sh-save-name', 'Save display name', save));
    controls.appendChild(button('Cancel', 'sh-cancel-name', 'Cancel renaming', cancel));
    fields.appendChild(input);
    fields.appendChild(node('small', 'sh-rename-hint', 'Naming a server also adds it to Bookmarks.'));
    fields.appendChild(controls);
    row.replaceChildren(fields);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    input.focus();
    input.select();
  }
  function makeRow(item) {
    var row = node('div', 'sh-row');
    var opener = button('', 'sh-server-link', 'Open ' + labelFor(item), function () { openServer(item.url); });
    opener.appendChild(node('strong', 'sh-server-name', labelFor(item)));
    opener.appendChild(node('span', 'sh-server-url', item.url));
    opener.appendChild(node('small', 'sh-server-date', lastUsed(item)));
    opener.title = item.url;
    row.appendChild(opener);

    var actions = node('div', 'sh-row-actions');
    var star = button(item.saved ? '★' : '☆', 'sh-icon-button sh-star' + (item.saved ? ' is-saved' : ''),
      item.saved ? 'Remove bookmark for ' + labelFor(item) : 'Bookmark ' + labelFor(item),
      function () { toggleSaved(item.url); });
    star.setAttribute('aria-pressed', String(item.saved));
    actions.appendChild(star);
    actions.appendChild(button('✎', 'sh-icon-button', 'Rename ' + labelFor(item), function () { rename(item, row); }));
    actions.appendChild(button('×', 'sh-icon-button sh-delete', 'Delete ' + labelFor(item) + ' from history and bookmarks', function () {
      entries = entries.filter(function (entry) { return entry.url !== item.url; });
      persist();
      message('Server removed.');
      render();
    }));
    row.appendChild(actions);
    return row;
  }
  function section(title, items, isRecent) {
    var section = node('section', 'sh-section');
    var header = node('div', 'sh-section-header');
    header.appendChild(node('h3', '', title + ' (' + items.length + ')'));
    if (isRecent && items.length) {
      header.appendChild(button('Clear all recent', 'sh-clear-button', 'Clear recent servers, keep bookmarks', function () {
        confirmingClear = !confirmingClear;
        render();
      }));
    }
    section.appendChild(header);
    if (isRecent && confirmingClear) {
      var confirm = node('div', 'sh-clear-confirm');
      confirm.appendChild(node('span', '', 'Remove all recent servers? Bookmarks will remain.'));
      confirm.appendChild(button('Clear', 'sh-confirm-button', 'Confirm clearing recent servers', function () {
        entries = entries.filter(function (item) { return item.saved; });
        confirmingClear = false;
        persist();
        message('Recent history cleared.');
        render();
      }));
      confirm.appendChild(button('Cancel', 'sh-cancel-name', 'Cancel clearing history', function () {
        confirmingClear = false;
        render();
      }));
      section.appendChild(confirm);
    }
    if (!items.length) section.appendChild(node('p', 'sh-empty', isRecent ? 'No recent servers.' : 'No bookmarks yet. Save a server for one-click access.'));
    items.forEach(function (item) { section.appendChild(makeRow(item)); });
    return section;
  }
  function render() {
    if (!panel || panel.hidden) return;
    updateCurrentButton();
    list.replaceChildren();
    var q = filter.trim().toLowerCase();
    var matching = entries.filter(function (item) {
      return !q || (labelFor(item) + ' ' + item.url).toLowerCase().includes(q);
    });
    var saved = matching.filter(function (item) { return item.saved; })
      .sort(function (a, b) { return b.lastVisited - a.lastVisited; });
    var recent = matching.filter(function (item) { return !item.saved; })
      .sort(function (a, b) { return b.lastVisited - a.lastVisited; });
    list.appendChild(section('Bookmarks', saved, false));
    list.appendChild(section('Recent servers', recent, true));
    if (!storageAvailable) message('');
  }
  function close(focusTrigger) {
    if (!panel) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    editing = '';
    confirmingClear = false;
    if (focusTrigger) trigger.focus();
  }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    filter = '';
    search.value = '';
    confirmingClear = false;
    message('');
    render();
    if (window.matchMedia && window.matchMedia('(min-width: 701px)').matches) search.focus();
  }
  function setup(api) {
    core = api;
    panel = byId('serverHistoryPanel');
    trigger = byId('serverHistoryButton');
    list = byId('serverHistoryList');
    search = byId('serverHistorySearch');
    saveCurrent = byId('serverHistorySave');
    status = byId('serverHistoryStatus');
    if (!panel || !trigger || !list || !search || !saveCurrent || !status) return;
    entries = load();

    trigger.addEventListener('click', function () {
      if (panel.hidden) open(); else close(true);
    });
    byId('serverHistoryClose').addEventListener('click', function () { close(true); });
    saveCurrent.addEventListener('click', function () {
      var root = serverRoot(core.getCurrent());
      if (root) toggleSaved(root);
    });
    search.addEventListener('input', function () { filter = search.value; confirmingClear = false; render(); });
    document.addEventListener('pointerdown', function (event) {
      if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener('keydown', function (event) {
      if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(true); }
    });
    window.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY) return;
      entries = load();
      if (!panel.hidden) render();
    });
  }
  function noteVisit(input) {
    if (!core) return;
    var root = serverRoot(input);
    if (!root) return;
    var item = find(root);
    if (!item) { item = {url: root, name: '', saved: false, lastVisited: 0}; entries.push(item); }
    item.lastVisited = Date.now();
    persist();
    if (panel && !panel.hidden) render();
  }
  window.GISServerHistory = {setup: setup, noteVisit: noteVisit};
})();