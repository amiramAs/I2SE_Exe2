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
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        session_id INTEGER,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
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
  }

  seedInitialData() {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    if (countRow.cnt > 0) return;

    const insertUser = this.db.prepare(
      'INSERT INTO users (google_id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)'
    );

    const lecturerRes = insertUser.run(
      'google-admin-1',
      'lecturer@ariel.ac.il',
      'Dr. Boaz Ben-Moshe (Lecturer)',
      'https://ui-avatars.com/api/?name=Boaz+Ben-Moshe&background=1e40af&color=fff',
      'ADMIN'
    );
    const lecturerId = Number(lecturerRes.lastInsertRowid);

    const studentsData = [
      ['google-stu-1', 'noa.cohen@msmail.ariel.ac.il', 'Noa Cohen'],
      ['google-stu-2', 'itay.levi@msmail.ariel.ac.il', 'Itay Levi'],
      ['google-stu-3', 'maya.mizrahi@msmail.ariel.ac.il', 'Maya Mizrahi'],
      ['google-stu-4', 'daniel.peretz@msmail.ariel.ac.il', 'Daniel Peretz'],
      ['google-stu-5', 'yael.avraham@msmail.ariel.ac.il', 'Yael Avraham'],
      ['google-stu-6', 'omer.friedman@msmail.ariel.ac.il', 'Omer Friedman']
    ];

    const studentIds = [];
    for (const [gid, email, name] of studentsData) {
      const res = insertUser.run(
        gid,
        email,
        name,
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0f766e&color=fff`,
        'STUDENT'
      );
      studentIds.push(Number(res.lastInsertRowid));
    }

    const insertCourse = this.db.prepare(
      'INSERT INTO courses (code, name, description, lecturer_id) VALUES (?, ?, ?, ?)'
    );
    const c1 = insertCourse.run(
      'CS-204',
      'Introduction to Software Engineering (OOP & OOD)',
      'Object-Oriented Programming, Deep Designing, UML, Testing Strategies & Vibe Coding.',
      lecturerId
    );
    const course1Id = Number(c1.lastInsertRowid);

    const c2 = insertCourse.run(
      'CS-208',
      'Algorithms & Data Structures II',
      'Graph Algorithms, Dynamic Programming, Network Flows & Complexity.',
      lecturerId
    );
    const course2Id = Number(c2.lastInsertRowid);

    const insertEnroll = this.db.prepare(
      'INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)'
    );
    for (const sid of studentIds) {
      insertEnroll.run(course1Id, sid);
    }
    insertEnroll.run(course2Id, studentIds[0]);
    insertEnroll.run(course2Id, studentIds[1]);

    const insertSession = this.db.prepare(`
      INSERT INTO sessions (course_id, title, qr_token, lecturer_lat, lecturer_lng, max_distance_meters, photo_headcount, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const s1 = insertSession.run(
      course1Id,
      'Lecture 1: OOP Principles & SOLID',
      'TOKEN-LEC1-CS204',
      32.1045,
      35.2075,
      60,
      5,
      0,
      '2026-11-05 10:00:00'
    );
    const session1Id = Number(s1.lastInsertRowid);

    const s2 = insertSession.run(
      course1Id,
      'Lecture 2: Requirements, SRS & UML Diagrams',
      'TOKEN-LEC2-CS204',
      32.1045,
      35.2075,
      60,
      4,
      0,
      '2026-11-12 10:00:00'
    );
    const session2Id = Number(s2.lastInsertRowid);

    const s3 = insertSession.run(
      course1Id,
      'Lecture 3 (Live): Vibe Coding & Deep Designing Demo',
      'TOKEN-LEC3-LIVE',
      32.1045,
      35.2075,
      60,
      4,
      1,
      '2026-11-19 10:00:00'
    );
    const session3Id = Number(s3.lastInsertRowid);

    const insertAtt = this.db.prepare(`
      INSERT INTO attendance (session_id, student_id, student_lat, student_lng, distance_meters, status, manual_override, checked_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Lecture 1 attendance
    for (let i = 0; i < 5; i++) {
      insertAtt.run(session1Id, studentIds[i], 32.10455, 35.20755, 8.2 + i, 'PRESENT', 0, '2026-11-05 10:04:00');
    }
    // Lecture 2 attendance
    for (let i = 0; i < 4; i++) {
      insertAtt.run(session2Id, studentIds[i], 32.10452, 35.20753, 6.5 + i, 'PRESENT', 0, '2026-11-12 10:03:00');
    }
    // Lecture 3 (Live) attendance: 5 students checked in digitally, while photo_headcount is 4 -> triggers Fraud Alert out of the box!
    for (let i = 0; i < 5; i++) {
      insertAtt.run(session3Id, studentIds[i], 32.10454, 35.20754, 11.4 + i * 2, 'PRESENT', 0, '2026-11-19 10:05:00');
    }

    // Seed Live & Offline Questions
    const insertQuestion = this.db.prepare(`
      INSERT INTO questions (course_id, session_id, student_id, is_anonymous, content, is_live, is_dismissed, lecturer_reply, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertQuestion.run(
      course1Id,
      session3Id,
      studentIds[0],
      1,
      'Can we use the Strategy pattern to swap between local TensorFlow.js person counting and Gemini Vision API?',
      1,
      0,
      null,
      '2026-11-19 10:15:00'
    );
    insertQuestion.run(
      course1Id,
      session2Id,
      studentIds[1],
      0,
      'For the SRS document in Ex2, should non-functional requirements include exact latency thresholds for WebSockets?',
      0,
      1,
      'Yes! Define concrete measurable thresholds (e.g., <500ms event propagation) so they can be verified during testing.',
      '2026-11-13 18:20:00'
    );

    // Seed Active Multiple-Choice Poll
    const insertPoll = this.db.prepare(`
      INSERT INTO polls (course_id, session_id, question, options_json, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    const pollRes = insertPoll.run(
      course1Id,
      session3Id,
      'Which diagram best models real-time WebSocket message ordering between Student Phone, Server, and Lecturer Projector?',
      JSON.stringify([
        'UML Sequence Diagram',
        'UML Class Diagram',
        'Entity-Relationship Diagram (ERD)',
        'Static Package Diagram'
      ]),
      1
    );
    const pollId = Number(pollRes.lastInsertRowid);
    const insertVote = this.db.prepare('INSERT INTO poll_votes (poll_id, student_id, option_index) VALUES (?, ?, ?)');
    insertVote.run(pollId, studentIds[0], 0);
    insertVote.run(pollId, studentIds[1], 0);
    insertVote.run(pollId, studentIds[2], 1);
    insertVote.run(pollId, studentIds[3], 0);

    // Seed Published Lecture Summary
    const insertSummary = this.db.prepare(`
      INSERT INTO lecture_summaries (course_id, session_id, title, raw_transcript, summary_markdown, is_published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertSummary.run(
      course1Id,
      session2Id,
      'Lecture 2 Summary: Requirements Engineering, SoW, SRS & UML Modeling',
      'In this lecture we covered how to move from an open-ended client problem to a Statement of Work (SoW), an IEEE-830 Software Requirements Specification (SRS), Use Cases, and Low-Level Class and Sequence Diagrams.',
      `### Executive Summary
This lecture established the complete software engineering pipeline from problem formulation to object-oriented design for Ex2.

### Core Concepts Covered
- **Statement of Work (SoW)**: Defines project milestones, deliverables, scope boundaries, and risk mitigation.
- **Software Requirements Specification (SRS)**: Distinguishes testable **Functional Requirements (FR)** from measurable **Non-Functional Requirements (NFR)**.
- **UML Class vs. Sequence Diagrams**: Class diagrams capture static structural relationships, attributes, and method contracts, whereas Sequence diagrams model time-ordered runtime interactions.

### Classroom Q&A Highlights Integrated
- **Q:** *Should non-functional requirements include exact latency thresholds for WebSockets?*
- **Takeaway:** Always specify verifiable metrics (such as \`<500ms\` round-trip latency and GPS radius thresholds).

### Next Steps & Action Items
- Complete the Technical Tools Report after real-life testing and prepare the 10-minute live classroom demo.`,
      1,
      '2026-11-12 12:00:00'
    );

    // Seed Homework Assignment & Peer Submissions
    const insertAssignment = this.db.prepare(`
      INSERT INTO assignments (course_id, title, description, submission_type, due_date)
      VALUES (?, ?, ?, ?, ?)
    `);
    const assignRes = insertAssignment.run(
      course1Id,
      'Ex2: Vibe Coding & Deep Designing — Web-Based Teaching Tool',
      'Design and compose an end-to-end classroom teaching web application including README, Tools Report, SoW, SRS, Use Cases, Architecture, UML Class & Sequence Diagrams, Testing Strategy, and a runnable KISS demo.',
      'BOTH',
      '2026-11-25 23:59:00'
    );
    const assignmentId = Number(assignRes.lastInsertRowid);

    const insertSubmission = this.db.prepare(`
      INSERT INTO submissions (assignment_id, student_id, repo_url, file_name, content, llm_review, llm_comparison, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSubmission.run(
      assignmentId,
      studentIds[0],
      'https://github.com/noa-cohen/I2SE_Ex2_SmartClass',
      'architecture_summary.md',
      'Implemented QR + GPS Haversine attendance with TensorFlow.js person counter, Socket.IO live anonymous Q&A with Web Audio chime, KISS multiple-choice polls, and Gemini LLM lecture summarizer.',
      `### Architectural & Code Quality Review
- **Strengths**: Clean separation between domain services (\`AttendanceService\`, \`QAService\`, \`PollService\`, \`LLMService\`) and transport layer (\`Socket.IO\`).
- **Anti-Spoofing Design**: Combines Haversine GPS distance validation with mobile-to-PC AI classroom photo auditing and manual lecturer override.
- **Documentation Completeness**: Includes all required deliverables (Tools Report, SoW, SRS, Use Cases, Class/Sequence Diagrams, and Testing Strategy).`,
      `### Anonymous Comparison Against Class Peers (3 Submissions Analyzed)
- **Architecture & Modularity (Top 15% of Cohort)**: Unlike 66% of peer submissions that placed SQL queries directly inside Express route handlers, your submission encapsulates business logic in dedicated OOP service classes matching the UML Class Diagram.
- **Attendance Anti-Spoofing**: 1 of the 2 other peer submissions relied solely on a static 4-digit PIN without GPS or classroom photo verification; your dual-factor QR + GPS + Mobile Admin Photo Counter provides significantly stronger spoofing resistance.
- **Suggested Improvement Compared to Peers**: Peer Submission #2 included automated retry logic for transient GitHub API rate limits; consider adding a cache header when inspecting external repositories.`,
      96
    );

    insertSubmission.run(
      assignmentId,
      studentIds[1],
      'https://github.com/itay-levi/classroom-helper-ex2',
      'main.js',
      'Single-page Express application with 4-digit attendance code, basic chat box for student questions, and static poll form.',
      null,
      null,
      null
    );

    insertSubmission.run(
      assignmentId,
      studentIds[2],
      'https://github.com/maya-mizrahi/oop-teaching-tool',
      'design_notes.txt',
      'React + Express teaching app with QR check-in, live polls, and OpenAI homework grader with retry middleware.',
      null,
      null,
      null
    );
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseManager;
