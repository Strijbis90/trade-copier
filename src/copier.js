const { TradovateClient } = require('./tradovate');
const { describeRoute } = require('./proxy');
const { desiredNet, orderDelta } = require('./qty');
const { assertClusterEligible, evaluateChallenge, normalizeChallenge } = require('./challenge');

class Copier {
  constructor({ store, io, log, tradeLog }) {
    this.store = store;
    this.io = io;
    this.log = log;
    this.tradeLog = tradeLog || null;
    this.runs = new Map();
    this.accountStatus = new Map();
  }

  snapshot() {
    return {
      positions: this.positionRows(),
      runtime: this.runtime(),
      accountStatus: Object.fromEntries(this.accountStatus)
    };
  }

  runtime() {
    const out = {};
    for (const cluster of this.store.clusters()) {
      const run = this.runs.get(cluster.id);
      out[cluster.id] = {
        running: Boolean(run && !run.stopped),
        message: run?.message || ''
      };
    }
    return out;
  }

  setAccountStatus(account, patch) {
    const prev = this.accountStatus.get(account.id) || {};
    const route = describeRoute(account);
    const next = {
      connection: prev.connection || 'offline',
      message: prev.message || '',
      route: route.mode,
      routeLabel: route.label,
      latency: prev.latency ?? null,
      ...patch
    };
    this.accountStatus.set(account.id, next);
    this.io.emit('account-status', { accountId: account.id, status: next });
  }

  emitRuntime() {
    this.io.emit('runtime', this.runtime());
    this.io.emit('positions', this.positionRows());
  }

