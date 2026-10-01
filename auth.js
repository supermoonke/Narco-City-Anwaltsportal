/**
 * auth.js
 * ----------------------------------------------------------------------
 * Authentifizierung & Autorisierung für das Anwaltsportal-Backend.
 *
 * Prinzipien (siehe auch Punkt 9 der Projektvorgaben):
 *  - Passwörter werden NIE im Klartext gespeichert, nur als bcrypt-Hash.
 *  - Auch Einmalpasswörter (OTP) werden nur als Hash gespeichert – der
 *    Administrator sieht das Klartext-OTP ausschließlich einmalig direkt
 *    nach der Erzeugung (Response der Create/Regenerate-Route), danach
 *    ist es aus der Datenbank nicht mehr rekonstruierbar.
 *  - Ein Administrator kann zu keinem Zeitpunkt das persönliche Passwort
 *    eines Anwalts einsehen – dafür gibt es keine Route.
 *  - Sessions werden serverseitig gehalten (express-session), das Cookie
 *    trägt nur eine Session-ID, keine Nutzdaten.
 *  - Rollenprüfung erfolgt serverseitig in requireRole(), niemals nur im
 *    Frontend.
 * ----------------------------------------------------------------------
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { BCRYPT_ROUNDS } = require("./database");

const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne O/0/I/1

function generateOtp() {
  function block(n) {
    let s = "";
    for (let i = 0; i < n; i++) {
      s += OTP_ALPHABET[crypto.randomInt(0, OTP_ALPHABET.length)];
    }
    return s;
  }
  return `${block(4)}-${block(4)}`;
}

function hashSecret(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function verifySecret(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

/**
 * Login-Logik gegen die Datenbank. Gibt entweder den Nutzer zurück
 * (inkl. Hinweis, ob eine Ersteinrichtung nötig ist) oder wirft einen
 * Fehler mit einer für das Frontend geeigneten Meldung.
 */
function authenticate(db, username, password) {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) throw new AuthError("Kein Konto mit diesem Benutzernamen gefunden.");
  if (user.status !== "aktiv") throw new AuthError("Dieses Konto wurde deaktiviert.");

  if (user.must_change_password) {
    if (!verifySecret(password, user.otp_hash)) {
      throw new AuthError("Einmalpasswort ist falsch oder wurde bereits verwendet.");
    }
    return { user, requiresPasswordSetup: true };
  }

  if (!verifySecret(password, user.password_hash)) {
    throw new AuthError("Falsches Passwort.");
  }
  return { user, requiresPasswordSetup: false };
}

function completePasswordSetup(db, userId, newPassword) {
  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 0, otp_hash = NULL
    WHERE id = ?
  `).run(hashSecret(newPassword), userId);
}

/**
 * Selbst-Passwortänderung durch einen bereits eingerichteten Nutzer
 * (Profil-Bereich). Verlangt das aktuelle Passwort zur Bestätigung.
 */
function changeOwnPassword(db, userId, currentPassword, newPassword) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) throw new AuthError("Benutzer nicht gefunden.");
  if (!verifySecret(currentPassword, user.password_hash)) {
    throw new AuthError("Aktuelles Passwort ist falsch.");
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashSecret(newPassword), userId);
}

class AuthError extends Error {}

/** Express-Middleware: verlangt eine aktive Session. */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  next();
}

/** Express-Middleware-Fabrik: verlangt eine bestimmte Rolle (serverseitig!). */
function requireRole(...roles) {
  return function (req, res, next) {
    const role = req.session && req.session.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "Kein Zugriff auf diese Funktion." });
    }
    next();
  };
}

module.exports = {
  generateOtp,
  hashSecret,
  verifySecret,
  authenticate,
  completePasswordSetup,
  changeOwnPassword,
  AuthError,
  requireAuth,
  requireRole
};
