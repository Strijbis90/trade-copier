const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Store, publicAccount } = require('./src/store');
const { createLogger } = require('./src/logger');
const { Copier } = require('./src/copier');
const { createApi } = require('./src/api');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const root = __dirname;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const store = new Store(path.join(root, 'data'));
const logger = createLogger(io);
const copier = new Copier({ store, io, log: logger });

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', createApi({ store, copier, logger }));
app.use(express.static(path.join(root, 'public')));

app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(400).json({ error: 'Ongeldig verzoek.' });
});

io.on('connection', (socket) => {
  socket.emit('snapshot', {
    accounts: store.accounts().map((account) => publicAccount(account, copier.accountStatus.get(account.id))),
    clusters: store.clusters(),
    logs: logger.list(),
    ...copier.snapshot()
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Tradovate Trade Copier: http://${HOST}:${PORT}`);
});

async function shutdown() {
  console.log('Stoppen...');
  await copier.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
