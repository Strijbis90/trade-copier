const { publicAccount } = require('./store');
const { assertProxyUrl, normalizeProxyUrl, describeRoute } = require('./proxy');

function sendError(res, err) {
  const status = err.status || 400;
  res.status(status).json({ error: err.message || 'Verzoek mislukt.' });
}

function cleanText(value, label, max) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is verplicht.`);
  if (text.length > max) throw new Error(`${label} is te lang.`);
  return text;
}

function parseAccount(body, { creating }) {
  const name = cleanText(body.name, 'Naam', 80);
  const username = cleanText(body.username, 'Gebruikersnaam', 80);
  const clientId = cleanText(body.clientId, 'Client ID', 40);
  const appId = String(body.appId || 'TradeCopier').trim() || 'TradeCopier';
  const environment = body.environment === 'live' ? 'live' : 'demo';
  const useProxy = Boolean(body.useProxy);
  const proxyUrl = normalizeProxyUrl(body.proxyUrl);
  if (useProxy) assertProxyUrl(proxyUrl);
  else if (proxyUrl) {
    try {
      assertProxyUrl(proxyUrl);
    } catch {
      throw new Error('Opgeslagen proxy URL is ongeldig. Maak het veld leeg of corrigeer het.');
    }
  }
  const secret = String(body.secret || '');
  const password = String(body.password || '');
  if (creating && !secret.trim()) throw new Error('Secret is verplicht.');
  if (creating && !password) throw new Error('Wachtwoord is verplicht.');
  const tradovateAccountId = body.tradovateAccountId ? String(body.tradovateAccountId) : null;
  const tradovateAccountName = String(body.tradovateAccountName || '').trim();
  return {
    name,
    username,
    clientId,
    appId,
    environment,
    useProxy,
    proxyUrl,
    secret: secret.trim(),
    password,
    tradovateAccountId,
    tradovateAccountName
  };
}

function parseCluster(body, store) {
  const name = cleanText(body.name, 'Clusternaam', 80);
  const masterId = cleanText(body.masterId, 'Master', 80);
  const master = store.account(masterId);
  if (!master) throw new Error('Kies een bestaand master-account.');
  if (!Array.isArray(body.slaves) || body.slaves.length === 0) {
    throw new Error('Kies minstens één slave.');
  }
  const seen = new Set();
  const slaves = body.slaves.map((slave) => {
    const accountId = cleanText(slave.accountId, 'Slave', 80);
    if (accountId === masterId) throw new Error('De master kan niet ook slave zijn.');
    if (seen.has(accountId)) throw new Error('Een slave is dubbel gekozen.');
    seen.add(accountId);
    if (!store.account(accountId)) throw new Error('Een slave-account bestaat niet.');
    const multiplier = Number(slave.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      throw new Error('Multiplier moet tussen 0 en 100 liggen.');
    }
    return { accountId, multiplier };
  });
  const maxOrderQty = Number(body.maxOrderQty == null ? 20 : body.maxOrderQty);
  if (!Number.isInteger(maxOrderQty) || maxOrderQty < 1 || maxOrderQty > 500) {
    throw new Error('Max ordergrootte moet een geheel getal van 1 tot 500 zijn.');
  }
  return {
    name,
    masterId,
    slaves,
    alignOnStart: Boolean(body.alignOnStart),
    maxOrderQty
  };
}

function accountViews(store, copier) {
  return store.accounts().map((account) => {
    const saved = copier.accountStatus.get(account.id);
    const route = describeRoute(account);
    return publicAccount(account, saved || {
      connection: 'offline',
      message: '',
      route: route.mode,
      routeLabel: route.label,
      latency: null
    });
  });
}

function createApi({ store, copier, logger }) {
  const express = require('express');
  const router = express.Router();

  router.get('/state', (req, res) => {
    res.json({
      accounts: accountViews(store, copier),
      clusters: store.clusters(),
      logs: logger.list(),
      ...copier.snapshot()
    });
  });

  router.post('/logs/clear', (req, res) => {
    logger.clear();
    res.json({ ok: true });
  });

  router.get('/accounts', (req, res) => {
    res.json(accountViews(store, copier));
  });

  router.post('/accounts', async (req, res) => {
    try {
      const row = await store.createAccount(parseAccount(req.body || {}, { creating: true }));
      res.status(201).json(publicAccount(row));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/accounts/:id', async (req, res) => {
    try {
      if (!store.account(req.params.id)) {
        res.status(404).json({ error: 'Account niet gevonden.' });
        return;
      }
      const row = await store.updateAccount(req.params.id, parseAccount(req.body || {}, { creating: false }));
      res.json(publicAccount(row, copier.accountStatus.get(row.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/accounts/:id', async (req, res) => {
    try {
      for (const run of copier.runs.values()) {
        if (run.accountIds.has(req.params.id)) {
          res.status(409).json({ error: 'Stop het cluster voordat je dit account verwijdert.' });
          return;
        }
      }
      await store.deleteAccount(req.params.id);
      copier.accountStatus.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/accounts/test', async (req, res) => {
    try {
      const body = req.body || {};
      let account;
      if (body.id && store.account(body.id)) {
        const parsed = parseAccount(body, { creating: false });
        const stored = store.account(body.id);
        account = {
          ...stored,
          ...parsed,
          secret: parsed.secret || stored.secret,
          password: parsed.password || stored.password
        };
      } else {
        account = {
          ...parseAccount(body, { creating: true }),
          deviceId: 'trade-copier-test',
          tradovateAccountId: body.tradovateAccountId || null
        };
      }
      const running = [...copier.runs.values()].some((run) => (
        body.id && run.accountIds.has(body.id)
      ));
      if (running) {
        res.status(409).json({ error: 'Dit account draait in een cluster. Stop het cluster om opnieuw te testen.' });
        return;
      }
      const result = await copier.testAccount(account);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/clusters', (req, res) => {
    res.json(store.clusters());
  });

  router.post('/clusters', async (req, res) => {
    try {
      const row = await store.createCluster(parseCluster(req.body || {}, store));
      res.status(201).json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/clusters/:id', async (req, res) => {
    try {
      if (copier.runs.has(req.params.id)) {
        res.status(409).json({ error: 'Stop het cluster voordat je het wijzigt.' });
        return;
      }
      const row = await store.updateCluster(req.params.id, parseCluster(req.body || {}, store));
      res.json(row);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/clusters/:id', async (req, res) => {
    try {
      if (copier.runs.has(req.params.id)) await copier.stop(req.params.id);
      await store.deleteCluster(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/clusters/:id/start', async (req, res) => {
    try {
      await copier.start(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/clusters/:id/stop', async (req, res) => {
    try {
      await copier.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

module.exports = { createApi };
