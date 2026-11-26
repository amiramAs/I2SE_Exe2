const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

const PUBLIC_USER_COLUMNS = 'id, google_id, email, name, picture, role, created_at';

/**
 * Password hashing with Node's built-in scrypt (salted). Stored as "scrypt$<salt>$<hash>".
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function avatarFor(name, bg = '0f766e') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=fff`;
}

class AuthService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
    this.googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    this.googleClient = this.googleClientId ? new OAuth2Client(this.googleClientId) : null;

    // Lecturer emails that receive the ADMIN role when signing in with a *verified* Google account
    const envAdmins = (process.env.ADMIN_EMAILS || '1234amiram@gmail.com')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    this.adminEmails = new Set(envAdmins);
    this.sessionSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  }

  // ==========================================================================
  // GOOGLE SIGN-IN
  // ==========================================================================

  /**
   * Upserts a user from a (server-verified) Google profile.
   * Role is stored per-user in the DB: new users are STUDENT unless whitelisted in ADMIN_EMAILS.
   */
  async authenticateGoogleUser({ email, name, picture, googleId }) {
    if (!email) {
      throw new Error('Google email is required for authentication');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isWhitelistedAdmin = this.adminEmails.has(normalizedEmail);
    const existing = this.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);

    if (existing) {
      this.db
        .prepare(
          `UPDATE users SET name = COALESCE(?, name), picture = COALESCE(?, picture),
             google_id = COALESCE(google_id, ?), role = CASE WHEN ? THEN 'ADMIN' ELSE role END
           WHERE id = ?`
        )
        .run(name || null, picture || null, googleId || null, isWhitelistedAdmin ? 1 : 0, existing.id);
      return this.getUserById(existing.id);
    }

    const displayName = name || normalizedEmail.split('@')[0];
    const res = this.db
      .prepare('INSERT INTO users (google_id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)')
      .run(
        googleId || null,
        normalizedEmail,
        displayName,
        picture || avatarFor(displayName),
        isWhitelistedAdmin ? 'ADMIN' : 'STUDENT'
      );

    return this.getUserById(Number(res.lastInsertRowid));
  }

  /**
   * Real Google Sign-In: verifies a Google Identity Services ID token (JWT credential)
   * against Google's public keys + our OAuth Client ID, then upserts the user.
   * Never trusts client-supplied email/name.
   */
  async loginWithGoogleCredential(credential) {
    if (!this.googleClient) {
      throw new Error('GOOGLE_CLIENT_ID is not configured on the server');
    }
    if (!credential || typeof credential !== 'string') {
      throw new Error('Missing Google credential');
    }
    const ticket = await this.googleClient.verifyIdToken({
      idToken: credential,
      audience: this.googleClientId
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || payload.email_verified === false) {
      throw new Error('Google account email is not verified');
    }
    return this.authenticateGoogleUser({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      googleId: payload.sub
    });
  }

  // ==========================================================================
  // EMAIL + PASSWORD (no Gmail required)
  // ==========================================================================

  /**
   * Registers a new email/password account. Self-registered accounts are always STUDENT —
   * ADMIN is only granted via the DB (seed) or a verified Google login of a whitelisted email,
   * so nobody can claim a lecturer address by registering with it.
   */
  registerWithPassword({ name, email, password }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const displayName = String(name || '').trim() || normalizedEmail.split('@')[0];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Please enter a valid email address');
    }
    if (!password || String(password).length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    const existing = this.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
    if (existing) {
      throw new Error('An account with this email already exists — please sign in');
    }

    const res = this.db
      .prepare('INSERT INTO users (email, name, picture, role, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(normalizedEmail, displayName, avatarFor(displayName), 'STUDENT', hashPassword(password));
    return this.getUserById(Number(res.lastInsertRowid));
  }

  loginWithPassword({ email, password }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const row = this.db
      .prepare('SELECT id, password_hash FROM users WHERE LOWER(email) = ?')
      .get(normalizedEmail);
    if (!row || !verifyPassword(password || '', row.password_hash)) {
      throw new Error('Incorrect email or password');
    }
    return this.getUserById(row.id);
  }

  // ==========================================================================
  // SESSION TOKENS
  // ==========================================================================

  /**
   * Issues a signed (HMAC-SHA256) session token so the browser stays logged in after refresh.
   */
  issueSessionToken(user, ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const body = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + ttlMs })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  getUserFromSessionToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!uid || Date.now() > exp) return null;
      return this.getUserById(uid) || null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // USERS (never expose password_hash)
  // ==========================================================================

  getUserById(userId) {
    return this.db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(userId);
  }

  getAllUsers() {
    return this.db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users ORDER BY role ASC, name ASC`).all();
  }
}

AuthService.hashPassword = hashPassword;
AuthService.verifyPassword = verifyPassword;

module.exports = AuthService;
