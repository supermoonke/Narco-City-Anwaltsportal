/**
 * server.js
 * ----------------------------------------------------------------------
 * Express-Backend für das Narco City Anwaltsportal.
 *
 * Dient sowohl die REST-API unter /api/* als auch das fertige Frontend
 * (ein einzelnes, in sich geschlossenes HTML-Dokument unter /public) aus
 * einem einzigen Prozess — für das Deployment reicht also ein einziger
 * Web-Dienst.
 * ----------------------------------------------------------------------
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const multer = require("multer");

const { initDb } = require("./database");
const authLib = require("./auth");
const { DOCUMENT_TYPES, CASE_STATUS_VALUES } = require("./documentTypes");

const DOCUMENT_TYPE_IDS = DOCUMENT_TYPES.map((t) => t.id);

const app = express();
const db = initDb();

const PORT = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === "production";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set("trust proxy", 1); // nötig, damit "secure" Cookies hinter einem Hosting-Proxy (Render, Railway, …) funktionieren

// Nur nötig, wenn Frontend und Backend auf unterschiedlichen Origins laufen
// (z. B. lokale Entwicklung mit Live-Server). Im Produktions-Deployment wird
// das Frontend von genau diesem Server mitausgeliefert, sodass CORS dort
// keine Rolle spielt.
if (process.env.FRONTEND_ORIGIN) {
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
}

app.use(express.json());
app.use(session({
  name: "ncap_sid",
  secret: process.env.SESSION_SECRET || "dev-only-secret-bitte-in-produktion-per-umgebungsvariable-ersetzen",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8 // 8 Stunden
  }
  // Hinweis: Der In-Memory-Session-Store von express-session reicht für einen
  // einzelnen Server-Prozess (wie hier) aus, geht aber bei jedem Neustart
  // verloren — alle Nutzer müssten sich dann erneut anmelden. Für einen
  // Dienst mit mehreren Instanzen wäre ein externer Store nötig.
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: function (req, file, cb) {
      var ext = path.extname(file.originalname || "").slice(0, 20);
      cb(null, crypto.randomBytes(16).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at
  };
}

function caseCollaborators(caseId) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName
    FROM case_collaborators cc
    JOIN users u ON u.id = cc.user_id
    WHERE cc.case_id = ?
    ORDER BY u.display_name
  `).all(caseId);
}

function publicCase(row) {
  const owner = db.prepare("SELECT username, display_name AS displayName FROM users WHERE id = ?").get(row.anwalt_id);
  return Object.assign({}, row, {
    collaborators: caseCollaborators(row.id),
    ownerUsername: owner ? owner.username : null,
    ownerDisplayName: owner ? owner.displayName : null
  });
}

/** Zugriff auf eine Akte: Admin, der zuständige Anwalt, oder ein Mitglied
 * des "Raums" (case_collaborators) dieser Akte. */
function hasCaseAccess(row, session) {
  if (session.role === "admin") return true;
  if (row.anwalt_id === session.userId) return true;
  const collab = db.prepare("SELECT 1 FROM case_collaborators WHERE case_id = ? AND user_id = ?").get(row.id, session.userId);
  return !!collab;
}

function publicTemplate(row) {
  return {
    id: row.id,
    typ: row.typ,
    name: row.name,
    aufbau: JSON.parse(row.aufbau_json),
    dateiname: row.dateiname,
    uploaded: !!row.uploaded
  };
}

/* ======================================================================
 * AUTH
 * ====================================================================== */

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Benutzername und Passwort erforderlich." });
  }
  try {
    const { user, requiresPasswordSetup } = authLib.authenticate(db, username, password);
    req.session.userId = user.id;
    req.session.role = user.role;
    // Solange die Ersteinrichtung aussteht, wird die Session bewusst NICHT
    // als vollwertig angemeldet behandelt – requireAuth-geschützte Routen
    // (außer setup-password) bleiben bis dahin gesperrt.
    req.session.pendingSetup = requiresPasswordSetup;
    res.json({ user: publicUser(user), requiresPasswordSetup });
  } catch (err) {
    if (err instanceof authLib.AuthError) return res.status(401).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Unerwarteter Fehler bei der Anmeldung." });
  }
});

