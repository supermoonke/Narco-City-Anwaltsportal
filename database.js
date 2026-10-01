/**
 * database.js
 * ----------------------------------------------------------------------
 * SQLite-Anbindung für das Narco City Anwaltsportal.
 *
 * STATUS: Dieses Modul ist lauffähig, aber NICHT an das Frontend
 * angeschlossen. Das Frontend arbeitet aktuell mit einer localStorage-
 * Simulation (siehe /js/app.js, NCAP.db.*). Sobald server.js über die
 * Routen in /api/* bedient wird, ersetzt dieses Modul dort die
 * localStorage-Aufrufe 1:1 (gleiche Feldnamen, gleiche Struktur).
 *
 * Verwendet better-sqlite3 (synchron, einfach, ausreichend für den
 * Portal-Maßstab). Für den produktiven Einsatz: regelmäßige Backups
 * der .sqlite-Datei einplanen.
 * ----------------------------------------------------------------------
 */

const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const { DOCUMENT_TYPES } = require("./documentTypes");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "anwaltsportal.sqlite");
const BCRYPT_ROUNDS = 12;

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                  TEXT PRIMARY KEY,
      username            TEXT UNIQUE NOT NULL,
      display_name        TEXT NOT NULL,
      role                TEXT NOT NULL CHECK (role IN ('admin', 'anwalt')),
      status              TEXT NOT NULL CHECK (status IN ('aktiv', 'inaktiv')) DEFAULT 'aktiv',
      password_hash       TEXT,              -- bcrypt-Hash, NULL solange Einmalpasswort aktiv ist
      must_change_password INTEGER NOT NULL DEFAULT 1,
      otp_hash            TEXT,              -- bcrypt-Hash des Einmalpassworts, nie im Klartext gespeichert
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cases (
      id           TEXT PRIMARY KEY,
      aktennummer  TEXT UNIQUE NOT NULL,
      mandant      TEXT NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('offen', 'in_bearbeitung', 'abgeschlossen')) DEFAULT 'offen',
      anwalt_id    TEXT NOT NULL REFERENCES users(id),
      beschreibung TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id             TEXT PRIMARY KEY,
      typ            TEXT NOT NULL,
      case_id        TEXT REFERENCES cases(id),
      mandant        TEXT,
      aktenzeichen   TEXT,
      sachverhalt    TEXT,
      argumentation  TEXT,
      weitere        TEXT,
      prompt         TEXT,
      erstellt_von   TEXT NOT NULL REFERENCES users(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS case_collaborators (
      case_id    TEXT NOT NULL REFERENCES cases(id),
      user_id    TEXT NOT NULL REFERENCES users(id),
      added_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (case_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id              TEXT PRIMARY KEY,
      typ             TEXT NOT NULL,
      name            TEXT NOT NULL,
      aufbau_json     TEXT NOT NULL,   -- JSON-Array der Aufbau-Schritte
      dateiname       TEXT,            -- Original-Dateiname, nur zur Anzeige
      stored_filename TEXT,            -- tatsächlicher Dateiname auf der Festplatte (uploads/)
      uploaded        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_cases_anwalt ON cases(anwalt_id);
    CREATE INDEX IF NOT EXISTS idx_collab_user ON case_collaborators(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
    CREATE INDEX IF NOT EXISTS idx_documents_ersteller ON documents(erstellt_von);
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, display_name, role, status, password_hash, must_change_password, otp_hash)
      VALUES (@id, @username, @displayName, @role, @status, @passwordHash, @mustChangePassword, @otpHash)
    `);

    // Erster Administrator-Zugang. Bitte direkt nach dem ersten Deploy im
    // Profil-Bereich ein eigenes Passwort setzen bzw. per ADMIN_PASSWORD
    // (Umgebungsvariable) beim allerersten Start überschreiben.
    insertUser.run({
      id: "u_admin",
      username: "admin",
      displayName: "Administrator",
      role: "admin",
      status: "aktiv",
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", BCRYPT_ROUNDS),
      mustChangePassword: 0,
      otpHash: null
    });
  }

  const templateCount = db.prepare("SELECT COUNT(*) AS n FROM templates").get().n;
  if (templateCount === 0) {
    const insertTemplate = db.prepare(`
      INSERT INTO templates (id, typ, name, aufbau_json, dateiname, stored_filename, uploaded)
      VALUES (@id, @typ, @name, @aufbauJson, NULL, NULL, 0)
    `);
    DOCUMENT_TYPES.forEach((t) => {
      insertTemplate.run({
        id: "t_" + t.id,
        typ: t.id,
        name: t.label + " – Standardvorlage",
        aufbauJson: JSON.stringify(t.aufbau)
      });
    });
  }
}

module.exports = { initDb, DB_PATH, BCRYPT_ROUNDS };
