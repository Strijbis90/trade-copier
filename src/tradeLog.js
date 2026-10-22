const fs = require('fs');
const path = require('path');
const { normalizeChallenge, evaluateChallenge } = require('./challenge');

const DEFAULT_TARGET = 1250;
const DEFAULT_MAX_LOSS = 1000;
const MAX_FILLS_PER_ACCOUNT = 20000;

const POINT_VALUE = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5, NKD: 5,
  CL: 1000, MCL: 100, GC: 100, MGC: 10, SI: 5000, HG: 250,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000
};

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function emptyBook() {
  return { version: 1, fills: [], closures: [], snapshots: [] };
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyBook();
    return {
      version: 1,
      fills: Array.isArray(parsed.fills) ? parsed.fills : [],
      closures: Array.isArray(parsed.closures) ? parsed.closures : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : []
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Kon trades.json niet lezen: ${err.message}`);
    return emptyBook();
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sessionDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  if (Number(parts.hour) >= 17) {
    const rolled = new Date(Date.UTC(year, month - 1, day));
    rolled.setUTCDate(rolled.getUTCDate() + 1);
    year = rolled.getUTCFullYear();
    month = rolled.getUTCMonth() + 1;
    day = rolled.getUTCDate();
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function tradeDayKey(value, fallbackStamp) {
  if (value && typeof value === 'object') {
    const year = Number(value.year);
    const month = Number(value.month);
    const day = Number(value.day);
    if (year && month && day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (fallbackStamp) {
    const parsed = new Date(fallbackStamp);
    if (!Number.isNaN(parsed.getTime())) return sessionDate(parsed);
  }
  return '';
}

function contractRoot(symbol) {
  const text = String(symbol || '').toUpperCase().replace(/^\./, '');
  const match = text.match(/^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,4}$/);
  return match ? match[1] : text;
}

function pointValue(symbol) {
  const root = contractRoot(symbol);
  return Object.prototype.hasOwnProperty.call(POINT_VALUE, root) ? POINT_VALUE[root] : null;
}

function usefulSymbol(symbol) {
  const text = String(symbol || '').trim();
  if (!text || text.startsWith('#')) return '';
  return text;
}

function normalizeFill(raw) {
  const id = raw?.id;
  const qty = Number(raw?.qty);
  const price = Number(raw?.price);
  const action = String(raw?.action || '').toLowerCase() === 'sell' ? 'Sell' : (String(raw?.action || '').toLowerCase() === 'buy' ? 'Buy' : '');
  if (id == null || !raw.localAccountId || !action || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) {
    return null;
  }
  const timestamp = raw.timestamp || raw.closedAt || new Date().toISOString();
  return {
    key: `${raw.environment || 'demo'}:${id}`,
    id,
    environment: raw.environment === 'live' ? 'live' : 'demo',
    localAccountId: String(raw.localAccountId),
    tradovateAccountId: raw.tradovateAccountId == null ? null : String(raw.tradovateAccountId),
    contractId: raw.contractId == null ? null : String(raw.contractId),
    symbol: usefulSymbol(raw.symbol),
    action,
    qty,
    price,
    timestamp: String(timestamp),
    tradeDate: tradeDayKey(raw.tradeDate, timestamp),
    orderId: raw.orderId == null ? null : String(raw.orderId)
  };
}

function matchFill(inventory, fill) {
  const incoming = fill.action === 'Sell' ? -1 : 1;
  let qty = fill.qty;
  const symbol = fill.symbol || (fill.contractId ? `#${fill.contractId}` : 'ONBEKEND');
  const lots = inventory.get(symbol) || [];
  const legs = [];
  while (qty > 0 && lots.length && lots[0].sign !== incoming) {
    const lot = lots[0];
    const take = Math.min(qty, lot.qty);
    const value = pointValue(symbol);
    const points = lot.sign === 1 ? (fill.price - lot.price) : (lot.price - fill.price);
    legs.push({
      symbol,
      qty: take,
      side: lot.sign === 1 ? 'Long' : 'Short',
      entryPrice: lot.price,
      exitPrice: fill.price,
      pnl: value == null ? null : round(points * take * value),
      openedAt: lot.time,
      closedAt: fill.timestamp
    });
    lot.qty -= take;
    qty -= take;
    if (lot.qty <= 1e-8) lots.shift();
  }
  if (qty > 0) {
    lots.push({
      sign: incoming,
      qty,
      price: fill.price,
      time: fill.timestamp,
      tradeDate: fill.tradeDate,
      symbol
    });
  }
  if (lots.length) inventory.set(symbol, lots);
  else inventory.delete(symbol);
  return legs;
}

function inventoryQty(inventory) {
  let total = 0;
  for (const lots of inventory.values()) {
    for (const lot of lots) total += lot.qty;
  }
  return total;
}

function pairAccount(fills) {
  const ordered = fills.slice().sort((a, b) => (
    String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id))
  ));
  const inventory = new Map();
  const closures = [];
  let open = null;
  for (const fill of ordered) {
    const wasFlat = inventoryQty(inventory) === 0;
    const legs = matchFill(inventory, fill);
    if (wasFlat && inventoryQty(inventory) > 0) {
      open = {
        tradeDate: fill.tradeDate,
        openedAt: fill.timestamp,
        symbols: new Set([fill.symbol || legs[0]?.symbol || '']),
        legs: []
      };
    }
    if (open) {
      if (fill.symbol) open.symbols.add(fill.symbol);
      open.legs.push(...legs);
    }
    if (open && inventoryQty(inventory) === 0) {
      const known = open.legs.every((leg) => leg.pnl != null);
      closures.push({
        id: `${fill.localAccountId}:${open.openedAt}:${fill.timestamp}`,
        localAccountId: fill.localAccountId,
        tradovateAccountId: fill.tradovateAccountId,
        symbols: [...open.symbols].filter(Boolean),
        side: open.legs.length === 1 ? open.legs[0].side : (open.legs[0]?.side || ''),
        qty: round(open.legs.reduce((sum, leg) => sum + leg.qty, 0)),
        pnl: known ? round(open.legs.reduce((sum, leg) => sum + leg.pnl, 0)) : null,
        openedAt: open.openedAt,
        closedAt: fill.timestamp,
        tradeDate: fill.tradeDate,
        openTradeDate: open.tradeDate
      });
      open = null;
    }
  }
  const stillOpen = open ? {
    localAccountId: ordered[0]?.localAccountId || '',
    tradeDate: open.tradeDate,
    openedAt: open.openedAt,
    symbols: [...open.symbols].filter(Boolean),
    qty: round(inventoryQty(inventory))
  } : null;
  return { closures, open: stillOpen };
}

