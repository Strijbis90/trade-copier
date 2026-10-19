const axios = require('axios');
const WebSocket = require('ws');
const { createProxyAgent, describeRoute } = require('./proxy');

const APP_VERSION = '1.0.0';

function endpoints(environment) {
  const live = environment === 'live';
  const host = live ? 'live.tradovateapi.com' : 'demo.tradovateapi.com';
  return {
    rest: `https://${host}/v1`,
    ws: `wss://${host}/v1/websocket`
  };
}

function authFailure(data) {
  if (!data || typeof data !== 'object') return 'Onverwacht antwoord van Tradovate.';
  if (data['p-captcha']) {
    return 'Tradovate vraagt een captcha. Log eerst in via het Tradovate-platform en probeer opnieuw.';
  }
  if (data.errorText) return data.errorText;
  if (data['p-ticket'] && !data.accessToken) {
    return 'Tradovate vraagt extra verificatie (p-ticket).';
  }
  return '';
}

class TradovateClient {
  constructor(account) {
    this.account = account;
    this.urls = endpoints(account.environment);
    this.route = describeRoute(account);
    this.token = null;
    this.expiration = 0;
    this.userId = null;
    this.userName = '';
    this.subAccounts = [];
    this.contracts = new Map();
    this.positions = new Map();
    this.ws = null;
    this.heartbeat = null;
    this.renewTimer = null;
    this.reconnectTimer = null;
    this.requestId = 1;
    this.pending = new Map();
    this.queued = [];
    this.ready = false;
    this.hasSynced = false;
    this.allowReconnect = false;
    this.closed = false;
    this.socketAuthed = false;
    this.reconnects = 0;
    this.onPosition = null;
    this.onStatus = null;
  }

  setStatus(connection, message) {
    if (this.onStatus) {
      this.onStatus({
        connection,
        message: message || '',
        route: this.route.mode,
        routeLabel: this.route.label
      });
    }
  }

  async http(method, path, body, token) {
    const agent = createProxyAgent(this.account);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const config = {
      method,
      url: `${this.urls.rest}${path}`,
      headers,
      timeout: 20000,
      proxy: false,
      validateStatus: () => true
    };
    if (body !== undefined) config.data = body;
    if (agent) {
      config.httpAgent = agent;
      config.httpsAgent = agent;
    }
    try {
      return await axios(config);
    } catch (err) {
      const reason = err.code || err.message;
      if (this.account.useProxy) {
        throw new Error(`Proxyverbinding mislukt (${reason}). Er is niet direct verbonden.`);
      }
      throw new Error(`Netwerkfout (${reason}).`);
    }
  }

  async authenticate() {
    const cid = String(this.account.clientId).trim();
    const body = {
      name: this.account.username,
      password: this.account.password,
      appId: this.account.appId || 'TradeCopier',
      appVersion: APP_VERSION,
      cid: /^\d+$/.test(cid) ? Number(cid) : cid,
      sec: this.account.secret,
      deviceId: this.account.deviceId
    };
    const res = await this.http('POST', '/auth/accesstokenrequest', body);
    const data = res.data || {};
    const failure = authFailure(data);
    if (res.status >= 400 || failure || !data.accessToken) {
      throw new Error(failure || `Tradovate ${res.status || 'auth'} geweigerd.`);
    }
    if (data.userStatus && data.userStatus !== 'Active') {
      throw new Error(`Tradovate-status: ${data.userStatus}`);
    }
    this.token = data.accessToken;
    this.expiration = data.expirationTime ? new Date(data.expirationTime).getTime() : Date.now() + 80 * 60 * 1000;
    this.userId = data.userId;
    this.userName = data.name || this.account.username;
    this.scheduleRenew();
    return data;
  }

  scheduleRenew() {
    clearTimeout(this.renewTimer);
    const delay = Math.max(15000, this.expiration - Date.now() - 15 * 60 * 1000);
    this.renewTimer = setTimeout(() => {
      this.renew().catch((err) => {
        this.setStatus('error', err.message);
      });
    }, delay);
  }

  async renew() {
    if (!this.token || this.closed) return;
    const res = await this.http('GET', '/auth/renewaccesstoken', undefined, this.token);
    const data = res.data || {};
    const failure = authFailure(data);
    if (res.status >= 400 || failure || !data.accessToken) {
      await this.authenticate();
      if (this.ws) this.reconnectSoon(0);
      return;
    }
    const changed = data.accessToken !== this.token;
    this.token = data.accessToken;
    if (data.expirationTime) this.expiration = new Date(data.expirationTime).getTime();
    this.scheduleRenew();
    if (changed && this.ws) this.reconnectSoon(0);
  }

