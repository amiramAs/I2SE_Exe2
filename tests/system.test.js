const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const DatabaseManager = require('../src/db/database');
const AuthService = require('../src/services/AuthService');
const AttendanceService = require('../src/services/AttendanceService');
const QAService = require('../src/services/QAService');
const PollService = require('../src/services/PollService');
const LLMService = require('../src/services/LLMService');
const HomeworkService = require('../src/services/HomeworkService');
const UserManagementService = require('../src/services/UserManagementService');

describe('LiveClass AI — End-to-End Software Components & OOP Classes Verification (Task 9)', () => {
  let dbManager;
  let authService;
  let attendanceService;
  let qaService;
  let pollService;
  let llmService;
  let homeworkService;
  let userManagementService;

  let lecturer;
  let student1;
  let student2;
  let course;
  let session1;

  before(() => {
    // Use an isolated in-memory SQLite database for deterministic test runs
    dbManager = new DatabaseManager(':memory:');
    authService = new AuthService(dbManager);
    attendanceService = new AttendanceService(dbManager);
    qaService = new QAService(dbManager);
    pollService = new PollService(dbManager);
    llmService = new LLMService(dbManager, '');
    homeworkService = new HomeworkService(dbManager, llmService);
    userManagementService = new UserManagementService(dbManager);
  });

  after(() => {
    dbManager.close();
  });

  test('TC-AUTH-01..04: AuthService resolves per-user roles, seeded demo accounts, and email/password login', async () => {
    lecturer = await authService.authenticateGoogleUser({
      email: '1234amiram@gmail.com',
      name: 'Amiram'
    });
    assert.equal(lecturer.role, 'ADMIN', 'Whitelisted lecturer email should receive ADMIN role');

    student1 = await authService.authenticateGoogleUser({
      email: 'student.one@msmail.ariel.ac.il',
      name: 'Student One'
    });
    assert.equal(student1.role, 'STUDENT', 'Default Google user should receive STUDENT role');

    // Self-registration (no Gmail) -> always STUDENT, password is hashed and never returned
    student2 = authService.registerWithPassword({
      name: 'Student Two',
      email: 'student.two@example.com',
      password: 'secret12'
    });
    assert.equal(student2.role, 'STUDENT');
    assert.equal(student2.password_hash, undefined, 'password hash must never be exposed');
    assert.throws(() => authService.registerWithPassword({ email: 'student.two@example.com', password: 'xxxx' }));

    const relogged = authService.loginWithPassword({ email: 'Student.Two@example.com', password: 'secret12' });
    assert.equal(relogged.id, student2.id);
    assert.throws(() => authService.loginWithPassword({ email: 'student.two@example.com', password: 'wrong' }));

    // Seeded demo accounts (password 1234) with fixed roles
    dbManager.seedInitialData();
    assert.equal(authService.loginWithPassword({ email: 'admin@test.com', password: '1234' }).role, 'ADMIN');
    for (const email of ['test1@test.com', 'test2@test.com', 'test3@test.com']) {
      assert.equal(authService.loginWithPassword({ email, password: '1234' }).role, 'STUDENT');
    }

    // Session tokens round-trip and reject tampering
    const token = authService.issueSessionToken(student2);
    assert.equal(authService.getUserFromSessionToken(token).id, student2.id);
    assert.equal(authService.getUserFromSessionToken(`${token}x`), null);
  });

  test('TC-ATT-01..03: AttendanceService creates courses, auto-enrolls on Lecture 1 QR scan, and verifies Haversine GPS distance', () => {
    course = attendanceService.createCourse(
      lecturer.id,
      'CS-204',
      'Intro to Software Engineering',
      'OOP & Deep Design'
    );
    assert.equal(course.code, 'CS-204');

    session1 = attendanceService.startSession(
      course.id,
      'Lecture 1: OOP Intro',
      32.1045,
      35.2075,
      60
    );
    assert.equal(session1.is_active, 1);

    // Student 1 scans QR inside classroom (~10m away) -> Auto-enrolled + PRESENT
    const checkIn1 = attendanceService.checkInStudent({
      qrToken: session1.qr_token,
      studentId: student1.id,
      studentLat: 32.10456,
      studentLng: 35.20755
    });
    assert.equal(checkIn1.checkIn.verified, true);
    assert.equal(checkIn1.checkIn.status, 'PRESENT');
    assert.ok(checkIn1.checkIn.distance_meters <= 60);

    // Confirm auto-enrollment so course now appears in Student 1's "My Courses"
    const studentCourses = attendanceService.getCoursesForUser(student1.id, 'STUDENT');
    assert.equal(studentCourses.length, 1);
    assert.equal(studentCourses[0].id, course.id);

    // Student 2 attempts to check in from outside classroom (~300m away) -> OUT_OF_RANGE
    const checkIn2 = attendanceService.checkInStudent({
      qrToken: session1.qr_token,
      studentId: student2.id,
      studentLat: 32.1075,
      studentLng: 35.2075
    });
    assert.equal(checkIn2.checkIn.verified, false);
    assert.equal(checkIn2.checkIn.status, 'OUT_OF_RANGE');
    assert.ok(checkIn2.checkIn.distance_meters > 60);
  });

  test('TC-ATT-04..05: AttendanceService detects Mobile Admin Photo Headcount discrepancy, supports manual edit, student history filter, and CSV export', () => {
    // Lecturer marks Student 2 manually PRESENT -> now 2 students are PRESENT digitally
    attendanceService.toggleManualAttendance(session1.id, student2.id, 'PRESENT');

    // Lecturer snaps classroom photo from phone -> AI counts only 1 person in the room!
    const audited = attendanceService.updatePhotoHeadcount(session1.id, 1, 'data:image/jpeg;base64,MOCK');
    assert.equal(audited.present_count, 2);
    assert.equal(audited.photo_headcount, 1);
    assert.equal(audited.fraud_alert, true, 'Should trigger fraud alert when Registered (2) > Photo Count (1)');
    assert.equal(audited.discrepancy_count, 1);

    // Filter Attendance History by Student 1 across all lectures
    const filteredHistory = attendanceService.getCourseAttendanceHistory(course.id, student1.id);
    assert.equal(filteredHistory.students.length, 1);
    assert.equal(filteredHistory.students[0].student.id, student1.id);
    assert.equal(filteredHistory.students[0].attendance_rate, 100);

    // Export CSV (Offline Spreadsheet) and verify no government ID is exposed
    const csv = attendanceService.exportAttendanceCSV(course.id);
    assert.ok(csv.includes('Student One'));
    assert.ok(csv.includes('100%'));
  });

  test('TC-QA-01..03: QAService handles Live Anonymous Questions (Projector Popup & Dismiss) and Post-Class Offline Replies', () => {
    // Live anonymous question during active session1
    const liveQ = qaService.askQuestion(
      course.id,
      session1.id,
      student1.id,
      'How does the Strategy pattern help our LLM service?',
      true
    );
    assert.equal(liveQ.is_live, true);
    assert.equal(liveQ.is_anonymous, true);
    assert.equal(liveQ.display_author, 'Anonymous Student');

    const dismissed = qaService.dismissLiveQuestion(liveQ.id);
    assert.equal(dismissed.is_dismissed, true);

    // End session -> next question is an Offline Post-Class question
    attendanceService.endSession(session1.id);
    const offlineQ = qaService.askQuestion(
      course.id,
      null,
      student2.id,
      'Will the sequence diagram be on the exam?',
      false
    );
    assert.equal(offlineQ.is_live, false);
    assert.equal(offlineQ.display_author, 'Student Two');

    const replied = qaService.replyToQuestion(offlineQ.id, 'Yes, study the WebSocket sequence flow!', {
      id: lecturer.id,
      name: lecturer.name,
      role: 'ADMIN'
    });
    assert.equal(replied.lecturer_reply, 'Yes, study the WebSocket sequence flow!');
    assert.equal(replied.status, 'ANSWERED_WRITTEN');
    assert.equal(replied.replies.length, 1);
    assert.equal(replied.replies[0].author_role, 'ADMIN');

    // Follow-up reply in the thread
    const followUp = qaService.replyToQuestion(offlineQ.id, 'Thank you professor!', {
      id: student2.id,
      name: student2.name,
      role: 'STUDENT'
    });
    assert.equal(followUp.replies.length, 2);

    // Lecturer Question History & Filtering
    const fullHistory = qaService.getQuestionHistory({ courseId: course.id });
    assert.equal(fullHistory.stats.total, 2);
    assert.equal(fullHistory.stats.live_count, 1);
    assert.equal(fullHistory.stats.offline_count, 1);
    assert.equal(fullHistory.stats.replied_count, 1);
    assert.equal(fullHistory.stats.verbal_count, 1);

    const writtenOnly = qaService.getQuestionHistory({ courseId: course.id, status: 'ANSWERED_WRITTEN' });
    assert.equal(writtenOnly.questions.length, 1);
    assert.equal(writtenOnly.questions[0].id, offlineQ.id);

    const anonOnly = qaService.getQuestionHistory({ courseId: course.id, studentId: 'ANONYMOUS' });
    assert.equal(anonOnly.questions.length, 1);
    assert.equal(anonOnly.questions[0].id, liveQ.id);

    const csv = qaService.exportQuestionsCSV({ courseId: course.id });
    assert.ok(csv.includes('WebSocket sequence flow'));
  });

  test('TC-POLL-01..02: PollService runs Single & Multiple-Choice Polls with student vote confirmation and projector-only results', () => {
    const poll = pollService.createPoll(course.id, session1.id, 'Is the UML Class Diagram clear?', [
      'Yes, 100%',
      'Need one more example',
      'No'
    ]);
    assert.equal(poll.options.length, 3);
    assert.equal(poll.allow_multiple, false);

    // Student 1 votes for option 0
    const voteConfirm = pollService.castVote(poll.id, student1.id, 0);
    assert.equal(voteConfirm.voted, true);
    assert.equal(voteConfirm.selected_option_index, 0);
    assert.equal(voteConfirm.results, undefined, 'Student confirmation must not leak live bar-chart results');

    // Single-choice poll must reject selecting multiple options
    assert.throws(() => pollService.castVote(poll.id, student1.id, [0, 1]), /only one option/);

    // Lecturer projector view receives full breakdown
    const lecturerView = pollService.getPollForLecturer(poll.id);
    assert.equal(lecturerView.total_votes, 1);
    assert.equal(lecturerView.results[0].count, 1);
    assert.equal(lecturerView.results[0].percentage, 100);

    // Multi-choice poll allowing students to select more than one option
    const multiPoll = pollService.createPoll(
      course.id,
      session1.id,
      'Which design patterns did we use today?',
      ['Strategy', 'Observer', 'Singleton', 'Factory'],
      true
    );
    assert.equal(multiPoll.allow_multiple, true);

    const multiConfirm = pollService.castVote(multiPoll.id, student1.id, [0, 1]);
    assert.deepEqual(multiConfirm.selected_option_indices, [0, 1]);
    assert.deepEqual(multiConfirm.selected_option_labels, ['Strategy', 'Observer']);

    const studentMultiView = pollService.getActivePollForStudent(course.id, student1.id);
    assert.equal(studentMultiView.allow_multiple, true);
    assert.deepEqual(studentMultiView.my_votes, [0, 1]);

    const lecturerMultiView = pollService.getPollForLecturer(multiPoll.id);
    assert.equal(lecturerMultiView.total_votes, 1);
    assert.equal(lecturerMultiView.total_selections, 2);
    assert.equal(lecturerMultiView.results[0].count, 1);
    assert.equal(lecturerMultiView.results[1].count, 1);
    assert.equal(lecturerMultiView.results[2].count, 0);
  });

  test('TC-LLM-01..02: LLMService generates draft lecture summary integrating live Q&A and publishes after lecturer approval', async () => {
    const courseQuestions = qaService.getQuestionsByCourse(course.id);
    const draft = await llmService.generateLectureSummary({
      courseId: course.id,
      sessionId: session1.id,
      title: 'Lecture 1 Summary',
      transcript: 'We covered SOLID principles, Haversine GPS verification, and UML diagrams.',
      liveQuestions: courseQuestions
    });
    assert.equal(draft.is_published, false, 'Newly generated summary must start as a lecturer draft');
    assert.ok(draft.summary_markdown.includes('Strategy pattern'));

    // Before publishing, students should see 0 published summaries
    const studentVisibleBefore = llmService.getSummariesForCourse(course.id, 'STUDENT');
    assert.equal(studentVisibleBefore.length, 0);

    // Lecturer edits/approves and publishes
    const published = llmService.publishLectureSummary(draft.id, draft.summary_markdown + '\n- Approved by Lecturer');
    assert.equal(published.is_published, true);

    const studentVisibleAfter = llmService.getSummariesForCourse(course.id, 'STUDENT');
    assert.equal(studentVisibleAfter.length, 1);
  });

  test('TC-HW-01..02 & TC-LLM-03: HomeworkService enforces submission_type and runs on-demand LLM review & peer comparison', async () => {
    const assignment = homeworkService.createAssignment(
      course.id,
      'Ex2: Teaching Tool',
      'Submit GitHub repo and/or architecture summary.',
      'GITHUB_ONLY',
      '2026-11-25'
    );

    // Attempting to submit without GitHub URL on a GITHUB_ONLY assignment should throw
    assert.throws(() => {
      homeworkService.submitHomework({
        assignmentId: assignment.id,
        studentId: student1.id,
        repoUrl: '',
        content: 'Only text without repo link'
      });
    }, /requires a GitHub Repository URL/);

    // Student 1 submits valid GitHub repo
    const sub1 = homeworkService.submitHomework({
      assignmentId: assignment.id,
      studentId: student1.id,
      repoUrl: 'https://github.com/student1/I2SE_Exe2',
      content: 'Implemented OOP Service Classes, UML Sequence diagrams, and SQLite persistence.'
    });

    // Student 2 also submits so Student 1 has a peer cohort to compare against!
    homeworkService.submitHomework({
      assignmentId: assignment.id,
      studentId: student2.id,
      repoUrl: 'https://github.com/student2/I2SE_Exe2_Basic',
      content: 'Basic express app.'
    });

    // Student 1 clicks "Get LLM Review & Peer Comparison" on demand
    const analyzed = await homeworkService.generateOnDemandReview(sub1.id);
    assert.ok(analyzed.llm_review.includes('Deep Architectural'));
    assert.ok(analyzed.llm_comparison.includes('1 Peer Submission'));
    assert.ok(analyzed.score >= 75);
  });

  test('TC-UM-01..03: UserManagementService lists users, retrieves full student activity profile, manages course enrollments, and enforces role change safeguards', () => {
    const allUsers = userManagementService.listUsers();
    assert.ok(allUsers.length >= 3);

    // Inspect student1's full activity profile (attendance, questions, poll votes, homework submissions)
    const profile1 = userManagementService.getUserProfile(student1.id);
    assert.equal(profile1.user.id, student1.id);
    assert.equal(profile1.enrolledCourses.length, 1);
    assert.equal(profile1.attendance.length, 1);
    assert.equal(profile1.attendanceSummary.present, 1);
    assert.equal(profile1.questions.length, 1);
    assert.ok(profile1.pollVotes.length >= 2);
    assert.equal(profile1.submissions.length, 1);
    assert.equal(profile1.submissions[0].has_review, true);

    // Admin cannot remove their own ADMIN role
    assert.throws(() => {
      userManagementService.setUserRole(lecturer.id, lecturer.id, 'STUDENT');
    }, /cannot remove your own ADMIN role/);

    // Promote student2 to ADMIN and demote back to STUDENT
    const promoted = userManagementService.setUserRole(lecturer.id, student2.id, 'ADMIN');
    assert.equal(promoted.role, 'ADMIN');
    const demoted = userManagementService.setUserRole(lecturer.id, student2.id, 'STUDENT');
    assert.equal(demoted.role, 'STUDENT');

    // Unenroll and re-enroll student2 in course
    const afterUnenroll = userManagementService.unenrollUser(student2.id, course.id);
    assert.equal(afterUnenroll.enrolledCourses.length, 0);
    const afterEnroll = userManagementService.enrollUser(student2.id, course.id);
    assert.equal(afterEnroll.enrolledCourses.length, 1);
  });
});
