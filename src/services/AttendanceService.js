const crypto = require('node:crypto');

class AttendanceService {
  constructor(dbManager) {
    this.db = dbManager.getDb();
  }

  createCourse(lecturerId, code, name, description = '') {
    if (!code || !name) {
      throw new Error('Course code and name are required');
    }
    const res = this.db
      .prepare('INSERT INTO courses (code, name, description, lecturer_id) VALUES (?, ?, ?, ?)')
      .run(code.trim(), name.trim(), description.trim(), lecturerId);
    return this.getCourseById(Number(res.lastInsertRowid));
  }

  getCourseById(courseId) {
    return this.db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  }

  /**
   * Returns all courses for ADMIN (Lecturer), or enrolled courses for STUDENT
   */
  getCoursesForUser(userId, role) {
    if (role === 'ADMIN') {
      return this.db
        .prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count,
            (SELECT id FROM sessions s WHERE s.course_id = c.id AND s.is_active = 1 ORDER BY id DESC LIMIT 1) AS active_session_id
          FROM courses c
          ORDER BY c.id ASC
        `)
        .all();
    }
    return this.db
      .prepare(`
        SELECT c.*, e.enrolled_at,
          (SELECT id FROM sessions s WHERE s.course_id = c.id AND s.is_active = 1 ORDER BY id DESC LIMIT 1) AS active_session_id
        FROM courses c
        INNER JOIN enrollments e ON e.course_id = c.id
        WHERE e.student_id = ?
        ORDER BY c.id ASC
      `)
      .all(userId);
  }

  getAllCoursesWithActiveSession() {
    return this.db
      .prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count,
          (SELECT id FROM sessions s WHERE s.course_id = c.id AND s.is_active = 1 ORDER BY id DESC LIMIT 1) AS active_session_id
        FROM courses c
        ORDER BY c.id ASC
      `)
      .all();
  }

  /**
   * Auto-enrolls a student in the course (triggered on first-lecture QR scan)
   */
  enrollStudent(courseId, studentId) {
    this.db
      .prepare('INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)')
      .run(courseId, studentId);
    return this.db
      .prepare('SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?')
      .get(courseId, studentId);
  }

