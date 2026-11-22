class PollService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
  }

  /**
   * Creates an on-the-spot multiple-choice (American-style) poll for the active course/session
   */
  createPoll(courseId, sessionId, question, options) {
    if (!question || !question.trim()) {
      throw new Error('Poll question is required.');
    }
    const cleanOptions = (options || []).map((o) => String(o).trim()).filter(Boolean);
    if (cleanOptions.length < 2) {
      throw new Error('A multiple-choice poll must have at least 2 options.');
    }

    // Close previous active polls in this course
    this.db.prepare('UPDATE polls SET is_active = 0 WHERE course_id = ?').run(courseId);

    const res = this.db
      .prepare(`
        INSERT INTO polls (course_id, session_id, question, options_json, is_active)
        VALUES (?, ?, ?, ?, 1)
      `)
      .run(courseId, sessionId || null, question.trim(), JSON.stringify(cleanOptions));

    return this.getPollForLecturer(Number(res.lastInsertRowid));
  }

  closePoll(pollId) {
    this.db.prepare('UPDATE polls SET is_active = 0 WHERE id = ?').run(pollId);
    return this.getPollForLecturer(pollId);
  }

  /**
   * Student casts a vote on a multiple-choice poll.
   * Returns ONLY a vote confirmation for the student's phone (results are displayed only on the lecturer's projector screen).
   */
  castVote(pollId, studentId, optionIndex) {
    const poll = this.db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error('Poll not found.');
    if (!poll.is_active) throw new Error('This poll is already closed.');

    const options = JSON.parse(poll.options_json);
    const idx = Number(optionIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= options.length) {
      throw new Error('Invalid poll option selected.');
    }

    this.db
      .prepare(`
        INSERT INTO poll_votes (poll_id, student_id, option_index)
        VALUES (?, ?, ?)
        ON CONFLICT(poll_id, student_id) DO UPDATE SET
          option_index = excluded.option_index,
          voted_at = datetime('now')
      `)
      .run(pollId, studentId, idx);

    return {
      poll_id: Number(pollId),
      student_id: Number(studentId),
      selected_option_index: idx,
      selected_option_label: options[idx],
      voted: true,
      message: 'Your vote has been recorded! Live results are displayed on the lecturer projector screen.'
    };
  }

  /**
   * Returns the poll payload safe for students (options & whether they voted, WITHOUT vote tallies)
   */
  getActivePollForStudent(courseId, studentId) {
    const poll = this.db
      .prepare('SELECT * FROM polls WHERE course_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
      .get(courseId);
    if (!poll) return null;

    const existingVote = studentId
      ? this.db
          .prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND student_id = ?')
          .get(poll.id, studentId)
      : null;

    return {
      id: poll.id,
      course_id: poll.course_id,
      session_id: poll.session_id,
      question: poll.question,
      options: JSON.parse(poll.options_json),
      is_active: Boolean(poll.is_active),
      my_vote: existingVote ? existingVote.option_index : null
    };
  }

  /**
   * Returns full live vote tallies and percentages exclusively for the Lecturer (ADMIN) projector screen
   */
  getPollForLecturer(pollId) {
    const poll = this.db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return null;

    const options = JSON.parse(poll.options_json);
    const votes = this.db
      .prepare('SELECT option_index, COUNT(*) as cnt FROM poll_votes WHERE poll_id = ? GROUP BY option_index')
      .all(poll.id);

    const counts = new Array(options.length).fill(0);
    let totalVotes = 0;
    for (const v of votes) {
      if (v.option_index >= 0 && v.option_index < counts.length) {
        counts[v.option_index] = Number(v.cnt);
        totalVotes += Number(v.cnt);
      }
    }

    const breakdown = options.map((label, index) => ({
      option_index: index,
      label,
      count: counts[index],
      percentage: totalVotes > 0 ? Math.round((counts[index] / totalVotes) * 100) : 0
    }));

    return {
      id: poll.id,
      course_id: poll.course_id,
      session_id: poll.session_id,
      question: poll.question,
      options,
      is_active: Boolean(poll.is_active),
      total_votes: totalVotes,
      results: breakdown,
      created_at: poll.created_at
    };
  }

  getActivePollForLecturerByCourse(courseId) {
    const poll = this.db
      .prepare('SELECT id FROM polls WHERE course_id = ? ORDER BY id DESC LIMIT 1')
      .get(courseId);
    return poll ? this.getPollForLecturer(poll.id) : null;
  }
}

module.exports = PollService;
