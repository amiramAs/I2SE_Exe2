# Main Use Cases & Client Stories — Task 6

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Use Case Diagram

```mermaid
flowchart LR
    subgraph Actors
        L["👨‍🏫 Lecturer (ADMIN - PC & Mobile)"]
        S["📱 Student (Mobile Web)"]
        AI["🤖 AI Services (Gemini LLM & CV Counter)"]
    end

    subgraph LiveClass_AI["LiveClass AI Platform"]
        UC1["UC-01: Sign-In (Google / Email) & First-Scan Course Enrollment"]
        UC2["UC-02: Dual-Factor Attendance (QR + GPS)"]
        UC3["UC-03: Mobile Admin Classroom Photo Count & Fraud Alert"]
        UC4["UC-04: View/Edit Attendance History & Filter by Student"]
        UC5["UC-05: Ask Anonymous/Named Question (OS Push to Lecturer Outside Site)"]
        UC6["UC-06: Reply to Question in Site (OS Push to Asking Student) & Browse Question History"]
        UC7["UC-07: Launch & Vote in Multiple-Choice KISS Poll"]
        UC8["UC-08: Record/Upload Lecture, Edit & Publish ML Summary"]
        UC9["UC-09: Submit Homework & Request On-Demand LLM Peer Comparison"]
    end

    L --> UC1
    S --> UC1
    S --> UC2
    L --> UC3
    UC3 --> AI
    L --> UC4
    S --> UC5
    UC5 --> L
    S --> UC6
    L --> UC6
    L --> UC7
    S --> UC7
    L --> UC8
    UC8 --> AI
    S --> UC8
    L --> UC9
    S --> UC9
    UC9 --> AI
```

---

## 2. Agile Client Stories (User Stories)

| ID | Actor | User Story | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **US-01** | Student | *As a student in the first lecture, I want to scan the lecturer's QR code once after signing in (Google or email/password) so that I am both enrolled in the course and marked present.* | Course appears permanently in "My Courses" from Lecture #2 onward. |
| **US-02** | Student | *As an enrolled student in Lecture #2+, I want to mark attendance either by scanning the QR or clicking into the course on the website while in class.* | Server validates active session + Haversine GPS distance $\le 60\text{m}$. |
| **US-03** | Lecturer | *As a lecturer, I want to snap a photo of the classroom from my phone (connected as Admin) and have the AI headcount appear live on my laptop screen.* | Photo uploads to server, counts people, updates PC via Socket.IO, and alerts if `Registered > Photo Count`. |
| **US-04** | Lecturer | *As a lecturer, I want to manually edit attendance and filter the attendance history by a specific student across all lectures.* | Online table filters by student or session and exports to Excel/CSV. |
| **US-05** | Student | *As a student who is shy to interrupt, I want to send an anonymous question from my phone that triggers an OS Push Notification and chime on the lecturer's computer even when the lecturer is outside the website (presenting PowerPoint).* | Chime plays, OS push notification fires over PowerPoint (`requireInteraction: true`), and projector modal lets the lecturer reply in writing or dismiss after answering verbally. |
| **US-06** | Student & Lecturer | *As a lecturer or student, I want to reply to questions inside the website so the student who asked immediately receives an OS Push Notification, and as a lecturer I want to filter and export the full question history.* | Replying emits `question:replied` and triggers an OS push notification on the asking student's device; lecturer filters question history by course, session, status, student/anonymous, or search query, and exports CSV. |
| **US-07** | Lecturer | *As a lecturer, I want to launch a quick poll on the spot—adding options with a `+` button and choosing whether students can select one or multiple answers—and show the live bar chart only on my projector screen.* | Dynamic option inputs (`+ Add Option`), single/multi-select toggle (`allow_multiple`); students vote via session link or poll QR; phone shows confirmation only; projector shows live chart. |
| **US-08** | Lecturer | *As a lecturer, I want to click "Start Recording" (or upload a recording), review the AI-generated summary (including live Q&A), and publish it to the course page.* | Draft summary is editable by lecturer; once published, all enrolled students see it by lecture date. |
| **US-09** | Student | *As a student, I want to upload my homework (GitHub repo or file/code) and click "Get LLM Review & Comparison" whenever I want.* | LLM analyzes submission, compares anonymously to all peers submitted so far; lecturer can also view all submissions and reviews. |

---

## 3. Detailed Use Case Specifications

