const { OAuth2Client } = require('google-auth-library');

class AuthService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
    this.googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    this.googleClient = this.googleClientId ? new OAuth2Client(this.googleClientId) : null;

    // Default whitelisted lecturer emails that automatically receive ADMIN role upon Google Sign-In
    const envAdmins = (process.env.ADMIN_EMAILS || 'lecturer@ariel.ac.il,boaz@ariel.ac.il,admin@ariel.ac.il')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    this.adminEmails = new Set(envAdmins);
  }

  /**
   * Authenticates a user via Google OAuth (supports real Google ID token or Google profile payload)
   * Default role is STUDENT unless email is in the lecturer ADMIN whitelist (or explicitly existing in DB).
   */
  async authenticateGoogleUser({ credential, email, name, picture, googleId }) {
    let profile = { email, name, picture, googleId };

    if (credential && this.googleClient && !email) {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: credential,
        audience: this.googleClientId
      });
      const payload = ticket.getPayload();
      profile = {
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture,
        googleId: payload.sub
      };
    }

    if (!profile.email) {
      throw new Error('Google email is required for authentication');
    }

    const normalizedEmail = profile.email.trim().toLowerCase();
    const existing = this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(normalizedEmail);

    if (existing) {
      if (profile.name || profile.picture) {
        this.db
          .prepare('UPDATE users SET name = COALESCE(?, name), picture = COALESCE(?, picture) WHERE id = ?')
          .run(profile.name || null, profile.picture || null, existing.id);
      }
      return this.getUserById(existing.id);
    }

    const initialRole = this.adminEmails.has(normalizedEmail) ? 'ADMIN' : 'STUDENT';
    const displayName = profile.name || normalizedEmail.split('@')[0];
    const avatarUrl =
      profile.picture ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0f766e&color=fff`;

    const res = this.db
      .prepare('INSERT INTO users (google_id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)')
      .run(
        profile.googleId || `google-${normalizedEmail}`,
        normalizedEmail,
        displayName,
        avatarUrl,
        initialRole
      );

    return this.getUserById(Number(res.lastInsertRowid));
  }

  /**
   * 1-Click Role Switcher (ADMIN <-> STUDENT) for live classroom demonstration
   */
  switchUserRole(userId, newRole) {
    if (!['ADMIN', 'STUDENT'].includes(newRole)) {
      throw new Error('Invalid role. Must be ADMIN or STUDENT.');
    }
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, userId);
    return this.getUserById(userId);
  }

  getUserById(userId) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }

  getAllUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY role ASC, name ASC').all();
  }
}

module.exports = AuthService;
