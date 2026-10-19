const crypto = require('crypto');

function createLogger(io) {
  const entries = [];

  function push(entry) {
    const row = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      level: entry.level || 'info',
      account: entry.account || '',
      cluster: entry.cluster || '',
      message: entry.message,
      latency: Number.isFinite(entry.latency) ? Math.round(entry.latency) : null
    };
    entries.push(row);
    if (entries.length > 400) entries.shift();
    const latencyText = row.latency == null ? '' : ` ${row.latency}ms`;
    console.log(`[${row.level}] ${row.cluster ? `${row.cluster} ` : ''}${row.message}${latencyText}`);
    io.emit('log', row);
    return row;
  }

  return {
    push,
    list: () => entries.slice(),
    clear() {
      entries.length = 0;
      io.emit('logs-cleared');
    }
  };
}

module.exports = { createLogger };