app.post("/api/auth/setup-password", (req, res) => {
  if (!req.session || !req.session.userId || !req.session.pendingSetup) {
    return res.status(401).json({ error: "Keine ausstehende Ersteinrichtung." });
  }
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Neues Passwort muss mindestens 6 Zeichen haben." });
  }
  authLib.completePasswordSetup(db, req.session.userId, newPassword);
  req.session.pendingSetup = false;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  res.json({ user: publicUser(row) });
});

app.post("/api/auth/change-password", authLib.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Bitte aktuelles und neues Passwort (mind. 6 Zeichen) angeben." });
  }
  try {
    authLib.changeOwnPassword(db, req.session.userId, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof authLib.AuthError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Unerwarteter Fehler." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", authLib.requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!row) return res.status(404).json({ error: "Nutzer nicht gefunden." });
  res.json({ user: publicUser(row) });
});

/* ======================================================================
 * BENUTZERVERWALTUNG (nur Administrator)
 * ====================================================================== */

app.get("/api/users", authLib.requireAuth, authLib.requireRole("admin"), (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY display_name").all();
  res.json({ users: rows.map(publicUser) });
});

app.post("/api/users", authLib.requireAuth, authLib.requireRole("admin"), (req, res) => {
  const { username, displayName, role } = req.body || {};
  if (!username || !displayName || !["admin", "anwalt"].includes(role)) {
    return res.status(400).json({ error: "Benutzername, Anzeigename und gültige Rolle erforderlich." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Dieser Benutzername ist bereits vergeben." });

  const id = "u_" + crypto.randomBytes(8).toString("hex");
  const otp = authLib.generateOtp();
  db.prepare(`
    INSERT INTO users (id, username, display_name, role, status, password_hash, must_change_password, otp_hash)
    VALUES (?, ?, ?, ?, 'aktiv', NULL, 1, ?)
  `).run(id, username, displayName, role, authLib.hashSecret(otp));

  // Das Einmalpasswort wird ausschließlich hier, in dieser einen Response, im
  // Klartext zurückgegeben. Ab jetzt existiert nur noch der bcrypt-Hash.
  res.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)), otp });
});