### UC-02 & UC-03: Dual-Factor Attendance & Mobile Admin Photo Verification
- **Primary Actors**: Student (`STUDENT`), Lecturer (`ADMIN` on Laptop & Smartphone).
- **Preconditions**: Lecturer has signed in (Google or email/password) with an `ADMIN` account and started a live session for Course $C$.
- **Main Success Scenario**:
  1. Lecturer's laptop captures classroom GPS coordinates $(\text{lat}_L, \text{lng}_L)$ and displays the Session QR code on the projector.
  2. Student scans QR (or selects Course $C$ from "My Courses"). If not yet enrolled in Course $C$, the system auto-enrolls the student.
  3. Student's browser captures GPS coordinates $(\text{lat}_S, \text{lng}_S)$ and sends check-in request.
  4. Server computes Haversine distance $d$. Since $d \le R_{\text{max}}$, student is marked `PRESENT (VERIFIED)` and the lecturer's live roster increments $N_{\text{digital}}$.
  5. Lecturer opens LiveClass AI on their smartphone (logged in as `ADMIN`), taps **"Snap Classroom Photo"**, and photographs the lecture hall.
  6. Server/AI detects $N_{\text{photo}}$ persons and pushes the annotated result to the lecturer's laptop via Socket.IO.
- **Extensions (Alternative Flows)**:
  - **3a. Remote Spoofing Attempt ($d > R_{\text{max}}$)**: Server rejects automatic verification or flags status as `OUT_OF_RANGE` with distance in meters.
  - **6a. Headcount Discrepancy ($N_{\text{digital}} > N_{\text{photo}}$)**: Dashboard displays a red fraud alert banner (`Warning: 24 students registered digitally, but only 19 people detected in classroom photo!`). Lecturer inspects the live table and manually unchecks absent students.

### UC-05 & UC-06: Live & Offline Q&A, Threaded Replies, Bidirectional OS Push & Question History
- **Primary Actors**: Student, Lecturer.
- **Main Success Scenario (Asking a Question & Lecturer OS Push)**:
  1. Student types a question in the course/session view, optionally checks **"Ask Anonymously"**, and taps Send (which also ensures OS notification permission is active on the student's browser).
  2. Server saves the question and emits `question:new` via Socket.IO.
  3. Lecturer's machine (even if the browser window is minimized or behind PowerPoint slides) plays the Web Audio chime, displays a native **OS Push Notification** (`new Notification` + Service Worker `sw.js`), shows a floating toast, and opens the projector popup modal.
  4. Lecturer either types an instant written reply inside the popup modal (`💬 Send Reply`) or answers verbally to the class and clicks **"Answered Verbally / Dismiss"**.
- **Replying to Questions in the Site & Student OS Push**:
  1. From the projector modal, the Lecturer Question History tab, or the Student Q&A feed, a user posts a reply to a question (`PATCH /api/questions/:id/reply` or `POST /api/questions/:id/replies`).
  2. Server persists the reply in `question_replies` (and updates `lecturer_reply` / `replied_at` on `questions`) and emits `question:replied` with `target_student_id: question.student_id`.
  3. The device of the student who asked the question receives an immediate **OS Push Notification** (even if they are outside the website), an audio chime, a floating visual toast, and an unread badge on their `💬 2. Ask Question` tab.
- **Lecturer Question History Flow**:
  1. Lecturer opens the **`💬 2. Questions`** tab and filters the complete question history by scope (`Current Course` / `All My Courses`), lecture session (`All`, `Live Only`, `Offline Only`, or specific session), status (`Pending`, `Answered in Writing`, `Answered Verbally`), student/anonymous author, or free-text search, and can export the filtered archive to CSV (`📥 Export History CSV`).

### UC-09: Configurable Homework & On-Demand LLM Peer Comparison
- **Primary Actors**: Lecturer, Student, Gemini LLM Engine.
- **Main Success Scenario**:
  1. Lecturer creates an assignment specifying allowed format (`GITHUB_ONLY`, `FILE_OR_TEXT`, or `BOTH`).
  2. Student submits their solution (e.g., GitHub repository URL and/or code/text).
  3. Student clicks **"Get LLM Review & Peer Comparison"**.
  4. Server retrieves the student's submission content (fetching repository README/structure if a GitHub URL is provided) plus all other submissions currently stored for that assignment.
  5. `LLMService` generates a deep architectural review and an anonymized comparison against peers who submitted up to that point.
  6. Both the student (on their submission card) and the lecturer (in the assignment submissions inspector) can view the detailed markdown feedback.