  positionRows() {
    const rows = [];
    for (const run of this.runs.values()) {
      if (run.stopped) continue;
      for (const slot of [run.master, ...run.slaves].filter(Boolean)) {
        if (!slot.client || !slot.tradingAccount) continue;
        for (const position of slot.client.positionRows(slot.tradingAccount.id)) {
          rows.push({
            clusterId: run.cluster.id,
            cluster: run.cluster.name,
            accountId: slot.account.id,
            account: slot.account.name,
            role: slot.role,
            route: slot.client.route.label,
            symbol: position.symbol,
            netPos: position.netPos,
            netPrice: position.netPrice,
            side: position.netPos > 0 ? 'Long' : 'Short',
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
    return rows;
  }

  async checkChallenge(account) {
    const rules = normalizeChallenge(account.challenge);
    if (rules.startBalance == null || rules.profitTarget == null || rules.maxDrawdown == null) {
      throw new Error('Sla eerst startbalans, winstdoel en max drawdown op.');
    }
    const running = [...this.runs.values()].some((run) => run.accountIds.has(account.id));
    if (running) {
      const error = new Error('Dit account draait in een cluster. Stop het cluster om de stand op te halen.');
      error.status = 409;
      throw error;
    }
    const client = new TradovateClient(account);
    try {
      const facts = await client.readChallengeFacts();
      const result = evaluateChallenge(rules, facts);
      const lastCheck = {
        at: new Date().toISOString(),
        balance: facts.balance,
        dayPnl: facts.dayPnl,
        tradingDays: facts.tradingDays,
        accountName: facts.accountName,
        ...result
      };
      return {
        challenge: {
          ...rules,
          peakBalance: result.peak,
          lastCheck
        },
        route: client.route
      };
    } finally {
      await client.close();
    }
  }

  async testAccount(account) {
    const started = Date.now();
    const client = new TradovateClient(account);
    try {
      await client.authenticate();
      const accounts = await client.listSubAccounts();
      return {
        ok: true,
        latency: Date.now() - started,
        userId: client.userId,
        userName: client.userName,
        accounts,
        route: client.route
      };
    } finally {
      await client.close();
    }
  }

  async start(clusterId) {
    if (this.runs.has(clusterId)) throw new Error('Dit cluster draait al.');
    const cluster = this.store.cluster(clusterId);
    if (!cluster) {
      const error = new Error('Cluster niet gevonden.');
      error.status = 404;
      throw error;
    }
    const masterAccount = this.store.account(cluster.masterId);
    if (!masterAccount) throw new Error('Master-account bestaat niet meer.');
    const slaves = cluster.slaves.map((slave) => {
      const account = this.store.account(slave.accountId);
      if (!account) throw new Error('Een slave-account bestaat niet meer.');
      return { account, multiplier: Number(slave.multiplier) };
    });

    const members = [masterAccount, ...slaves.map((slave) => slave.account)];
    assertClusterEligible(members);
    const envs = new Set(members.map((account) => account.environment));
    if (envs.size > 1) {
      throw new Error('Demo en live accounts in hetzelfde cluster zijn geblokkeerd.');
    }
    const memberIds = members.map((account) => account.id);
    for (const run of this.runs.values()) {
      if (memberIds.some((id) => run.accountIds.has(id))) {
        throw new Error(`Account overlap met draaiend cluster "${run.cluster.name}".`);
      }
    }

    const run = {
      cluster,
      stopped: false,
      message: 'Verbinden',
      accountIds: new Set(memberIds),
      master: null,
      slaves: [],
      clientPool: new Map(),
      clients: [],
      baselines: new Map(),
      inflight: new Map(),
      failures: new Map()
    };
    this.runs.set(cluster.id, run);
    this.emitRuntime();

    try {
      await this.openSlot(run, masterAccount, 'Master');
      for (const slave of slaves) {
        try {
          await this.openSlot(run, slave.account, 'Slave', slave.multiplier);
        } catch (err) {
          this.log.push({
            level: 'error',
            cluster: cluster.name,
            account: slave.account.name,
            message: `Slave niet verbonden: ${err.message}`
          });
          this.setAccountStatus(slave.account, { connection: 'error', message: err.message });
        }
      }
      if (run.stopped) return;
      if (!run.slaves.length) throw new Error('Geen enkele slave is verbonden.');

      this.captureBaselines(run);
      run.message = cluster.alignOnStart ? 'Posities gelijk trekken' : 'Volgt nieuwe fills';
      this.log.push({
        level: 'success',
        cluster: cluster.name,
        message: cluster.alignOnStart
          ? 'Cluster gestart. Bestaande posities worden gelijk getrokken.'
          : 'Cluster gestart. Alleen nieuwe master-fills worden gekopieerd.'
      });
      for (const slot of [run.master, ...run.slaves]) {
        this.log.push({
          level: 'info',
          cluster: cluster.name,
          account: slot.account.name,
          message: `${slot.role} route: ${slot.client.route.label}`
        });
      }
      this.emitRuntime();
      if (cluster.alignOnStart) await this.reconcile(run, null, Date.now());
    } catch (err) {
      await this.stop(cluster.id, { silent: true });
      this.log.push({
        level: 'error',
        cluster: cluster.name,
        message: `Start afgebroken: ${err.message}`
      });
      throw err;
    }
  }

  findClient(account) {
    const key = this.loginKey(account);
    const proxy = this.proxySig(account);
    for (const run of this.runs.values()) {
      if (run.stopped) continue;
      const client = run.clientPool.get(key);
      if (!client || client.closed || !client.token) continue;
      if (this.proxySig(client.account) !== proxy) continue;
      return client;
    }
    return null;
  }

  recordFills(run, client, fills) {
    if (!this.tradeLog || !Array.isArray(fills) || !fills.length) return;
    const rows = [];
    for (const fill of fills) {
      const slot = this.slotsOf(run).find((item) => String(item.tradingAccount?.id) === String(fill.accountId));
      if (!slot) continue;
      rows.push({
        id: fill.id,
        environment: slot.account.environment,
        localAccountId: slot.account.id,
        tradovateAccountId: fill.accountId,
        contractId: fill.contractId,
        symbol: fill.symbol || client.contracts.get(fill.contractId) || '',
        action: fill.action,
        qty: fill.qty,
        price: fill.price,
        timestamp: fill.timestamp,
        tradeDate: fill.tradeDate,
        orderId: fill.orderId
      });
    }
    if (!rows.length) return;
    this.tradeLog.addFills(rows).catch((err) => {
      this.log.push({
        level: 'warn',
        cluster: run.cluster.name,
        message: `Fill niet opgeslagen: ${err.message}`
      });
    });
  }

  loginKey(account) {
    return `${account.environment}|${String(account.username).trim().toLowerCase()}`;
  }

  proxySig(account) {
    return account.useProxy ? `1|${account.proxyUrl}` : '0';
  }

  slotsOf(run) {
    return [run.master, ...run.slaves].filter(Boolean);
  }

  async openSlot(run, account, role, multiplier) {
    const key = this.loginKey(account);
    let client = run.clientPool.get(key);
    const created = !client;
    if (!client) {
      client = new TradovateClient(account);
      run.clientPool.set(key, client);
      run.clients.push(client);
      client.onStatus = (status) => {
        const matches = this.slotsOf(run).filter((slot) => slot.client === client);
        const targets = matches.length ? matches.map((slot) => slot.account) : [account];
        for (const target of targets) this.setAccountStatus(target, status);
      };
      client.onPosition = (position) => {
        for (const slot of this.slotsOf(run)) {
          if (slot.client !== client) continue;
          if (String(slot.tradingAccount.id) !== String(position.accountId)) continue;
          this.onPosition(run, slot, position);
        }
      };
      client.onFills = (fills) => this.recordFills(run, client, fills);
    } else if (this.proxySig(client.account) !== this.proxySig(account)) {
      throw new Error('Dezelfde Tradovate-login moet dezelfde proxy-instelling gebruiken.');
    }

    this.setAccountStatus(account, {
      connection: created ? 'connecting' : 'online',
      message: created ? 'Inloggen' : client.route.label
    });

    let slot = null;
    try {
      if (created) {
        await client.authenticate();
        await client.listSubAccounts();
      }
      const trading = client.resolveSubAccount(account.tradovateAccountId);
      if (this.slotsOf(run).some((item) => String(item.tradingAccount.id) === String(trading.id))) {
        throw new Error(`Tradovate-account ${trading.name} is al in dit cluster gekozen.`);
      }
      if (!account.tradovateAccountId) {
        await this.store.updateAccount(account.id, {
          tradovateAccountId: trading.id,
          tradovateAccountName: trading.name,
          secret: '',
          password: ''
        });
      }
      slot = {
        account,
        role,
        multiplier: multiplier ?? null,
        client,
        tradingAccount: trading
      };
      if (role === 'Master') run.master = slot;
      else run.slaves.push(slot);
      if (created) await client.connectStream();
      else this.setAccountStatus(account, { connection: 'online', message: client.route.label });
    } catch (err) {
      if (slot) {
        if (role === 'Master') run.master = null;
        else run.slaves = run.slaves.filter((item) => item !== slot);
      }
      const stillUsed = this.slotsOf(run).some((item) => item.client === client);
      if (created && !stillUsed) {
        await client.close().catch(() => {});
        run.clientPool.delete(key);
        run.clients = run.clients.filter((item) => item !== client);
      }
      this.setAccountStatus(account, { connection: 'error', message: err.message });
      throw err;
    }

    this.log.push({
      level: 'info',
      cluster: run.cluster.name,
      account: account.name,
      message: `${role} gekoppeld aan ${slot.tradingAccount.name} (${account.environment}${created ? '' : ', gedeelde sessie'})`
    });
    return slot;
  }

  captureBaselines(run) {
    const read = (slot) => {
      const map = new Map();
      for (const position of slot.client.positions.values()) {
        if (String(position.accountId) !== String(slot.tradingAccount.id)) continue;
        const symbol = slot.client.contracts.get(position.contractId) || String(position.contractId);
        map.set(symbol, position.netPos || 0);
      }
      return map;
    };
    run.baselines.set(run.master.account.id, read(run.master));
    for (const slave of run.slaves) run.baselines.set(slave.account.id, read(slave));
  }

  baseline(run, accountId, symbol) {
    return run.baselines.get(accountId)?.get(symbol) || 0;
  }

  onPosition(run, slot, position) {
    if (run.stopped) return;
    this.emitRuntime();
    if (slot.role !== 'Master') {
      const symbol = position.symbol || String(position.contractId);
      const pending = run.inflight.get(this.flightKey(slot, symbol));
      if (pending && position.netPos === pending.target) {
        run.inflight.delete(this.flightKey(slot, symbol));
      }
      return;
    }
    const symbol = position.symbol;
    if (!symbol) {
      slot.client.symbolFor(position.contractId).then((name) => {
        if (!name || run.stopped) return;
        this.log.push({
          level: 'order',
          cluster: run.cluster.name,
          account: slot.account.name,
          message: `Master ${name} ${position.prevNet} → ${position.netPos}`
        });
        this.reconcile(run, name, Date.now()).catch((err) => {
          this.log.push({ level: 'error', cluster: run.cluster.name, message: err.message });
        });
      }).catch((err) => {
        this.log.push({ level: 'error', cluster: run.cluster.name, message: err.message });
      });
      return;
    }
    this.log.push({
      level: 'order',
      cluster: run.cluster.name,
      account: slot.account.name,
      message: `Master ${symbol} ${position.prevNet} → ${position.netPos}`
    });
    for (const key of [...run.failures.keys()]) {
      if (key.endsWith(`:${symbol}`)) run.failures.delete(key);
    }
    this.reconcile(run, symbol, Date.now()).catch((err) => {
      this.log.push({ level: 'error', cluster: run.cluster.name, message: err.message });
    });
  }

  netOf(slot, symbol) {
    for (const position of slot.client.positions.values()) {
      if (String(position.accountId) !== String(slot.tradingAccount.id)) continue;
      const name = slot.client.contracts.get(position.contractId);
      if (name === symbol) return position.netPos || 0;
    }
    return 0;
  }

  flightKey(slot, symbol) {
    return `${slot.account.id}:${symbol}`;
  }

  async reconcile(run, onlySymbol, startedAt) {
    if (run.stopped) return;
    const symbols = new Set();
    if (onlySymbol) symbols.add(onlySymbol);
    else {
      for (const slot of this.slotsOf(run)) {
        for (const position of slot.client.positions.values()) {
          if (String(position.accountId) !== String(slot.tradingAccount.id)) continue;
          const name = slot.client.contracts.get(position.contractId);
          if (name) symbols.add(name);
        }
      }
    }

    for (const symbol of symbols) {
      const lockKey = `lock:${symbol}`;
      if (run.inflight.get(lockKey)) {
        run.inflight.set(`dirty:${symbol}`, true);
        continue;
      }
      run.inflight.set(lockKey, true);
      try {
        await this.copySymbol(run, symbol, startedAt || Date.now());
      } finally {
        run.inflight.delete(lockKey);
        if (run.inflight.get(`dirty:${symbol}`)) {
          run.inflight.delete(`dirty:${symbol}`);
          await this.reconcile(run, symbol, Date.now());
        }
      }
    }
  }

  async copySymbol(run, symbol, startedAt) {
    const masterNet = this.netOf(run.master, symbol);
    const masterBase = this.baseline(run, run.master.account.id, symbol);
    const align = Boolean(run.cluster.alignOnStart);
    const maxQty = Number(run.cluster.maxOrderQty) || 20;

    for (const slave of run.slaves) {
      if (run.stopped) return;
      if (!slave.tradingAccount || slave.client.closed) continue;
      const actual = this.netOf(slave, symbol);
      const slaveBase = this.baseline(run, slave.account.id, symbol);
      const target = desiredNet({
        masterNet,
        masterBase,
        slaveBase,
        multiplier: slave.multiplier,
        align
      });
      const key = this.flightKey(slave, symbol);
      const pending = run.inflight.get(key);
      if (pending && actual === pending.target) run.inflight.delete(key);
      const held = pending && pending.target != null && Date.now() < pending.until ? pending.target : actual;
      const delta = orderDelta(held, target);
      if (!delta) continue;

      const fails = run.failures.get(`${key}`) || 0;
      if (fails >= 3) continue;
      if (Math.abs(delta) > maxQty) {
        this.log.push({
          level: 'error',
          cluster: run.cluster.name,
          account: slave.account.name,
          message: `Order ${symbol} van ${Math.abs(delta)} geweigerd. Maximum is ${maxQty}.`
        });
        run.failures.set(key, 3);
        continue;
      }

      const action = delta > 0 ? 'Buy' : 'Sell';
      const orderQty = Math.abs(delta);
      run.inflight.set(key, { target, until: Date.now() + 20000 });
      this.log.push({
        level: 'order',
        cluster: run.cluster.name,
        account: slave.account.name,
        message: `Order geplaatst ${action} ${orderQty} ${symbol} (×${slave.multiplier}) via ${slave.client.route.label}`
      });
      try {
        const result = await slave.client.placeOrder({
          action,
          symbol,
          orderQty,
          accountId: slave.tradingAccount.id,
          accountSpec: slave.tradingAccount.name
        });
        const latency = Date.now() - startedAt;
        this.setAccountStatus(slave.account, { connection: 'online', latency: result.latency, message: slave.client.route.label });
        this.log.push({
          level: 'success',
          cluster: run.cluster.name,
          account: slave.account.name,
          latency,
          message: `Order geslaagd ${action} ${orderQty} ${symbol}${result.orderId ? ` #${result.orderId}` : ''}`
        });
        run.failures.delete(key);
      } catch (err) {
        run.inflight.delete(key);
        run.failures.set(key, fails + 1);
        const latency = err.latency || (Date.now() - startedAt);
        this.setAccountStatus(slave.account, { connection: 'error', latency, message: err.message });
        this.log.push({
          level: 'error',
          cluster: run.cluster.name,
          account: slave.account.name,
          latency,
          message: `Order mislukt ${action} ${orderQty} ${symbol}: ${err.message}`
        });
      }
    }
  }

  async stop(clusterId, options = {}) {
    const run = this.runs.get(clusterId);
    if (!run) return;
    run.stopped = true;
    this.runs.delete(clusterId);
    const slots = [run.master, ...run.slaves].filter(Boolean);
    const clients = new Set([...(run.clients || []), ...slots.map((slot) => slot.client)]);
    await Promise.all([...clients].map(async (client) => {
      try {
        await client.close();
      } catch {
        /* socket already gone */
      }
    }));
    for (const slot of slots) {
      this.setAccountStatus(slot.account, { connection: 'offline', message: 'Gestopt', latency: null });
    }
    this.emitRuntime();
    if (!options.silent) {
      this.log.push({
        level: 'warn',
        cluster: run.cluster.name,
        message: 'Cluster gestopt. Open posities zijn niet gesloten.'
      });
    }
  }

  async stopAll() {
    const ids = [...this.runs.keys()];
    for (const id of ids) await this.stop(id);
  }
}

module.exports = { Copier };
