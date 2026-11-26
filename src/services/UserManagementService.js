/**
 * UserManagementService — admin-only user administration:
 * list users, change roles, manage course enrollments, and inspect a user's full activity
 * (attendance per session, questions, poll votes, homework submissions, taught courses).
 */
class UserManagementService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.picture, u.role, u.created_at,
           (u.google_id IS NOT NULL) AS has_google,
           (u.password_hash IS NOT NULL) AS has_password,
           (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = u.id) AS enrolled_count,
           (SELECT COUNT(*) FROM courses c WHERE c.lecturer_id = u.id) AS taught_count,
           (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND a.status = 'PRESENT') AS present_count,
           (SELECT COUNT(*) FROM questions q WHERE q.student_id = u.id) AS question_count,
           (SELECT COUNT(*) FROM poll_votes v WHERE v.student_id = u.id) AS vote_count,
           (SELECT COUNT(*) FROM submissions s WHERE s.student_id = u.id) AS submission_count
         FROM users u
         ORDER BY u.role ASC, u.name COLLATE NOCASE ASC`
      )
      .all()
      .map((u) => ({ ...u, has_google: Boolean(u.has_google), has_password: Boolean(u.has_password) }));
  }

  listAllCourses() {
    return this.db
      .prepare(
        `SELECT c.id, c.code, c.name, c.lecturer_id, u.name AS lecturer_name
         FROM courses c LEFT JOIN users u ON u.id = c.lecturer_id
         ORDER BY c.code COLLATE NOCASE`
      )
      .all();
  }

  _requireUser(userId) {
    const user = this.db
      .prepare('SELECT id, email, name, picture, role, created_at, google_id, password_hash FROM users WHERE id = ?')
      .get(userId);
    if (!user) throw new Error('User not found');
    return user;
  }

  getUserProfile(userId) {
    const raw = this._requireUser(userId);
    const user = {
      id: raw.id,
      email: raw.email,
      name: raw.name,
      picture: raw.picture,
      role: raw.role,
      created_at: raw.created_at,
      has_google: Boolean(raw.google_id),
      has_password: Boolean(raw.password_hash)
    };

    const enrolledCourses = this.db
      .prepare(
        `SELECT c.id, c.code, c.name, e.enrolled_at, l.name AS lecturer_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN users l ON l.id = c.lecturer_id
         WHERE e.student_id = ? ORDER BY c.code COLLATE NOCASE`
      )
      .all(userId);

    const taughtCourses = this.db
      .prepare(
        `SELECT c.id, c.code, c.name,
           (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count,
           (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS session_count
         FROM courses c WHERE c.lecturer_id = ? ORDER BY c.code COLLATE NOCASE`
      )
      .all(userId);

    // Every session of every enrolled course (missing check-in => ABSENT), plus any
    // check-ins in courses the user is not (or no longer) enrolled in.
    const attendance = this.db
      .prepare(
        `SELECT s.id AS session_id, s.title AS session_title, s.created_at AS session_date,
           c.id AS course_id, c.code AS course_code, c.name AS course_name,
           COALESCE(a.status, 'ABSENT') AS status, a.distance_meters, a.manual_override, a.checked_in_at
         FROM sessions s
         JOIN courses c ON c.id = s.course_id
         LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = ?
         WHERE s.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)
            OR a.id IS NOT NULL
         ORDER BY s.created_at DESC, s.id DESC`
      )
      .all(userId, userId)
      .map((r) => ({ ...r, manual_override: Boolean(r.manual_override) }));

    const attendanceSummary = {
      total: attendance.length,
      present: attendance.filter((r) => r.status === 'PRESENT').length,
      outOfRange: attendance.filter((r) => r.status === 'OUT_OF_RANGE').length,
      absent: attendance.filter((r) => r.status === 'ABSENT').length
    };

    const questions = this.db
      .prepare(
        `SELECT q.id, q.content, q.is_anonymous, q.is_live, q.lecturer_reply, q.created_at,
           c.code AS course_code, c.name AS course_name, s.title AS session_title
         FROM questions q
         JOIN courses c ON c.id = q.course_id
         LEFT JOIN sessions s ON s.id = q.session_id
         WHERE q.student_id = ? ORDER BY q.created_at DESC, q.id DESC`
      )
      .all(userId)
      .map((q) => ({ ...q, is_anonymous: Boolean(q.is_anonymous), is_live: Boolean(q.is_live) }));

    const pollVotes = this.db
      .prepare(
        `SELECT v.id, v.option_index, v.option_indices_json, v.voted_at, p.id AS poll_id, p.question, p.options_json, p.is_active,
           c.code AS course_code, c.name AS course_name
         FROM poll_votes v
         JOIN polls p ON p.id = v.poll_id
         JOIN courses c ON c.id = p.course_id
         WHERE v.student_id = ? ORDER BY v.voted_at DESC, v.id DESC`
      )
      .all(userId)
      .map(({ options_json, option_indices_json, ...v }) => {
        let options = [];
        try {
          options = JSON.parse(options_json);
        } catch {
          options = [];
        }
        let indices = [v.option_index];
        if (option_indices_json) {
          try {
            const parsed = JSON.parse(option_indices_json);
            if (Array.isArray(parsed) && parsed.length > 0) indices = parsed.map(Number);
          } catch {
            // fallback to option_index
          }
        }
        const chosen_option = indices.map((idx) => options[idx] ?? `#${idx + 1}`).join(', ');
        return { ...v, is_active: Boolean(v.is_active), chosen_option };
      });

    const submissions = this.db
      .prepare(
        `SELECT sub.id, sub.repo_url, sub.file_name, sub.score, sub.submitted_at,
           (sub.llm_review IS NOT NULL) AS has_review,
           a.id AS assignment_id, a.title AS assignment_title, a.due_date,
           c.code AS course_code, c.name AS course_name
         FROM submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
         JOIN courses c ON c.id = a.course_id
         WHERE sub.student_id = ? ORDER BY sub.submitted_at DESC, sub.id DESC`
      )
      .all(userId)
      .map((s) => ({ ...s, has_review: Boolean(s.has_review) }));

    return { user, enrolledCourses, taughtCourses, attendance, attendanceSummary, questions, pollVotes, submissions };
  }

  /**
   * Changes a user's role. Guards: an admin cannot demote themselves, and the last ADMIN can't be demoted.
   */
  setUserRole(actorId, userId, role) {
    if (!['ADMIN', 'STUDENT'].includes(role)) {
      throw new Error('Invalid role. Must be ADMIN or STUDENT.');
    }
    const target = this._requireUser(userId);
    if (target.role === role) return this.getUserProfile(userId).user;

    if (role === 'STUDENT') {
      if (Number(actorId) === Number(userId)) {
        throw new Error('You cannot remove your own ADMIN role');
      }
      const admins = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'").get().n;
      if (admins <= 1) {
        throw new Error('Cannot demote the last ADMIN');
      }
    }
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    return this.getUserProfile(userId).user;
  }

  enrollUser(userId, courseId) {
    this._requireUser(userId);
    const course = this.db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
    if (!course) throw new Error('Course not found');
    this.db.prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)').run(courseId, userId);
    return this.getUserProfile(userId);
  }

  /**
   * Removes the enrollment only. Historical attendance/questions/submissions are kept.
   */
  unenrollUser(userId, courseId) {
    this._requireUser(userId);
    this.db.prepare('DELETE FROM enrollments WHERE course_id = ? AND student_id = ?').run(courseId, userId);
    return this.getUserProfile(userId);
  }
}

module.exports = UserManagementService;
