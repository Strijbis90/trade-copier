# Handleiding Tradovate Trade Copier

Deze handleiding is geschreven voor iemand die het programma voor het eerst opent. Je hoeft niets van programmeren te weten. Lees hoofdstuk 1 tot en met 5 één keer helemaal. Daarna kun je de rest als naslag gebruiken: elk veld, elke knop, en wat het programma doet als een order niet volledig vult of er iets misgaat.

Het programma kopieert **posities** van één Tradovate-account (de master) naar één of meer andere Tradovate-accounts (de slaves). Het doet dat op deze computer. Er is geen website in de cloud.

---

## 1. Wat het programma wel en niet is

Je handelt op een master-account. Dat kan vanuit de Tradovate-website, de Tradovate-app, of vanuit TradingView als die grafiek aan datzelfde Tradovate-account gekoppeld is. Zodra de positie op de master verandert, stuurt dit programma een market order naar elke slave.

Een **market order** is een order die meteen tegen de beschikbare prijs wordt uitgevoerd. De slave krijgt dus geen kopie van jouw limiet, stop of target. De slave krijgt een market order voor het verschil in positie.

Voorbeeld. Jij koopt op de master 1 NQ. De slave staat op multiplier 2. De slave krijgt een market order: koop 2 NQ. Jij zet daarna een target en een stop in Tradovate of TradingView. Die target en stop blijven op de master liggen. De slave heeft ze niet in zijn orderboek. Pas als jouw target of stop vult en de masterpositie daardoor kleiner wordt of naar nul gaat, stuurt de copier een market order die de slave meeneemt.

TradingView zelf staat niet in dit programma. Er is geen veld voor een TradingView-webhook, geen Pine Script, en geen login voor TradingView. Hoe de keten vanuit TradingView toch werkt, staat in hoofdstuk 16.

---

## 2. Woordenlijst

| Woord | Betekenis |
| --- | --- |
| Master | Het account waarop jij zelf handelt. Dit account wordt gevolgd. |
| Slave | Een account dat de master nabootst. |
| Cluster | Een groep van precies 1 master en 1 of meer slaves, met een multiplier per slave. |
| Multiplier | De vermenigvuldiging. 1 betekent dezelfde grootte. 2 betekent dubbel. 0,5 betekent de helft, afgerond. |
| Fill | Een order die echt is uitgevoerd. Alleen dan verandert de positie. |
| Positie / netto | Hoeveel contracten je open hebt. +2 is long 2. −1 is short 1. 0 is vlak. |
| Demo | Oefenomgeving van Tradovate. Geen echt geld. |
| Live | Echt Tradovate-account. Orders kosten echt geld. |
| App ID | De naam die jij aan je Tradovate API-key hebt gegeven. |
| Client ID | Het nummer (cid) dat Tradovate bij die API-key toont. |
| Secret | Het geheime wachtwoord van die API-key. Tradovate toont het één keer. |
| Proxy | Een tussenstation voor het internetverkeer van één account. Uit = rechtstreeks vanaf deze pc. |
| Latency | Het aantal milliseconden tussen “de masterpositie veranderde” en “Tradovate antwoordde op de slave-order”. |
| Market order | Order die meteen uitgevoerd wordt tegen de prijs die dan beschikbaar is. |

---

## 3. Wat je nodig hebt

