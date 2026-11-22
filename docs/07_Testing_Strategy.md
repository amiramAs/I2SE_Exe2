# Testing Strategy & Class Verification Matrix — Task 9

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Testing Philosophy & Scope

In accordance with Task 9 (*"Define a testing strategy; make sure to address the classes as in Task 7 & 8"*), our testing strategy verifies every domain service class and database layer component using automated, deterministic tests executed via Node.js v22's built-in test runner (`node --test`).

### Testing Pyramid
1. **Unit Tests (Class & Method Level)**: Validate pure algorithmic methods (e.g., `AttendanceService.calculateHaversineDistance`), role resolution (`AuthService`), and input validation rules (`HomeworkService` submission format constraints).
2. **Service Integration Tests (SQLite + Service Classes)**: Execute real SQL transactions against an isolated test database (`:memory:` or temporary SQLite file) to verify state transitions across `AuthService`, `AttendanceService`, `QAService`, `PollService`, `LLMService`, and `HomeworkService`.
3. **End-to-End API & WebSocket Verification**: Verify HTTP REST endpoints and real-time classroom workflows.

---

## 2. Class-by-Class Test Coverage Matrix

| Target Class (from Task 7 & 8) | Methods Under Test | Test Case IDs & Scenarios Verified |
| :--- | :--- | :--- |
| **`DatabaseManager`** (`src/db/database.js`) | `initSchema()`, `seedInitialData()` | **TC-DB-01**: Schema creation of all 10 tables (`users`, `courses`, `enrollments`, `sessions`, `attendance`, `questions`, `polls`, `poll_votes`, `lecture_summaries`, `assignments`, `submissions`).<br>**TC-DB-02**: Initial seed verification (courses, students, sample repos). |
| **`AuthService`** (`src/services/AuthService.js`) | `authenticateGoogleUser()`, `switchUserRole()` | **TC-AUTH-01**: Default new Google user receives `STUDENT` role.<br>**TC-AUTH-02**: Whitelisted lecturer email receives `ADMIN` role automatically.<br>**TC-AUTH-03**: Demo Role Switcher (`switchUserRole`) toggles user between `STUDENT` and `ADMIN`. |
| **`AttendanceService`** (`src/services/AttendanceService.js`) | `createCourse()`, `startSession()`, `calculateHaversineDistance()`, `checkInStudent()`, `updatePhotoHeadcount()`, `toggleManualAttendance()`, `getCourseAttendanceHistory()`, `exportAttendanceCSV()` | **TC-ATT-01**: First-lecture QR check-in automatically enrolls the student in the course (`enrollments`) and marks `PRESENT`.<br>**TC-ATT-02**: Haversine GPS distance calculation accepts student inside classroom radius ($\le 60\text{m}$) and flags student outside radius ($>60\text{m}$) as `OUT_OF_RANGE`.<br>**TC-ATT-03**: Subsequent lecture check-in works directly from enrolled course page.<br>**TC-ATT-04**: Mobile Admin classroom photo headcount triggers `fraudAlert = true` when `registeredCount > photoHeadcount`.<br>**TC-ATT-05**: Lecturer manual attendance override (`PRESENT` $\leftrightarrow$ `ABSENT`) and per-student attendance history filter across multiple lectures + CSV export. |
| **`QAService`** (`src/services/QAService.js`) | `askQuestion()`, `dismissLiveQuestion()`, `replyToQuestion()`, `getQuestionsByCourse()` | **TC-QA-01**: Live question submitted during active session sets `is_live = 1` and masks student identity when `isAnonymous = true`.<br>**TC-QA-02**: Lecturer dismissing a live projector question marks `is_dismissed = 1`.<br>**TC-QA-03**: Offline post-lecture question sets `is_live = 0` and records lecturer's written reply. |
| **`PollService`** (`src/services/PollService.js`) | `createPoll()`, `castVote()`, `getPollResultsForLecturer()` | **TC-POLL-01**: Lecturer creates multiple-choice poll with custom options.<br>**TC-POLL-02**: Student casts vote -> receives confirmation only (no result leak), while `getPollResultsForLecturer()` returns accurate tallies and blocks duplicate votes by the same student. |
| **`LLMService`** (`src/services/LLMService.js`) | `generateLectureSummary()`, `countPeopleInClassroomPhoto()`, `reviewAndCompareHomework()` | **TC-LLM-01**: Lecture summary integrates both the spoken transcript and live Q&A questions from the session.<br>**TC-LLM-02**: Draft summary remains hidden from students until lecturer publishes it (`is_published = 1`).<br>**TC-LLM-03**: Homework review analyzes target submission and produces a comparative breakdown against peer submissions. |
| **`HomeworkService`** (`src/services/HomeworkService.js`) | `createAssignment()`, `submitHomework()`, `generateOnDemandReview()` | **TC-HW-01**: Enforces lecturer's configured submission type (`GITHUB_ONLY`, `FILE_OR_TEXT`, `BOTH`).<br>**TC-HW-02**: Student triggers on-demand LLM review & peer comparison comparing their submission against all peers submitted up to that point. |

---

## 3. Running the Automated Test Suite

Execute the entire automated test suite from the project root:

```bash
npm test
```

This invokes `node --no-warnings --test tests/system.test.js`, which instantiates an isolated SQLite database and runs all unit and integration assertions across every class listed above.
