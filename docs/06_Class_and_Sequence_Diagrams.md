# Low-Level Class Diagrams & Sequence Diagrams — Task 8

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Low-Level UML Class Diagram

The following UML class diagram details the object-oriented classes, attributes, method signatures, and associations implemented in `src/db/` and `src/services/`.

```mermaid
classDiagram
    class DatabaseManager {
        -DatabaseSync db
        -string dbPath
        +constructor(dbPath: string)
        +initSchema() void
        +seedInitialData() void
        +getDb() DatabaseSync
        +close() void
    }

    class AuthService {
        -DatabaseManager dbManager
        -OAuth2Client googleClient
        -Set~string~ adminEmails
        +constructor(dbManager: DatabaseManager)
        +authenticateGoogleUser(payload: Object) User
        +switchUserRole(userId: number, newRole: string) User
        +getUserById(userId: number) User
        +getAllUsers() User[]
    }

    class AttendanceService {
        -DatabaseManager dbManager
        +constructor(dbManager: DatabaseManager)
        +createCourse(lecturerId: number, code: string, name: string, description: string) Course
        +getCoursesForUser(userId: number, role: string) Course[]
        +enrollStudent(courseId: number, studentId: number) Enrollment
        +startSession(courseId: number, title: string, lat: number, lng: number, maxDist: number) Session
        +endSession(sessionId: number) Session
        +calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) number
        +checkInStudent(params: CheckInRequest) AttendanceRecord
        +updatePhotoHeadcount(sessionId: number, count: number, photoDataUrl: string) PhotoAuditResult
        +toggleManualAttendance(sessionId: number, studentId: number, status: string) AttendanceRecord
        +getCourseAttendanceHistory(courseId: number, filterStudentId: number) AttendanceHistoryReport
        +exportAttendanceCSV(courseId: number, sessionId: number) string
    }

    class QAService {
        -DatabaseManager dbManager
        +constructor(dbManager: DatabaseManager)
        +askQuestion(courseId: number, sessionId: number, studentId: number, content: string, isAnonymous: boolean) Question
        +dismissLiveQuestion(questionId: number) Question
        +replyToQuestion(questionId: number, replyText: string) Question
        +getQuestionsByCourse(courseId: number) Question[]
    }

    class PollService {
        -DatabaseManager dbManager
        +constructor(dbManager: DatabaseManager)
        +createPoll(sessionId: number, question: string, options: string[]) Poll
        +closePoll(pollId: number) Poll
        +castVote(pollId: number, studentId: number, optionIndex: number) VoteConfirmation
        +getPollResultsForLecturer(pollId: number) PollResults
    }

    class LLMService {
        -string apiKey
        +constructor(apiKey: string)
        +generateLectureSummary(transcript: string, liveQuestions: Question[], title: string) string
        +countPeopleInClassroomPhoto(imageBase64: string, clientDetectedCount: number) number
        +reviewAndCompareHomework(targetSubmission: Submission, peerSubmissions: Submission[], assignment: Assignment) HomeworkLLMFeedback
    }

    class HomeworkService {
        -DatabaseManager dbManager
        -LLMService llmService
        +constructor(dbManager: DatabaseManager, llmService: LLMService)
        +createAssignment(courseId: number, title: string, description: string, submissionType: string, dueDate: string) Assignment
        +submitHomework(assignmentId: number, studentId: number, repoUrl: string, content: string, fileName: string) Submission
        +fetchGitHubRepoSummary(repoUrl: string) string
        +generateOnDemandReview(submissionId: number) Submission
        +getAssignmentSubmissions(assignmentId: number) Submission[]
    }

    AuthService --> DatabaseManager : uses
    AttendanceService --> DatabaseManager : uses
    QAService --> DatabaseManager : uses
    PollService --> DatabaseManager : uses
    HomeworkService --> DatabaseManager : uses
    HomeworkService --> LLMService : delegates AI analysis
```

---

## 2. Sequence Diagrams for Core Features

### 2.1 Dual-Factor Attendance + Lecturer Phone-to-PC Classroom Photo Audit

```mermaid
sequenceDiagram
    actor Student as 📱 Student (Phone)
    actor LecturerPhone as 📱 Lecturer (Phone Admin)
    participant Server as ⚙️ Express + Socket.IO
    participant AttSvc as 🛡️ AttendanceService
    participant LLM as 🤖 CV / LLMService
    actor LecturerPC as 🖥️ Lecturer PC (Projector)

    LecturerPC->>Server: POST /api/sessions (startSession with GPS lat/lng)
    Server->>AttSvc: startSession(courseId, title, lat, lng, 60m)
    AttSvc-->>LecturerPC: Returns Session + QR Code DataURL

    Student->>Server: Scans QR / Opens Session Link (POST /api/attendance/checkin)
    Server->>AttSvc: enrollStudent(courseId, studentId) [Auto-enrolls on Lecture 1]
    Server->>AttSvc: calculateHaversineDistance(lecturerGPS, studentGPS)
    AttSvc-->>Server: Status: PRESENT (14.2m <= 60m)
    Server-->>Student: 200 OK (Checked In & Enrolled)
    Server-->>LecturerPC: Socket.IO emit("attendance:updated", {registeredCount: 25})

    Note over LecturerPhone,LecturerPC: Lecturer snaps classroom photo from phone (logged in as ADMIN)
    LecturerPhone->>Server: POST /api/sessions/:id/photo-audit (photo + clientCount)
    Server->>LLM: countPeopleInClassroomPhoto(photo, clientCount)
    LLM-->>Server: photoHeadcount = 18
    Server->>AttSvc: updatePhotoHeadcount(sessionId, 18, photoDataUrl)
    AttSvc-->>Server: {registeredCount: 25, photoHeadcount: 18, fraudAlert: true}
    Server-->>LecturerPC: Socket.IO emit("photo:audited", {alert: "25 Registered vs 18 in Photo!"})
    LecturerPC->>Server: PATCH /api/attendance/manual (Lecturer manually edits roster)
```

