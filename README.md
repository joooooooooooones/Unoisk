# Unoisk 🃏

UNO for hele familien – hver spiller på sin egen telefon. 2–10 spillere (lavet til 6).

Én opretter et spil og får en kode på 4 bogstaver. De andre åbner siden, skriver deres navn og koden – så er I i gang. Telefonerne snakker direkte sammen (WebRTC via [PeerJS](https://peerjs.com)), så der skal ikke køre nogen server. Siden er bare statiske filer.

## Få den på nettet (GitHub Pages)

1. Gå til repoets **Settings → Pages**.
2. Under **Build and deployment** vælg **Deploy from a branch**, repoets hovedbranch (lige nu `claude/brave-wozniak-qllu6v`) og mappe `/ (root)`. Tryk **Save**.
3. Efter et minut ligger spillet på `https://<dit-brugernavn>.github.io/<repo-navn>/`.

> GitHub Pages er gratis for offentlige repos. Er repoet privat, kræver Pages et betalt GitHub-abonnement – ellers kan mappen lægges på fx Netlify eller Cloudflare Pages (træk mappen ind, ingen opsætning).

**Spil her: https://joooooooooooones.github.io/Unoisk/**

## Installér som app på Android

1. Åbn linket i **Chrome**.
2. Tryk på knappen **📲 Installér som app** på forsiden – eller tryk **⋮** øverst til højre og vælg **Installer app**.
3. Unoisk ligger nu i app-skuffen med sit eget ikon og åbner i fuld skærm.

På iPhone: åbn linket i Safari, tryk **Del** og vælg **Føj til hjemmeskærm**.

Appen gemmer sig selv på telefonen, så den også starter uden internet. Åbn den bare én gang med internet først (og igen engang imellem, så den bliver opdateret).

## Spil uden internet (samme Wi-Fi)

I sommerhuset, i bilen eller i flyet: telefonerne kan snakke direkte sammen over det samme Wi-Fi – uden internet og uden nogen server. Det kan være et almindeligt Wi-Fi uden internetforbindelse, eller én telefons hotspot (mobildata behøver ikke være slået til).

1. **Værten** trykker **Opret spil** under *uden internet – på samme Wi-Fi*. Lobbyen viser en QR-kode.
2. **Den nye spiller** trykker **📷 Scan og deltag** og scanner værtens QR-kode. Så viser spillerens telefon sin egen QR-kode.
3. **Værten** trykker **📷 Scan spiller** og scanner spillerens kode. Så er spilleren med, og der kommer en ny QR-kode frem til den næste.

Har spilleren allerede åbnet appen én gang, kan værtens QR-kode også scannes med telefonens almindelige kamera. Virker kameraet ikke, kan koden deles som tekst (fx sms) under QR-koden.

Godt at vide uden internet:

- Mister en spiller forbindelsen (eller genindlæser værten siden), er kortene og pointene der stadig – man skal bare parres igen: værten trykker **📶** øverst, og spilleren scanner koden som før.
- Det virker ikke på netværk, hvor enhederne ikke må se hinanden (fx nogle gæste-netværk på hoteller). Brug så én telefons hotspot.
- Laver værtens telefon selv hotspottet, og vil forbindelsen ikke komme, så lad en af de andre telefoner lave hotspot i stedet.

## Sådan spiller I

- Skriv dit navn og vælg en figur (🦊 🐻 🦄 …), så man kan kende hinanden.
- **Værten** (den der opretter spillet) trykker **Opret nyt spil**. De andre **scanner QR-koden** i lobbyen med kameraet – eller skriver koden på 4 bogstaver og trykker **Deltag**. **Del link** sender linket via fx Messenger.
- Er I få, kan værten trykke **🤖 Tilføj computerspiller**. Man kan også øve sig alene mod computeren.
- Værten vælger **spillets længde**: 100, 200, 300 eller 500 point (officielt). Når alle er med, trykker værten **Start spil**.
- Læg et kort med samme farve, tal eller symbol. Kort, der kan lægges, lyser op. Kan du ikke lægge noget, så tryk på bunken.
- Tryk **UNO!** når du har to kort tilbage (eller lige efter du har lagt det næstsidste). Lægger du flere ens ned til ét kort, kan du trykke UNO! i din tur, før du lægger. Glemmer du det, kan de andre trykke **Fang!**, og så trækker du 2 kort.
- Den første uden kort vinder runden og får point for de andres kort. Slutter runden på et +2/+4, trækker næste spiller kortene først, og de tæller med (officiel regel). Først til pointmålet vinder hele spillet.
- Tryk på **koden** øverst for at vise QR-koden igen – nye spillere kommer med fra næste runde.
- Kortene siger lyd, når de lægges og trækkes, og der lyder et lille ding, når det er din tur. Tryk på **🔊** øverst for at slå lyden fra – det huskes på telefonen.

Husregler, som værten kan slå til i lobbyen:

- **Stabling** – +2 og +4 kan lægges oven på hinanden, og den der ikke kan, trækker det hele.
- **Træk til du kan** – bliv ved med at trække, indtil du får et kort, der passer.
- **Læg flere ens** (slået til som standard) – har du flere kort med samme tal eller symbol, må du lægge dem på én gang uanset farve, når det første passer. Det sidste kort bestemmer farven. To +2 giver 4 kort, to spring over springer to spillere over.

Godt at vide:

- Værtens telefon *er* spillet, så den skal holde siden åben. Appen prøver at holde skærmen tændt.
- Mister en spiller forbindelsen (skærmen slukker, siden lukkes), kommer de automatisk tilbage med de samme kort, når de åbner siden igen. Det gælder også værten.
- Er nogens telefon død, kan værten trykke **Fjern** ved spilleren, så spillet kan fortsætte. Pointene huskes, hvis spilleren kommer tilbage.
- Nye spillere kan komme med mellem to runder.

## Udvikling

Ingen build-trin – bare HTML, CSS og JavaScript-moduler.

```sh
npm start   # starter en lokal server på http://localhost:8080
npm test    # regler, point, vært, computerspillere og QR-koderne til spil uden internet (kræver Node 20+)
```

Åbn `http://localhost:8080/?lokal` i flere faner for at teste uden internet: så snakker fanerne sammen via `BroadcastChannel` i stedet for WebRTC.

| Fil | Indhold |
| --- | --- |
| `js/game.js` | Spillereglerne (ren logik, ingen DOM) |
| `js/host.js` | Værten: spillerliste, point, pointmål, computerspillernes tempo, og hvad hver spiller må se |
| `js/bot.js` | Computerspillernes strategi (ser kun det, en spiller må se) |
| `js/avatars.js` | Figurer, man kan vælge |
| `js/net.js` | Forbindelser – PeerJS eller lokal testtilstand |
| `js/lan.js` | Spil uden internet: WebRTC direkte over Wi-Fi, parret med små QR-koder |
| `js/scan.js` | QR-scanner med kameraet (BarcodeDetector eller jsQR) |
| `js/app.js` | Brugerfladen |
| `sw.js`, `manifest.webmanifest`, `icons/` | Gør spillet installerbart som app |
| `test/golden.test.js` | Golden master: faste, seedede spil skal give samme resultat (opdatér med `UPDATE_GOLDEN=1 npm test` ved en bevidst regelændring) |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 (MIT-licens) |
| `vendor/qrcode.js` | qrcode-generator 1.4.4 (MIT-licens) |
| `vendor/jsQR.min.js` | jsQR 1.4.0, minificeret (Apache-2.0) – læser QR-koder på iPhone |
| `vendor/fonts/` | Nunito (SIL Open Font License) |
