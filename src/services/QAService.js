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
        SELECT q.*,
               u.name AS real_student_name,
               u.email AS student_email,
               s.title AS session_title,
               c.code AS course_code,
               c.name AS course_name,
               c.lecturer_id AS lecturer_id
        FROM questions q
        INNER JOIN users u ON u.id = q.student_id
        INNER JOIN courses c ON c.id = q.course_id
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
   * Posts a written reply to a question (from the lecturer or a participant).
   * Keeps `lecturer_reply` populated and records the reply in `question_replies`.
   */
  replyToQuestion(questionId, replyText, authorUser = null) {
    if (!replyText || !replyText.trim()) {
      throw new Error('Reply text cannot be empty.');
    }

    const existing = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
    if (!existing) {
      throw new Error('Question not found.');
    }

    const cleanReply = replyText.trim();
    let userId = authorUser?.id || null;
    let authorName = authorUser?.name || 'Lecturer';
    let authorRole = authorUser?.role || 'ADMIN';

    if (userId && !authorUser?.name) {
      const u = this.db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
      if (u) {
        authorName = u.name;
        authorRole = u.role;
      }
    }

    this.db
      .prepare(`
        INSERT INTO question_replies (question_id, user_id, author_name, author_role, content)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(questionId, userId, authorName, authorRole, cleanReply);

    if (authorRole === 'ADMIN' || !existing.lecturer_reply) {
      this.db
        .prepare(`
          UPDATE questions
          SET lecturer_reply = ?,
              replied_at = datetime('now'),
              is_dismissed = 1
          WHERE id = ?
        `)
        .run(cleanReply, questionId);
    }

    return this.getQuestionById(questionId);
  }

  getQuestionsByCourse(courseId) {
    const rows = this.db
      .prepare(`
        SELECT q.*,
               u.name AS real_student_name,
               u.email AS student_email,
               s.title AS session_title,
               c.code AS course_code,
               c.name AS course_name,
               c.lecturer_id AS lecturer_id
        FROM questions q
        INNER JOIN users u ON u.id = q.student_id
        INNER JOIN courses c ON c.id = q.course_id
        LEFT JOIN sessions s ON s.id = q.session_id
        WHERE q.course_id = ?
        ORDER BY q.id DESC
      `)
      .all(courseId);
    return rows.map((r) => this._formatQuestion(r));
  }

  /**
   * Returns complete question history for the lecturer with filtering by course, session/lecture,
   * status (PENDING / ANSWERED_WRITTEN / ANSWERED_VERBAL), student/anonymous, and free-text search,
   * along with summary KPI statistics.
   */
  getQuestionHistory(filters = {}) {
    const {
      courseId = null,
      lecturerId = null,
      sessionId = null,
      studentId = null,
      status = null,
      search = null
    } = filters;

    const whereClauses = [];
    const params = [];

    if (courseId) {
      whereClauses.push('q.course_id = ?');
      params.push(Number(courseId));
    } else if (lecturerId) {
      whereClauses.push('c.lecturer_id = ?');
      params.push(Number(lecturerId));
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const allRows = this.db
      .prepare(`
        SELECT q.*,
               u.name AS real_student_name,
               u.email AS student_email,
               s.title AS session_title,
               c.code AS course_code,
               c.name AS course_name,
               c.lecturer_id AS lecturer_id
        FROM questions q
        INNER JOIN users u ON u.id = q.student_id
        INNER JOIN courses c ON c.id = q.course_id
        LEFT JOIN sessions s ON s.id = q.session_id
        ${whereSql}
        ORDER BY q.id DESC
      `)
      .all(...params);

    const allFormatted = allRows.map((r) => this._formatQuestion(r));

    const stats = {
      total: allFormatted.length,
      live_count: allFormatted.filter((q) => q.is_live).length,
      offline_count: allFormatted.filter((q) => !q.is_live).length,
      replied_count: allFormatted.filter((q) => q.status === 'ANSWERED_WRITTEN').length,
      verbal_count: allFormatted.filter((q) => q.status === 'ANSWERED_VERBAL').length,
      pending_count: allFormatted.filter((q) => q.status === 'PENDING').length
    };

    // Build available filter options from the full dataset for this course/lecturer
    let sessions = [];
    if (courseId) {
      sessions = this.db
        .prepare('SELECT id, title, created_at, is_active FROM sessions WHERE course_id = ? ORDER BY id DESC')
        .all(Number(courseId));
    } else if (lecturerId) {
      sessions = this.db
        .prepare(`
          SELECT s.id, (c.code || ' — ' || s.title) AS title, s.created_at, s.is_active
          FROM sessions s
          INNER JOIN courses c ON c.id = s.course_id
          WHERE c.lecturer_id = ?
          ORDER BY s.id DESC
        `)
        .all(Number(lecturerId));
    }

    // Collect distinct non-anonymous students who asked questions
    const studentMap = new Map();
    for (const q of allFormatted) {
      if (!q.is_anonymous && !studentMap.has(q.student_id)) {
        studentMap.set(q.student_id, {
          id: q.student_id,
          name: q.real_student_name,
          email: q.student_email
        });
      }
    }
    const students = Array.from(studentMap.values());

    // Apply fine-grained history filters
    const filtered = allFormatted.filter((q) => {
      if (sessionId) {
        if (sessionId === 'OFFLINE') {
          if (q.is_live) return false;
        } else if (sessionId === 'LIVE') {
          if (!q.is_live) return false;
        } else if (Number(q.session_id) !== Number(sessionId)) {
          return false;
        }
      }

      if (studentId) {
        if (studentId === 'ANONYMOUS') {
          if (!q.is_anonymous) return false;
        } else if ( q.is_anonymous || Number(q.student_id) !== Number(studentId)) {
          return false;
        }
      }

      if (status && q.status !== status) {
        return false;
      }

      if (search && search.trim()) {
        const needle = search.trim().toLowerCase();
        const inContent = (q.content || '').toLowerCase().includes(needle);
        const inAuthor = (q.display_author || '').toLowerCase().includes(needle);
        const inReply = (q.lecturer_reply || '').toLowerCase().includes(needle);
        const inThread = (q.replies || []).some((rep) => (rep.content || '').toLowerCase().includes(needle));
        if (!inContent && !inAuthor && !inReply && !inThread) return false;
      }

      return true;
    });

    return {
      questions: filtered,
      sessions,
      students,
      stats
    };
  }

  exportQuestionsCSV(filters = {}) {
    const history = this.getQuestionHistory(filters);
    const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Question ID',
      'Course',
      'Session / Lecture',
      'Asked Mode',
      'Student / Author',
      'Question Content',
      'Status',
      'Lecturer Reply',
      'Replies Count',
      'Created At'
    ];
    const lines = [header.map(escapeCsv).join(',')];
    for (const q of history.questions) {
      lines.push(
        [
          q.id,
          `${q.course_code} - ${q.course_name}`,
          q.session_title || 'General / Post-Class',
          q.is_live ? 'LIVE in Class' : 'Offline Post-Class',
          q.display_author,
          q.content,
          q.status,
          q.lecturer_reply || '',
          q.replies.length,
          q.created_at
        ]
          .map(escapeCsv)
          .join(',')
      );
    }
    return '\uFEFF' + lines.join('\n');
  }

  _formatQuestion(row) {
    if (!row) return null;
    const isAnon = Boolean(row.is_anonymous);
    const replies = this.db
      .prepare('SELECT * FROM question_replies WHERE question_id = ? ORDER BY id ASC')
      .all(row.id);

    // If legacy lecturer_reply exists without rows in question_replies, synthesize one for display
    const normalizedReplies =
      replies.length > 0
        ? replies
        : row.lecturer_reply
          ? [
              {
                id: 0,
                question_id: row.id,
                user_id: row.lecturer_id || null,
                author_name: 'Lecturer',
                author_role: 'ADMIN',
                content: row.lecturer_reply,
                created_at: row.replied_at || row.created_at
              }
            ]
          : [];

    const hasWrittenReply = Boolean(row.lecturer_reply) || normalizedReplies.length > 0;
    const status = hasWrittenReply
      ? 'ANSWERED_WRITTEN'
      : row.is_dismissed
        ? 'ANSWERED_VERBAL'
        : 'PENDING';

    return {
      ...row,
      is_anonymous: isAnon,
      is_live: Boolean(row.is_live),
      is_dismissed: Boolean(row.is_dismissed),
      display_author: isAnon ? 'Anonymous Student' : row.real_student_name,
      replies: normalizedReplies,
      status
    };
  }
}

module.exports = QAService;
