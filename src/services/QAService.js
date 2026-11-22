class QAService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
  }

  /**
   * Submits a student question (live during an active session or offline after class).
   * Supports optional anonymous mode (`isAnonymous = true`).
   */
  askQuestion(courseId, sessionId, studentId, content, isAnonymous = false) {
    if (!content || !content.trim()) {
      throw new Error('Question content cannot be empty.');
    }

    let activeSession = null;
    if (sessionId) {
      activeSession = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    } else {
      activeSession = this.db
        .prepare('SELECT * FROM sessions WHERE course_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
        .get(courseId);
    }

    const isLive = activeSession && activeSession.is_active ? 1 : 0;
    const targetSessionId = activeSession ? activeSession.id : null;

    const res = this.db
      .prepare(`
        INSERT INTO questions (course_id, session_id, student_id, is_anonymous, content, is_live, is_dismissed)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `)
      .run(courseId, targetSessionId, studentId, isAnonymous ? 1 : 0, content.trim(), isLive);

    return this.getQuestionById(Number(res.lastInsertRowid));
  }

  getQuestionById(questionId) {
    const q = this.db
      .prepare(`
        SELECT q.*, u.name AS real_student_name, u.email AS student_email, s.title AS session_title
        FROM questions q
        INNER JOIN users u ON u.id = q.student_id
        LEFT JOIN sessions s ON s.id = q.session_id
        WHERE q.id = ?
      `)
      .get(questionId);
    return this._formatQuestion(q);
  }

  /**
   * Dismisses a live question popup from the lecturer's projector screen after answering verbally
   */
  dismissLiveQuestion(questionId) {
    this.db.prepare('UPDATE questions SET is_dismissed = 1 WHERE id = ?').run(questionId);
    return this.getQuestionById(questionId);
  }

  /**
   * Posts a written reply from the lecturer (primarily for post-class offline questions, or written follow-up)
   */
  replyToQuestion(questionId, replyText) {
    if (!replyText || !replyText.trim()) {
      throw new Error('Reply text cannot be empty.');
    }
    this.db
      .prepare('UPDATE questions SET lecturer_reply = ?, is_dismissed = 1 WHERE id = ?')
      .run(replyText.trim(), questionId);
    return this.getQuestionById(questionId);
  }

  getQuestionsByCourse(courseId) {
    const rows = this.db
      .prepare(`
        SELECT q.*, u.name AS real_student_name, u.email AS student_email, s.title AS session_title
        FROM questions q
        INNER JOIN users u ON u.id = q.student_id
        LEFT JOIN sessions s ON s.id = q.session_id
        WHERE q.course_id = ?
        ORDER BY q.id DESC
      `)
      .all(courseId);
    return rows.map((r) => this._formatQuestion(r));
  }

  _formatQuestion(row) {
    if (!row) return null;
    const isAnon = Boolean(row.is_anonymous);
    return {
      ...row,
      is_anonymous: isAnon,
      is_live: Boolean(row.is_live),
      is_dismissed: Boolean(row.is_dismissed),
      display_author: isAnon ? 'Anonymous Student' : row.real_student_name
    };
  }
}

module.exports = QAService;