app.patch("/api/users/:id", authLib.requireAuth, authLib.requireRole("admin"), (req, res) => {
  const { displayName, role, status } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Nutzer nicht gefunden." });
  if (user.id === req.session.userId && status === "inaktiv") {
    return res.status(400).json({ error: "Das eigene Konto kann nicht deaktiviert werden." });
  }
  db.prepare(`
    UPDATE users SET
      display_name = COALESCE(?, display_name),
      role = COALESCE(?, role),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(displayName || null, role || null, status || null, req.params.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)) });
});

app.post("/api/users/:id/otp", authLib.requireAuth, authLib.requireRole("admin"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Nutzer nicht gefunden." });
  const otp = authLib.generateOtp();
  db.prepare(`
    UPDATE users SET otp_hash = ?, password_hash = NULL, must_change_password = 1 WHERE id = ?
  `).run(authLib.hashSecret(otp), req.params.id);
  res.json({ otp });
});

/* ======================================================================
 * AKTEN
 * ====================================================================== */

app.post("/api/cases", authLib.requireAuth, authLib.requireRole("anwalt"), (req, res) => {
  const { aktennummer, mandant, beschreibung } = req.body || {};
  if (!aktennummer || !String(aktennummer).trim() || !mandant || !String(mandant).trim()) {
    return res.status(400).json({ error: "Aktennummer und Mandant sind erforderlich." });
  }
  const id = "c_" + crypto.randomBytes(8).toString("hex");
  try {
    db.prepare(`
      INSERT INTO cases (id, aktennummer, mandant, status, anwalt_id, beschreibung)
      VALUES (?, ?, ?, 'offen', ?, ?)
    `).run(id, String(aktennummer).trim(), String(mandant).trim(), req.session.userId, beschreibung ? String(beschreibung).trim() : null);
  } catch (err) {
    if (/UNIQUE/.test(err.message || "")) {
      return res.status(409).json({ error: "Diese Aktennummer ist bereits vergeben." });
    }
    console.error(err);
    return res.status(500).json({ error: "Akte konnte nicht erstellt werden." });
  }
  res.status(201).json({ case: publicCase(db.prepare("SELECT * FROM cases WHERE id = ?").get(id)) });
});

app.get("/api/cases", authLib.requireAuth, (req, res) => {
  var rows;
  if (req.session.role === "admin") {
    rows = db.prepare("SELECT * FROM cases ORDER BY created_at DESC").all();
  } else {
    rows = db.prepare(`
      SELECT * FROM cases
      WHERE anwalt_id = ?
         OR id IN (SELECT case_id FROM case_collaborators WHERE user_id = ?)
      ORDER BY created_at DESC
    `).all(req.session.userId, req.session.userId);
  }
  res.json({ cases: rows.map(publicCase) });
});

app.patch("/api/cases/:id", authLib.requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!CASE_STATUS_VALUES.includes(status)) {
    return res.status(400).json({ error: "Ungültiger Status." });
  }
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Akte nicht gefunden." });
  if (!hasCaseAccess(row, req.session)) {
    return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
  }
  db.prepare("UPDATE cases SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ case: publicCase(db.prepare("SELECT * FROM cases WHERE id = ?").get(req.params.id)) });
});

/* ------------------------------------------------------------------ *
 * "Räume": weitere Anwälte an einer Akte beteiligen, damit alle
 * Mitglieder dieselbe Akte samt Dokumenten sehen und bearbeiten können.
 * ------------------------------------------------------------------ */

app.post("/api/cases/:id/collaborators", authLib.requireAuth, authLib.requireRole("anwalt", "admin"), (req, res) => {
  const { username } = req.body || {};
  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: "Benutzername erforderlich." });
  }
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Akte nicht gefunden." });
  if (!hasCaseAccess(row, req.session)) {
    return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
  }

  const target = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim());
  if (!target) return res.status(404).json({ error: "Kein Konto mit diesem Benutzernamen gefunden." });
  if (target.role !== "anwalt") return res.status(400).json({ error: "Nur Anwälte können zu einer Akte hinzugefügt werden." });
  if (target.status !== "aktiv") return res.status(400).json({ error: "Dieses Konto ist deaktiviert." });
  if (target.id === row.anwalt_id) return res.status(409).json({ error: "Dieser Anwalt ist bereits der zuständige Anwalt dieser Akte." });

  const already = db.prepare("SELECT 1 FROM case_collaborators WHERE case_id = ? AND user_id = ?").get(row.id, target.id);
  if (already) return res.status(409).json({ error: "Dieser Anwalt ist bereits im Team dieser Akte." });

  db.prepare("INSERT INTO case_collaborators (case_id, user_id) VALUES (?, ?)").run(row.id, target.id);
  res.status(201).json({ case: publicCase(db.prepare("SELECT * FROM cases WHERE id = ?").get(row.id)) });
});

app.delete("/api/cases/:id/collaborators/:userId", authLib.requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Akte nicht gefunden." });
  if (req.params.userId === row.anwalt_id) {
    return res.status(400).json({ error: "Der zuständige Anwalt kann nicht aus dem Team entfernt werden." });
  }

  const isOwnerOrAdmin = req.session.role === "admin" || row.anwalt_id === req.session.userId;
  const isSelfLeaving = req.params.userId === req.session.userId;
  if (!isOwnerOrAdmin && !isSelfLeaving) {
    return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
  }

  db.prepare("DELETE FROM case_collaborators WHERE case_id = ? AND user_id = ?").run(row.id, req.params.userId);
  res.json({ case: publicCase(db.prepare("SELECT * FROM cases WHERE id = ?").get(row.id)) });
});

/* ======================================================================
 * DOKUMENTE
 * ====================================================================== */

app.get("/api/documents", authLib.requireAuth, (req, res) => {
  // Sichtbar sind: eigene Dokumente (auch ohne Akte) sowie alle Dokumente
  // in Akten, an denen man als zuständiger Anwalt oder Team-Mitglied
  // ("Raum") beteiligt ist — so sehen alle im Team denselben Stand.
  const rows = req.session.role === "admin"
    ? db.prepare("SELECT * FROM documents ORDER BY created_at DESC").all()
    : db.prepare(`
        SELECT DISTINCT d.* FROM documents d
        LEFT JOIN cases c ON c.id = d.case_id
        WHERE d.erstellt_von = ?
           OR c.anwalt_id = ?
           OR c.id IN (SELECT case_id FROM case_collaborators WHERE user_id = ?)
        ORDER BY d.created_at DESC
      `).all(req.session.userId, req.session.userId, req.session.userId);
  res.json({ documents: rows });
});

app.post("/api/documents", authLib.requireAuth, (req, res) => {
  const { typ, caseId, mandant, aktenzeichen, sachverhalt, argumentation, weitere, prompt } = req.body || {};
  if (!DOCUMENT_TYPE_IDS.includes(typ)) {
    return res.status(400).json({ error: "Unbekannter Dokumenttyp." });
  }
  if (!mandant || !String(mandant).trim() || !sachverhalt || !String(sachverhalt).trim()) {
    return res.status(400).json({ error: "Mandant und Sachverhalt sind erforderlich." });
  }
  var resolvedCaseId = null;
  if (caseId) {
    const caseRow = db.prepare("SELECT * FROM cases WHERE id = ?").get(caseId);
    if (!caseRow) return res.status(400).json({ error: "Akte nicht gefunden." });
    if (!hasCaseAccess(caseRow, req.session)) {
      return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
    }
    resolvedCaseId = caseRow.id;
  }

  const id = "d_" + crypto.randomBytes(8).toString("hex");
  db.prepare(`
    INSERT INTO documents (id, typ, case_id, mandant, aktenzeichen, sachverhalt, argumentation, weitere, prompt, erstellt_von)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, typ, resolvedCaseId,
    String(mandant).trim(), aktenzeichen ? String(aktenzeichen).trim() : null,
    String(sachverhalt).trim(), argumentation ? String(argumentation).trim() : "",
    weitere ? String(weitere).trim() : "", prompt ? String(prompt) : "",
    req.session.userId
  );
  res.status(201).json({ document: db.prepare("SELECT * FROM documents WHERE id = ?").get(id) });
});

