const { TradovateClient } = require('./tradovate');
const { sessionDate } = require('./tradeLog');

const WORKING = new Set(['Working', 'PendingNew', 'PendingReplace', 'PendingCancel', 'Accepted', 'Suspended']);

async function mapPool(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function loginKey(account) {
  return `${account.environment}|${String(account.username || '').trim().toLowerCase()}|${account.useProxy ? account.proxyUrl : ''}`;
}

function positionView(row, symbol) {
  const netPos = Number(row.netPos || 0);
  if (!netPos) return null;
  return {
    symbol: symbol || (row.contractId ? `#${row.contractId}` : 'Contract'),
    side: netPos > 0 ? 'Long' : 'Short',
    qty: Math.abs(netPos),
    netPos,
    price: row.netPrice == null ? null : Number(row.netPrice)
  };
}

function orderView(row, symbol) {
  const status = row.ordStatus || row.orderStatus || '';
  if (!WORKING.has(status)) return null;
  const qty = Number(row.orderQty ?? row.qty ?? 0);
  if (!qty) return null;
  return {
    symbol: symbol || (row.contractId ? `#${row.contractId}` : 'Contract'),
    action: row.action || '',
    qty,
    orderType: row.orderType || 'Order',
    price: row.price == null ? null : Number(row.price),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    status
  };
}

class Analytics {
  constructor({ store, copier, tradeLog }) {
    this.store = store;
    this.copier = copier;
    this.tradeLog = tradeLog;
    this.pending = null;
  }

  load() {
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async refresh() {
    const accounts = this.store.accounts();
    const today = sessionDate();
    const liveById = {};
    const fills = [];
    const snapshots = [];
    const groups = new Map();
    for (const account of accounts) {
      const key = loginKey(account);
      const rows = groups.get(key) || [];
      rows.push(account);
      groups.set(key, rows);
    }
    await mapPool([...groups.values()], 3, async (group) => {
      await this.readGroup(group, { today, liveById, fills, snapshots });
    });
    if (fills.length) await this.tradeLog.addFills(fills);
    if (snapshots.length) await this.tradeLog.saveSnapshots(snapshots);
    return this.tradeLog.report(accounts, liveById, today);
  }

  async readGroup(group, bag) {
    const sample = group[0];
    let client = this.copier.findClient(sample);
    let owned = false;
    if (!client) {
      client = new TradovateClient(sample);
      owned = true;
    }
    try {
      const book = await client.readBook();
      for (const account of group) {
        const trading = this.resolveTrading(account, book.subAccounts);
        if (!trading) {
          bag.liveById[account.id] = {
            error: 'Kies eerst het Tradovate-subaccount bij Accounts.',
            positions: [],
            workingOrders: [],
            dayPnl: null,
            balance: null,
            subaccount: account.tradovateAccountName || ''
          };
          continue;
        }
        const cash = book.cash.find((row) => String(row.accountId) === String(trading.id));
        const dayPnl = cash && Number.isFinite(Number(cash.amount)) && Number.isFinite(Number(cash.amountSOD))
          ? Math.round((Number(cash.amount) - Number(cash.amountSOD)) * 100) / 100
          : null;
        const balance = cash && Number.isFinite(Number(cash.amount)) ? Number(cash.amount) : null;
        const symbolOf = (contractId) => book.symbols[String(contractId)] || (contractId ? `#${contractId}` : '');
        const positions = book.positionsKnown
          ? book.positions
            .filter((row) => String(row.accountId) === String(trading.id))
            .map((row) => positionView(row, symbolOf(row.contractId)))
            .filter(Boolean)
          : null;
        const workingOrders = book.ordersKnown
          ? book.orders
            .filter((row) => String(row.accountId) === String(trading.id))
            .map((row) => orderView(row, symbolOf(row.contractId)))
            .filter(Boolean)
          : null;
        bag.liveById[account.id] = {
          error: [book.warning].filter(Boolean).join(' '),
          subaccount: trading.name || account.tradovateAccountName || '',
          dayPnl,
          balance,
          positions,
          workingOrders
        };
        if (dayPnl != null) {
          bag.snapshots.push({ localAccountId: account.id, date: bag.today, dayPnl, balance });
        }
        if (book.fillsKnown) {
          for (const fill of book.fills) {
            if (String(fill.accountId) !== String(trading.id)) continue;
            bag.fills.push({
              id: fill.id,
              environment: account.environment,
              localAccountId: account.id,
              tradovateAccountId: trading.id,
              contractId: fill.contractId,
              symbol: symbolOf(fill.contractId),
              action: fill.action,
              qty: fill.qty,
              price: fill.price,
              timestamp: fill.timestamp,
              tradeDate: fill.tradeDate,
              orderId: fill.orderId
            });
          }
        }
      }
    } catch (err) {
      for (const account of group) {
        bag.liveById[account.id] = {
          error: err.message,
          positions: null,
          workingOrders: null,
          dayPnl: null,
          balance: null,
          subaccount: account.tradovateAccountName || ''
        };
      }
    } finally {
      if (owned) await client.close().catch(() => {});
    }
  }

  resolveTrading(account, subAccounts) {
    if (account.tradovateAccountId) {
      return subAccounts.find((row) => String(row.id) === String(account.tradovateAccountId))
        || { id: account.tradovateAccountId, name: account.tradovateAccountName || '' };
    }
    if (subAccounts.length === 1) return subAccounts[0];
    return null;
  }
}

module.exports = { Analytics, WORKING };
