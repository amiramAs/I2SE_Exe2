const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

class DatabaseManager {
  constructor(dbPath = path.join(__dirname, '../../database.sqlite')) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  getDb() {
    return this.db;
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        picture TEXT,
        role TEXT NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('ADMIN', 'STUDENT')),
        password_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        lecturer_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (lecturer_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        enrolled_at TEXT DEFAULT (datetime('now')),
        UNIQUE(course_id, student_id),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        qr_token TEXT UNIQUE NOT NULL,
        lecturer_lat REAL NOT NULL DEFAULT 32.1045,
        lecturer_lng REAL NOT NULL DEFAULT 35.2075,
        max_distance_meters INTEGER NOT NULL DEFAULT 60,
        photo_headcount INTEGER,
        photo_data_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        student_lat REAL,
        student_lng REAL,
        distance_meters REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'ABSENT', 'OUT_OF_RANGE')),
        manual_override INTEGER NOT NULL DEFAULT 0,
        checked_in_at TEXT DEFAULT (datetime('now')),
        UNIQUE(session_id, student_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        session_id INTEGER,
        student_id INTEGER NOT NULL,
        is_anonymous INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        is_live INTEGER NOT NULL DEFAULT 1,
        is_dismissed INTEGER NOT NULL DEFAULT 0,
        lecturer_reply TEXT,
        replied_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS question_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        user_id INTEGER,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL DEFAULT 'ADMIN',
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        session_id INTEGER,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        allow_multiple INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        option_index INTEGER NOT NULL,
        option_indices_json TEXT,
        voted_at TEXT DEFAULT (datetime('now')),
        UNIQUE(poll_id, student_id),
        FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS lecture_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        session_id INTEGER,
        title TEXT NOT NULL,
        raw_transcript TEXT NOT NULL,
        summary_markdown TEXT NOT NULL,
        is_published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        submission_type TEXT NOT NULL DEFAULT 'BOTH' CHECK (submission_type IN ('GITHUB_ONLY', 'FILE_OR_TEXT', 'BOTH')),
        due_date TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        repo_url TEXT,
        file_name TEXT,
        content TEXT,
        llm_review TEXT,
        llm_comparison TEXT,
        score INTEGER,
        submitted_at TEXT DEFAULT (datetime('now')),
        UNIQUE(assignment_id, student_id),
        FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Migration for existing databases created before email/password login was added
    const userCols = this.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('password_hash')) {
      this.db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
    }

    const questionCols = this.db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
    if (!questionCols.includes('replied_at')) {
      this.db.exec('ALTER TABLE questions ADD COLUMN replied_at TEXT');
    }

    const pollCols = this.db.prepare('PRAGMA table_info(polls)').all().map((c) => c.name);
    if (!pollCols.includes('allow_multiple')) {
      this.db.exec('ALTER TABLE polls ADD COLUMN allow_multiple INTEGER NOT NULL DEFAULT 0');
    }

    const pollVoteCols = this.db.prepare('PRAGMA table_info(poll_votes)').all().map((c) => c.name);
    if (!pollVoteCols.includes('option_indices_json')) {
      this.db.exec('ALTER TABLE poll_votes ADD COLUMN option_indices_json TEXT');
    }
  }

  seedInitialData() {
    // Ensures the built-in accounts exist (idempotent — safe on every server start).
    // Roles are stored per user; there is no runtime role switcher.
    // Courses/sessions/questions/polls/assignments start 100% CLEAN for a live demo.
    const { scryptSync, randomBytes } = require('node:crypto');
    const hash = (pw) => {
      const salt = randomBytes(16).toString('hex');
      return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
    };
    const avatar = (name, bg) =>
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=fff`;

    const accounts = [
      // [email, name, role, demoPassword|null (null = Google sign-in only)]
      ['1234amiram@gmail.com', 'Amiram', 'ADMIN', null],
      ['admin@test.com', 'Test Admin', 'ADMIN', '1234'],
      ['test1@test.com', 'Test Student 1', 'STUDENT', '1234'],
      ['test2@test.com', 'Test Student 2', 'STUDENT', '1234'],
      ['test3@test.com', 'Test Student 3', 'STUDENT', '1234']
    ];

    const findUser = this.db.prepare('SELECT id, password_hash FROM users WHERE LOWER(email) = ?');
    const insertUser = this.db.prepare(
      'INSERT INTO users (email, name, picture, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    );
    const updateUser = this.db.prepare(
      'UPDATE users SET role = ?, password_hash = COALESCE(password_hash, ?) WHERE id = ?'
    );

    for (const [email, name, role, password] of accounts) {
      const existing = findUser.get(email);
      const pwHash = password ? hash(password) : null;
      if (existing) {
        updateUser.run(role, pwHash, existing.id);
      } else {
        insertUser.run(email, name, avatar(name, role === 'ADMIN' ? '2563eb' : '0f766e'), role, pwHash);
      }
    }
  }

  /**
   * Wipes all courses, sessions, attendance, questions, polls, summaries, and homework
   * so the site is 100% clean for starting a demo from scratch!
   */
  resetAllDataForCleanDemo() {
    this.db.exec(`
      DELETE FROM poll_votes;
      DELETE FROM polls;
      DELETE FROM question_replies;
      DELETE FROM questions;
      DELETE FROM attendance;
      DELETE FROM lecture_summaries;
      DELETE FROM submissions;
      DELETE FROM assignments;
      DELETE FROM enrollments;
      DELETE FROM sessions;
      DELETE FROM courses;
    `);
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseManager;