### 2.2 Live Anonymous/Named Q&A (Projector Audio Alert) & Post-Class Offline Reply

```mermaid
sequenceDiagram
    actor Student as 📱 Student
    participant Server as ⚙️ Express + Socket.IO
    participant QASvc as 💬 QAService
    actor LecturerPC as 🖥️ Lecturer PC (Connected to Projector)

    rect rgb(235, 245, 255)
        Note over Student,LecturerPC: Scenario A: Live Question During Active Lecture
        Student->>Server: POST /api/questions {content, isAnonymous: true}
        Server->>QASvc: askQuestion(courseId, sessionId, studentId, content, true)
        QASvc-->>Server: Question (is_live = true, author = "Anonymous Student")
        Server-->>LecturerPC: Socket.IO emit("question:live", question)
        Note over LecturerPC: Plays Web Audio Chime + OS Desktop Notification + Projector Modal
        LecturerPC->>Server: PATCH /api/questions/:id/dismiss (Answers verbally & clicks Dismiss)
    end

    rect rgb(245, 255, 240)
        Note over Student,LecturerPC: Scenario B: Post-Class Offline Question
        Student->>Server: POST /api/questions {content, isAnonymous: false} (No active session)
        Server->>QASvc: askQuestion(courseId, null, studentId, content, false)
        QASvc-->>Server: Question (is_live = false)
        Server-->>LecturerPC: Updates Unread Question Badge on Course Dashboard
        LecturerPC->>Server: PATCH /api/questions/:id/reply {replyText}
        Server->>QASvc: replyToQuestion(questionId, replyText)
        Server-->>Student: Socket.IO emit("question:replied") — Displayed on Course Page
    end
```

### 2.3 On-the-Spot Multiple-Choice (KISS) Poll (Projector-Only Results)

```mermaid
sequenceDiagram
    actor LecturerPC as 🖥️ Lecturer PC (Projector)
    participant Server as ⚙️ Express + Socket.IO
    participant PollSvc as 📊 PollService
    actor Student as 📱 Student Phone

    LecturerPC->>Server: POST /api/polls {sessionId, question, options: ["A","B","C","D"]}
    Server->>PollSvc: createPoll(sessionId, question, options)
    PollSvc-->>Server: Poll + Direct Poll QR Code
    Server-->>Student: Socket.IO emit("poll:started", {id, question, options})
    Server-->>LecturerPC: Displays Poll QR & Live 0% Bar Chart on Projector

    Student->>Server: POST /api/polls/:id/vote {optionIndex: 1}
    Server->>PollSvc: castVote(pollId, studentId, 1)
    PollSvc-->>Student: {voted: true, message: "Your vote has been recorded!"}
    Note over Student: Phone shows confirmation only (no chart spoilers)
    Server->>PollSvc: getPollResultsForLecturer(pollId)
    Server-->>LecturerPC: Socket.IO emit("poll:results_updated", tallies)
```

### 2.4 Live Lecture Recording / Upload -> LLM Draft Summary -> Lecturer Publish

```mermaid
sequenceDiagram
    actor LecturerPC as 🖥️ Lecturer PC
    participant Server as ⚙️ Express + Socket.IO
    participant QASvc as 💬 QAService
    participant LLM as 🤖 LLMService
    actor Student as 📱 Enrolled Students

    LecturerPC->>LecturerPC: Clicks "Start Recording" (Web Speech / Audio) or Uploads File
    LecturerPC->>Server: POST /api/summaries/generate {courseId, sessionId, title, transcript}
    Server->>QASvc: getQuestionsByCourse(courseId) [Fetches live session Q&A]
    Server->>LLM: generateLectureSummary(transcript, liveQuestions, title)
    LLM-->>Server: Structured Markdown Summary (Draft, is_published = 0)
    Server-->>LecturerPC: Returns Draft Summary for Lecturer Review/Editing
    LecturerPC->>Server: PATCH /api/summaries/:id/publish {summaryMarkdown}
    Server-->>Student: Socket.IO emit("summary:published") — Appears on Course Page by Date
```

### 2.5 Configurable Homework Submission & On-Demand LLM Peer Comparison

```mermaid
sequenceDiagram
    actor LecturerPC as 🖥️ Lecturer
    actor Student as 📱 Student
    participant Server as ⚙️ Express Server
    participant HWSvc as 📂 HomeworkService
    participant LLM as 🤖 LLMService

    LecturerPC->>Server: POST /api/assignments {submissionType: "BOTH" | "GITHUB_ONLY" | "FILE_OR_TEXT"}
    Student->>Server: POST /api/submissions {assignmentId, repoUrl, content}
    Server->>HWSvc: submitHomework(...)
    HWSvc-->>Student: Submission Saved

    Note over Student: Student clicks "Get LLM Review & Peer Comparison" whenever ready
    Student->>Server: POST /api/submissions/:id/analyze
    Server->>HWSvc: generateOnDemandReview(submissionId)
    HWSvc->>HWSvc: fetchGitHubRepoSummary(repoUrl) [If GitHub URL provided]
    HWSvc->>HWSvc: Load all peer submissions submitted so far for this assignment
    HWSvc->>LLM: reviewAndCompareHomework(targetSubmission, peerSubmissions, assignment)
    LLM-->>HWSvc: {llm_review, llm_comparison, score}
    HWSvc-->>Student: Displays Deep Review + Anonymous Comparison to Class Peers
    HWSvc-->>LecturerPC: Lecturer can also inspect all submissions & their LLM reviews
```
