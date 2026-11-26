require('dotenv').config();
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const DatabaseManager = require('./db/database');
const AuthService = require('./services/AuthService');
const AttendanceService = require('./services/AttendanceService');
const QAService = require('./services/QAService');
const PollService = require('./services/PollService');
const LLMService = require('./services/LLMService');
const HomeworkService = require('./services/HomeworkService');
const UserManagementService = require('./services/UserManagementService');

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function createApp(dbPath) {
  const dbManager = new DatabaseManager(dbPath);
  dbManager.seedInitialData();

  const authService = new AuthService(dbManager);
  const attendanceService = new AttendanceService(dbManager);
  const qaService = new QAService(dbManager);
  const pollService = new PollService(dbManager);
  const llmService = new LLMService(dbManager);
  const homeworkService = new HomeworkService(dbManager, llmService);
  const userManagementService = new UserManagementService(dbManager);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.static(path.join(__dirname, '../public')));

  const lanIp = getLocalLanIp();
  const port = process.env.PORT || 3000;

  function getBaseUrl(req) {
    const host = req.headers.host || `${lanIp}:${port}`;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    if (host.startsWith('localhost') && lanIp !== 'localhost') {
      return `${proto}://${lanIp}:${port}`;
    }
    return `${proto}://${host}`;
  }

  // ============================================================================
  // 1. AUTHENTICATION & ROLE SWITCHER (Google OAuth + Classroom Demo Profiles)
  // ============================================================================
  app.get('/api/auth/config', (req, res) => {
    res.json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      lanBaseUrl: `http://${lanIp}:${port}`
    });
  });

  // Real Google Sign-In: only a Google-signed ID token (credential) is accepted.
  app.post('/api/auth/google', async (req, res) => {
    try {
      const user = await authService.loginWithGoogleCredential(req.body && req.body.credential);
      const token = authService.issueSessionToken(user);
      res.json({ user, token });
    } catch (err) {
      res.status(401).json({ error: `Google sign-in failed: ${err.message}` });
    }
  });

  // Restore session after page refresh using the signed session token.
  app.get('/api/auth/me', (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = authService.getUserFromSessionToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    res.json({ user });
  });

  app.post('/api/auth/register', (req, res) => {
    try {
      const user = authService.registerWithPassword(req.body || {});
      res.json({ user, token: authService.issueSessionToken(user) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const user = authService.loginWithPassword(req.body || {});
      res.json({ user, token: authService.issueSessionToken(user) });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  // ============================================================================
  // 1b. ADMIN USER MANAGEMENT (server-side ADMIN check via signed session token)
  // ============================================================================
  function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const actor = authService.getUserFromSessionToken(token);
    if (!actor) return res.status(401).json({ error: 'Please sign in again' });
    if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
    req.actor = actor;
    next();
  }

  function sendUserMgmtError(res, err) {
    const status = err.message === 'User not found' || err.message === 'Course not found' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json({ users: userManagementService.listUsers(), courses: userManagementService.listAllCourses() });
  });

  app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
    try {
      res.json(userManagementService.getUserProfile(Number(req.params.id)));
    } catch (err) {
      sendUserMgmtError(res, err);
    }
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    try {
      const userId = Number(req.params.id);
      const user = userManagementService.setUserRole(req.actor.id, userId, req.body && req.body.role);
      io.emit('user:updated', { userId });
      res.json({ user });
    } catch (err) {
      sendUserMgmtError(res, err);
    }
  });

  app.post('/api/admin/users/:id/enrollments', requireAdmin, (req, res) => {
    try {
      const userId = Number(req.params.id);
      const profile = userManagementService.enrollUser(userId, Number(req.body && req.body.courseId));
      io.emit('user:updated', { userId });
      res.json(profile);
    } catch (err) {
      sendUserMgmtError(res, err);
    }
  });

  app.delete('/api/admin/users/:id/enrollments/:courseId', requireAdmin, (req, res) => {
    try {
      const userId = Number(req.params.id);
      const profile = userManagementService.unenrollUser(userId, Number(req.params.courseId));
      io.emit('user:updated', { userId });
      res.json(profile);
    } catch (err) {
      sendUserMgmtError(res, err);
    }
  });

  app.post('/api/admin/reset', (req, res) => {
    try {
      dbManager.resetAllDataForCleanDemo();
      io.emit('system:reset');
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================================
  // 2. MULTI-COURSE MANAGEMENT & SESSIONS
  // ============================================================================
  app.get('/api/courses', (req, res) => {
    try {
      const userId = Number(req.query.userId);
      const role = req.query.role || 'STUDENT';
      const courses = attendanceService.getCoursesForUser(userId, role);
      const allCourses = attendanceService.getAllCoursesWithActiveSession();
      res.json({ courses, allCourses });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/courses', (req, res) => {
    try {
      const { lecturerId, code, name, description } = req.body;
      const course = attendanceService.createCourse(Number(lecturerId), code, name, description);
      io.emit('course:created', course);
      res.json({ course });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sessions/start', async (req, res) => {
    try {
      const { courseId, title, lecturerLat, lecturerLng, maxDistanceMeters } = req.body;
      const session = attendanceService.startSession(
        Number(courseId),
        title,
        Number(lecturerLat || 32.1045),
        Number(lecturerLng || 35.2075),
        Number(maxDistanceMeters || 60)
      );

      const checkinUrl = `${getBaseUrl(req)}/?qr=${encodeURIComponent(session.qr_token)}&courseId=${session.course_id}`;
      const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'H', margin: 1, width: 280 });

      const enriched = { ...session, checkin_url: checkinUrl, qr_data_url: qrDataUrl };
      io.emit('session:updated', enriched);
      res.json({ session: enriched });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sessions/:id/end', (req, res) => {
    try {
      const session = attendanceService.endSession(Number(req.params.id));
      io.emit('session:updated', session);
      res.json({ session });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/courses/:courseId/active-session', async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const db = dbManager.getDb();
      const row = db
        .prepare('SELECT id FROM sessions WHERE course_id = ? ORDER BY is_active DESC, id DESC LIMIT 1')
        .get(courseId);
      if (!row) return res.json({ session: null });

      const session = attendanceService.getSessionWithStats(row.id);
      const checkinUrl = `${getBaseUrl(req)}/?qr=${encodeURIComponent(session.qr_token)}&courseId=${session.course_id}`;
      const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'H', margin: 1, width: 280 });

      res.json({ session: { ...session, checkin_url: checkinUrl, qr_data_url: qrDataUrl } });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================================
  // 3. FEATURE 1: DUAL-FACTOR ATTENDANCE, MOBILE ADMIN PHOTO COUNT & HISTORY
  // ============================================================================
  app.post('/api/attendance/checkin', (req, res) => {
    try {
      const result = attendanceService.checkInStudent(req.body);
      io.emit('attendance:updated', result.session);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Phone-to-PC Admin Classroom Photo Upload & Headcount Sync
  app.post('/api/sessions/:id/photo-audit', async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const { photoDataUrl, detectedCount } = req.body;
      const headcount = await llmService.countPeopleInClassroomPhoto(photoDataUrl, detectedCount);
      const updatedSession = attendanceService.updatePhotoHeadcount(sessionId, headcount, photoDataUrl);

      // Push live update & fraud alert to Lecturer's Laptop Projector Dashboard!
      io.emit('photo:audited', updatedSession);
      io.emit('attendance:updated', updatedSession);
      res.json({ session: updatedSession, headcount });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Lecturer Manual Attendance Edit
  app.patch('/api/attendance/manual', (req, res) => {
    try {
      const { sessionId, studentId, status } = req.body;
      const updatedSession = attendanceService.toggleManualAttendance(
        Number(sessionId),
        Number(studentId),
        status
      );
      io.emit('attendance:updated', updatedSession);
      res.json({ session: updatedSession });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Attendance History with Student Filtering Across All Lectures
  app.get('/api/courses/:courseId/attendance-history', (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const filterStudentId = req.query.studentId ? Number(req.query.studentId) : null;
      const history = attendanceService.getCourseAttendanceHistory(courseId, filterStudentId);
      res.json(history);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Offline Spreadsheet CSV/Excel Export
  app.get('/api/courses/:courseId/attendance-export.csv', (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const filterStudentId = req.query.studentId ? Number(req.query.studentId) : null;
      const csv = attendanceService.exportAttendanceCSV(courseId, filterStudentId);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="course_${courseId}_attendance.csv"`);
      res.send(csv);
    } catch (err) {
      res.status(400).send(err.message);
    }
  });

  // ============================================================================
  // 4. FEATURE 2: LIVE & OFFLINE Q&A (PROJECTOR POPUP + ANONYMOUS + HISTORY + PUSH)
  // ============================================================================
  app.get('/api/courses/:courseId/questions', (req, res) => {
    try {
      const questions = qaService.getQuestionsByCourse(Number(req.params.courseId));
      res.json({ questions });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/questions/history', (req, res) => {
    try {
      const history = qaService.getQuestionHistory({
        courseId: req.query.courseId ? Number(req.query.courseId) : null,
        lecturerId: req.query.lecturerId ? Number(req.query.lecturerId) : null,
        sessionId: req.query.sessionId || null,
        studentId: req.query.studentId || null,
        status: req.query.status || null,
        search: req.query.search || null
      });
      res.json(history);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/questions/history-export.csv', (req, res) => {
    try {
      const csv = qaService.exportQuestionsCSV({
        courseId: req.query.courseId ? Number(req.query.courseId) : null,
        lecturerId: req.query.lecturerId ? Number(req.query.lecturerId) : null,
        sessionId: req.query.sessionId || null,
        studentId: req.query.studentId || null,
        status: req.query.status || null,
        search: req.query.search || null
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="questions_history.csv"');
      res.send(csv);
    } catch (err) {
      res.status(400).send(err.message);
    }
  });

  app.post('/api/questions', (req, res) => {
    try {
      const { courseId, sessionId, studentId, content, isAnonymous } = req.body;
      const question = qaService.askQuestion(
        Number(courseId),
        sessionId ? Number(sessionId) : null,
        Number(studentId),
        content,
        Boolean(isAnonymous)
      );
      io.emit('question:new', question);
      res.json({ question });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/questions/:id/dismiss', (req, res) => {
    try {
      const question = qaService.dismissLiveQuestion(Number(req.params.id));
      io.emit('question:updated', question);
      res.json({ question });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/questions/:id/reply', (req, res) => {
    try {
      const authorUser = req.body.userId
        ? {
            id: Number(req.body.userId),
            name: req.body.authorName,
            role: req.body.authorRole || 'ADMIN'
          }
        : null;
      const question = qaService.replyToQuestion(Number(req.params.id), req.body.replyText, authorUser);
      const latestReply = question.replies[question.replies.length - 1] || {
        author_name: authorUser?.name || 'Lecturer',
        author_role: authorUser?.role || 'ADMIN',
        content: req.body.replyText
      };
      io.emit('question:updated', question);
      io.emit('question:replied', {
        question,
        reply: latestReply,
        target_student_id: question.student_id,
        replier_id: authorUser?.id || null
      });
      res.json({ question });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/questions/:id/replies', (req, res) => {
    try {
      const authorUser = {
        id: req.body.userId ? Number(req.body.userId) : null,
        name: req.body.authorName || 'Lecturer',
        role: req.body.authorRole || 'ADMIN'
      };
      const question = qaService.replyToQuestion(Number(req.params.id), req.body.replyText, authorUser);
      const latestReply = question.replies[question.replies.length - 1];
      io.emit('question:updated', question);
      io.emit('question:replied', {
        question,
        reply: latestReply,
        target_student_id: question.student_id,
        replier_id: authorUser.id
      });
      res.json({ question });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================================
  // 5. FEATURE 3: ON-THE-SPOT MULTIPLE-CHOICE (KISS) POLLS
  // ============================================================================
  app.get('/api/courses/:courseId/poll', async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const role = req.query.role || 'STUDENT';
      const studentId = req.query.studentId ? Number(req.query.studentId) : null;

      if (role === 'ADMIN') {
        const poll = pollService.getActivePollForLecturerByCourse(courseId);
        if (!poll) return res.json({ poll: null });
        const pollUrl = `${getBaseUrl(req)}/?pollId=${poll.id}&courseId=${courseId}`;
        const qrDataUrl = await QRCode.toDataURL(pollUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
        return res.json({ poll: { ...poll, poll_url: pollUrl, qr_data_url: qrDataUrl } });
      }

      const poll = pollService.getActivePollForStudent(courseId, studentId);
      res.json({ poll });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/polls', async (req, res) => {
    try {
      const { courseId, sessionId, question, options } = req.body;
      const poll = pollService.createPoll(Number(courseId), sessionId ? Number(sessionId) : null, question, options);
      const pollUrl = `${getBaseUrl(req)}/?pollId=${poll.id}&courseId=${courseId}`;
      const qrDataUrl = await QRCode.toDataURL(pollUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 });

      const enriched = { ...poll, poll_url: pollUrl, qr_data_url: qrDataUrl };
      io.emit('poll:started', {
        course_id: Number(courseId),
        studentPoll: {
          id: poll.id,
          course_id: poll.course_id,
          question: poll.question,
          options: poll.options,
          is_active: true,
          my_vote: null
        },
        lecturerPoll: enriched
      });
      res.json({ poll: enriched });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/polls/:id/vote', (req, res) => {
    try {
      const pollId = Number(req.params.id);
      const { studentId, optionIndex } = req.body;
      const confirmation = pollService.castVote(pollId, Number(studentId), Number(optionIndex));
      const updatedLecturerPoll = pollService.getPollForLecturer(pollId);

      // Push live bar-chart update exclusively to Lecturer screen
      io.emit('poll:results_updated', updatedLecturerPoll);
      res.json({ confirmation });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/polls/:id/close', (req, res) => {
    try {
      const poll = pollService.closePoll(Number(req.params.id));
      io.emit('poll:closed', poll);
      res.json({ poll });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================================
  // 6. FEATURE 4: LIVE LECTURE RECORDING / UPLOAD & ML SUMMARY (DRAFT -> PUBLISH)
  // ============================================================================
  app.get('/api/courses/:courseId/summaries', (req, res) => {
    try {
      const summaries = llmService.getSummariesForCourse(
        Number(req.params.courseId),
        req.query.role || 'STUDENT'
      );
      res.json({ summaries });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/summaries/generate', async (req, res) => {
    try {
      const { courseId, sessionId, title, transcript } = req.body;
      const allQuestions = qaService.getQuestionsByCourse(Number(courseId));
      const sessionQuestions = sessionId
        ? allQuestions.filter((q) => q.session_id === Number(sessionId))
        : allQuestions.slice(0, 5);

      const summary = await llmService.generateLectureSummary({
        courseId: Number(courseId),
        sessionId: sessionId ? Number(sessionId) : null,
        title,
        transcript,
        liveQuestions: sessionQuestions
      });
      res.json({ summary });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/summaries/:id/publish', (req, res) => {
    try {
      const summary = llmService.publishLectureSummary(
        Number(req.params.id),
        req.body.summaryMarkdown,
        req.body.title
      );
      io.emit('summary:published', summary);
      res.json({ summary });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================================
  // 7. FEATURE 5: CONFIGURABLE HOMEWORK & ON-DEMAND LLM PEER COMPARISON
  // ============================================================================
  app.get('/api/courses/:courseId/assignments', (req, res) => {
    try {
      const assignments = homeworkService.getAssignmentsByCourse(Number(req.params.courseId));
      res.json({ assignments });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/assignments', (req, res) => {
    try {
      const { courseId, title, description, submissionType, dueDate } = req.body;
      const assignment = homeworkService.createAssignment(
        Number(courseId),
        title,
        description,
        submissionType,
        dueDate
      );
      io.emit('assignment:created', assignment);
      res.json({ assignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/assignments/:id/submissions', (req, res) => {
    try {
      const assignmentId = Number(req.params.id);
      const submissions = homeworkService.getAssignmentSubmissions(assignmentId);
      res.json({ submissions });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/submissions', (req, res) => {
    try {
      const submission = homeworkService.submitHomework({
        assignmentId: Number(req.body.assignmentId),
        studentId: Number(req.body.studentId),
        repoUrl: req.body.repoUrl,
        content: req.body.content,
        fileName: req.body.fileName
      });
      io.emit('submission:updated', submission);
      res.json({ submission });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/submissions/:id/analyze', async (req, res) => {
    try {
      const submission = await homeworkService.generateOnDemandReview(Number(req.params.id));
      io.emit('submission:analyzed', submission);
      res.json({ submission });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return { app, server, io, dbManager, services: { authService, attendanceService, qaService, pollService, llmService, homeworkService, userManagementService } };
}

if (require.main === module) {
  const { server } = createApp();
  const port = process.env.PORT || 3000;
  const lanIp = getLocalLanIp();
  server.listen(port, () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 LiveClass AI Server running!`);
    console.log(`🖥️  Lecturer Projector URL: http://localhost:${port}`);
    console.log(`📱 Mobile LAN URL (QR):    http://${lanIp}:${port}`);
    console.log(`=============================================================\n`);
  });
}

module.exports = { createApp };
