(function (global) {
  'use strict';

  function safeTrim(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeScriptUrl(url) {
    var raw = safeTrim(url);
    if (!raw) throw new Error('scriptUrl is required');
    // GitHub Pages cannot call /dev deployment; force /exec when user pasted /dev.
    raw = raw.replace(/\/dev([?#]|$)/i, '/exec$1');
    return raw;
  }

  function appendQuery(url, params) {
    var out = String(url || '');
    var hasQuery = out.indexOf('?') !== -1;
    for (var key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      var value = params[key];
      if (value === undefined || value === null || value === '') continue;
      out += (hasQuery ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(String(value));
      hasQuery = true;
    }
    return out;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_e) {
      throw new Error('invalid_json_response');
    }
  }

  function randomDeviceKey() {
    return 'dk_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  function normalizeTimeoutMs(value, fallback) {
    var num = Number(value);
    var base = Number(fallback || 15000);
    if (!isFinite(base) || base <= 0) base = 15000;
    if (!isFinite(num) || num <= 0) return base;
    if (num < 5000) return 5000;
    if (num > 120000) return 120000;
    return Math.round(num);
  }

  function normalizeTransportMode(value) {
    var mode = safeTrim(value).toLowerCase();
    if (mode === 'fetch' || mode === 'jsonp' || mode === 'auto') return mode;
    return '';
  }

  function isJsonpTransportError(err) {
    var message = safeTrim(err && err.message || '');
    return (
      message.indexOf('jsonp_timeout') === 0 ||
      message.indexOf('jsonp_no_callback') === 0 ||
      message.indexOf('jsonp_failed') === 0
    );
  }

  function isJsonpRetryableError(err) {
    var message = safeTrim(err && err.message || '');
    return (
      message.indexOf('jsonp_timeout') === 0 ||
      message.indexOf('jsonp_no_callback') === 0
    );
  }

  function getTransportStorageKey(scriptUrl) {
    var normalized = safeTrim(scriptUrl || '').split('#')[0].split('?')[0].toLowerCase();
    if (!normalized) return '';
    return 'docControlTransportModeV1:' + normalized;
  }

  function readStoredTransportMode(scriptUrl) {
    var key = getTransportStorageKey(scriptUrl);
    if (!key) return '';
    try {
      return normalizeTransportMode(localStorage.getItem(key) || '');
    } catch (_e) {
      return '';
    }
  }

  function persistTransportMode(scriptUrl, mode) {
    var key = getTransportStorageKey(scriptUrl);
    var normalized = normalizeTransportMode(mode);
    if (!key || !normalized || normalized === 'auto') return;
    try {
      localStorage.setItem(key, normalized);
    } catch (_e) {}
  }

  function readSessionCache(cacheKey, maxAgeMs) {
    if (!cacheKey || !(maxAgeMs > 0)) return null;
    try {
      var raw = sessionStorage.getItem(cacheKey) || '';
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var ts = Number(parsed.ts || 0);
      if (!isFinite(ts) || ts <= 0) return null;
      if ((Date.now() - ts) > Number(maxAgeMs)) return null;
      return parsed.data;
    } catch (_e) {
      return null;
    }
  }

  function writeSessionCache(cacheKey, data) {
    if (!cacheKey) return;
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        ts: Date.now(),
        data: data
      }));
    } catch (_e) {}
  }

  function clearSessionCache(cacheKey) {
    if (!cacheKey) return;
    try {
      sessionStorage.removeItem(cacheKey);
    } catch (_e) {}
  }

  function normalizeCachePrefix(scriptUrl) {
    return safeTrim(scriptUrl || '').split('#')[0].split('?')[0].toLowerCase();
  }

  function DocumentControlApi(options) {
    options = options || {};
    this.scriptUrl = normalizeScriptUrl(options.scriptUrl || '');
    this.defaultDeviceKey = safeTrim(options.deviceKey || '') || randomDeviceKey();
    this.defaultIpKey = safeTrim(options.ipKey || '');
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs, 15000);
    var storedMode = readStoredTransportMode(this.scriptUrl) || '';
    if (typeof fetch === 'function') {
      this.transportMode = storedMode === 'fetch' ? 'fetch' : 'auto';
    } else {
      this.transportMode = storedMode || 'jsonp';
    }
    this.cachePrefix = 'docControlApiCacheV1:' + normalizeCachePrefix(this.scriptUrl);
  }

  DocumentControlApi.prototype._buildPayload = function (action, payload, opts) {
    var normalizedPayload = payload && typeof payload === 'object' ? payload : {};
    var body = {
      action: action,
      payload: normalizedPayload
    };
    var bodyDeviceKey = safeTrim(normalizedPayload.deviceKey || normalizedPayload.dk || this.defaultDeviceKey || '');
    var bodyIpKey = safeTrim(
      normalizedPayload.clientIpKey
      || normalizedPayload.ipKey
      || normalizedPayload.ipk
      || this.defaultIpKey
      || ''
    );
    if (bodyDeviceKey) {
      body.deviceKey = bodyDeviceKey;
      body.dk = bodyDeviceKey;
    }
    if (bodyIpKey) {
      body.clientIpKey = bodyIpKey;
      body.ipKey = bodyIpKey;
      body.ipk = bodyIpKey;
    }
    var requestId = safeTrim(opts && opts.requestId ? opts.requestId : '');
    if (requestId) body.requestId = requestId;
    return body;
  };

  DocumentControlApi.prototype._ensureSessionKeys = function (payload) {
    var out = payload && typeof payload === 'object' ? payload : {};
    if (!safeTrim(out.deviceKey)) out.deviceKey = this.defaultDeviceKey;
    if (!safeTrim(out.clientIpKey) && this.defaultIpKey) out.clientIpKey = this.defaultIpKey;
    return out;
  };

  DocumentControlApi.prototype._fetchWithTimeout = function (url, requestInit, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, timeoutMs);

      fetch(url, requestInit)
        .then(function (resp) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(resp);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err || new Error('network_error'));
        });
    });
  };

  DocumentControlApi.prototype._callFetch = function (action, payload, opts) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch_not_supported'));
    }

    var sessionDeviceKey = safeTrim((payload && (payload.deviceKey || payload.dk)) || this.defaultDeviceKey || '');
    var sessionIpKey = safeTrim(
      (payload && (payload.clientIpKey || payload.ipKey || payload.ipk))
      || this.defaultIpKey
      || ''
    );
    var endpoint = appendQuery(this.scriptUrl, {
      api: '1',
      dk: sessionDeviceKey,
      deviceKey: sessionDeviceKey,
      ipk: sessionIpKey,
      clientIpKey: sessionIpKey
    });
    var body = this._buildPayload(action, payload, opts);
    var timeoutMs = normalizeTimeoutMs((opts && opts.timeoutMs), this.timeoutMs || 15000);

    return this._fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
        credentials: 'omit',
        mode: 'cors'
      },
      timeoutMs
    ).then(function (resp) {
      return resp.text().then(function (text) {
        if (!resp || !resp.ok) {
          throw new Error('HTTP_' + (resp ? resp.status : '0'));
        }
        var parsed = parseJson(text);
        if (!parsed || parsed.success === false) {
          var apiErr = new Error(parsed && parsed.error ? parsed.error : 'api_error');
          apiErr.code = parsed && parsed.code ? parsed.code : 'api_error';
          apiErr.isApiError = true;
          throw apiErr;
        }
        return parsed;
      });
    });
  };

  DocumentControlApi.prototype._callJsonp = function (action, payload, opts) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var callbackName = '__docApiCb_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
      var scriptTag = null;
      var timer = null;
      var callbackFired = false;
      var timeoutMs = normalizeTimeoutMs((opts && opts.timeoutMs), self.timeoutMs || 15000);

      function cleanup() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          delete global[callbackName];
        } catch (_e1) {
          global[callbackName] = undefined;
        }
        if (scriptTag && scriptTag.parentNode) {
          scriptTag.parentNode.removeChild(scriptTag);
        }
        scriptTag = null;
      }

      global[callbackName] = function (response) {
        callbackFired = true;
        cleanup();
        if (!response || response.success === false) {
          reject(new Error(response && response.error ? response.error : 'api_error'));
          return;
        }
        resolve(response);
      };

      var queryPayload = self._buildPayload(action, payload, opts).payload || {};
      var queryDeviceKey = safeTrim((queryPayload && (queryPayload.deviceKey || queryPayload.dk)) || self.defaultDeviceKey || '');
      var queryIpKey = safeTrim(
        (queryPayload && (queryPayload.clientIpKey || queryPayload.ipKey || queryPayload.ipk))
        || self.defaultIpKey
        || ''
      );
      var src = appendQuery(self.scriptUrl, {
        api: '1',
        action: action,
        callback: callbackName,
        dk: queryDeviceKey,
        deviceKey: queryDeviceKey,
        ipk: queryIpKey,
        clientIpKey: queryIpKey,
        payload: JSON.stringify(queryPayload),
        _: Date.now()
      });

      scriptTag = document.createElement('script');
      scriptTag.async = true;
      scriptTag.src = src;
      scriptTag.onload = function () {
        if (callbackFired) return;
        setTimeout(function () {
          if (callbackFired) return;
          cleanup();
          reject(new Error('jsonp_no_callback: โหลดสคริปต์ได้แต่ไม่ได้รับ callback (ตรวจสอบ scriptUrl /exec และ action API)'));
        }, 120);
      };
      scriptTag.onerror = function () {
        cleanup();
        reject(new Error('jsonp_failed: โหลดสคริปต์ API ไม่สำเร็จ (ตรวจสอบ URL /exec, deployment เป็น Anyone และเปิดสิทธิ์การเข้าถึง)'));
      };

      timer = setTimeout(function () {
        cleanup();
        reject(new Error('jsonp_timeout: ไม่ได้รับ callback จาก Apps Script'));
      }, timeoutMs);

      document.head.appendChild(scriptTag);
    });
  };

  DocumentControlApi.prototype._startGlobalLoader = function (opts) {
    if (opts && opts.noPageLoader) return null;
    var message = safeTrim(opts && opts.loaderMessage ? opts.loaderMessage : '') || 'กำลังโหลดข้อมูล...';

    if (typeof global.beginPageLoading === 'function') {
      return global.beginPageLoading(message);
    }
    if (typeof global.showPageLoader === 'function') {
      global.showPageLoader(message, false);
      return { _legacyLoader: true };
    }
    return null;
  };

  DocumentControlApi.prototype._stopGlobalLoader = function (ticket) {
    if (!ticket) return;
    if (typeof global.endPageLoading === 'function') {
      global.endPageLoading(ticket);
      return;
    }
    if (typeof global.hidePageLoader === 'function') {
      global.hidePageLoader(false);
    }
  };

  DocumentControlApi.prototype._rememberTransportMode = function (mode) {
    var normalized = normalizeTransportMode(mode);
    if (!normalized || normalized === 'auto') return;
    this.transportMode = normalized;
    persistTransportMode(this.scriptUrl, normalized);
  };

  DocumentControlApi.prototype._cacheKey = function (name) {
    var suffix = safeTrim(name || '');
    if (!suffix) return '';
    return this.cachePrefix + ':' + suffix;
  };

  DocumentControlApi.prototype._cacheRead = function (name, maxAgeMs) {
    return readSessionCache(this._cacheKey(name), maxAgeMs);
  };

  DocumentControlApi.prototype._cacheWrite = function (name, data) {
    writeSessionCache(this._cacheKey(name), data);
  };

  DocumentControlApi.prototype._cacheClear = function (name) {
    clearSessionCache(this._cacheKey(name));
  };

  DocumentControlApi.prototype.call = function (action, payload, opts) {
    var requestPayload = this._ensureSessionKeys(payload || {});
    if (safeTrim(requestPayload.deviceKey)) {
      this.defaultDeviceKey = safeTrim(requestPayload.deviceKey);
    }
    if (safeTrim(requestPayload.clientIpKey)) {
      this.defaultIpKey = safeTrim(requestPayload.clientIpKey);
    }
    var useJsonpOnly = !!(opts && opts.useJsonpOnly);
    var loaderTicket = this._startGlobalLoader(opts);
    var self = this;
    var requestPromise;
    var requestedMode = normalizeTransportMode(opts && opts.transportMode) || '';
    var transportMode = useJsonpOnly
      ? 'jsonp'
      : (requestedMode || normalizeTransportMode(this.transportMode) || 'auto');

    if (transportMode === 'jsonp') {
      requestPromise = this._callJsonp(action, requestPayload, opts)
        .then(function (response) {
          self._rememberTransportMode('jsonp');
          return response;
        })
        .catch(function (err) {
          if (useJsonpOnly || !isJsonpTransportError(err)) {
            throw err;
          }
          var retryPromise = Promise.reject(err);
          if (isJsonpRetryableError(err)) {
            var retryOpts = {};
            var sourceOpts = opts || {};
            for (var key in sourceOpts) {
              if (!Object.prototype.hasOwnProperty.call(sourceOpts, key)) continue;
              retryOpts[key] = sourceOpts[key];
            }
            retryOpts.timeoutMs = normalizeTimeoutMs(
              Number((sourceOpts && sourceOpts.timeoutMs) || self.timeoutMs || 15000) * 1.5,
              self.timeoutMs || 15000
            );
            retryPromise = self._callJsonp(action, requestPayload, retryOpts).then(function (response) {
              self._rememberTransportMode('jsonp');
              return response;
            });
          }

          return retryPromise.catch(function () {
            return self._callFetch(action, requestPayload, opts).then(function (response) {
              self._rememberTransportMode('fetch');
              return response;
            }).catch(function (fetchErr) {
              throw err || fetchErr;
            });
          });
        });
    } else if (transportMode === 'fetch') {
      requestPromise = this._callFetch(action, requestPayload, opts)
        .then(function (response) {
          self._rememberTransportMode('fetch');
          return response;
        })
        .catch(function (err) {
          if (err && err.isApiError) {
            throw err;
          }
          self._rememberTransportMode('jsonp');
          return self._callJsonp(action, requestPayload, opts);
        });
    } else {
      requestPromise = this._callFetch(action, requestPayload, opts).catch(function (err) {
        if (err && err.isApiError) {
          throw err;
        }
        self._rememberTransportMode('jsonp');
        return self._callJsonp(action, requestPayload, opts);
      }).then(function (response) {
        if (normalizeTransportMode(self.transportMode) !== 'jsonp') {
          self._rememberTransportMode('fetch');
        }
        return response;
      });
    }

    return requestPromise.then(function (response) {
      self._stopGlobalLoader(loaderTicket);
      return response;
    }, function (err) {
      self._stopGlobalLoader(loaderTicket);
      throw err;
    });
  };

  DocumentControlApi.prototype.health = function (opts) {
    return this.call('health', { deviceKey: this.defaultDeviceKey }, opts);
  };

  DocumentControlApi.prototype.login = function (username, password, opts) {
    var payload = {
      username: safeTrim(username),
      password: String(password == null ? '' : password),
      deviceKey: (opts && opts.deviceKey) ? safeTrim(opts.deviceKey) : this.defaultDeviceKey,
      clientIpKey: (opts && opts.ipKey) ? safeTrim(opts.ipKey) : this.defaultIpKey
    };
    this.defaultDeviceKey = payload.deviceKey || this.defaultDeviceKey;
    var self = this;
    return this.call('auth.login', payload, opts).then(function (res) {
      if (res && res.success && res.user) self._cacheWrite('auth.me', res);
      return res;
    });
  };

  DocumentControlApi.prototype.logout = function (opts) {
    var self = this;
    return this.call('auth.logout', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).finally(function () {
      self._cacheClear('auth.me');
    });
  };

  DocumentControlApi.prototype.me = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('auth.me', 20000);
    if (cached && cached.success && cached.user) {
      return Promise.resolve(cached);
    }

    var self = this;
    return this.call('auth.me', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success && res.user) self._cacheWrite('auth.me', res);
      return res;
    });
  };

  DocumentControlApi.prototype.optionsInfo = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('options.info', 10 * 60 * 1000);
    if (cached && cached.success) return Promise.resolve(cached);

    var self = this;
    return this.call('options.info', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success) self._cacheWrite('options.info', res);
      return res;
    });
  };

  DocumentControlApi.prototype.optionsMembers = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('options.members', 10 * 60 * 1000);
    if (cached && cached.success) return Promise.resolve(cached);

    var self = this;
    return this.call('options.members', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success) self._cacheWrite('options.members', res);
      return res;
    });
  };

  DocumentControlApi.prototype.storageOptions = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('storage.options', 10 * 60 * 1000);
    if (cached && cached.success) return Promise.resolve(cached);

    var self = this;
    return this.call('storage.options', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success) self._cacheWrite('storage.options', res);
      return res;
    });
  };

  DocumentControlApi.prototype.docsList = function (params, opts) {
    params = params || {};
    return this.call('docs.list', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      page: Number(params.page || 1),
      itemsPerPage: Number(params.itemsPerPage || 20),
      searchQuery: safeTrim(params.searchQuery || ''),
      statusFilter: safeTrim(params.statusFilter || 'all')
    }, opts);
  };

  DocumentControlApi.prototype.docDetail = function (docId, opts) {
    return this.call('doc.detail', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || '')
    }, opts);
  };

  DocumentControlApi.prototype.systemReport = function (opts) {
    return this.call('docs.report_all', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts);
  };

  DocumentControlApi.prototype.loanOptions = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('loan.options', 10 * 60 * 1000);
    if (cached && cached.success) return Promise.resolve(cached);

    var self = this;
    return this.call('loan.options', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success) self._cacheWrite('loan.options', res);
      return res;
    });
  };

  DocumentControlApi.prototype.loanLookupDoc = function (docNoSdh, opts) {
    return this.call('loan.lookup_doc', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docNoSdh: safeTrim(docNoSdh || '')
    }, opts);
  };

  DocumentControlApi.prototype.loanList = function (params, opts) {
    params = params || {};
    return this.call('loan.list', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      page: Number(params.page || 1),
      itemsPerPage: Number(params.itemsPerPage || 20),
      searchQuery: safeTrim(params.searchQuery || '')
    }, opts);
  };

  DocumentControlApi.prototype.loanDetail = function (recordId, opts) {
    return this.call('loan.detail', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      recordId: safeTrim(recordId || '')
    }, opts);
  };

  DocumentControlApi.prototype.loanCreate = function (formData, opts) {
    return this.call('loan.create', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      formData: formData || {}
    }, opts);
  };

  DocumentControlApi.prototype.loanUpdate = function (recordId, formData, opts) {
    return this.call('loan.update', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      recordId: safeTrim(recordId || ''),
      formData: formData || {}
    }, opts);
  };

  DocumentControlApi.prototype.loanStorageOptions = function (opts) {
    var cached = (opts && opts.forceRefresh) ? null : this._cacheRead('loan.storage.options', 10 * 60 * 1000);
    if (cached && cached.success) return Promise.resolve(cached);

    var self = this;
    return this.call('loan.storage.options', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey
    }, opts).then(function (res) {
      if (res && res.success) self._cacheWrite('loan.storage.options', res);
      return res;
    });
  };

  DocumentControlApi.prototype.checkLoanStorageEligibility = function (recordId, opts) {
    var normalizedId = safeTrim(recordId || '');
    return this.call('loan.storage.check_eligibility', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      recordId: normalizedId,
      id: normalizedId,
      docId: normalizedId
    }, opts);
  };

  DocumentControlApi.prototype.saveLoanStorageData = function (recordId, newLoc, userName, fiscalYear, opts) {
    var realFiscal = fiscalYear;
    var realOpts = opts;
    if (realFiscal && typeof realFiscal === 'object' && !Array.isArray(realFiscal)) {
      realOpts = realFiscal;
      realFiscal = '';
    }
    return this.call('loan.storage.save_data', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      recordId: safeTrim(recordId || ''),
      newLoc: safeTrim(newLoc || ''),
      userName: safeTrim(userName || ''),
      fiscalYear: safeTrim(realFiscal || '')
    }, realOpts);
  };

  DocumentControlApi.prototype.saveLoanDocumentsToStorage = function (items, userName, opts) {
    return this.call('loan.storage.save_documents', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      items: Array.isArray(items) ? items : [],
      userName: safeTrim(userName || '')
    }, opts);
  };

  DocumentControlApi.prototype.docCreate = function (formData, opts) {
    return this.call('doc.create', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      formData: formData || {}
    }, opts);
  };

  DocumentControlApi.prototype.docUpdate = function (docId, formData, opts) {
    return this.call('doc.update', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || ''),
      formData: formData || {}
    }, opts);
  };

  DocumentControlApi.prototype.docUpdateStatus = function (docId, statusData, opts) {
    return this.call('doc.update_status', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || ''),
      statusData: statusData || {}
    }, opts);
  };

  DocumentControlApi.prototype.docChangeMainStatus = function (docId, newStatus, statusRemark, opts) {
    return this.call('doc.change_main_status', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || ''),
      newStatus: safeTrim(newStatus || ''),
      statusRemark: String(statusRemark == null ? '' : statusRemark)
    }, opts);
  };

  DocumentControlApi.prototype.docUpdateField = function (docId, fieldName, fieldValue, opts) {
    return this.call('doc.update_field', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || ''),
      fieldName: safeTrim(fieldName || ''),
      fieldValue: fieldValue
    }, opts);
  };

  DocumentControlApi.prototype.checkStorageEligibility = function (docId, opts) {
    var normalizedDocId = safeTrim(docId || '');
    return this.call('storage.check_eligibility', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: normalizedDocId,
      id: normalizedDocId,
      amDocNo: normalizedDocId
    }, opts);
  };

  DocumentControlApi.prototype.saveDocumentsToBox = function (docIds, boxId, userName, opts) {
    return this.call('storage.save_documents', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docIds: Array.isArray(docIds) ? docIds : [],
      boxId: safeTrim(boxId || ''),
      userName: safeTrim(userName || '')
    }, opts);
  };

  DocumentControlApi.prototype.saveStorageData = function (docId, newLoc, userName, fiscalYear, destroyDate, opts) {
    return this.call('storage.save_data', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      docId: safeTrim(docId || ''),
      newLoc: safeTrim(newLoc || ''),
      userName: safeTrim(userName || ''),
      fiscalYear: safeTrim(fiscalYear || ''),
      destroyDate: safeTrim(destroyDate || '')
    }, opts);
  };

  DocumentControlApi.prototype.boxDetail = function (boxName, opts) {
    var normalizedBox = safeTrim(boxName || '');
    return this.call('box.detail', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      boxName: normalizedBox,
      box: normalizedBox,
      boxId: normalizedBox,
      box_name: normalizedBox,
      id: normalizedBox,
      name: normalizedBox,
      location: normalizedBox,
      loc: normalizedBox,
      detail: normalizedBox,
      selectedLocation: normalizedBox,
      storedLoc: normalizedBox,
      newLoc: normalizedBox
    }, opts);
  };

  DocumentControlApi.prototype.inspectionReport = function (params, opts) {
    params = params || {};
    return this.call('inspection.report', {
      deviceKey: this.defaultDeviceKey,
      clientIpKey: this.defaultIpKey,
      officerName: safeTrim(params.officerName || ''),
      selectedFiscalYears: Array.isArray(params.selectedFiscalYears) ? params.selectedFiscalYears : [],
      startDate: safeTrim(params.startDate || ''),
      endDate: safeTrim(params.endDate || ''),
      startTime: safeTrim(params.startTime || ''),
      endTime: safeTrim(params.endTime || ''),
      group: safeTrim(params.group || '')
    }, opts);
  };

  global.DocumentControlApi = DocumentControlApi;
})(typeof window !== 'undefined' ? window : this);