  async listSubAccounts() {
    if (!this.token) await this.authenticate();
    const res = await this.http('GET', '/account/list', undefined, this.token);
    if (res.status === 401) {
      await this.authenticate();
      return this.listSubAccounts();
    }
    if (res.status >= 400) {
      const msg = res.data?.errorText || res.statusText || 'account/list mislukt';
      throw new Error(`Tradovate ${res.status}: ${msg}`);
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    this.subAccounts = rows
      .filter((row) => row && row.active !== false)
      .map((row) => ({ id: row.id, name: row.name }));
    return this.subAccounts;
  }

  resolveSubAccount(preferredId) {
    const wanted = preferredId || null;
    if (wanted) {
      const match = this.subAccounts.find((row) => String(row.id) === String(wanted));
      if (!match) throw new Error('Gekozen Tradovate-account hoort niet bij deze login.');
      return match;
    }
    if (this.subAccounts.length === 1) return this.subAccounts[0];
    if (this.subAccounts.length === 0) throw new Error('Geen actief Tradovate-account gevonden.');
    throw new Error('Meerdere Tradovate-accounts gevonden. Kies er een bij het account.');
  }

  detachSocket() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }

  async connectStream() {
    if (this.closed) return;
    if (!this.token) await this.authenticate();
    this.detachSocket();
    this.ready = false;
    this.socketAuthed = false;
    this.queued = [];
    this.setStatus('connecting', this.route.label);
    await new Promise((resolve, reject) => {
      const agent = createProxyAgent(this.account);
      const options = { handshakeTimeout: 15000 };
      if (agent) options.agent = agent;
      const ws = new WebSocket(this.urls.ws, options);
      this.ws = ws;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('Websocket-timeout.')), 20000);

      ws.on('error', (err) => {
        const reason = err.message || 'websocket';
        if (this.account.useProxy) {
          fail(new Error(`Proxy websocket mislukt (${reason}). Er is niet direct verbonden.`));
        } else {
          fail(new Error(`Websocket mislukt (${reason}).`));
        }
      });

      ws.on('close', () => {
        clearInterval(this.heartbeat);
        this.rejectPending(new Error('Websocket gesloten.'));
        if (!settled) fail(new Error('Websocket gesloten tijdens het verbinden.'));
        if (!this.closed && this.allowReconnect && this.ws === ws) this.reconnectSoon();
      });

      ws.on('message', (raw) => {
        this.onFrame(raw.toString(), () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.reconnects = 0;
            this.allowReconnect = true;
            resolve();
          }
        }, fail);
      });
    });
    this.setStatus('online', this.route.label);
  }

  onFrame(text, onReady, fail) {
    if (!text) return;
    const type = text[0];
    if (type === 'h') return;
    if (type === 'o') {
      this.startHeartbeat();
      this.ws.send(`authorize\n0\n\n${this.token}`);
      return;
    }
    if (type === 'c') {
      fail(new Error(`Tradovate sloot de socket: ${text.slice(1)}`));
      return;
    }
    if (type !== 'a') return;
    let items;
    try {
      items = JSON.parse(text.slice(1));
    } catch {
      return;
    }
    if (!Array.isArray(items)) return;
    for (const item of items) this.onItem(item, onReady, fail);
  }

  onItem(item, onReady, fail) {
    if (!item || typeof item !== 'object') return;
    if (item.i === 0 && !this.socketAuthed) {
      if (item.s && item.s >= 400) {
        fail(new Error(item.d?.errorText || `Socket-auth ${item.s}`));
        return;
      }
      this.socketAuthed = true;
      this.syncRequest()
        .then((data) => {
          this.ingest(data, this.hasSynced);
          this.hasSynced = true;
          this.flushQueue();
          onReady();
        })
        .catch((err) => fail(err));
      return;
    }
    if (typeof item.i === 'number' && this.pending.has(item.i)) {
      const waiter = this.pending.get(item.i);
      clearTimeout(waiter.timer);
      this.pending.delete(item.i);
      if (item.s && item.s >= 400) waiter.reject(new Error(item.d?.errorText || `WS ${item.s}`));
      else waiter.resolve(item.d);
    }
    if (item.e === 'props' && item.d) this.queueOrHandle(item.d);
  }

  startHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('[]');
    }, 2500);
  }

  syncRequest() {
    return this.send('user/syncrequest', { users: [this.userId] });
  }

  send(endpoint, body) {
    const id = this.requestId++;
    const payload = body ? JSON.stringify(body) : '';
    const message = `${endpoint}\n${id}\n\n${payload}`;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Websocket is niet open.'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout op ${endpoint}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(message);
    });
  }

  positionKey(position) {
    return `${position.accountId}:${position.contractId}`;
  }

  ingest(data, emit) {
    for (const contract of data?.contracts || []) {
      if (contract?.id && contract.name) this.contracts.set(contract.id, contract.name);
    }
    const seen = new Set();
    for (const position of data?.positions || []) {
      if (!position?.accountId || !position.contractId) continue;
      seen.add(this.positionKey(position));
      this.storePosition(position, emit);
    }
    if (emit) {
      for (const [key, prev] of this.positions) {
        if (!seen.has(key) && prev.netPos) {
          this.storePosition({ ...prev, netPos: 0 }, true);
          this.positions.delete(key);
        }
      }
    }
    this.ready = true;
  }

  flushQueue() {
    const queued = this.queued.splice(0);
    for (const props of queued) this.handleProps(props);
  }

  queueOrHandle(props) {
    if (!this.ready) {
      this.queued.push(props);
      return;
    }
    this.handleProps(props);
  }

  handleProps(props) {
    const entityType = props.entityType;
    const entity = props.entity;
    if (!entity) return;
    if (entityType === 'contract' && entity.id && entity.name) {
      this.contracts.set(entity.id, entity.name);
      return;
    }
    if (entityType !== 'position' || !entity.accountId || !entity.contractId) return;
    const event = props.event || props.eventType;
    const key = this.positionKey(entity);
    if (event === 'Deleted') {
      const prev = this.positions.get(key);
      if (!prev) return;
      this.storePosition({ ...prev, netPos: 0 }, true);
      this.positions.delete(key);
      return;
    }
    this.storePosition(entity, true);
  }

  storePosition(position, emit) {
    const key = this.positionKey(position);
    const prev = this.positions.get(key);
    const next = { ...prev, ...position };
    this.positions.set(key, next);
    if (!emit) return;
    if (prev && prev.netPos === next.netPos) return;
    if (this.onPosition) {
      this.onPosition({
        accountId: next.accountId,
        contractId: next.contractId,
        symbol: this.contracts.get(next.contractId) || '',
        netPos: next.netPos || 0,
        netPrice: next.netPrice ?? null,
        prevNet: prev ? prev.netPos : 0
      });
    }
  }

  positionRows(accountId) {
    const rows = [];
    for (const position of this.positions.values()) {
      if (!position.netPos) continue;
      if (accountId && String(position.accountId) !== String(accountId)) continue;
      rows.push({
        accountId: position.accountId,
        contractId: position.contractId,
        symbol: this.contracts.get(position.contractId) || `#${position.contractId}`,
        netPos: position.netPos,
        netPrice: position.netPrice ?? null
      });
    }
    return rows;
  }

  async symbolFor(contractId, hinted) {
    if (hinted) {
      this.contracts.set(contractId, hinted);
      return hinted;
    }
    if (this.contracts.has(contractId)) return this.contracts.get(contractId);
    const res = await this.http('GET', `/contract/item?id=${encodeURIComponent(contractId)}`, undefined, this.token);
    if (res.status >= 400 || !res.data?.name) {
      throw new Error(`Contract ${contractId} niet gevonden.`);
    }
    this.contracts.set(contractId, res.data.name);
    return res.data.name;
  }

  async placeOrder({ action, symbol, orderQty, accountId, accountSpec }) {
    if (!accountId || !accountSpec) throw new Error('Geen Tradovate-account geselecteerd.');
    const body = {
      accountSpec,
      accountId,
      action,
      symbol,
      orderQty,
      orderType: 'Market',
      timeInForce: 'Day',
      isAutomated: true,
      text: 'TradeCopier',
      clOrdId: `tc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    };
    const started = Date.now();
    let res = await this.http('POST', '/order/placeorder', body, this.token);
    if (res.status === 401) {
      await this.authenticate();
      res = await this.http('POST', '/order/placeorder', body, this.token);
    }
    const latency = Date.now() - started;
    const data = res.data || {};
    if (res.status >= 400) {
      const msg = data.errorText || data.failureText || res.statusText || 'order geweigerd';
      const error = new Error(msg);
      error.latency = latency;
      throw error;
    }
    if (data.failureReason || data.failureText) {
      const error = new Error(data.failureText || data.failureReason);
      error.latency = latency;
      throw error;
    }
    return { orderId: data.orderId || null, latency };
  }

  rejectPending(err) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  reconnectSoon(delay) {
    if (this.closed || this.reconnectTimer) return;
    this.reconnects += 1;
    if (this.reconnects > 6) {
      this.setStatus('error', 'Websocket bleef wegvallen.');
      return;
    }
    const wait = delay == null ? Math.min(15000, 1000 * 2 ** (this.reconnects - 1)) : delay;
    this.setStatus('connecting', `Opnieuw verbinden over ${Math.round(wait / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
    this.ready = false;
    this.socketAuthed = false;
    this.connectStream().catch((err) => {
        this.setStatus('error', err.message);
        this.reconnectSoon();
      });
    }, wait);
  }

  async close() {
    this.closed = true;
    this.allowReconnect = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.renewTimer);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectPending(new Error('Client gesloten.'));
    this.detachSocket();
  }
}

module.exports = { TradovateClient, endpoints };