function rebuildClosures(fills) {
  const groups = new Map();
  for (const fill of fills) {
    const rows = groups.get(fill.localAccountId) || [];
    rows.push(fill);
    groups.set(fill.localAccountId, rows);
  }
  const closures = [];
  for (const rows of groups.values()) closures.push(...pairAccount(rows).closures);
  return closures;
}

function capFills(fills) {
  const groups = new Map();
  for (const fill of fills) {
    const rows = groups.get(fill.localAccountId) || [];
    rows.push(fill);
    groups.set(fill.localAccountId, rows);
  }
  const kept = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
    kept.push(...rows.slice(-MAX_FILLS_PER_ACCOUNT));
  }
  return kept;
}

function dailyRows(accountId, closures, snapshots, openCycle) {
  const map = new Map();
  const touch = (date) => {
    if (!date) return null;
    if (!map.has(date)) map.set(date, { date, pnl: 0, pnlKnown: true, trades: 0, fromSnapshot: false });
    return map.get(date);
  };
  for (const cycle of closures) {
    if (cycle.localAccountId !== accountId) continue;
    const row = touch(cycle.tradeDate);
    if (!row) continue;
    row.trades += 1;
    if (cycle.pnl == null) row.pnlKnown = false;
    else row.pnl = round(row.pnl + cycle.pnl);
  }
  if (openCycle && openCycle.tradeDate) {
    const row = touch(openCycle.tradeDate);
    if (row) row.trades += 1;
  }
  for (const snap of snapshots) {
    if (snap.localAccountId !== accountId || snap.dayPnl == null) continue;
    const row = touch(snap.date);
    if (!row) continue;
    row.pnl = round(snap.dayPnl);
    row.pnlKnown = true;
    row.fromSnapshot = true;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function consistencyOf(days) {
  const known = days.filter((day) => day.pnlKnown && day.pnl != null);
  const total = round(known.reduce((sum, day) => sum + day.pnl, 0));
  const best = known.length ? round(Math.max(...known.map((day) => day.pnl))) : null;
  const share = total > 0 && best != null ? best / total : 0;
  const breached = known.length >= 2 && total > 0 && best != null && best > total * 0.5;
  return {
    ok: !breached,
    bestDay: best,
    totalProfit: total,
    share: round(share * 10000) / 10000,
    warning: breached
      ? `Beste dag is ${Math.round(share * 100)}% van de totale winst. De 50%-consistency is overschreden.`
      : ''
  };
}

function progressOf(account, live, days) {
  const rules = normalizeChallenge(account.challenge);
  const profitTarget = rules.profitTarget == null ? DEFAULT_TARGET : Number(rules.profitTarget);
  const maxLoss = rules.maxDrawdown == null ? DEFAULT_MAX_LOSS : Number(rules.maxDrawdown);
  const knownDays = days.filter((day) => day.pnlKnown);
  const storedPnl = knownDays.length ? round(knownDays.reduce((sum, day) => sum + day.pnl, 0)) : 0;
  let profitProgress = storedPnl;
  let drawdownRemaining = round(maxLoss - Math.max(0, -storedPnl));
  let estimated = rules.startBalance == null || live.balance == null;
  if (live.balance != null && rules.startBalance != null) {
    const facts = evaluateChallenge(
      { ...rules, profitTarget, maxDrawdown: maxLoss },
      { balance: live.balance, dayPnl: live.dayPnl, tradingDays: null }
    );
    profitProgress = facts.pnl;
    drawdownRemaining = round(maxLoss - facts.drawdownUsed);
    estimated = false;
  }
  return {
    profitTarget,
    maxLoss,
    drawdownMode: rules.drawdownMode || 'static',
    profitProgress,
    drawdownRemaining,
    estimated,
    usingDefaults: rules.profitTarget == null || rules.maxDrawdown == null
  };
}

function buildReport({ accounts, book, liveById, today }) {
  const fills = book?.fills || [];
  const snapshots = book?.snapshots || [];
  const cards = [];
  const historyMap = new Map();
  for (const account of accounts) {
    const live = liveById[account.id] || {};
    const ownFills = fills.filter((fill) => fill.localAccountId === account.id);
    const paired = pairAccount(ownFills);
    const days = dailyRows(account.id, paired.closures, snapshots, paired.open);
    let tradesToday = paired.closures.filter((cycle) => cycle.tradeDate === today).length;
    if (paired.open && paired.open.tradeDate === today) tradesToday += 1;
    const openNow = Array.isArray(live.positions) && live.positions.length > 0;
    if (openNow && tradesToday < 1) tradesToday = 1;
    const todayRow = days.find((day) => day.date === today);
    const dayPnl = live.dayPnl == null ? (todayRow && todayRow.pnlKnown ? todayRow.pnl : null) : round(live.dayPnl);
    if (todayRow) {
      todayRow.trades = Math.max(todayRow.trades, tradesToday);
      if (dayPnl != null) {
        todayRow.pnl = dayPnl;
        todayRow.pnlKnown = true;
      }
    } else if (tradesToday || dayPnl != null) {
      days.push({
        date: today,
        pnl: dayPnl == null ? 0 : dayPnl,
        pnlKnown: dayPnl != null,
        trades: tradesToday,
        fromSnapshot: false
      });
    }
    const balanceSnaps = snapshots.filter((snap) => snap.localAccountId === account.id && snap.balance != null);
    const balanceSnap = balanceSnaps.find((snap) => snap.date === today) || balanceSnaps[balanceSnaps.length - 1];
    const progress = progressOf(account, {
      ...live,
      balance: live.balance == null ? (balanceSnap ? balanceSnap.balance : null) : live.balance
    }, days);
    const consistency = consistencyOf(days);
    const positions = Array.isArray(live.positions) ? live.positions : [];
    const workingOrders = Array.isArray(live.workingOrders) ? live.workingOrders : [];
    const positionKnown = Array.isArray(live.positions);
    const ordersKnown = Array.isArray(live.workingOrders);
    const safetyMessages = [];
    if (!positionKnown) safetyMessages.push('Open posities niet opgehaald.');
    else if (positions.length) {
      safetyMessages.push(`Open: ${positions.map((row) => `${row.qty} ${row.symbol} ${row.side}`).join(', ')}`);
    }
    if (!ordersKnown) safetyMessages.push('Werkende orders niet opgehaald.');
    else if (workingOrders.length) {
      safetyMessages.push(`Orderboek: ${workingOrders.map((row) => {
        const price = row.price != null ? ` @ ${row.price}` : '';
        return `${row.action} ${row.orderType} ${row.qty} ${row.symbol}${price}`;
      }).join(', ')}`);
    }
    const exposed = positions.length > 0 || workingOrders.length > 0 || !positionKnown || !ordersKnown;
    cards.push({
      id: account.id,
      name: account.name,
      subaccount: live.subaccount || account.tradovateAccountName || '',
      environment: account.environment,
      phase: normalizeChallenge(account.challenge).phase,
      dayPnl,
      tradesToday,
      status: tradesToday >= 1 ? 'used' : 'ready',
      statusLabel: tradesToday >= 1 ? '1 Trade gemaakt - Knoppen vast!' : 'Klaar voor trade',
      ...progress,
      consistency,
      positions,
      workingOrders,
      safety: {
        clear: positionKnown && ordersKnown && !exposed,
        message: exposed
          ? safetyMessages.join(' · ')
          : 'Geen open positie of rustende order.'
      },
      error: live.error || ''
    });
    for (const day of days) {
      if (!day.date) continue;
      const bucket = historyMap.get(day.date) || [];
      bucket.push({
        id: account.id,
        name: account.name,
        pnl: day.pnlKnown ? day.pnl : null,
        trades: day.trades
      });
      historyMap.set(day.date, bucket);
    }
  }
  cards.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  const history = [...historyMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => {
      const ordered = rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      const known = ordered.filter((row) => row.pnl != null);
      return {
        date,
        accounts: ordered,
        totalPnl: known.length ? round(known.reduce((sum, row) => sum + row.pnl, 0)) : null
      };
    });
  const knownDay = cards.filter((card) => card.dayPnl != null);
  return {
    asOf: new Date().toISOString(),
    today,
    defaults: { profitTarget: DEFAULT_TARGET, maxLoss: DEFAULT_MAX_LOSS },
    summary: {
      accountCount: cards.length,
      dayPnl: knownDay.length ? round(knownDay.reduce((sum, card) => sum + card.dayPnl, 0)) : null,
      dayPnlMissing: cards.length - knownDay.length,
      tradedToday: cards.filter((card) => card.tradesToday >= 1).length,
      readyToday: cards.filter((card) => card.status === 'ready').length
    },
    accounts: cards,
    history
  };
}

class TradeLog {
  constructor(dir) {
    this.file = path.join(dir, 'trades.json');
    this.chain = Promise.resolve();
    fs.mkdirSync(dir, { recursive: true });
  }

  read() {
    return readJson(this.file);
  }

  mutate(fn) {
    this.chain = this.chain.then(() => {
      const next = fn(this.read());
      writeJson(this.file, next);
      return next;
    });
    return this.chain;
  }

  addFills(rows) {
    const incoming = rows.map(normalizeFill).filter(Boolean);
    if (!incoming.length) return Promise.resolve(this.read());
    return this.mutate((book) => {
      const byKey = new Map(book.fills.map((fill) => [fill.key, fill]));
      for (const fill of incoming) {
        const prev = byKey.get(fill.key);
        byKey.set(fill.key, {
          ...(prev || {}),
          ...fill,
          symbol: usefulSymbol(fill.symbol) || usefulSymbol(prev?.symbol) || fill.symbol
        });
      }
      const fills = capFills([...byKey.values()]);
      return { ...book, fills, closures: rebuildClosures(fills) };
    });
  }

  saveSnapshots(rows) {
    const clean = rows.filter((row) => row && row.localAccountId && row.date && row.dayPnl != null);
    if (!clean.length) return Promise.resolve(this.read());
    return this.mutate((book) => {
      const snapshots = book.snapshots.slice();
      for (const row of clean) {
        const index = snapshots.findIndex((snap) => snap.localAccountId === row.localAccountId && snap.date === row.date);
        const next = {
          localAccountId: String(row.localAccountId),
          date: row.date,
          dayPnl: round(row.dayPnl),
          balance: row.balance == null ? null : round(row.balance)
        };
        if (index >= 0) snapshots[index] = next;
        else snapshots.push(next);
      }
      return { ...book, snapshots };
    });
  }

  report(accounts, liveById, today = sessionDate()) {
    return buildReport({ accounts, book: this.read(), liveById, today });
  }
}

module.exports = {
  TradeLog,
  DEFAULT_TARGET,
  DEFAULT_MAX_LOSS,
  sessionDate,
  normalizeFill,
  pairAccount,
  buildReport,
  pointValue
};