  startSession(courseId, title, lecturerLat = 32.1045, lecturerLng = 35.2075, maxDistanceMeters = 60) {
    // Deactivate prior active sessions for this course
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE course_id = ?').run(courseId);

    const qrToken = `SES-${courseId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const res = this.db
      .prepare(`
        INSERT INTO sessions (course_id, title, qr_token, lecturer_lat, lecturer_lng, max_distance_meters, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `)
      .run(courseId, title || `Live Lecture (${new Date().toLocaleDateString()})`, qrToken, lecturerLat, lecturerLng, maxDistanceMeters);

    return this.getSessionWithStats(Number(res.lastInsertRowid));
  }

  endSession(sessionId) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);
    return this.getSessionWithStats(sessionId);
  }

  getSessionByToken(qrToken) {
    return this.db.prepare('SELECT * FROM sessions WHERE qr_token = ?').get(qrToken);
  }

  getSessionWithStats(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const records = this.db
      .prepare(`
        SELECT a.*, u.name AS student_name, u.email AS student_email, u.picture AS student_picture
        FROM attendance a
        INNER JOIN users u ON u.id = a.student_id
        WHERE a.session_id = ?
        ORDER BY a.checked_in_at DESC
      `)
      .all(sessionId);

    const enrolledStudents = this.db
      .prepare(`
        SELECT u.id, u.name, u.email, u.picture
        FROM users u
        INNER JOIN enrollments e ON e.student_id = u.id
        WHERE e.course_id = ? AND u.role = 'STUDENT'
        ORDER BY u.name ASC
      `)
      .all(session.course_id);

    const presentCount = records.filter((r) => r.status === 'PRESENT').length;
    const fraudAlert =
      session.photo_headcount !== null &&
      session.photo_headcount !== undefined &&
      presentCount > session.photo_headcount;

    return {
      ...session,
      present_count: presentCount,
      total_enrolled: enrolledStudents.length,
      fraud_alert: fraudAlert,
      discrepancy_count: fraudAlert ? presentCount - session.photo_headcount : 0,
      attendance_records: records,
      enrolled_students: enrolledStudents
    };
  }

  /**
   * Computes great-circle distance in meters between two GPS coordinates using the Haversine formula
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000; // Earth radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  /**
   * Checks in a student either via First-Lecture QR Scan (which auto-enrolls them)
   * or from the Course Page in Lecture 2+ while a session is active.
   */
  checkInStudent({ sessionId, qrToken, courseId, studentId, studentLat, studentLng }) {
    let session = null;
    if (qrToken) {
      session = this.getSessionByToken(qrToken);
    } else if (sessionId) {
      session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    } else if (courseId) {
      session = this.db
        .prepare('SELECT * FROM sessions WHERE course_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
        .get(courseId);
    }

    if (!session) {
      throw new Error('No matching lecture session found.');
    }
    if (!session.is_active) {
      throw new Error('This lecture session is closed and no longer accepting live check-ins.');
    }

    // Auto-enroll the student in the course (First-Lecture QR scan or direct join)
    this.enrollStudent(session.course_id, studentId);

    const lat = studentLat !== undefined && studentLat !== null ? Number(studentLat) : session.lecturer_lat;
    const lng = studentLng !== undefined && studentLng !== null ? Number(studentLng) : session.lecturer_lng;

    const distanceMeters = this.calculateHaversineDistance(
      session.lecturer_lat,
      session.lecturer_lng,
      lat,
      lng
    );

    const isWithinRange = distanceMeters <= session.max_distance_meters;
    const status = isWithinRange ? 'PRESENT' : 'OUT_OF_RANGE';

    this.db
      .prepare(`
        INSERT INTO attendance (session_id, student_id, student_lat, student_lng, distance_meters, status, manual_override, checked_in_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
        ON CONFLICT(session_id, student_id) DO UPDATE SET
          student_lat = excluded.student_lat,
          student_lng = excluded.student_lng,
          distance_meters = excluded.distance_meters,
          status = excluded.status,
          checked_in_at = datetime('now')
      `)
      .run(session.id, studentId, lat, lng, distanceMeters, status);

    return {
      session: this.getSessionWithStats(session.id),
      checkIn: {
        session_id: session.id,
        course_id: session.course_id,
        student_id: studentId,
        distance_meters: distanceMeters,
        max_distance_meters: session.max_distance_meters,
        status,
        verified: isWithinRange
      }
    };
  }

  /**
   * Updates the AI classroom photo headcount (sent from Lecturer's Mobile Admin Camera or PC)
   * and evaluates whether Registered Students > Photo Headcount.
   */
  updatePhotoHeadcount(sessionId, count, photoDataUrl = null) {
    this.db
      .prepare('UPDATE sessions SET photo_headcount = ?, photo_data_url = COALESCE(?, photo_data_url) WHERE id = ?')
      .run(Number(count), photoDataUrl, sessionId);
    return this.getSessionWithStats(sessionId);
  }

  /**
   * Allows the lecturer to manually mark/unmark any student as PRESENT or ABSENT
   */
  toggleManualAttendance(sessionId, studentId, status) {
    if (!['PRESENT', 'ABSENT', 'OUT_OF_RANGE'].includes(status)) {
      throw new Error('Invalid attendance status');
    }
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) throw new Error('Session not found');

    this.enrollStudent(session.course_id, studentId);

    this.db
      .prepare(`
        INSERT INTO attendance (session_id, student_id, student_lat, student_lng, distance_meters, status, manual_override, checked_in_at)
        VALUES (?, ?, ?, ?, 0, ?, 1, datetime('now'))
        ON CONFLICT(session_id, student_id) DO UPDATE SET
          status = excluded.status,
          manual_override = 1
      `)
      .run(sessionId, studentId, session.lecturer_lat, session.lecturer_lng, status);

    return this.getSessionWithStats(sessionId);
  }

  /**
   * Returns complete attendance history for a course, with optional filtering by a specific student across all lectures!
   */
  getCourseAttendanceHistory(courseId, filterStudentId = null) {
    const sessions = this.db
      .prepare('SELECT * FROM sessions WHERE course_id = ? ORDER BY created_at ASC, id ASC')
      .all(courseId);

    let studentsQuery = `
      SELECT u.id, u.name, u.email, u.picture
      FROM users u
      INNER JOIN enrollments e ON e.student_id = u.id
      WHERE e.course_id = ? AND u.role = 'STUDENT'
    `;
    const params = [courseId];
    if (filterStudentId) {
      studentsQuery += ' AND u.id = ?';
      params.push(Number(filterStudentId));
    }
    studentsQuery += ' ORDER BY u.name ASC';
    const students = this.db.prepare(studentsQuery).all(...params);

    const allAttendance = this.db
      .prepare(`
        SELECT a.*
        FROM attendance a
        INNER JOIN sessions s ON s.id = a.session_id
        WHERE s.course_id = ?
      `)
      .all(courseId);

    const attMap = new Map();
    for (const rec of allAttendance) {
      attMap.set(`${rec.session_id}_${rec.student_id}`, rec);
    }

    const studentRows = students.map((stu) => {
      let presentSessions = 0;
      const sessionStatuses = sessions.map((ses) => {
        const rec = attMap.get(`${ses.id}_${stu.id}`);
        const status = rec ? rec.status : 'ABSENT';
        if (status === 'PRESENT') presentSessions++;
        return {
          session_id: ses.id,
          session_title: ses.title,
          session_date: ses.created_at,
          status,
          distance_meters: rec ? rec.distance_meters : null,
          manual_override: rec ? Boolean(rec.manual_override) : false,
          checked_in_at: rec ? rec.checked_in_at : null
        };
      });

      const attendanceRate =
        sessions.length > 0 ? Math.round((presentSessions / sessions.length) * 100) : 0;

      return {
        student: stu,
        present_sessions: presentSessions,
        total_sessions: sessions.length,
        attendance_rate: attendanceRate,
        sessions: sessionStatuses
      };
    });

    return {
      course_id: Number(courseId),
      filter_student_id: filterStudentId ? Number(filterStudentId) : null,
      sessions,
      students: studentRows
    };
  }

  /**
   * Generates an Excel-compatible UTF-8 BOM CSV spreadsheet of course/session attendance (without Student ID numbers per Q&A #6)
   */
  exportAttendanceCSV(courseId, filterStudentId = null) {
    const history = this.getCourseAttendanceHistory(courseId, filterStudentId);
    const sessionHeaders = history.sessions.map((s) => `"${s.title.replace(/"/g, '""')}"`);
    const headerRow = [
      '"Student Name"',
      '"Email"',
      '"Attended Lectures"',
      '"Total Lectures"',
      '"Attendance Rate (%)"',
      ...sessionHeaders
    ].join(',');

    const rows = [headerRow];
    for (const row of history.students) {
      const cols = [
        `"${row.student.name.replace(/"/g, '""')}"`,
        `"${row.student.email}"`,
        row.present_sessions,
        row.total_sessions,
        `${row.attendance_rate}%`,
        ...row.sessions.map((s) => {
          if (s.status === 'PRESENT') {
            return `"PRESENT (${s.distance_meters ?? 0}m${s.manual_override ? ' Manual' : ''})"`;
          }
          return `"${s.status}"`;
        })
      ];
      rows.push(cols.join(','));
    }

    return '\uFEFF' + rows.join('\r\n');
  }
}

module.exports = AttendanceService;
