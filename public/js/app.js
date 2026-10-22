const state = {
  view: 'monitor',
  challengeId: null,
  accounts: [],
  clusters: [],
  logs: [],
  positions: [],
  runtime: {}
};

const titles = {
  monitor: ['Realtime', 'Live Monitor'],
  accounts: ['Credentials', 'Accounts'],
  challenges: ['Jij beslist', 'Challenges'],
  clusters: ['Master / slaves', 'Cluster builder'],
  analytics: ['10 challenges', 'Analytics & Multi-Challenge Tracker']
};

const phaseLabel = { evaluatie: 'Evaluatie', gehaald: 'Gehaald', gezakt: 'Gezakt' };
const suggestionLabel = { bezig: 'Nog bezig', lijkt_gehaald: 'Lijkt gehaald', lijkt_gezakt: 'Lijkt gezakt' };

const socket = io();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function toast(message, level) {
  const host = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast ${level || ''}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function ask({ title, body, confirm, danger }) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  const ok = document.getElementById('modal-ok');
  ok.textContent = confirm || 'Bevestig';
  ok.className = danger ? 'btn danger' : 'btn primary';
  modal.hidden = false;
  return new Promise((resolve) => {
    const finish = (value) => {
      modal.hidden = true;
      ok.removeEventListener('click', onOk);
      document.getElementById('modal-cancel').removeEventListener('click', onCancel);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    ok.addEventListener('click', onOk);
    document.getElementById('modal-cancel').addEventListener('click', onCancel);
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Verzoek mislukt.');
  return data;
}

function accountById(id) {
  return state.accounts.find((account) => account.id === id);
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('nl-NL', { hour12: false });
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function latencyClass(ms) {
  if (ms == null) return '';
  if (ms < 300) return 'lat-good';
  if (ms < 800) return 'lat-mid';
  return 'lat-bad';
}

function dotClass(connection) {
  if (connection === 'online') return 'on';
  if (connection === 'connecting') return 'wait';
  if (connection === 'error') return 'bad';
  return 'off';
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((node) => {
    node.hidden = node.id !== `view-${view}`;
  });
  document.querySelectorAll('.nav-btn').forEach((node) => {
    node.classList.toggle('active', node.dataset.view === view);
  });
  const [eyebrow, title] = titles[view];
  document.getElementById('eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
  if (view === 'analytics') startAnalytics();
  else stopAnalytics();
}

function renderStats() {
  const running = Object.values(state.runtime).filter((row) => row.running).length;
  const errors = state.logs.filter((row) => row.level === 'error').length;
  const latencies = state.logs.map((row) => row.latency).filter((value) => value != null);
  const last = latencies.length ? latencies[latencies.length - 1] : null;
  const cards = [
    ['Clusters live', running],
    ['Open posities', state.positions.length],
    ['Laatste latency', last == null ? '—' : `${last} ms`],
    ['Fouten', errors]
  ];
  document.getElementById('stats').innerHTML = cards.map(([label, value]) => (
    `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
  )).join('');
}

function renderPositions() {
  const host = document.getElementById('position-rows');
  document.getElementById('pos-count').textContent = String(state.positions.length);
  if (!state.positions.length) {
    host.innerHTML = '<p class="empty">Geen open posities. Start een cluster om de master te volgen.</p>';
    return;
  }
  host.innerHTML = state.positions.map((row) => `
    <div class="f-row">
      <span class="c-cluster">${esc(row.cluster)}</span>
      <span class="c-account">${esc(row.account)}</span>
      <span class="c-role">${esc(row.role)}</span>
      <span class="c-route">${esc(row.route)}</span>
      <span class="c-symbol">${esc(row.symbol)}</span>
      <span class="c-side ${row.side === 'Long' ? 'side-long' : 'side-short'}">${esc(row.side)}</span>
      <span class="c-qty">${esc(row.netPos)}</span>
      <span class="c-price">${esc(formatPrice(row.netPrice))}</span>
    </div>
  `).join('');
}

function renderLogs() {
  const scroller = document.getElementById('log-scroll');
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  const host = document.getElementById('log-rows');
  if (!state.logs.length) {
    host.innerHTML = '<p class="empty">Nog geen logregels. Orders, succes, fouten en latency verschijnen hier.</p>';
    return;
  }
  host.innerHTML = state.logs.map((row) => `
    <div class="f-row">
      <span class="c-time">${esc(formatTime(row.time))}</span>
      <span class="c-level lvl-${esc(row.level)}">${esc(row.level)}</span>
      <span class="c-account">${esc(row.account || row.cluster || '—')}</span>
      <span class="c-msg">${esc(row.message)}</span>
      <span class="c-lat ${latencyClass(row.latency)}">${row.latency == null ? '—' : `${esc(row.latency)} ms`}</span>
    </div>
  `).join('');
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}

function renderClusterStrip() {
  const host = document.getElementById('cluster-strip');
  if (!state.clusters.length) {
    host.innerHTML = '<p class="empty">Nog geen cluster. Bouw er een onder Clusters.</p>';
    return;
  }
  host.innerHTML = state.clusters.map((cluster) => {
    const run = state.runtime[cluster.id] || {};
    const master = accountById(cluster.masterId);
    return `
      <article class="strip-card">
        <header>
          <strong>${esc(cluster.name)}</strong>
          <span class="tag ${run.running ? 'run' : ''}">${run.running ? 'Live' : 'Gestopt'}</span>
        </header>
        <p class="faint">${esc(master ? master.name : 'Master ontbreekt')} · ${cluster.slaves.length} slave${cluster.slaves.length === 1 ? '' : 's'}</p>
        <p class="faint">${esc(run.message || (cluster.alignOnStart ? 'Sync bij start' : 'Alleen nieuwe fills'))}</p>
        <div class="card-actions">
          <button type="button" class="btn sm ${run.running ? 'danger' : 'primary'}" data-action="${run.running ? 'stop' : 'start'}" data-id="${esc(cluster.id)}">${run.running ? 'Stop' : 'Start'}</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderAccounts() {
  const host = document.getElementById('account-list');
  document.getElementById('account-count').textContent = String(state.accounts.length);
  if (!state.accounts.length) {
    host.innerHTML = '<p class="empty">Nog geen accounts.</p>';
    return;
  }
  host.innerHTML = state.accounts.map((account) => {
    const status = account.status || {};
    return `
      <article class="entity">
        <div class="entity-top">
          <strong>${esc(account.name)}</strong>
          <span class="tag ${account.environment === 'live' ? 'live' : 'demo'}">${esc(account.environment)}</span>
        </div>
        <p class="faint">${esc(account.username)}${account.tradovateAccountName ? ` · ${esc(account.tradovateAccountName)}` : ''}</p>
        <p><span class="tag ${esc(account.challenge?.phase || 'evaluatie')}">${esc(phaseLabel[account.challenge?.phase] || 'Evaluatie')}</span></p>
        <p><span class="dot ${dotClass(status.connection)}"></span> ${esc(status.routeLabel || (account.useProxy ? 'Proxy' : 'Direct'))}${status.message ? ` · ${esc(status.message)}` : ''}</p>
        <div class="card-actions">
          <button type="button" class="btn sm" data-action="edit-account" data-id="${esc(account.id)}">Bewerk</button>
          <button type="button" class="btn sm danger" data-action="delete-account" data-id="${esc(account.id)}">Verwijder</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderClusters() {
  const host = document.getElementById('cluster-list');
  document.getElementById('cluster-count').textContent = String(state.clusters.length);
  if (!state.clusters.length) {
    host.innerHTML = '<p class="empty">Nog geen clusters.</p>';
    return;
  }
  host.innerHTML = state.clusters.map((cluster) => {
    const run = state.runtime[cluster.id] || {};
    const master = accountById(cluster.masterId);
    const slaves = cluster.slaves.map((slave) => {
      const account = accountById(slave.accountId);
      return `${account ? account.name : 'onbekend'} ×${slave.multiplier}`;
    }).join(', ');
    return `
      <article class="entity">
        <div class="entity-top">
          <strong>${esc(cluster.name)}</strong>
          <span class="tag ${run.running ? 'run' : ''}">${run.running ? 'Live' : 'Gestopt'}</span>
        </div>
        <p>Master: ${esc(master ? master.name : '—')}</p>
        <p class="faint">Slaves: ${esc(slaves)}</p>
        <p class="faint">${cluster.alignOnStart ? 'Trekt posities gelijk bij start' : 'Kopieert alleen nieuwe fills'} · max ${esc(cluster.maxOrderQty)}</p>
        <div class="card-actions">
          <button type="button" class="btn sm ${run.running ? 'danger' : 'primary'}" data-action="${run.running ? 'stop' : 'start'}" data-id="${esc(cluster.id)}">${run.running ? 'Stop' : 'Start'}</button>
          <button type="button" class="btn sm" data-action="edit-cluster" data-id="${esc(cluster.id)}">Bewerk</button>
          <button type="button" class="btn sm danger" data-action="delete-cluster" data-id="${esc(cluster.id)}">Verwijder</button>
        </div>
      </article>
    `;
  }).join('');
}

function challengeOf(account) {
  return account?.challenge || { phase: 'evaluatie', lastCheck: null };
}

function moneyText(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('nl-NL', { style: 'currency', currency: 'USD' });
}

function renderChallengeList() {
  const host = document.getElementById('challenge-list');
  document.getElementById('challenge-count').textContent = String(state.accounts.length);
  if (!state.accounts.length) {
    host.innerHTML = '<p class="empty">Voeg eerst een account toe.</p>';
    return;
  }
  host.innerHTML = state.accounts.map((account) => {
    const challenge = challengeOf(account);
    const advice = challenge.lastCheck?.suggestion;
    return `
      <article class="entity ${state.challengeId === account.id ? 'selected' : ''}">
        <div class="entity-top">
          <strong>${esc(account.name)}</strong>
          <span class="tag ${esc(challenge.phase)}">${esc(phaseLabel[challenge.phase] || 'Evaluatie')}</span>
        </div>
        <p class="faint">${esc(account.environment)} · ${esc(account.username)}</p>
        <p class="faint">${advice ? `Advies: ${esc(suggestionLabel[advice] || advice)}` : 'Nog geen stand opgehaald'}</p>
        <div class="card-actions">
          <button type="button" class="btn sm" data-action="open-challenge" data-id="${esc(account.id)}">Open</button>
        </div>
      </article>
    `;
  }).join('');
}

function fillChallengeForm(account) {
  state.challengeId = account.id;
  const challenge = challengeOf(account);
  document.getElementById('challenge-title').textContent = account.name;
  document.getElementById('challenge-empty').hidden = true;
  document.getElementById('challenge-fields').hidden = false;
  document.getElementById('ch-start').value = challenge.startBalance ?? '';
  document.getElementById('ch-target').value = challenge.profitTarget ?? '';
  document.getElementById('ch-dd').value = challenge.maxDrawdown ?? '';
  document.getElementById('ch-mode').value = challenge.drawdownMode || 'static';
  document.getElementById('ch-daily').value = challenge.dailyLossLimit ?? '';
  document.getElementById('ch-days').value = challenge.minDays ?? '';
  renderChallengeResult(challenge);
  renderChallengeList();
}

function renderChallengeResult(challenge) {
  const host = document.getElementById('challenge-result');
  const check = challenge.lastCheck;
  if (!check) {
    host.innerHTML = '<p class="hint">Nog geen stand. Sla de regels op en haal daarna het saldo op bij Tradovate.</p>';
    return;
  }
  const target = Number(challenge.profitTarget) || 0;
  const ddMax = Number(challenge.maxDrawdown) || 0;
  const profitWidth = target > 0 ? Math.max(0, Math.min(100, (check.pnl / target) * 100)) : 0;
  const ddWidth = ddMax > 0 ? Math.max(0, Math.min(100, (check.drawdownUsed / ddMax) * 100)) : 0;
  const notes = (check.notes || []).map((note) => `<p class="hint">${esc(note)}</p>`).join('');
  host.innerHTML = `
    <div class="challenge-result">
      <p><span class="tag ${esc(challenge.phase)}">${esc(phaseLabel[challenge.phase])}</span>
         <span class="tag advise">${esc(suggestionLabel[check.suggestion] || check.suggestion)}</span></p>
      <p class="faint">Saldo ${esc(moneyText(check.balance))} · resultaat ${esc(moneyText(check.pnl))} · ${esc(formatTime(check.at))}</p>
      <div class="meter">
        <div class="meter-top"><span>Winstdoel</span><span>${esc(moneyText(check.pnl))} / ${esc(moneyText(target))}</span></div>
        <div class="bar"><span style="width:${profitWidth}%"></span></div>
      </div>
      <div class="meter">
        <div class="meter-top"><span>Drawdown</span><span>${esc(moneyText(check.drawdownUsed))} / ${esc(moneyText(ddMax))}</span></div>
        <div class="bar ${check.ddBreached ? 'bad' : ddWidth > 70 ? 'warn' : ''}"><span style="width:${ddWidth}%"></span></div>
      </div>
      ${check.tradingDays == null ? '' : `<p class="faint">Tradedagen: ${esc(check.tradingDays)}</p>`}
      ${notes}
    </div>
  `;
}

function renderAll() {
  renderStats();
  renderPositions();
  renderLogs();
  renderClusterStrip();
  renderAccounts();
  renderChallengeList();
  renderClusters();
}

function applySnapshot(data) {
  state.accounts = data.accounts || state.accounts;
  state.clusters = data.clusters || state.clusters;
  state.logs = data.logs || [];
  state.positions = data.positions || [];
  state.runtime = data.runtime || {};
  if (data.accountStatus) {
    state.accounts = state.accounts.map((account) => {
      const status = data.accountStatus[account.id];
      return status ? { ...account, status: { ...account.status, ...status } } : account;
    });
  }
  renderAll();
}

function readPicker() {
  const master = document.querySelector('input[name="master"]:checked');
  const slaves = [];
  document.querySelectorAll('[data-slave]').forEach((row) => {
    const box = row.querySelector('input[type="checkbox"]');
    const multiplier = row.querySelector('input[type="number"]');
    if (box.checked) {
      slaves.push({ accountId: row.dataset.slave, multiplier: Number(multiplier.value) });
    }
  });
  return { masterId: master ? master.value : '', slaves };
}

function syncPickerLocks() {
  const masterId = document.querySelector('input[name="master"]:checked')?.value;
  document.querySelectorAll('[data-slave]').forEach((row) => {
    const box = row.querySelector('input[type="checkbox"]');
    const multiplier = row.querySelector('input[type="number"]');
    const radio = row.querySelector('input[type="radio"]');
    const eligible = row.dataset.eligible === '1';
    const locked = row.dataset.slave === masterId;
    if (locked) box.checked = false;
    if (!eligible && !box.checked) box.disabled = true;
    else box.disabled = locked;
    if (!eligible && !radio.checked) radio.disabled = true;
    multiplier.disabled = locked || !box.checked || (!eligible && !box.checked);
  });
}

function renderPicker(seed) {
  const host = document.getElementById('picker');
  const picked = seed || { masterId: '', slaves: [] };
  const multipliers = new Map((picked.slaves || []).map((slave) => [slave.accountId, slave.multiplier]));
  if (!state.accounts.length) {
    host.innerHTML = '<p class="empty">Voeg eerst een account toe.</p>';
    return;
  }
  host.innerHTML = state.accounts.map((account) => {
    const checked = multipliers.has(account.id);
    const multiplier = multipliers.get(account.id) ?? 1;
    const eligible = challengeOf(account).phase === 'gehaald';
    const isMaster = picked.masterId === account.id;
    const keep = !eligible && (isMaster || checked);
    return `
      <div class="pick ${eligible ? '' : 'blocked'}" data-slave="${esc(account.id)}" data-eligible="${eligible ? '1' : '0'}">
        <label class="pick-col"><input type="radio" name="master" value="${esc(account.id)}" ${isMaster ? 'checked' : ''} ${eligible || isMaster ? '' : 'disabled'}></label>
        <label class="pick-col"><input type="checkbox" ${checked ? 'checked' : ''} ${eligible || checked ? '' : 'disabled'}></label>
        <span class="who"><b>${esc(account.name)}</b><small>${esc(phaseLabel[challengeOf(account).phase])} · ${esc(account.environment)}${keep ? ' · vink uit' : ''}</small></span>
        <input type="number" min="0.1" max="100" step="0.1" value="${esc(multiplier)}" aria-label="Multiplier voor ${esc(account.name)}" ${eligible || checked ? '' : 'disabled'}>
      </div>
    `;
  }).join('');
  syncPickerLocks();
}

function resetAccountForm() {
  document.getElementById('account-form').reset();
  document.getElementById('account-id').value = '';
  document.getElementById('acc-app').value = 'TradeCopier';
  document.getElementById('acc-sub').innerHTML = '<option value="">Test de verbinding om accounts op te halen</option>';
  document.getElementById('account-form-title').textContent = 'Account toevoegen';
}

function fillAccountForm(account) {
  document.getElementById('account-id').value = account.id;
  document.getElementById('acc-name').value = account.name;
  document.getElementById('acc-env').value = account.environment;
  document.getElementById('acc-app').value = account.appId || 'TradeCopier';
  document.getElementById('acc-cid').value = account.clientId;
  document.getElementById('acc-secret').value = '';
  document.getElementById('acc-user').value = account.username;
  document.getElementById('acc-pass').value = '';
  document.getElementById('acc-proxy').value = account.proxyUrl || '';
  document.getElementById('acc-use-proxy').checked = Boolean(account.useProxy);
  const select = document.getElementById('acc-sub');
  select.innerHTML = '';
  const option = document.createElement('option');
  option.value = account.tradovateAccountId || '';
  option.textContent = account.tradovateAccountName || 'Nog geen Tradovate-account gekozen';
  option.selected = true;
  select.appendChild(option);
  document.getElementById('account-form-title').textContent = 'Account bewerken';
  document.getElementById('acc-secret').placeholder = 'Leeg laten om te behouden';
  document.getElementById('acc-pass').placeholder = 'Leeg laten om te behouden';
}

function accountPayload() {
  const sub = document.getElementById('acc-sub');
  const selected = sub.selectedOptions[0];
  return {
    id: document.getElementById('account-id').value || undefined,
    name: document.getElementById('acc-name').value,
    environment: document.getElementById('acc-env').value,
    appId: document.getElementById('acc-app').value,
    clientId: document.getElementById('acc-cid').value,
    secret: document.getElementById('acc-secret').value,
    username: document.getElementById('acc-user').value,
    password: document.getElementById('acc-pass').value,
    proxyUrl: document.getElementById('acc-proxy').value,
    useProxy: document.getElementById('acc-use-proxy').checked,
    tradovateAccountId: sub.value || null,
    tradovateAccountName: sub.value ? (selected?.textContent || '') : ''
  };
}

function fillSubAccounts(accounts, currentId) {
  const select = document.getElementById('acc-sub');
  select.innerHTML = '';
  if (!accounts.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Geen actief account';
    select.appendChild(option);
    return;
  }
  for (const account of accounts) {
    const option = document.createElement('option');
    option.value = String(account.id);
    option.textContent = account.name;
    if (currentId && String(currentId) === String(account.id)) option.selected = true;
    select.appendChild(option);
  }
  if (!currentId && accounts.length === 1) select.value = String(accounts[0].id);
}

function resetClusterForm() {
  document.getElementById('cluster-form').reset();
  document.getElementById('cluster-id').value = '';
  document.getElementById('cluster-max').value = '20';
  document.getElementById('cluster-form-title').textContent = 'Cluster bouwen';
  renderPicker();
}

function fillClusterForm(cluster) {
  document.getElementById('cluster-id').value = cluster.id;
  document.getElementById('cluster-name').value = cluster.name;
  document.getElementById('cluster-max').value = cluster.maxOrderQty;
  document.getElementById('cluster-align').checked = Boolean(cluster.alignOnStart);
  document.getElementById('cluster-form-title').textContent = 'Cluster bewerken';
  renderPicker(cluster);
  setView('clusters');
}

async function saveAccount(event) {
  event.preventDefault();
  const payload = accountPayload();
  const button = document.getElementById('account-save');
  button.disabled = true;
  try {
    if (payload.id) await api(`/api/accounts/${payload.id}`, { method: 'PUT', body: payload });
    else await api('/api/accounts', { method: 'POST', body: payload });
    toast('Account opgeslagen.', 'success');
    resetAccountForm();
    const picker = readPicker();
    await reload();
    renderPicker(picker.masterId || picker.slaves.length ? picker : null);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function testAccount() {
  const button = document.getElementById('account-test');
  button.disabled = true;
  try {
    const payload = accountPayload();
    const result = await api('/api/accounts/test', { method: 'POST', body: payload });
    fillSubAccounts(result.accounts, payload.tradovateAccountId);
    toast(`Verbonden via ${result.route.label} in ${result.latency} ms.`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function saveCluster(event) {
  event.preventDefault();
  const id = document.getElementById('cluster-id').value;
  const picked = readPicker();
  const payload = {
    name: document.getElementById('cluster-name').value,
    masterId: picked.masterId,
    slaves: picked.slaves,
    alignOnStart: document.getElementById('cluster-align').checked,
    maxOrderQty: Number(document.getElementById('cluster-max').value)
  };
  const button = document.getElementById('cluster-save');
  button.disabled = true;
  try {
    if (id) await api(`/api/clusters/${id}`, { method: 'PUT', body: payload });
    else await api('/api/clusters', { method: 'POST', body: payload });
    toast('Cluster opgeslagen.', 'success');
    resetClusterForm();
    await reload();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function toggleCluster(id, action) {
  const cluster = state.clusters.find((row) => row.id === id);
  if (!cluster) return;
  if (action === 'start') {
    const members = [cluster.masterId, ...cluster.slaves.map((slave) => slave.accountId)]
      .map(accountById)
      .filter(Boolean);
    if (members.some((account) => account.environment === 'live')) {
      const ok = await ask({
        title: 'Live cluster starten',
        body: 'Minstens één account staat op live. Orders worden echt bij Tradovate geplaatst.',
        confirm: 'Start live',
        danger: true
      });
      if (!ok) return;
    }
  } else {
    const ok = await ask({
      title: 'Cluster stoppen',
      body: 'De copier volgt de master niet meer. Open posities blijven staan.',
      confirm: 'Stop',
      danger: true
    });
    if (!ok) return;
  }
  try {
    await api(`/api/clusters/${id}/${action}`, { method: 'POST' });
    await reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function challengePayload() {
  return {
    startBalance: document.getElementById('ch-start').value,
    profitTarget: document.getElementById('ch-target').value,
    maxDrawdown: document.getElementById('ch-dd').value,
    drawdownMode: document.getElementById('ch-mode').value,
    dailyLossLimit: document.getElementById('ch-daily').value,
    minDays: document.getElementById('ch-days').value
  };
}

async function refreshOpenChallenge() {
  await reload();
  const account = accountById(state.challengeId);
  if (account) fillChallengeForm(account);
}

async function saveChallengeRules(event) {
  event.preventDefault();
  if (!state.challengeId) return;
  const button = document.getElementById('challenge-save');
  button.disabled = true;
  try {
    await api(`/api/accounts/${state.challengeId}/challenge`, { method: 'PUT', body: challengePayload() });
    toast('Challengeregels opgeslagen. Je status is niet veranderd.');
    await refreshOpenChallenge();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function checkChallenge() {
  if (!state.challengeId) return;
  const button = document.getElementById('challenge-check');
  button.disabled = true;
  try {
    await api(`/api/accounts/${state.challengeId}/challenge`, { method: 'PUT', body: challengePayload() });
    await api(`/api/accounts/${state.challengeId}/challenge/check`, { method: 'POST' });
    toast('Stand opgehaald. Het advies wijzigt je beslissing niet.');
    await refreshOpenChallenge();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function decideChallenge(phase) {
  if (!state.challengeId) return;
  const account = accountById(state.challengeId);
  const suggestion = account?.challenge?.lastCheck?.suggestion;
  if (phase === 'gehaald') {
    const warning = suggestion === 'lijkt_gezakt'
      ? 'De berekening ziet een overtreding. Jij kunt dit account toch als gehaald markeren. Daarna mag het in een cluster.'
      : 'Daarna mag dit account in een cluster, ook als het advies nog op bezig staat.';
    const ok = await ask({
      title: 'Als gehaald markeren',
      body: warning,
      confirm: 'Markeer als gehaald'
    });
    if (!ok) return;
  }
  if (phase === 'gezakt') {
    const ok = await ask({
      title: 'Als gezakt markeren',
      body: 'Dit account kan dan niet in een cluster, tot je het zelf terugzet naar evaluatie of gehaald.',
      confirm: 'Markeer als gezakt',
      danger: true
    });
    if (!ok) return;
  }
  try {
    await api(`/api/accounts/${state.challengeId}/challenge/decision`, { method: 'POST', body: { phase } });
    toast(phase === 'evaluatie' ? 'Terug naar evaluatie.' : 'Jouw beslissing is opgeslagen.');
    await refreshOpenChallenge();
  } catch (err) {
    toast(err.message, 'error');
  }
}

let analyticsTimer = null;
let analyticsLoading = false;

function pnlClass(value) {
  if (value == null || Number(value) === 0) return 'flat';
  return Number(value) > 0 ? 'up' : 'down';
}

function barWidth(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

function renderAnalytics(report) {
  const summary = report.summary || { accountCount: 0, dayPnl: null, tradedToday: 0, readyToday: 0, dayPnlMissing: 0 };
  const dayText = summary.dayPnl == null ? '—' : moneyText(summary.dayPnl);
  const missing = summary.dayPnlMissing
    ? ` · ${summary.dayPnlMissing} zonder dagsaldo`
    : '';
  document.getElementById('analytics-stats').innerHTML = `
    <div class="stat"><span>Totale dagwinst</span><b class="${pnlClass(summary.dayPnl)}">${esc(dayText)}</b></div>
    <div class="stat"><span>Trade vandaag gemaakt</span><b>${esc(summary.tradedToday)} / ${esc(summary.accountCount)}</b></div>
    <div class="stat"><span>Klaar voor trade</span><b>${esc(summary.readyToday)}</b></div>
  `;
  document.getElementById('analytics-updated').textContent = report.asOf
    ? `Bijgewerkt ${formatTime(report.asOf)}${missing}`
    : '';
  const grid = document.getElementById('analytics-grid');
  if (!report.accounts?.length) {
    grid.innerHTML = '<p class="empty">Nog geen accounts. Voeg ze toe onder Accounts.</p>';
  } else {
    grid.innerHTML = report.accounts.map(renderChallengeCard).join('');
  }
  renderAnalyticsHistory(report.history || []);
}

function renderChallengeCard(card) {
  const targetWidth = barWidth(Math.max(0, card.profitProgress || 0), card.profitTarget);
  const bufferWidth = barWidth(Math.max(0, card.drawdownRemaining || 0), card.maxLoss);
  const bufferHot = card.drawdownRemaining != null && card.maxLoss > 0 && card.drawdownRemaining / card.maxLoss <= 0.25;
  const bufferWarn = !bufferHot && card.drawdownRemaining != null && card.maxLoss > 0 && card.drawdownRemaining / card.maxLoss <= 0.5;
  return `
    <article class="challenge-card">
      <header>
        <div>
          <b>${esc(card.name)}</b>
          <small>${esc(card.subaccount || 'Geen subaccount')} · ${esc(card.environment)} · ${esc(phaseLabel[card.phase] || '')}</small>
        </div>
        <span class="tag ${card.status === 'used' ? 'used' : 'ready'}">${esc(card.statusLabel)}</span>
      </header>
      <p class="day-pnl ${pnlClass(card.dayPnl)}">${esc(card.dayPnl == null ? '—' : moneyText(card.dayPnl))}</p>
      <p class="faint">${esc(card.tradesToday)} trade${card.tradesToday === 1 ? '' : 's'} vandaag</p>
      <div class="meter">
        <div class="meter-top"><span>Target</span><span>${esc(moneyText(card.profitProgress))} / ${esc(moneyText(card.profitTarget))}</span></div>
        <div class="bar"><span style="width:${targetWidth}%"></span></div>
      </div>
      <div class="meter">
        <div class="meter-top"><span>Drawdown buffer</span><span>${esc(card.drawdownRemaining == null ? '—' : moneyText(card.drawdownRemaining))} van ${esc(moneyText(card.maxLoss))}</span></div>
        <div class="bar buffer ${bufferHot ? 'bad' : bufferWarn ? 'warn' : ''}"><span style="width:${bufferWidth}%"></span></div>
      </div>
      ${card.estimated ? '<p class="faint">Buffer is een schatting tot startbalans en saldo bekend zijn.</p>' : ''}
      ${card.consistency?.warning ? `<p class="tag warn-tag">${esc(card.consistency.warning)}</p>` : ''}
      <p class="guard ${card.safety?.clear ? '' : 'hot'}">${esc(card.safety?.message || '')}</p>
      ${card.error ? `<p class="card-error">${esc(card.error)}</p>` : ''}
    </article>
  `;
}

function renderAnalyticsHistory(history) {
  const host = document.getElementById('analytics-history');
  if (!history.length) {
    host.innerHTML = '<p class="empty">Nog geen opgeslagen dagen. Vernieuwen bewaart de dag-P&amp;L van vandaag.</p>';
    return;
  }
  const rows = history.slice(0, 60).flatMap((day) => {
    const accountRows = day.accounts.map((row) => `
      <div class="h-row">
        <span class="h-date">${esc(day.date)}</span>
        <span class="h-account">${esc(row.name)}</span>
        <span class="h-pnl ${pnlClass(row.pnl)}">${esc(row.pnl == null ? '—' : moneyText(row.pnl))}</span>
        <span class="h-trades">${esc(row.trades)}</span>
      </div>
    `);
    accountRows.push(`
      <div class="h-row total">
        <span class="h-date">${esc(day.date)}</span>
        <span class="h-account">Totaal</span>
        <span class="h-pnl ${pnlClass(day.totalPnl)}">${esc(day.totalPnl == null ? '—' : moneyText(day.totalPnl))}</span>
        <span class="h-trades">${esc(day.accounts.reduce((sum, row) => sum + Number(row.trades || 0), 0))}</span>
      </div>
    `);
    return accountRows;
  });
  host.innerHTML = `
    <div class="h-head"><span class="h-date">Datum</span><span class="h-account">Account</span><span class="h-pnl">P&amp;L</span><span class="h-trades">Trades</span></div>
    ${rows.join('')}
  `;
}

async function loadAnalytics() {
  if (analyticsLoading) return;
  const button = document.getElementById('analytics-refresh');
  analyticsLoading = true;
  if (button) button.disabled = true;
  try {
    renderAnalytics(await api('/api/analytics/all-challenges'));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    analyticsLoading = false;
    if (button) button.disabled = false;
  }
}

function startAnalytics() {
  stopAnalytics();
  loadAnalytics();
  analyticsTimer = setInterval(() => {
    if (state.view === 'analytics') loadAnalytics();
  }, 20000);
}

function stopAnalytics() {
  clearInterval(analyticsTimer);
  analyticsTimer = null;
}

function refreshPickerIfIdle() {
  const host = document.getElementById('picker');
  if (!host || host.contains(document.activeElement)) return;
  if (document.getElementById('cluster-id').value) return;
  const picker = readPicker();
  renderPicker(picker.masterId || picker.slaves.length ? picker : null);
}

async function reload() {
  applySnapshot(await api('/api/state'));
  refreshPickerIfIdle();
}

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.getElementById('account-form').addEventListener('submit', saveAccount);
document.getElementById('account-test').addEventListener('click', testAccount);
document.getElementById('account-reset').addEventListener('click', resetAccountForm);
document.getElementById('cluster-form').addEventListener('submit', saveCluster);
document.getElementById('challenge-form').addEventListener('submit', saveChallengeRules);
document.getElementById('challenge-check').addEventListener('click', checkChallenge);
document.getElementById('challenge-pass').addEventListener('click', () => decideChallenge('gehaald'));
document.getElementById('challenge-fail').addEventListener('click', () => decideChallenge('gezakt'));
document.getElementById('challenge-reset').addEventListener('click', () => decideChallenge('evaluatie'));
document.getElementById('cluster-reset').addEventListener('click', resetClusterForm);
document.getElementById('analytics-refresh').addEventListener('click', loadAnalytics);
document.getElementById('picker').addEventListener('change', syncPickerLocks);
document.getElementById('clear-logs').addEventListener('click', async () => {
  try {
    await api('/api/logs/clear', { method: 'POST' });
    state.logs = [];
    renderLogs();
    renderStats();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'start' || action === 'stop') {
    toggleCluster(id, action);
    return;
  }
  if (action === 'open-challenge') {
    const account = accountById(id);
    if (account) {
      fillChallengeForm(account);
      setView('challenges');
    }
    return;
  }
  if (action === 'edit-account') {
    const account = accountById(id);
    if (account) {
      fillAccountForm(account);
      setView('accounts');
    }
    return;
  }
  if (action === 'delete-account') {
    const account = accountById(id);
    const ok = await ask({
      title: 'Account verwijderen',
      body: `${account ? account.name : 'Dit account'} wordt uit de lokale opslag gehaald.`,
      confirm: 'Verwijder',
      danger: true
    });
    if (!ok) return;
    try {
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      if (document.getElementById('account-id').value === id) resetAccountForm();
      toast('Account verwijderd.');
      await reload();
      renderPicker(readPicker());
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  if (action === 'edit-cluster') {
    const cluster = state.clusters.find((row) => row.id === id);
    if (cluster) fillClusterForm(cluster);
    return;
  }
  if (action === 'delete-cluster') {
    const ok = await ask({
      title: 'Cluster verwijderen',
      body: 'Het cluster stopt als het nog draait. Posities worden niet gesloten.',
      confirm: 'Verwijder',
      danger: true
    });
    if (!ok) return;
    try {
      await api(`/api/clusters/${id}`, { method: 'DELETE' });
      if (document.getElementById('cluster-id').value === id) resetClusterForm();
      toast('Cluster verwijderd.');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

socket.on('connect', () => {
  document.getElementById('sock-dot').className = 'dot on';
  document.getElementById('sock-label').textContent = 'Server verbonden';
});

socket.on('disconnect', () => {
  document.getElementById('sock-dot').className = 'dot bad';
  document.getElementById('sock-label').textContent = 'Server weg';
});

socket.on('snapshot', applySnapshot);
socket.on('log', (row) => {
  state.logs.push(row);
  if (state.logs.length > 400) state.logs.shift();
  renderLogs();
  renderStats();
});
socket.on('logs-cleared', () => {
  state.logs = [];
  renderLogs();
  renderStats();
});
socket.on('positions', (rows) => {
  state.positions = rows || [];
  renderPositions();
  renderStats();
});
socket.on('runtime', (runtime) => {
  state.runtime = runtime || {};
  renderClusterStrip();
  renderClusters();
  renderStats();
});
socket.on('account-status', ({ accountId, status }) => {
  state.accounts = state.accounts.map((account) => (
    account.id === accountId ? { ...account, status: { ...account.status, ...status } } : account
  ));
  renderAccounts();
});

function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('nl-NL', { hour12: false });
}

tickClock();
setInterval(tickClock, 1000);
renderPicker();
reload().catch((err) => toast(err.message, 'error'));
