const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXY_PROTOCOLS = new Set([
  'http:',
  'https:',
  'socks:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'socks5h:'
]);

function normalizeProxyUrl(value) {
  return String(value || '').trim();
}

function assertProxyUrl(value) {
  const raw = normalizeProxyUrl(value);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Proxy URL is ongeldig.');
  }
  if (!PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error('Proxy moet HTTP of SOCKS5 zijn (http, https, socks5).');
  }
  if (!url.hostname || !url.port) {
    throw new Error('Proxy URL heeft een host en een poort nodig.');
  }
  return raw;
}

/**
 * Direct vanaf de host, tenzij dit account expliciet een proxy aan heeft staan.
 * Een gevulde URL zonder toggle wordt genegeerd. Een kapotte proxy faalt
 * hard, zodat het verkeer niet stilletjes direct naar buiten gaat.
 */
function createProxyAgent(account) {
  if (!account?.useProxy) return null;
  const raw = assertProxyUrl(account.proxyUrl);
  if (/^socks/i.test(raw)) return new SocksProxyAgent(raw);
  return new HttpsProxyAgent(raw);
}

function describeRoute(account) {
  if (!account?.useProxy) return { mode: 'direct', label: 'Direct' };
  try {
    const url = new URL(normalizeProxyUrl(account.proxyUrl));
    const scheme = url.protocol.replace(':', '').toUpperCase();
    return { mode: 'proxy', label: `${scheme} ${url.hostname}:${url.port}` };
  } catch {
    return { mode: 'proxy', label: 'Proxy' };
  }
}

module.exports = {
  createProxyAgent,
  describeRoute,
  assertProxyUrl,
  normalizeProxyUrl
};
