class PollService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
  }

  /**
   * Creates an on-the-spot multiple-choice (American-style) poll for the active course/session
   */
  createPoll(courseId, sessionId, question, options, allowMultiple = false) {
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
        INSERT INTO polls (course_id, session_id, question, options_json, allow_multiple, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `)
      .run(courseId, sessionId || null, question.trim(), JSON.stringify(cleanOptions), allowMultiple ? 1 : 0);

    return this.getPollForLecturer(Number(res.lastInsertRowid));
  }

  closePoll(pollId) {
    this.db.prepare('UPDATE polls SET is_active = 0 WHERE id = ?').run(pollId);
    return this.getPollForLecturer(pollId);
  }

  _parseVoteIndices(voteRow) {
    if (!voteRow) return [];
    if (voteRow.option_indices_json) {
      try {
        const parsed = JSON.parse(voteRow.option_indices_json);
        if (Array.isArray(parsed)) return parsed.map(Number);
      } catch {
        // fallback to option_index
      }
    }
    return voteRow.option_index !== null && voteRow.option_index !== undefined
      ? [Number(voteRow.option_index)]
      : [];
  }

  /**
   * Student casts a vote on a multiple-choice poll.
   * Accepts either a single optionIndex (number) or an array of optionIndices (number[]).
   * Returns ONLY a vote confirmation for the student's phone (results are displayed only on the lecturer's projector screen).
   */
  castVote(pollId, studentId, optionSelection) {
    const poll = this.db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) throw new Error('Poll not found.');
    if (!poll.is_active) throw new Error('This poll is already closed.');

    const options = JSON.parse(poll.options_json);
    const allowMultiple = Boolean(poll.allow_multiple);

    const rawIndices = Array.isArray(optionSelection) ? optionSelection : [optionSelection];
    const indices = [...new Set(rawIndices.map((x) => Number(x)))];

    if (indices.length === 0) {
      throw new Error('Please select at least one option.');
    }
    if (!allowMultiple && indices.length > 1) {
      throw new Error('This poll allows selecting only one option.');
    }
    for (const idx of indices) {
      if (Number.isNaN(idx) || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
        throw new Error('Invalid poll option selected.');
      }
    }

    const primaryIdx = indices[0];
    const indicesJson = JSON.stringify(indices);

    this.db
      .prepare(`
        INSERT INTO poll_votes (poll_id, student_id, option_index, option_indices_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(poll_id, student_id) DO UPDATE SET
          option_index = excluded.option_index,
          option_indices_json = excluded.option_indices_json,
          voted_at = datetime('now')
      `)
      .run(pollId, studentId, primaryIdx, indicesJson);

    return {
      poll_id: Number(pollId),
      student_id: Number(studentId),
      selected_option_index: primaryIdx,
      selected_option_indices: indices,
      selected_option_label: options[primaryIdx],
      selected_option_labels: indices.map((i) => options[i]),
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
          .prepare('SELECT option_index, option_indices_json FROM poll_votes WHERE poll_id = ? AND student_id = ?')
          .get(poll.id, studentId)
      : null;

    const myVotes = this._parseVoteIndices(existingVote);

    return {
      id: poll.id,
      course_id: poll.course_id,
      session_id: poll.session_id,
      question: poll.question,
      options: JSON.parse(poll.options_json),
      allow_multiple: Boolean(poll.allow_multiple),
      is_active: Boolean(poll.is_active),
      my_vote: myVotes.length > 0 ? myVotes[0] : null,
      my_votes: myVotes
    };
  }

  /**
   * Returns full live vote tallies and percentages exclusively for the Lecturer (ADMIN) projector screen
   */
  getPollForLecturer(pollId) {
    const poll = this.db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return null;

    const options = JSON.parse(poll.options_json);
    const voteRows = this.db
      .prepare('SELECT option_index, option_indices_json FROM poll_votes WHERE poll_id = ?')
      .all(poll.id);

    const counts = new Array(options.length).fill(0);
    const totalVoters = voteRows.length;
    let totalSelections = 0;

    for (const row of voteRows) {
      const indices = this._parseVoteIndices(row);
      for (const idx of indices) {
        if (idx >= 0 && idx < counts.length) {
          counts[idx] += 1;
          totalSelections += 1;
        }
      }
    }

    const breakdown = options.map((label, index) => ({
      option_index: index,
      label,
      count: counts[index],
      percentage: totalVoters > 0 ? Math.round((counts[index] / totalVoters) * 100) : 0
    }));

    return {
      id: poll.id,
      course_id: poll.course_id,
      session_id: poll.session_id,
      question: poll.question,
      options,
      allow_multiple: Boolean(poll.allow_multiple),
      is_active: Boolean(poll.is_active),
      total_votes: totalVoters,
      total_selections: totalSelections,
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
