# Narco City Anwaltsportal — Backend + Frontend

Ein einziger Node.js-Dienst, der sowohl die Oberfläche (`public/index.html`)
als auch die API (`/api/*`) ausliefert. Alle Anwälte und Akten liegen in
einer echten, gemeinsam genutzten Datenbank (SQLite) — jeder, der die Seite
öffnet, sieht denselben aktuellen Stand.

## Lokal testen

```bash
npm install
cp .env.example .env   # optional, Standardwerte funktionieren auch so
npm start
```

Dann `http://localhost:4000` öffnen. Beim allerersten Start wird automatisch
ein Administrator-Konto angelegt:

- Benutzername: `admin`
- Passwort: `admin123` (bzw. der Wert von `ADMIN_PASSWORD`, falls gesetzt)

**Bitte dieses Passwort direkt nach dem ersten Login im Profilbereich
ändern.**

## Kostenlos online stellen (Render.com)

Render bietet einen kostenlosen Web-Service-Plan ohne Kreditkarte. So geht's:

1. **GitHub-Konto** (falls noch nicht vorhanden): auf [github.com](https://github.com)
   kostenlos registrieren.
2. **Neues Repository anlegen**: auf GitHub oben rechts auf "+" → "New
   repository" → einen Namen vergeben (z. B. `anwaltsportal`) → "Create
   repository".
3. **Dateien hochladen**: im neuen, leeren Repository auf "uploading an
   existing file" klicken und den kompletten Inhalt dieses Ordners
   (`backend/`, also `server.js`, `database.js`, `public/`, `package.json`
   usw.) per Drag&Drop hineinziehen, dann "Commit changes".
4. **Render-Konto anlegen**: auf [render.com](https://render.com) kostenlos
   registrieren (Anmeldung mit dem GitHub-Konto geht am schnellsten).
5. **Neuer Web-Dienst**: im Render-Dashboard auf "New +" → "Web Service" →
   das eben erstellte GitHub-Repository auswählen.
6. Render erkennt die Datei `render.yaml` in diesem Ordner automatisch und
   schlägt die richtigen Einstellungen vor (Node, `npm install`,
   `npm start`, kostenloser Plan). Bei "ADMIN_PASSWORD" ein eigenes,
   sicheres Passwort für den ersten Admin-Zugang eintragen.
7. Auf "Create Web Service" bzw. "Apply" klicken. Nach ein bis zwei Minuten
   ist die Seite unter der von Render vergebenen Adresse
   (`https://<name>.onrender.com`) live und mit jedem beliebigen Link
   erreichbar — auch ohne Claude-Konto.

## Wichtiger Hinweis zum kostenlosen Plan

Auf dem **kostenlosen** Render-Plan gibt es keine dauerhafte Festplatte: die
SQLite-Datenbank-Datei kann bei einem Neu-Deploy oder wenn Render den
Dienst intern verschiebt zurückgesetzt werden (alle Anwälte/Akten wären
dann weg). Für ein Hobby-/Testprojekt reicht das meistens aus, solange
selten neu deployt wird. Für echte Dauerhaftigkeit gibt es zwei Wege:

- **Render-Disk hinzufügen** (kostenpflichtig, ab ca. 7 $/Monat für den
  "Starter"-Plan): im Dashboard des Dienstes unter "Disks" eine Festplatte
  anlegen, z. B. unter `/var/data` einhängen, und die Umgebungsvariable
  `DB_PATH=/var/data/anwaltsportal.sqlite` setzen.
- Oder gelegentlich die Datenbank-Datei über einen anderen kostenlosen
  Hosting-Anbieter mit dauerhaftem Speicher laufen lassen (z. B. eine VM
  mit Docker) — dafür gerne noch einmal melden, dann helfe ich beim
  Umzug.

## Räume: gemeinsam mit anderen Anwälten an einer Akte arbeiten

Jede Akte öffnet sich (über "Meine Akten" → Akte anklicken) mit einem
"Team"-Bereich. Dort kann der zuständige Anwalt einen Kollegen per
Benutzername zur Akte hinzufügen — ab sofort sieht dieser Kollege die Akte
ebenfalls in seinen "Meine Akten" und kann dort Dokumente anlegen und
einsehen, genau wie der zuständige Anwalt. Ein hinzugefügtes Team-Mitglied
kann den Raum über "Verlassen" jederzeit selbst wieder verlassen; der
zuständige Anwalt kann Team-Mitglieder zusätzlich über "Entfernen"
herausnehmen. Der zuständige Anwalt selbst kann über diese Funktion nicht
entfernt werden.

## Struktur

```
backend/
  server.js          Express-Server: liefert die API (/api/*) und public/index.html aus
  database.js         SQLite-Anbindung, Tabellen, Erstbefüllung
  auth.js              Login/Sessions/Passwort-Hashing (bcrypt)
  documentTypes.js     Liste der 8 Dokumenttypen (Vorlagen-Seed + Validierung)
  public/index.html    Die komplette Oberfläche (ein einziges HTML-Dokument)
  uploads/              Hochgeladene Vorlagen-Dateien (wird automatisch angelegt)
```

## Sicherheitshinweise

- Passwörter und Einmalpasswörter werden ausschließlich als bcrypt-Hash
  gespeichert — niemals im Klartext. Ein Administrator kann zu keinem
  Zeitpunkt das persönliche Passwort eines Anwalts einsehen.
- Rollen- und Zugriffsprüfungen laufen serverseitig (nicht nur im
  Frontend).
- Der KI-Assistent bereitet nur einen kopierbaren ChatGPT-Prompt vor — es
  gibt keine ChatGPT-Anbindung, keinen API-Key im Frontend und es werden
  keine ChatGPT-Zugangsdaten abgefragt oder gespeichert.
