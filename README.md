# Unoisk 🃏

UNO for hele familien – hver spiller på sin egen telefon. 2–10 spillere (lavet til 6).

Én opretter et spil og får en kode på 4 bogstaver. De andre åbner siden, skriver deres navn og koden – så er I i gang. Telefonerne snakker direkte sammen (WebRTC via [PeerJS](https://peerjs.com)), så der skal ikke køre nogen server. Siden er bare statiske filer.

## Få den på nettet (GitHub Pages)

1. Gå til repoets **Settings → Pages**.
2. Under **Build and deployment** vælg **Deploy from a branch**, branch `main` og mappe `/ (root)`. Tryk **Save**.
3. Efter et minut ligger spillet på `https://<dit-brugernavn>.github.io/<repo-navn>/`.

> GitHub Pages er gratis for offentlige repos. Er repoet privat, kræver Pages et betalt GitHub-abonnement – ellers kan mappen lægges på fx Netlify eller Cloudflare Pages (træk mappen ind, ingen opsætning).

**Spil her: https://joooooooooooones.github.io/Unoisk/**

## Installér som app på Android

1. Åbn linket i **Chrome**.
2. Tryk på knappen **📲 Installér som app** på forsiden – eller tryk **⋮** øverst til højre og vælg **Installer app**.
3. Unoisk ligger nu i app-skuffen med sit eget ikon og åbner i fuld skærm.

På iPhone: åbn linket i Safari, tryk **Del** og vælg **Føj til hjemmeskærm**.

## Sådan spiller I

- **Værten** (den der opretter spillet) trykker **Opret nyt spil** og deler koden eller linket (**Del link**).
- De andre trykker **Deltag** med koden. Når alle er med, trykker værten **Start spil**.
- Læg et kort med samme farve, tal eller symbol. Kort, der kan lægges, lyser op. Kan du ikke lægge noget, så tryk på bunken.
- Tryk **UNO!** når du har to kort tilbage (eller lige efter du har lagt det næstsidste). Glemmer du det, kan de andre trykke **Fang!**, og så trækker du 2 kort.
- Den første uden kort vinder runden og får point for de andres kort. Først til 500 point vinder.

Husregler, som værten kan slå til i lobbyen:

- **Stabling** – +2 og +4 kan lægges oven på hinanden, og den der ikke kan, trækker det hele.
- **Træk til du kan** – bliv ved med at trække, indtil du får et kort, der passer.

Godt at vide:

- Værtens telefon *er* spillet, så den skal holde siden åben. Appen prøver at holde skærmen tændt.
- Mister en spiller forbindelsen (skærmen slukker, siden lukkes), kommer de automatisk tilbage med de samme kort, når de åbner siden igen. Det gælder også værten.
- Er nogens telefon død, kan værten trykke **Fjern** ved spilleren, så spillet kan fortsætte.
- Nye spillere kan komme med mellem to runder.

## Udvikling

Ingen build-trin – bare HTML, CSS og JavaScript-moduler.

```sh
npm start   # starter en lokal server på http://localhost:8080
npm test    # kører testene af spillereglerne (kræver Node 20+)
```

Åbn `http://localhost:8080/?lokal` i flere faner for at teste uden internet: så snakker fanerne sammen via `BroadcastChannel` i stedet for WebRTC.

| Fil | Indhold |
| --- | --- |
| `js/game.js` | Spillereglerne (ren logik, ingen DOM) |
| `js/host.js` | Værten: spillerliste, point, og hvad hver spiller må se |
| `js/net.js` | Forbindelser – PeerJS eller lokal testtilstand |
| `js/app.js` | Brugerfladen |
| `sw.js`, `manifest.webmanifest`, `icons/` | Gør spillet installerbart som app |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 (MIT-licens) |
