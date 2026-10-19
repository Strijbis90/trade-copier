const PHASES = ['evaluatie', 'gehaald', 'gezakt'];

function emptyChallenge() {
  return {
    phase: 'evaluatie',
    decidedAt: null,
    startBalance: null,
    profitTarget: null,
    maxDrawdown: null,
    drawdownMode: 'static',
    dailyLossLimit: null,
    minDays: null,
    peakBalance: null,
    lastCheck: null
  };
}

function normalizeChallenge(raw) {
  const base = emptyChallenge();
  if (!raw || typeof raw !== 'object') return base;
  const phase = PHASES.includes(raw.phase) ? raw.phase : 'evaluatie';
  return {
    ...base,
    ...raw,
    phase,
    drawdownMode: raw.drawdownMode === 'trailing' ? 'trailing' : 'static'
  };
}

function money(value, label, required) {
  if (value === '' || value == null) {
    if (required) throw new Error(`${label} is verplicht.`);
    return null;
  }
  const number = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} moet groter dan 0 zijn.`);
  return Math.round(number * 100) / 100;
}

function wholeDays(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 365) {
    throw new Error('Minimum tradedagen moet een geheel getal van 1 tot 365 zijn.');
  }
  return number;
}

function parseChallengeRules(body, previous) {
  const prior = normalizeChallenge(previous);
  const startBalance = money(body.startBalance, 'Startbalans', true);
  const profitTarget = money(body.profitTarget, 'Winstdoel', true);
  const maxDrawdown = money(body.maxDrawdown, 'Max drawdown', true);
  const drawdownMode = body.drawdownMode === 'trailing' ? 'trailing' : 'static';
  const dailyLossLimit = money(body.dailyLossLimit, 'Daglimiet', false);
  const minDays = wholeDays(body.minDays);
  const rulesChanged = prior.startBalance !== startBalance
    || prior.maxDrawdown !== maxDrawdown
    || prior.drawdownMode !== drawdownMode;
  return {
    ...prior,
    startBalance,
    profitTarget,
    maxDrawdown,
    drawdownMode,
    dailyLossLimit,
    minDays,
    peakBalance: rulesChanged ? null : prior.peakBalance,
    lastCheck: rulesChanged ? null : prior.lastCheck
  };
}

function applyDecision(previous, phase) {
  if (!PHASES.includes(phase)) throw new Error('Onbekende challengestatus.');
  return {
    ...normalizeChallenge(previous),
    phase,
    decidedAt: new Date().toISOString()
  };
}

function evaluateChallenge(rules, facts) {
  const start = Number(rules.startBalance);
  const balance = Number(facts.balance);
  const pnl = Math.round((balance - start) * 100) / 100;
  const storedPeak = rules.peakBalance == null ? start : Number(rules.peakBalance);
  const peak = Math.round(Math.max(storedPeak, balance, start) * 100) / 100;
  const failLine = rules.drawdownMode === 'trailing'
    ? Math.round((peak - Number(rules.maxDrawdown)) * 100) / 100
    : Math.round((start - Number(rules.maxDrawdown)) * 100) / 100;
  const drawdownUsed = Math.round(Math.max(0, (rules.drawdownMode === 'trailing' ? peak : start) - balance) * 100) / 100;
  const ddBreached = balance <= failLine;
  const dayPnl = facts.dayPnl == null ? null : Number(facts.dayPnl);
  const dailyBreached = rules.dailyLossLimit != null && dayPnl != null && dayPnl <= -Number(rules.dailyLossLimit);
  const targetHit = pnl >= Number(rules.profitTarget);
  const daysKnown = facts.tradingDays != null;
  const daysOk = rules.minDays == null || (daysKnown && facts.tradingDays >= rules.minDays);
  const notes = [];
  if (rules.dailyLossLimit != null && dayPnl == null) {
    notes.push('Daglimiet niet gecontroleerd: Tradovate stuurde geen dagsaldo.');
  }
  if (rules.minDays != null && !daysKnown) {
    notes.push('Tradedagen niet gecontroleerd.');
  }
  let suggestion = 'bezig';
  if (ddBreached || dailyBreached) suggestion = 'lijkt_gezakt';
  else if (targetHit && daysOk) suggestion = 'lijkt_gehaald';
  return {
    pnl,
    peak,
    failLine,
    drawdownUsed,
    targetHit,
    ddBreached,
    dailyBreached,
    daysOk,
    suggestion,
    notes
  };
}

function eligiblePhase(account) {
  return normalizeChallenge(account?.challenge).phase === 'gehaald';
}

function assertClusterEligible(accounts) {
  const blocked = accounts.filter((account) => account && !eligiblePhase(account));
  if (!blocked.length) return;
  const names = blocked.map((account) => account.name).join(', ');
  const error = new Error(blocked.length === 1
    ? `${names} is nog niet als gehaald gemarkeerd. Dat doe je zelf op Challenges.`
    : `${names} zijn nog niet als gehaald gemarkeerd. Dat doe je zelf op Challenges.`);
  error.status = 409;
  throw error;
}

module.exports = {
  PHASES,
  emptyChallenge,
  normalizeChallenge,
  parseChallengeRules,
  applyDecision,
  evaluateChallenge,
  eligiblePhase,
  assertClusterEligible
};