- Deze pc, met Windows.
- Node.js versie 18 of nieuwer. Dat is het programma dat de copier start. Download de LTS-versie van [https://nodejs.org](https://nodejs.org). Tijdens de installatie kun je de standaardopties laten staan.
- Een Tradovate-login voor de master, en een aparte login (of een ander subaccount onder dezelfde login) voor elke slave.
- Een API-key per login. Hoe je die aanmaakt staat in hoofdstuk 7.
- Een browser: Chrome, Edge of Firefox.
- Voor de eerste keer: oefen op **Demo**. Zet pas daarna een account op Live.

TradingView is optioneel. Je kunt ook rechtstreeks in Tradovate handelen. De copier ziet het verschil niet, zolang de order op het master-account van Tradovate binnenkomt.

---

## 4. Eerste installatie

Dit doe je één keer.

1. Pak deze map erbij: `C:\Users\strij\Trade copier`.
2. Klik in de adresbalk van de Verkenner, typ `powershell`, en druk op Enter. Er opent een blauw venster in deze map.
3. Typ dit en druk op Enter:

```powershell
npm install
```

4. Wacht tot de tekst weer een regel toont waarop je kunt typen. Er worden dan pakketten in de map `node_modules` gezet. Dat is normaal.
5. Zie je `npm wordt niet herkend` of `npm is not recognized`, dan is Node.js niet geïnstalleerd, of dit venster stond al open vóór de installatie. Sluit het venster, open het opnieuw, en probeer het nog eens.

Daarna hoef je `npm install` alleen opnieuw te doen als het programma wordt bijgewerkt.

---

## 5. Het programma starten en de pagina openen

De pagina is geen bestand dat je dubbelklikt. `index.html` openen vanuit de Verkenner geeft een lege of kapotte pagina, omdat de server dan niet draait.

1. Open PowerShell in de map `Trade copier`, zoals in hoofdstuk 4.
2. Typ:

```powershell
npm start
```

3. Wacht op deze regel:

```text
Tradovate Trade Copier: http://127.0.0.1:3000
```

4. Open je browser en plak precies dit adres:

```text
http://127.0.0.1:3000
```

`127.0.0.1` betekent “deze computer”. Het dashboard is vanaf een andere computer of telefoon niet bereikbaar. Dat is met opzet, omdat hier wachtwoorden opgeslagen worden.

Laat het PowerShell-venster open. Sluit je het, of zet je de pc uit, dan stopt de copier. De browser toont dan “kan deze site niet bereiken”. Start dan opnieuw met `npm start`.

Een cluster dat draaide, start niet vanzelf weer na `npm start`. Je drukt opnieuw op **Start**. Posities die bij Tradovate openstaan, blijven daar gewoon openstaan. Het programma onthoudt niet dat het cluster aan stond.

---

## 6. Rondleiding door het scherm

Links staat een donkere balk.

- **01 Live Monitor.** Het scherm tijdens het handelen: status, open posities en de log.
- **02 Accounts.** Hier bewaar je Tradovate-logins.
- **03 Challenges.** Hier zie je of een challenge gehaald lijkt, en beslis jij of het account in een cluster mag.
- **04 Clusters.** Hier koppel je een master aan slaves.
- **05 Analytics & Multi-Challenge Tracker.** Hier zie je alle accounts naast elkaar: dag-P&L, of de trade van vandaag al gemaakt is, de voortgang naar het doel en de resterende verliesbuffer.

Onderin die balk staat een bolletje.

| Bolletje | Tekst | Betekenis |
| --- | --- | --- |
| Groen | Server verbonden | De pagina praat met het programma op deze pc. |
| Rood | Server weg | `npm start` is gestopt, of de pagina is de verbinding kwijt. Ververs de pagina nadat je `npm start` weer hebt gedraaid. |
| Grijs | Verbinden | De pagina is nog aan het opstarten. |

Rechtsboven staat de klok van je pc en het woord `localhost`. Dat herinnert je eraan dat dit scherm alleen op deze machine draait.

Fouten en bevestigingen verschijnen rechtsonder als een kort groen of rood vlak. Die verdwijnt vanzelf. De log onder Live Monitor blijft staan tot je op **Wis** drukt.

Een bevestigingsvenster (verwijderen, stoppen, live starten) heeft **Annuleer** en een knop rechts. Niets gebeurt tot je de rechterknop indrukt.

---

## 7. Een API-key aanmaken bij Tradovate

Doe dit voor elke login die je in de copier wilt gebruiken. Demo en live hebben elk hun eigen sleutel. Een sleutel van demo werkt niet op live, en omgekeerd.

1. Log in op de omgeving die bij het account hoort.
   - Demo: [https://demo.tradovate.com](https://demo.tradovate.com)
   - Live: [https://trader.tradovate.com](https://trader.tradovate.com)
2. Open de instellingen (het tandwiel) en zoek **API Access** of **API**. De exacte menunaam kan per Tradovate-versie iets verschillen.
3. Maak een nieuwe API-key. Geef hem een naam, bijvoorbeeld `TradeCopier`.
4. Tradovate toont drie dingen. Schrijf ze meteen op, want het secret zie je vaak maar één keer.
   - **Naam van de key.** Dit vul je in het veld **App ID**.
   - **CID / Client ID.** Een getal. Dit vul je in **Client ID**.
   - **Secret.** Een lange tekenreeks. Dit vul je in **Secret**.
5. Je **gebruikersnaam** is de naam waarmee je bij Tradovate inlogt.
6. Je **wachtwoord** is het wachtwoord van die Tradovate-login. Heeft Tradovate je een apart API-wachtwoord gegeven, gebruik dan dat.

Lukt het aanmaken van een key niet, dan staat API-toegang op dat account nog uit. Dat regel je in Tradovate zelf, niet in dit programma.

Tradovate staat per gebruiker een klein aantal gelijktijdige sessies toe (gebruikelijk twee). Dit programma gebruikt één sessie per login. Zit je tegelijk in de Tradovate-website, in de telefoon-app én in deze copier, dan kan Tradovate de oudste sessie sluiten. Het logboek toont dan dat de verbinding wegvalt en opnieuw wordt opgezet. Houd het aantal open sessies laag.

---

## 8. Accounts invullen, veld voor veld

Ga naar **02 Accounts**. Links staat het formulier, rechts de lijst.

### Naam

Een bijnaam voor jezelf, bijvoorbeeld `Master demo` of `Slave FTMO`. Tradovate ziet deze naam niet. Maximaal 80 tekens. Dit veld is verplicht.

### Omgeving

- **Demo.** Het programma praat met `demo.tradovateapi.com`. Geen echt geld.
- **Live.** Het programma praat met `live.tradovateapi.com`. Echt geld.

Kies de omgeving die bij de API-key hoort. Een demo-key in een live-account faalt bij het testen.

### App ID

De naam van de API-key uit hoofdstuk 7. Staat er niets, dan gebruikt het programma `TradeCopier`. Die tekst moet overeenkomen met de naam die je bij Tradovate aan de key gaf. Een verkeerde naam geeft een fout bij **Verbinding testen**.

### Client ID

Het cid-nummer van diezelfde key. Verplicht. Alleen het nummer, zonder spaties.

### Secret

Het secret van die key. Verplicht bij een nieuw account. Het veld is een wachtwoordveld: je ziet bolletjes.

Bij **Bewerk** laat je dit veld leeg als het secret hetzelfde blijft. De placeholder wordt dan “Leeg laten om te behouden”. Vul je iets in, dan wordt het oude secret vervangen.

### Gebruikersnaam

De Tradovate-login. Verplicht. Maximaal 80 tekens.

### Wachtwoord

Het Tradovate-wachtwoord van die login. Verplicht bij een nieuw account. Bij bewerken geldt hetzelfde als bij Secret: leeg laten betekent “het oude wachtwoord houden”.

### Proxy URL

Optioneel. Voorbeelden van een geldige URL:

```text
socks5://127.0.0.1:1080
http://127.0.0.1:8888
http://gebruiker:wachtwoord@mijnproxy.nl:8080
```

Er moet een protocol, een host en een poort in staan. `http`, `https`, `socks`, `socks4`, `socks5` en `socks5h` zijn toegestaan. `ftp://` wordt geweigerd.

Een URL zonder poort, of een lege URL terwijl **Proxy aan** aanstaat, geeft een fout bij opslaan.

### Proxy aan

De schakelaar rechts van het proxyveld.

- **Uit**, ook als er een URL staat: dit account verbindt rechtstreeks vanaf deze pc. In de lijst staat dan **Direct**.
- **Aan**: al het verkeer van dit account, inclusief de live verbinding, gaat door die proxy. In de lijst staat bijvoorbeeld `SOCKS5 127.0.0.1:1080` of `HTTP 10.0.0.8:8080`. Het wachtwoord uit de URL wordt niet in de log gezet.
- De proxy is kapot of uit: de verbinding faalt met een tekst als `Proxyverbinding mislukt`. Het programma schakelt dan niet stiekem over op een directe verbinding.

Gebruik je dezelfde Tradovate-login voor twee kaarten in één cluster, dan moeten die twee dezelfde proxy-instelling hebben. Anders weigert de start met: `Dezelfde Tradovate-login moet dezelfde proxy-instelling gebruiken.`

### Tradovate-account

Een login kan meerdere handelsaccounts hebben, bijvoorbeeld twee demo-subaccounts. Dit uitklapmenu kiest welk van die accounts deze kaart is.

Bij een nieuw account staat er: `Test de verbinding om accounts op te halen`. Het menu vult zich pas na een geslaagde test. Is er precies één account, dan wordt dat gekozen. Zijn er meerdere, kies dan zelf de juiste naam voordat je opslaat.

Laat je dit leeg en er is later bij het starten maar één account, dan kiest het programma dat account en slaat de naam op. Zijn er meerdere en heb je niets gekozen, dan stopt de start met: `Meerdere Tradovate-accounts gevonden. Kies er een bij het account.`

### Opslaan

Schrijft de kaart naar `data\accounts.json` op deze pc. Wachtwoorden en secrets staan in dat bestand. Ze worden niet naar de browser teruggestuurd en niet naar internet geüpload, behalve naar Tradovate op het moment dat je test of een cluster start.

Na opslaan wordt het formulier leeg gemaakt. De kaart verschijnt rechts.

### Verbinding testen

Logt één keer in bij Tradovate met de gegevens die nú in het formulier staan. Je hoeft niet eerst op te slaan, maar een bestaand account kun je testen terwijl je het bewerkt: lege secret- en wachtwoordvelden gebruiken dan de opgeslagen waarden.

Bij succes verschijnt rechtsonder een melding met de route en de tijd in milliseconden, en het menu **Tradovate-account** toont de gevonden accounts. Sla daarna op, zodat de keuze bewaard blijft.

Testen kan niet terwijl dit account in een draaiend cluster zit. Stop het cluster eerst. Een test tijdens een lopend cluster zou de live sessie kunnen verstoren.

### Nieuw

Maakt het formulier leeg, zodat je een tweede account kunt toevoegen zonder de vorige te overschrijven.

### De kaart rechts

Elke kaart toont:

- de bijnaam;
- een label **demo** of **live**;
- de gebruikersnaam, en na een geslaagde koppeling de Tradovate-accountnaam;
- een bolletje en de route.

| Bolletje op de kaart | Betekenis |
| --- | --- |
| Groen | Verbonden. |
| Oranje | Bezig met inloggen of opnieuw verbinden. |
| Rood | Laatste poging mislukt. De tekst ernaast is de fout. |
| Grijs | Niet in gebruik. |

**Bewerk** zet de gegevens terug in het formulier. Secret en wachtwoord blijven leeg op het scherm.

**Verwijder** vraagt om bevestiging en haalt de kaart uit `data\accounts.json`. Dit kan niet zolang de kaart in een cluster zit. Haal hem eerst uit het cluster, of verwijder het cluster. Het kan ook niet terwijl een cluster met dit account draait.

---

## 9. Challenges

Een cluster accepteert alleen accounts die **jij** als gehaald hebt gemarkeerd. Het programma kan een advies geven. Dat advies zet de status niet vanzelf om.

Ga naar **03 Challenges** en klik **Open** bij een account.

| Veld of knop | Wat het doet |
| --- | --- |
| Startbalans | De balans waarmee de challenge begon. |
| Winstdoel | Hoeveel winst erbovenop nodig is, in dollars. |
| Max drawdown | Hoeveel het saldo mag dalen voordat het advies “lijkt gezakt” wordt. |
| Drawdown | Vast rekent vanaf de startbalans. Trailing rekent vanaf de hoogste stand die dit programma heeft gezien. |
| Daglimiet | Optioneel. Leeg betekent: niet controleren. Werkt alleen als Tradovate een dagsaldo meestuurt. |
| Minimum tradedagen | Optioneel. Leeg betekent: niet controleren. |
| Regels opslaan | Bewaart de regels. Je status blijft staan. |
| Stand ophalen | Leest saldo en fills bij Tradovate en vult het advies. |
| Markeer als gehaald | Jouw beslissing. Daarna mag het account in een cluster. Dit kan ook als het advies nog “bezig” of zelfs “lijkt gezakt” is. In dat laatste geval vraagt het programma extra bevestiging. |
| Markeer als gezakt | Jouw beslissing. Het account kan niet in een cluster. |
| Terug naar evaluatie | Haalt jouw beslissing weer weg. Het account kan niet in een cluster. |

De status die jij zet is **Evaluatie**, **Gehaald** of **Gezakt**. Alleen Gehaald komt in de clusterbouwer als kiesbaar account. Een account dat al in een bestaand cluster zit en dat je terugzet, kun je uitvinken. Opslaan of starten weigert zolang er een account tussen zit dat niet op Gehaald staat.

Het advies “lijkt gehaald” verschijnt als de winst op of boven het doel zit, de drawdown niet door de lijn is, de daglimiet niet geraakt is, en het minimum aantal tradedagen gehaald is als je dat invulde. “Lijkt gezakt” verschijnt als het saldo op of onder de drawdownlijn zit, of als het dagverlies door de limiet is. Jij mag daarvan afwijken.

## 10. Clusters maken, knop voor knop

Ga naar **04 Clusters**. Er moet minstens één account op **Gehaald** staan. Anders kun je de rijen niet aanvinken. Staat er nog geen account, dan zie je: `Voeg eerst een account toe.`

### Clusternaam

Een bijnaam, bijvoorbeeld `NQ scalper`. Alleen voor jou. Verplicht, maximaal 80 tekens.

### Max ordergrootte

Een geheel getal van 1 tot en met 500. Standaard 20.

Dit is een rem. Wil de copier voor één slave in één keer meer contracten sturen dan dit getal, dan wordt die order niet geplaatst. In de log staat: `Order … geweigerd. Maximum is 20.` Die slave wordt voor dat symbool dan overgeslagen tot de master in dat symbool opnieuw beweegt.

Zet dit getal bewust. Een multiplier van 10 op een master die 5 contracten handelt, vraagt 50 op de slave. Staat het maximum op 20, dan gebeurt die copy niet.

### Bij start bestaande posities gelijk trekken

Dit vakje staat standaard uit.

**Uit.** Het cluster onthoudt de posities zoals ze zijn op het moment dat je op Start drukt. Alleen wat de master daarna doet, wordt gekopieerd. Stond de master al +2 NQ voordat je startte, dan krijgen de slaves die 2 niet alsnog.

**Aan.** Meteen na de start rekent het programma de slave-doelpositie uit als `afgerond(masterpositie × multiplier)` en stuurt market orders om de slaves daarheen te brengen. Had de master +2 en de multiplier is 2, dan gaat de slave naar +4, ook als de slave op dat moment vlak was. Dit kan dus meteen een echte order zijn. Op een live-account is dat echt geld.

Stoppen maakt dit niet ongedaan. Posities blijven open.

### De tabel Master / Slave / Account / Multiplier

Elke opgeslagen account is één rij.

- Het rondje onder **Master** kiest precies één master. Een tweede rondje vervangt de eerste.
- Het vakje onder **Slave** zet dat account aan als volger.
- **Multiplier** hoort bij die slave. Het veld is uitgeschakeld tot het slave-vakje aanstaat. Kleinste stap is 0,1. Toegestaan is groter dan 0 en maximaal 100.

De rij die je als master kiest, verliest zijn slave-vinkje. Die rij kan niet allebei zijn. Probeer je het toch, dan komt de fout: `De master kan niet ook slave zijn.`

Je hebt minstens één slave nodig. Anders: `Kies minstens één slave.`

### Cluster opslaan

Bewaart het cluster in `data\clusters.json`. Er wordt nog niets gekopieerd. De kaart verschijnt rechts, met de tekst **Gestopt**.

### Nieuw

Leegt het formulier voor een volgend cluster.

### De kaart rechts

De kaart toont de master, de slaves met hun multiplier (`Slave A ×2.5`), of het cluster alleen nieuwe fills kopieert of bij start gelijk trekt, en het maximum.

**Start.** Begint het volgen. Zie hoofdstuk 11.

**Stop.** Staat er zolang het cluster **Live** is. Vraagt bevestiging: de copier volgt niet meer, open posities blijven staan.

**Bewerk.** Zet het cluster terug in het formulier. Dit kan alleen als het cluster gestopt is. Tijdens het draaien: `Stop het cluster voordat je het wijzigt.`

**Verwijder.** Stopt het cluster als het nog draaide, en haalt de definitie weg. Posities bij Tradovate blijven open.

---

## 11. Een cluster starten en stoppen

### Start op demo

Druk op **Start** op de clusterkaart, of op de kaart bovenaan Live Monitor. Er komt geen extra waarschuwing als elk account op Demo staat.

Het programma doet dan, in deze volgorde:

1. Controleert dat demo en live niet gemengd zijn. Gemengd geeft: `Demo en live accounts in hetzelfde cluster zijn geblokkeerd.`
2. Controleert dat geen van deze accounts al in een ander draaiend cluster zit. Overlap geeft: `Account overlap met draaiend cluster "…"`.
3. Logt in bij Tradovate, eerst de master, daarna de slaves.
4. Kiest het Tradovate-subaccount van elke kaart.
5. Opent de live verbinding en leest de posities die op dat moment openstaan.
6. Schrijft in de log de route van elk account: `Direct` of de proxy.
7. Zet het label op **Live**.

Dezelfde Tradovate-login mag in één cluster meerdere subaccounts aansturen (master én slave onder één gebruikersnaam). Daarvoor wordt één verbinding gedeeld. In de log staat dan `gedeelde sessie`. Twee kaarten mogen niet naar hetzelfde Tradovate-subaccount wijzen. Dan stopt de start met: `Tradovate-account … is al in dit cluster gekozen.`

Een slave die niet kan inloggen, wordt gelogd en overgeslagen. De andere slaves lopen door. Kunnen alle slaves niet verbinden, dan wordt de start afgebroken en gaat alles weer uit.

Een mislukte start laat een rode logregel achter, bijvoorbeeld `Start afgebroken: Incorrect username or password…`. Het cluster blijft **Gestopt**.

### Start op live

Zit er minstens één live-account in het cluster, dan verschijnt een venster:

> Minstens één account staat op live. Orders worden echt bij Tradovate geplaatst.

**Start live** gaat door. **Annuleer** doet niets.

### Stop

Het venster zegt dat open posities blijven staan. Na bevestiging wordt de verbinding gesloten. De kaarten gaan op grijs, met de tekst Gestopt. In de log staat: `Cluster gestopt. Open posities zijn niet gesloten.`

Er is geen knop “alles sluiten” of “flatten”. Wil je de posities dicht, dan doe je dat zelf op de master vóórdat je stopt (de slaves volgen die sluiting mee zolang het cluster nog draait), of je sluit ze handmatig bij Tradovate.

---

## 12. Multiplier, met getallen

De copier telt vanaf de stand die hij zag bij **Start** (tenzij je “gelijk trekken” aan hebt gezet).

De formule is: doel van de slave = slavestand bij start + afgerond( (master nu − master bij start) × multiplier ).

Afronden gaat naar het dichtstbijzijnde hele contract. 0,5 rondt af naar boven bij positieve getallen (1,5 wordt 2). Een uitkomst van 0 betekent: geen order.

| Master, nieuw sinds de start | Multiplier | Slave krijgt erbij |
| --- | --- | --- |
| +1 | 1 | +1 |
| +1 | 2 | +2 |
| +1 | 0,4 | 0 (0,4 rondt af naar 0) |
| +2 | 0,4 | +1 (0,8 rondt af naar 1) |
| +3, daarna terug naar +2 | 0,4 | blijft +1, want 0,8 blijft 1 |
| −1 (short) | 2 | −2 |

Staat “gelijk trekken” aan, dan is het doel simpelweg afgerond(huidige masterpositie × multiplier), gerekend vanaf nul, niet vanaf de stand bij start.

De slave-order is altijd een market order voor het verschil tussen waar de slave nu is en dat doel. Wordt de master kleiner, dan verkoopt de slave. Gaat de master van long naar short, dan stuurt de copier één market order voor de hele draai.

---

## 13. Live Monitor, elke regel en knop

### De vier tegels

- **Clusters live.** Hoeveel clusters nu op Start staan.
- **Open posities.** Hoeveel regels er in de positietabel staan. Een vlakke positie (0) wordt niet getoond.
- **Laatste latency.** De latency van de laatste logregel die een tijd heeft. Groen onder 300 ms, oranje onder 800 ms, rood daarboven.
- **Fouten.** Het aantal logregels met niveau `error` sinds de laatste **Wis**, of sinds de laatste start van `npm start`. Wis maakt dit getal weer 0. Het herstelt geen orders.

### De clusterstrook

Elk cluster is een kaart met naam, **Live** of **Gestopt**, de master, het aantal slaves, en een korte status zoals `Volgt nieuwe fills` of `Posities gelijk trekken`. **Start** en **Stop** doen hetzelfde als op de Clusters-pagina.

### Open posities

| Kolom | Betekenis |
| --- | --- |
| Cluster | Welk cluster deze regel hoort. |
| Account | Jouw bijnaam van het account. |
| Rol | Master of Slave. |
| Route | Direct, of de proxy zonder wachtwoord. |
| Symbool | Het contract, bijvoorbeeld `MNQZ5`. |
| Side | Long (groen) of Short (rood). |
| Netto | Het aantal contracten. Negatief is short. |
| Prijs | De gemiddelde prijs die Tradovate meestuurt. Een streepje betekent dat die prijs niet in het bericht zat. |

De tabel ververst vanzelf zodra Tradovate een positie stuurt. Je hoeft niet te verversen.

### Logs

| Kolom | Betekenis |
| --- | --- |
| Tijd | Tijdstip op deze pc. |
| Niveau | Zie de tabel hieronder. |
| Account | Het account, of anders de clusternaam. |
| Bericht | Wat er gebeurde. |
| Latency | Milliseconden voor die stap. Een streepje betekent dat er geen tijd gemeten is. |

| Niveau | Kleur | Wanneer |
| --- | --- | --- |
| info | Grijs | Verbonden, route, welk Tradovate-account gekoppeld is. |
| order | Blauw | De masterpositie veranderde, of er is een slave-order naartoe gestuurd. |
| success | Groen | Tradovate heeft de slave-order geaccepteerd. Het ordernummer staat erbij als Tradovate er een gaf. |
| warn | Oranje | Het cluster is gestopt. |
| error | Rood | Inloggen mislukt, order geweigerd, proxy stuk, maximum overschreden. |

**Wis** leegt alleen dit logboek in het geheugen. Accounts, clusters en posities bij Tradovate blijven. Na het sluiten van het programma is de log ook weg. Hij wordt niet op schijf bewaard. Er passen ongeveer 400 regels in. Daarna valt de oudste weg.

De log scrolt vanzelf naar beneden, behalve als jij omhoog bent gescrold om iets terug te lezen.

---

## 14. Een complete eerste testrit

Doe dit op demo, met twee demo-accounts.

1. Installeer en start, hoofdstuk 4 en 5.
2. Maak bij Tradovate twee demo API-keys, of één key als beide subaccounts onder dezelfde demo-login vallen. Hoofdstuk 7.
3. **Accounts.** Maak de master. Omgeving Demo. Proxy uit. **Verbinding testen.** Kies het juiste subaccount. **Opslaan.**
4. Maak de slave op dezelfde manier.
5. **Challenges.** Open elk account, vul een startbalans, winstdoel en drawdown in, en klik **Markeer als gehaald**. Zonder die beslissing weigert het cluster.
6. **Clusters.** Naam `Test`. Maximum 20. Laat “gelijk trekken” uit. Rondje bij de master. Vink de slave aan. Multiplier 1. **Cluster opslaan.**
7. **Start.**
8. In de log verwacht je regels als `Master gekoppeld aan …`, `Slave gekoppeld aan …`, `route: Direct`, en `Cluster gestart. Alleen nieuwe master-fills worden gekopieerd.`
9. Koop op de master 1 contract market, in Tradovate of in TradingView dat aan deze master hangt.
10. In de log verwacht je `Master SYMbool 0 → 1`, daarna `Order geplaatst Buy 1 …`, daarna `Order geslaagd`.
11. In Open posities staan twee regels: de master long 1, de slave long 1.
12. Sluit de master (verkoop 1). De slave hoort ook naar 0 te gaan en uit de tabel te verdwijnen.
13. Druk op **Stop**. De posities, als er nog een openstond, blijven bij Tradovate bestaan.

Werkt stap 8 tot en met 11, dan is de keten goed. Pas daarna ga je naar live of naar een andere multiplier.

---

## 15. Vanuit TradingView

### Hoe de keten in elkaar zit

```text
Jij klikt op de grafiek in TradingView
        ↓
TradingView stuurt die order naar het Tradovate-account
dat jij in TradingView als broker hebt gekoppeld
        ↓
Tradovate vult de order, de positie van dat account verandert
        ↓
Dit programma ziet die positieverandering op de master
        ↓
Dit programma stuurt een market order naar elke slave
```

Dit programma logt niet in bij TradingView. Je koppelt TradingView zelf aan Tradovate.

### TradingView aan de master koppelen

1. Log in TradingView in met je eigen TradingView-account.
2. Open een grafiek van het contract dat je wilt handelen, bijvoorbeeld NQ of MNQ.
3. Open onderaan het paneel **Trading** (of **Trading Panel**).
4. Kies de broker **Tradovate**.
5. Kies dezelfde omgeving als in dit programma. Demo in TradingView hoort bij Omgeving **Demo** hier. Live hoort bij **Live**.
6. Log in met dezelfde Tradovate-gebruikersnaam als de masterkaart.
7. Kies in TradingView hetzelfde subaccount als in het veld **Tradovate-account** van de master. Dit is de stap die mensen het vaakst missen. Staat TradingView op subaccount A en de copier op subaccount B, dan zie je in TradingView een fill en gebeurt er in de copier niets.
8. Start het cluster pas als deze koppeling klopt.

### Paper Trading van TradingView is iets anders

TradingView heeft een eigen oefenmodus, vaak Paper Trading genoemd. Dat is een simulator van TradingView. Orders daar komen niet aan op Tradovate. Deze copier ziet ze niet.

Wil je oefenen mét de copier, dan gebruik je het **demo-account van Tradovate**, zowel in dit programma als in de brokerkoppeling van TradingView.

### Wat voor orders vanuit de grafiek meekomen

| Wat jij in TradingView doet | Wat de copier doet |
| --- | --- |
| Market kopen of verkopen, en hij vult | Slave krijgt meteen een market order voor het positieverschil × multiplier. |
| Limiet die nog niet vult | Niets. De slave blijft staan tot er een fill is. |
| Limiet die deels vult | Slave krijgt alleen het gevulde stuk. Zie hoofdstuk 17. |
| Stop of target die later vult | Op het moment van de fill verandert de masterpositie, en de slave volgt met een market order. |
| Order intrekken voordat hij vult | Niets. Er was geen positieverandering. |
| Alleen een alert, een pijl, of een Pine-melding | Niets, tenzij die alert zelf een echte order op het Tradovate-masteraccount plaatst. Een webhook-URL naar dit programma bestaat niet. |
| Order op een ander TradingView-account dan de master | Niets. |

Een strategie of indicator kopieert dus alleen mee als hij via de Tradovate-brokerkoppeling echt een order op de master zet én die order vult.

### Prijsverschil tussen master en slave

De slave-order is een market order, een fractie van een seconde later. De prijs kan daardoor iets anders zijn dan jouw fill in TradingView. Dat verschil is slippage. De kolom Latency laat zien hoe lang de opdracht duurde, niet hoeveel ticks de prijs verschoof.

### Brackets, targets en stops

Zet je in TradingView een bracket (entry plus target plus stop), dan liggen target en stop op de master. De slaves krijgen die rustende orders niet. Ze volgen op het moment dat de bracket de masterpositie verandert:

- entry vult → slaves openen mee;
- target vult en de master gaat naar 0 → slaves krijgen een market order terug naar 0;
- stop vult → hetzelfde;
- je schuift de stop op de grafiek → er gebeurt niets op de slave, tot die stop echt vult.

Wil je dat een slave een eigen stop heeft terwijl de master-stop nog niet geraakt is, dan zet je die stop zelf op het slave-account. Deze copier doet dat niet.

---

## 16. Wat er tijdens een trade stap voor stap gebeurt

1. Tradovate stuurt een positiebericht: dit account, dit contract, nieuwe netto stand.
2. Het bericht hoort bij de master. Berichten van een slave werken de tabel bij, maar starten geen nieuwe copy.
3. De log krijgt een regel `Master MNQZ5 0 → 1`.
4. Voor elke slave wordt het doel uitgerekend, zoals in hoofdstuk 12.
5. Is het verschil 0, dan gebeurt er niets. Dat zie je bij een kleine multiplier, of als de slave al op het doel staat.
6. Is het verschil groter dan **Max ordergrootte**, dan komt er een error en wordt er niet gestuurd.
7. Anders gaat er een market order weg. De log zegt `Order geplaatst Buy 2 MNQZ5 (×2) via Direct`.
8. Tradovate accepteert hem. De log zegt `Order geslaagd` plus het ordernummer. De latency is de tijd sinds stap 3.
9. Tradovate stuurt daarna de nieuwe slavepositie. De tabel werkt bij.

Verandert de master nog een keer terwijl stap 7 nog bezig is, dan wacht die tweede wijziging tot de eerste copy klaar is en wordt daarna meteen verwerkt. Hij wordt niet weggegooid.

---

## 17. Foutafhandeling

Dit hoofdstuk is de naslag voor “er ging iets mis”. Per situatie: wat jij ziet, wat het programma doet, en wat jij daarna doet.

### De master-order vult helemaal niet

Een limiet of stop die blijft liggen, verandert de positie niet. Slaves doen niets. Er komt geen logregel `Master … → …`. Dat is het gewenste gedrag.

Jij hoeft niets te doen. Trek je de order in, dan blijft alles zoals het was.

### De master vult maar een deel

Stel: limiet van 4, er vult eerst 1.

De positie gaat van 0 naar 1. De slaves krijgen alleen dat ene contract, maal de multiplier, afgerond. In de log staat `Master … 0 → 1` en daarna de slave-orders.

Vult later nog 3, dan komt er een tweede ronde voor het nieuwe verschil.

Annuleer je de overige 3, dan blijft de slave op het deel dat al gevuld was. Het geannuleerde stuk wordt niet nagekomen. De slave wordt ook niet automatisch teruggezet naar 0. Wil je dat wel, sluit dan de masterpositie terwijl het cluster nog draait. De slaves volgen die sluiting.

### De master-order wordt geweigerd

De positie blijft gelijk. Er gaat geen slave-order weg. De fout zie je in Tradovate of TradingView, niet als copy-fout in dit programma, want er was niets te kopiëren.

### De slave-order wordt geweigerd

De log wordt rood: `Order mislukt Buy 1 MNQZ5: …` met de tekst van Tradovate erachter. De accountkaart wordt rood, met diezelfde tekst.

Het programma probeert die slave voor dat symbool opnieuw zodra de master in dat symbool weer beweegt. Dat gebeurt tot 3 mislukkingen. Daarna slaat hij die combinatie over, tot de masterpositie in dat symbool opnieuw verandert. Die nieuwe beweging zet de teller terug en er wordt weer geprobeerd.

Een afgewezen order wordt niet eindeloos herhaald in dezelfde seconde. Dat beschermt je tegen een reeks dezelfde fout.

Veelvoorkomende teksten van Tradovate en wat ze betekenen:

| Tekst in de log | Wat er aan de hand is | Wat je doet |
| --- | --- | --- |
| Incorrect username or password | Gebruikersnaam of wachtwoord klopt niet, of je gebruikt het gewone wachtwoord terwijl er een API-wachtwoord is. | Bewerk het account en vul het juiste wachtwoord. Test opnieuw. |
| Tradovate vraagt een captcha | Tradovate vertrouwt deze login nog niet vanaf deze pc. | Log eerst een keer normaal in op de Tradovate-website met dezelfde gebruiker, en test daarna opnieuw. |
| Tradovate vraagt extra verificatie (p-ticket) | Zelfde soort extra controle. | Eerst inloggen via de Tradovate-site, daarna opnieuw testen. |
| Tradovate-status: TemporaryLocked of een andere status dan Active | Het account is vergrendeld of nog niet actief. | Los het op in Tradovate. De copier kan dat slot niet openen. |
| Gekozen Tradovate-account hoort niet bij deze login | Het subaccount in het menu past niet bij deze gebruiker. | Opnieuw testen en het juiste account kiezen. |
| Proxyverbinding mislukt … Er is niet direct verbonden. | De proxy is uit, het adres klopt niet, of de proxy weigert. | Zet de proxy aan, of zet **Proxy aan** uit als je rechtstreeks wilt. |
| Websocket-timeout / Websocket bleef wegvallen | De live verbinding kwam niet op, of viel vaker dan 6 keer weg. | Internet en proxy controleren. Cluster stoppen en opnieuw starten. |
| Order … geweigerd. Maximum is 20 | De copy was groter dan **Max ordergrootte**. | Verlaag de multiplier of verhoog het maximum, en laat de master nog een keer bewegen als je alsnog wilt kopiëren. |
| Contract … niet gevonden | Het symbool van de positie kon niet worden opgezocht. | Zeldzaam. Stop en start het cluster. Blijft het, dan is het contract niet meer handelbaar. |

### De slave-order wordt geaccepteerd maar vult niet helemaal

Een market order vult meestal in één keer. Gebeurt dat niet, dan geldt dit:

Het programma heeft “geaccepteerd” gezien en rekent 20 seconden alsof de slave al op de doelpositie staat. In die 20 seconden stuurt hij niet nog een order voor hetzelfde gat, anders zou je dubbel kunnen zitten.

Een slavepositie die daarna blijft achterlopen, wordt niet uit zichzelf opnieuw besteld. De volgende keer dat de **master** in dat symbool beweegt, rekent de copier het gat opnieuw mee en stuurt hij het ontbrekende stuk.

Kijk dus in de positietabel. Staat de slave na een trade structureel te laag of te hoog, en beweegt de master niet meer, dan is het verschil blijven liggen tot de volgende master-fill. Je kunt het handmatig corrigeren op de slave, of de master een klein rondje laten maken terwijl het cluster draait zodat de standen weer samenkomen. Wees daar voorzichtig mee op live.

### De verbinding valt weg midden in een trade

De accountkaart wordt oranje: opnieuw verbinden. Het programma probeert het tot 6 keer, met steeds iets langere pauze, tot maximaal ongeveer 15 seconden tussen pogingen.

Komt de verbinding terug, dan vergelijkt hij de nieuwe posities met wat hij daarvoor zag. Een fill die tijdens de onderbreking op de master binnenkwam, wordt dan alsnog als verschil gekopieerd.

Na 6 mislukte pogingen blijft de kaart rood: `Websocket bleef wegvallen.` Het cluster kopieert dan niet meer betrouwbaar. Stop het, controleer internet of proxy, en start opnieuw.

Het toegangsbewijs van Tradovate is ongeveer 80 tot 90 minuten geldig. Het programma verlengt dat ongeveer 15 minuten van tevoren, zonder dat jij iets doet. Lukt verlengen niet, dan logt het opnieuw in.

### Je herstart `npm start` terwijl er posities openstonden

De copier stopt op het moment dat het venster sluit. Tradovate sluit je posities niet.

Na een nieuwe start staat elk cluster op **Gestopt**. Druk je op Start met “gelijk trekken” uit, dan is de huidige stand de nieuwe nulmeting. Een master die al +2 was, wordt niet alsnog naar de slaves gekopieerd. Alleen trades na deze start tellen.

Wil je dat de slaves alsnog naar de master toe worden getrokken, zet dan vóór het starten “Bij start bestaande posities gelijk trekken” aan. Op live gaan er dan meteen market orders uit.

### Je drukt op Stop terwijl er een positie open is

De slaves volgen niets meer. Een target die daarna op de master vult, doet niets op de slaves. Beide kanten blijven open tot je ze zelf sluit.

### Twee clusters tegelijk

Dat mag, zolang een account maar in één draaiend cluster zit. Dezelfde kaart in twee clusters die allebei starten, geeft `Account overlap met draaiend cluster`.

### Demo en live door elkaar

De start weigert. Een demo-signaal kan daardoor geen live-order worden door een vergissing in het cluster.

### Je verwijdert een account dat nog in een cluster zit

De fout is: `Dit account zit nog in een cluster. Verwijder het cluster eerst.` De kaart blijft bestaan.

### Het logboek zegt success, maar de positietabel klopt niet meteen

`Order geslaagd` betekent: Tradovate heeft de opdracht aangenomen. De tabel wacht op het positiebericht dat daarna komt. Dat is meestal binnen een seconde. Blijft de tabel achter terwijl de log success zei, kijk dan in Tradovate zelf of de order daar gevuld, deels gevuld of alleen geaccepteerd is. Hoofdstuk 17, “niet helemaal gevuld”, beschrijft wat de copier daarna doet.

---

## 18. Wat het programma bewust niet doet

- Het kopieert geen rustende limieten, stops of brackets. Alleen positieveranderingen.
- Het sluit niets als je op Stop drukt.
- Het start geen cluster opnieuw na een herstart van de pc of van `npm start`.
- Het ontvangt geen TradingView-alerts of webhooks.
- Het handelt niet op TradingView Paper Trading.
- Het deelt één verbinding per Tradovate-login, en weigert twee kaarten die naar hetzelfde subaccount wijzen.
- Het stuurt geen order die groter is dan **Max ordergrootte**.
- Het blijft een slave niet eindeloos opnieuw proberen na drie fouten op hetzelfde symbool, tot de master weer beweegt.
- Het laat een kapotte proxy niet stilletjes direct naar buiten gaan.

---

## 19. Veilig werken

- Oefen de hele testrit van hoofdstuk 14 op demo voordat een account op Live staat.
- Een live start vraagt een extra bevestiging. Lees hem.
- Houd **Max ordergrootte** laag tot je de multiplier vertrouwt.
- “Gelijk trekken” op live kan meteen een grote market order zijn. Laat het uit tenzij je die orders echt wilt.
- Stop het cluster voordat je een account of cluster wijzigt.
- Sluit posities terwijl het cluster nog draait, als de slaves moeten meesluiten.
- `data\accounts.json` bevat wachtwoorden in leesbare tekst. Deel die map niet, en zet hem niet op een gedeelde schijf. Het bestand staat in `.gitignore`, zodat het niet per ongeluk in git hoort.
- Het dashboard is alleen bereikbaar op deze pc (`127.0.0.1`).

---

## 20. Problemen oplossen

| Wat je ziet | Oorzaak | Oplossing |
| --- | --- | --- |
| Browser: kan de site niet bereiken | Het programma draait niet. | PowerShell in de projectmap, `npm start`, venster open laten, daarna http://127.0.0.1:3000 |
| Je opende `index.html` met dubbelklik | Er is dan geen server. | Gebruik het adres hierboven terwijl `npm start` draait. |
| `npm wordt niet herkend` | Node.js ontbreekt. | Installeer Node.js 18 of nieuwer en open PowerShell opnieuw. |
| Bolletje “Server weg” | De pagina was open terwijl de server stopte. | `npm start` en de pagina verversen. |
| Verbinding testen faalt met username/password | Verkeerde login, of demo-key op live. | Hoofdstuk 7 en 8 nalopen. Omgeving moet bij de key horen. |
| Captcha of p-ticket | Tradovate wil een gewone login eerst. | Inloggen op de Tradovate-site, daarna opnieuw testen. |
| Test lukt, maar een trade in TradingView kopieert niet | TradingView staat op Paper Trading, of op een ander subaccount dan de master. | Hoofdstuk 15. Cluster moet op **Live** (gestart) staan. |
| Alleen een deel van de limiet is gekopieerd | Alleen het gevulde deel telt. | Hoofdstuk 17. De rest volgt als die ook vult. |
| Slave blijft achter na een rare fill | De automatische inhaal wacht op de volgende master-beweging. | Positietabel vergelijken met Tradovate. Zo nodig handmatig rechtzetten. |
| Rode kaart “maximum” | Copy groter dan het maximum. | Maximum of multiplier aanpassen. Cluster was gestopt nodig om te bewerken. |
| Proxy-fout terwijl je direct wilt | **Proxy aan** staat aan. | Schakelaar uit, opslaan. |
| Je wilt direct, maar er staat een URL | De URL wordt genegeerd zolang de schakelaar uit is. | Niets aan de hand. De kaart hoort **Direct** te zeggen. |
| Cluster start niet, demo/live | De kaarten hebben verschillende omgevingen. | Alle kaarten in het cluster op demo, of allemaal op live. |
| Bewerk doet niets nuttigs / fout over stoppen | Het cluster draait. | Eerst **Stop**. |
| Na herstart van de pc kopieert hij niet | Clusters starten niet vanzelf. | `npm start`, browser openen, opnieuw op **Start**. |

---

## 21. Dagelijks gebruik, korte lijst

1. Pc aan. PowerShell in `C:\Users\strij\Trade copier`.
2. `npm start`. Venster open laten.
3. Browser: http://127.0.0.1:3000
4. Kijk of het bolletje groen is: Server verbonden.
5. Druk bij het cluster op **Start**. Wacht op de groene regel dat het cluster gestart is.
6. Handel op de master, in Tradovate of in TradingView dat aan die master hangt.
7. Houd Live Monitor in de gaten. Rode regels eerst lezen voordat je doorgaat.
8. Aan het eind: posities sluiten terwijl het cluster nog aanstaat, daarna **Stop**, daarna het PowerShell-venster sluiten.

---

## 22. Waar de gegevens staan

| Bestand of map | Inhoud |
| --- | --- |
| `data\accounts.json` | Accounts, inclusief wachtwoorden en secrets. |
| `data\clusters.json` | Clusters, masters, slaves, multipliers. Geen wachtwoorden. |
| `data\trades.json` | Fills, sluitingen en dag-P&L per account. Geen wachtwoorden. |
| Live Monitor-log | Alleen in het geheugen. Weg na **Wis** of na het stoppen van het programma. |
| `npm start` | Moet draaien, anders is de pagina dood en kopieert er niets. |

---

## 23. Analytics & Multi-Challenge Tracker

Dit scherm is bedoeld als je meerdere challenges tegelijk volgt, tot een stuk of tien.

1. Ga naar **05 Analytics & Multi-Challenge Tracker**.
2. Het programma leest bij Tradovate het saldo, de fills, de open posities en de werkende orders. Die fills en sluitingen worden lokaal bewaard in `data\trades.json`.
3. Bovenaan staat de dagwinst van alle accounts bij elkaar, en hoeveel accounts vandaag al een trade hebben gemaakt.
4. Elke tegel is één account.
   - Groen **Klaar voor trade**: vandaag nog 0 trades.
   - Rood **1 Trade gemaakt - Knoppen vast!**: vandaag 1 of meer trades, of er staat nu een positie open.
   - **Target** loopt naar $1.250, tenzij je op Challenges een ander winstdoel hebt opgeslagen.
   - **Drawdown buffer** is wat er nog over is van $1.000 max verlies, of van de max drawdown die je zelf hebt ingevuld. Zonder startbalans is dat een schatting.
   - Een gele consistency-regel verschijnt zodra er minstens twee dagen zijn en de beste dag meer dan 50% van de totale winst is.
   - De safety-regel onderaan wordt geel zolang er een open positie of een rustende limit/stop in het orderboek staat.
5. **Vernieuwen** haalt de stand meteen opnieuw op. Het scherm doet dat ook zelf, ongeveer elke 20 seconden, zolang je op dit tabblad blijft.
6. De tabel **Dagelijks historie** toont per datum de P&L en het aantal trades van elk account.

Een draaiend cluster wordt niet onderbroken: als die Tradovate-login al verbonden is, gebruikt Analytics die sessie. De status op dit scherm verandert niet of een account op Challenges op gehaald staat. Dat beslis je daar zelf.