/* ======================================================================
 * VORLAGEN
 * ====================================================================== */

app.get("/api/templates", authLib.requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM templates").all();
  res.json({ templates: rows.map(publicTemplate) });
});

app.post("/api/templates/:id/upload", authLib.requireAuth, authLib.requireRole("admin"), upload.single("file"), (req, res) => {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!row) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "Vorlage nicht gefunden." });
  }
  if (!req.file) return res.status(400).json({ error: "Keine Datei übermittelt." });

  // Alte Datei entfernen, falls schon eine hinterlegt war.
  if (row.stored_filename) {
    fs.unlink(path.join(UPLOAD_DIR, row.stored_filename), () => {});
  }

  db.prepare(`
    UPDATE templates SET dateiname = ?, stored_filename = ?, uploaded = 1 WHERE id = ?
  `).run(req.file.originalname, req.file.filename, req.params.id);

  res.json({ template: publicTemplate(db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id)) });
});

app.delete("/api/templates/:id/upload", authLib.requireAuth, authLib.requireRole("admin"), (req, res) => {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Vorlage nicht gefunden." });
  if (row.stored_filename) {
    fs.unlink(path.join(UPLOAD_DIR, row.stored_filename), () => {});
  }
  db.prepare("UPDATE templates SET dateiname = NULL, stored_filename = NULL, uploaded = 0 WHERE id = ?").run(req.params.id);
  res.json({ template: publicTemplate(db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id)) });
});

/* ======================================================================
 * FRONTEND (ein einzelnes, in sich geschlossenes HTML-Dokument)
 * ====================================================================== */

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Anwaltsportal läuft auf http://localhost:${PORT}`);
});
