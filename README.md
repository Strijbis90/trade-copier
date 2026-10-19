# Tradovate Trade Copier

Lokaal dashboard om Tradovate-fills van één master naar slave-accounts te kopiëren.

De volledige uitleg, inclusief TradingView, elk veld en de foutafhandeling, staat in [HANDLEIDING.md](HANDLEIDING.md).

## Start

```bash
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Gebruik

1. Maak bij Tradovate een API-key en vul bij Accounts naam, App ID, Client ID, secret, gebruikersnaam en wachtwoord in.
2. Laat proxy uit voor een directe verbinding vanaf deze host. Zet proxy aan en vul een `http://` of `socks5://` URL in als alleen dat account via een proxy mag.
3. Test de verbinding en kies het Tradovate-account als de login er meerdere heeft.
4. Bouw een cluster: één master, slaves via checkboxes, en een multiplier per slave.
5. Start het cluster en volg orders, fouten, latency en open posities in Live Monitor.

Stoppen sluit geen posities. Demo en live mogen niet in hetzelfde cluster. De server bindt standaard aan `127.0.0.1`.
