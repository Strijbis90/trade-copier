const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describeRoute } = require('./proxy');
const { emptyChallenge, normalizeChallenge } = require('./challenge');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Kon ${path.basename(file)} niet lezen: ${err.message}`);
    }
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    this.accountsFile = path.join(dir, 'accounts.json');
    this.clustersFile = path.join(dir, 'clusters.json');
    this.accountChain = Promise.resolve();
    this.clusterChain = Promise.resolve();
    fs.mkdirSync(dir, { recursive: true });
  }

  accounts() {
    const rows = readJson(this.accountsFile, []);
    return Array.isArray(rows) ? rows : [];
  }

  clusters() {
    const rows = readJson(this.clustersFile, []);
    return Array.isArray(rows) ? rows : [];
  }

  account(id) {
    return this.accounts().find((row) => row.id === id) || null;
  }

  cluster(id) {
    return this.clusters().find((row) => row.id === id) || null;
  }

  mutateAccounts(fn) {
    this.accountChain = this.accountChain.then(() => {
      const next = fn(this.accounts());
      writeJson(this.accountsFile, next);
      return next;
    });
    return this.accountChain;
  }

  mutateClusters(fn) {
    this.clusterChain = this.clusterChain.then(() => {
      const next = fn(this.clusters());
      writeJson(this.clustersFile, next);
      return next;
    });
    return this.clusterChain;
  }

  createAccount(input) {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      appId: input.appId,
      clientId: input.clientId,
      secret: input.secret,
      username: input.username,
      password: input.password,
      environment: input.environment,
      proxyUrl: input.proxyUrl,
      useProxy: input.useProxy,
      tradovateAccountId: input.tradovateAccountId,
      tradovateAccountName: input.tradovateAccountName,
      challenge: emptyChallenge(),
      deviceId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    };
    return this.mutateAccounts((rows) => [...rows, row]).then(() => row);
  }

  updateAccount(id, input) {
    let updated = null;
    return this.mutateAccounts((rows) => {
      const next = rows.map((row) => {
        if (row.id !== id) return row;
        updated = {
          ...row,
          ...input,
          id: row.id,
          deviceId: row.deviceId,
          secret: input.secret ? input.secret : row.secret,
          password: input.password ? input.password : row.password,
          createdAt: row.createdAt,
          updatedAt: new Date().toISOString()
        };
        return updated;
      });
      if (!updated) {
        const error = new Error('Account niet gevonden.');
        error.status = 404;
        throw error;
      }
      return next;
    }).then(() => updated);
  }

  updateChallenge(id, challenge) {
    let updated = null;
    return this.mutateAccounts((rows) => {
      const next = rows.map((row) => {
        if (row.id !== id) return row;
        updated = { ...row, challenge, updatedAt: new Date().toISOString() };
        return updated;
      });
      if (!updated) {
        const error = new Error('Account niet gevonden.');
        error.status = 404;
        throw error;
      }
      return next;
    }).then(() => updated);
  }

  deleteAccount(id) {
    const used = this.clusters().some((cluster) => (
      cluster.masterId === id || cluster.slaves.some((slave) => slave.accountId === id)
    ));
    if (used) {
      const error = new Error('Dit account zit nog in een cluster. Verwijder het cluster eerst.');
      error.status = 409;
      throw error;
    }
    return this.mutateAccounts((rows) => rows.filter((row) => row.id !== id));
  }

  createCluster(input) {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      masterId: input.masterId,
      slaves: input.slaves,
      alignOnStart: input.alignOnStart,
      maxOrderQty: input.maxOrderQty,
      createdAt: now,
      updatedAt: now
    };
    return this.mutateClusters((rows) => [...rows, row]).then(() => row);
  }

  updateCluster(id, input) {
    let updated = null;
    return this.mutateClusters((rows) => {
      const next = rows.map((row) => {
        if (row.id !== id) return row;
        updated = {
          ...row,
          ...input,
          id: row.id,
          createdAt: row.createdAt,
          updatedAt: new Date().toISOString()
        };
        return updated;
      });
      if (!updated) {
        const error = new Error('Cluster niet gevonden.');
        error.status = 404;
        throw error;
      }
      return next;
    }).then(() => updated);
  }

  deleteCluster(id) {
    return this.mutateClusters((rows) => rows.filter((row) => row.id !== id));
  }
}

function publicAccount(account, status) {
  if (!account) return null;
  const route = describeRoute(account);
  return {
    id: account.id,
    name: account.name,
    appId: account.appId,
    clientId: account.clientId,
    username: account.username,
    environment: account.environment,
    proxyUrl: account.proxyUrl || '',
    useProxy: Boolean(account.useProxy),
    secretSet: Boolean(account.secret),
    passwordSet: Boolean(account.password),
    tradovateAccountId: account.tradovateAccountId || null,
    tradovateAccountName: account.tradovateAccountName || '',
    challenge: normalizeChallenge(account.challenge),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    status: {
      connection: 'offline',
      message: '',
      latency: null,
      ...(status || {}),
      route: route.mode,
      routeLabel: route.label
    }
  };
}

module.exports = { Store, publicAccount };
