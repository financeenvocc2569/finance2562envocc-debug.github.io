(function (global) {
  'use strict';

  var STORAGE_SCRIPT_URL = 'docControlScriptUrlV3';
  var STORAGE_DEVICE_KEY = 'docControlDeviceKeyV3';

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  function safeTrim(value) {
    return safeText(value).trim();
  }

  function normalizeScriptUrl(url) {
    var raw = safeTrim(url);
    if (!raw) return '';
    raw = raw.replace(/\s+/g, '');
    return raw.replace(/\/dev([?#]|$)/i, '/exec$1');
  }

  function randomDeviceKey() {
    return 'dk_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  function getRuntimeDeviceKey() {
    var key = '';
    try {
      if (typeof global.getDeviceKey === 'function') {
        key = safeTrim(global.getDeviceKey() || '');
      }
    } catch (_e1) {}
    if (!key) key = safeTrim(global.__docControlDeviceKey || '');
    return key;
  }

  function safeUrl(url) {
    var v = safeTrim(url);
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? v : '';
  }

  function normalizeConfigObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function readConfig() {
    var cfg = normalizeConfigObject(global.DOC_CONTROL_CONFIG);
    var links = normalizeConfigObject(cfg.links);

    return {
      appName: safeTrim(cfg.appName),
      subtitle: safeTrim(cfg.subtitle),
      themePreset: safeTrim(cfg.themePreset || 'apple-glass'),
      scriptUrl: normalizeScriptUrl(cfg.scriptUrl),
      deviceKey: safeTrim(cfg.deviceKey),
      lockSettings: !!cfg.lockSettings,
      requestTimeoutMs: Number(cfg.requestTimeoutMs || 35000),
      links: {
        webApp: safeUrl(links.webApp),
        spreadsheet: safeUrl(links.spreadsheet),
        appsScriptProject: safeUrl(links.appsScriptProject),
        driveFolder: safeUrl(links.driveFolder),
        manual: safeUrl(links.manual)
      }
    };
  }

  function getStoredSettings() {
    var cfg = readConfig();
    var savedUrl = '';
    var savedDevice = '';
    var runtimeDevice = '';
    var query = parseQuery();
    var queryUrl = normalizeScriptUrl(query.su || query.scriptUrl || query.script || '');
    var queryDevice = safeTrim(query.dk || query.deviceKey || query.device || '');

    try {
      savedUrl = normalizeScriptUrl(localStorage.getItem(STORAGE_SCRIPT_URL) || '');
      savedDevice = safeTrim(localStorage.getItem(STORAGE_DEVICE_KEY) || '');
    } catch (_e) {}

    runtimeDevice = getRuntimeDeviceKey();

    var scriptUrl = cfg.scriptUrl || queryUrl || savedUrl;
    var deviceKey = cfg.deviceKey || queryDevice || savedDevice || runtimeDevice || randomDeviceKey();

    if (scriptUrl) {
      try { localStorage.setItem(STORAGE_SCRIPT_URL, scriptUrl); } catch (_e0) {}
    }

    if (deviceKey) {
      try { localStorage.setItem(STORAGE_DEVICE_KEY, deviceKey); } catch (_e2) {}
      global.__docControlDeviceKey = deviceKey;
    }

    return {
      scriptUrl: scriptUrl,
      deviceKey: deviceKey,
      lockSettings: cfg.lockSettings,
      config: cfg
    };
  }

  function persistSettings(scriptUrl, deviceKey) {
    var nextUrl = normalizeScriptUrl(scriptUrl);
    var nextDevice = safeTrim(deviceKey) || getRuntimeDeviceKey() || randomDeviceKey();
    if (!nextUrl) throw new Error('missing_script_url');
    if (!nextDevice) throw new Error('missing_device_key');

    try {
      localStorage.setItem(STORAGE_SCRIPT_URL, nextUrl);
      localStorage.setItem(STORAGE_DEVICE_KEY, nextDevice);
    } catch (_e) {}
    global.__docControlDeviceKey = nextDevice;

    return {
      scriptUrl: nextUrl,
      deviceKey: nextDevice
    };
  }

  function ensureSettingsOrThrow() {
    var settings = getStoredSettings();
    if (!settings.scriptUrl) throw new Error('missing_script_url');
    if (!settings.deviceKey) throw new Error('missing_device_key');
    return settings;
  }

  function createApiClient(settings) {
    if (typeof global.DocumentControlApi !== 'function') {
      throw new Error('api_client_missing');
    }

    var s = settings || ensureSettingsOrThrow();
    var timeoutMs = Number((s.config && s.config.requestTimeoutMs) || s.requestTimeoutMs || 35000);
    if (!isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 35000;
    if (timeoutMs < 5000) timeoutMs = 5000;
    if (timeoutMs > 120000) timeoutMs = 120000;
    return new global.DocumentControlApi({
      scriptUrl: s.scriptUrl,
      deviceKey: s.deviceKey,
      timeoutMs: timeoutMs
    });
  }

  function parseQuery(search) {
    var out = {};

    function mergeQuery(source) {
      var query = safeText(source || '').replace(/^\?/, '');
      if (!query) return;
      var parts = query.split('&');
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        var idx = p.indexOf('=');
        var k = idx >= 0 ? p.substring(0, idx) : p;
        var v = idx >= 0 ? p.substring(idx + 1) : '';
        try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (_e1) {}
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (_e2) {}
        if (!k) continue;
        if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
      }
    }

    if (typeof search === 'string') {
      mergeQuery(search);
      return out;
    }

    mergeQuery(global.location ? global.location.search : '');

    // Fallback: บางลิงก์ฝัง query ไว้ใน hash เช่น "#/path?box=..."
    if (global.location && global.location.hash && Object.keys(out).length === 0) {
      var hash = String(global.location.hash || '');
      var qIdx = hash.indexOf('?');
      if (qIdx >= 0) mergeQuery(hash.substring(qIdx + 1));
    }

    return out;
  }

  function buildPageUrl(path, params) {
    var base = safeTrim(path || 'index.html') || 'index.html';
    var q = [];
    var key;
    params = params || {};

    for (key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      var value = params[key];
      if (value === undefined || value === null || value === '') continue;
      q.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }

    return q.length ? (base + '?' + q.join('&')) : base;
  }

  function redirect(path, params, replace) {
    if (!global.location) return;
    var url = buildPageUrl(path, params);
    if (typeof global.appendSessionKeysToUrl === 'function') {
      url = global.appendSessionKeysToUrl(url);
    } else if (typeof global.appendDeviceKeyToUrl === 'function') {
      url = global.appendDeviceKeyToUrl(url);
    }
    if (typeof global.navigateWithLoader === 'function') {
      global.navigateWithLoader(url);
      return;
    }
    if (replace) {
      global.location.replace(url);
    } else {
      global.location.href = url;
    }
  }

  function escapeHtml(value) {
    return safeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(value) {
    var raw = safeTrim(value);
    if (!raw) return '-';
    var num = Number(raw.replace(/,/g, ''));
    if (isNaN(num)) return raw;
    return num.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  var helpDictCache = {};

  function normalizeHelpKey(value) {
    var text = safeText(value || '');
    text = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    text = text.replace(/\s*\([A-Z]{1,3}\)\s*$/g, '').trim();
    return text;
  }

  function applyHelpDictToLabels(labels, dictMap) {
    if (!labels || !labels.length) return;
    var map = dictMap || {};
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (!label) continue;
      var key = normalizeHelpKey(label.textContent || '');
      if (!key) continue;
      var helpText = safeTrim(map[key] || '');
      var badge = label.querySelector('.field-help');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'field-help';
        badge.textContent = '?';
        label.appendChild(badge);
      }
      badge.setAttribute('data-help-key', key);
      if (helpText) {
        badge.title = helpText;
      } else {
        badge.title = 'ยังไม่มีคำอธิบาย';
      }
    }
  }

  function attachHelpHints(scope, api, root) {
    var scopeKey = safeTrim(scope || '').toLowerCase();
    if (!scopeKey) return Promise.resolve(false);
    if (!global.document) return Promise.resolve(false);
    var host = root && root.querySelectorAll ? root : global.document;
    var labels = host.querySelectorAll('.form-label');
    if (!labels.length) return Promise.resolve(false);

    if (helpDictCache[scopeKey]) {
      applyHelpDictToLabels(labels, helpDictCache[scopeKey]);
      return Promise.resolve(true);
    }

    if (!api || typeof api.dictGet !== 'function') {
      applyHelpDictToLabels(labels, {});
      return Promise.resolve(false);
    }

    return api.dictGet(scopeKey, { noPageLoader: true }).then(function (res) {
      var items = (res && res.success && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
      var map = {};
      for (var i = 0; i < items.length; i++) {
        var item = items[i] || {};
        var key = normalizeHelpKey(item.key || item.name || '');
        if (!key) continue;
        map[key] = safeTrim(item.desc || item.description || '');
      }
      helpDictCache[scopeKey] = map;
      applyHelpDictToLabels(labels, map);
      return true;
    }).catch(function () {
      applyHelpDictToLabels(labels, {});
      return false;
    });
  }

  global.DocFrontendCommon = {
    safeText: safeText,
    safeTrim: safeTrim,
    normalizeScriptUrl: normalizeScriptUrl,
    randomDeviceKey: randomDeviceKey,
    readConfig: readConfig,
    getStoredSettings: getStoredSettings,
    persistSettings: persistSettings,
    ensureSettingsOrThrow: ensureSettingsOrThrow,
    createApiClient: createApiClient,
    parseQuery: parseQuery,
    buildPageUrl: buildPageUrl,
    redirect: redirect,
    escapeHtml: escapeHtml,
    fmtMoney: fmtMoney,
    normalizeHelpKey: normalizeHelpKey,
    attachHelpHints: attachHelpHints,
    storageKeys: {
      scriptUrl: STORAGE_SCRIPT_URL,
      deviceKey: STORAGE_DEVICE_KEY
    }
  };
})(typeof window !== 'undefined' ? window : this);
