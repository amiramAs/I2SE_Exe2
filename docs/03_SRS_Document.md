# Software Requirements Specification (SRS) — Task 5

**Project:** LiveClass AI — Web-Based Teaching Tool  
**Standard:** IEEE 830 / ISO/IEC/IEEE 29148 Adapted  

---

## 1. Introduction

### 1.1 Purpose
This Software Requirements Specification (SRS) defines the functional and non-functional requirements for **LiveClass AI**, an end-to-end web-based classroom management and learning enhancement platform designed for lecturers and students.

### 1.2 Product Vision & Core Classroom Workflow
At the beginning of a lecture, the lecturer signs into the web platform (Google or email/password, `ADMIN` role), selects or creates a course, opens a live session, and projects the session QR code on the classroom projector. Students sign in (Google account or email/password — self-registration is supported) and scan the QR code using their smartphones:
- On the **first lecture of the course**, scanning the QR code automatically **enrolls** the student in the course and records their GPS-verified attendance.
- From the **second lecture onward**, the course permanently appears on the student's **"My Courses"** dashboard; students can either scan the session QR code or enter the active course directly from the website to mark attendance (which still verifies an active session + GPS proximity).
- Through the same unified course/session view, students can ask **live or post-lecture questions (with optional anonymity)**, vote in **on-the-spot multiple-choice polls**, view **published AI lecture summaries**, and upload **homework (GitHub repo or file/text) to request on-demand LLM deep reviews and peer comparisons**.

---

## 2. Overall Description

### 2.1 User Classes and Characteristics
1. **Lecturer (`ADMIN`)**:
   - Connects their laptop to the classroom projector and optionally connects their smartphone as an `ADMIN` mobile companion (e.g., to snap a live classroom photo that syncs to the laptop screen).
   - Manages multiple courses, opens live sessions, audits attendance (including manual overrides, per-student attendance history filtering across all lectures, and CSV/Excel export), answers live/offline questions, launches multiple-choice polls, records/uploads lectures, edits and publishes AI summaries, and configures homework assignments.
2. **Student (`STUDENT`)**:
   - Uses a smartphone or laptop browser with zero installation (KISS).
   - Signs in via Google OAuth or email/password (or self-registers), enrolls via first QR scan, marks GPS-verified attendance, asks questions (named or anonymous, live or offline), votes in multiple-choice polls, reads published lecture summaries, and submits homework with on-demand LLM peer comparison.

---

## 3. Functional Requirements (FR)

### 3.1 Authentication, Role Resolution & Multi-Course Enrollment
- **FR-01 (Sign-In)**: The system shall authenticate users via Google OAuth 2.0 (server-verified Google Identity Services ID tokens) or via email + password, including self-registration without a Gmail account.
- **FR-02 (Per-User Roles)**: Each user has a fixed role stored in the database. New users default to `STUDENT`; lecturers (seeded accounts or verified Google emails in the `ADMIN_EMAILS` whitelist) are `ADMIN`. Users cannot change their own role.
- **FR-03 (Multi-Course Management & First-Scan Auto-Enrollment)**: Lecturers (`ADMIN`) shall be able to create and manage multiple courses. When a student scans a course session QR code in the first lecture, the system shall automatically enroll the student in that course (`enrollments` table) so it appears on their **"My Courses"** dashboard on every future login.
- **FR-04 (Subsequent Lecture Check-In)**: Enrolled students shall be able to mark attendance in subsequent lectures either by scanning the session QR code OR by entering the course directly from their **"My Courses"** dashboard while a live session is active, subject to the same GPS proximity check.

### 3.2 Feature 1: Dual-Factor Attendance, Phone-to-PC Photo Audit & History Filter
- **FR-05 (Live Session & GPS Geofence)**: Starting a live session shall capture the lecturer's classroom GPS coordinates and generate a session QR code and link.
- **FR-06 (Haversine GPS Verification)**: When a student checks in, the server shall calculate the Haversine distance between the student's GPS coordinates and the lecturer's classroom coordinates. Check-ins within the allowed radius (default: 60m) are marked `VERIFIED`.
- **FR-07 (Phone-to-Desktop AI Classroom Photo Headcount)**: The lecturer (logged in as `ADMIN` on their smartphone or PC) shall be able to capture a photo of the classroom using the phone camera or upload an existing image file. The photo is processed by the server/AI to count visible persons ($N_{\text{photo}}$) and **synchronized in real time via WebSockets to the lecturer's PC dashboard**.
- **FR-08 (Over-Registration Fraud Alert & Manual Override)**: If the number of digitally checked-in students ($N_{\text{digital}}$) exceeds the AI photo headcount ($N_{\text{photo}}$), the lecturer's dashboard shall display a prominent discrepancy alert (`Registered: X > Counted in Photo: Y`). The lecturer shall be able to manually toggle/edit any student's attendance status (`Present` / `Absent`) directly in the table.
- **FR-09 (Attendance History, Per-Student Filtering & CSV Export)**: The lecturer shall have an **Online Attendance History Spreadsheet** view supporting:
  - Filtering by a **specific student** across all lectures of the course (showing attendance rate and per-session status).
  - Filtering by **lecture session**.
  - 1-click **Offline Spreadsheet Export (`.csv` / Excel)**.

### 3.3 Feature 2: Projector-First Live & Offline Q&A (Anonymity, Threaded Replies, Bidirectional OS Push & Lecturer History)
- **FR-10 (Named or Anonymous Question Submission)**: Students shall be able to submit questions via the session/course link and toggle whether their question is displayed with their name or **Anonymously**.
- **FR-11 (Lecturer OS Push Notification Outside Browser & Projector Popup)**: Whenever a student submits a question (live or offline, across any course), the lecturer's client shall immediately:
  - Play an audible notification chime (via Web Audio API).
  - Trigger a native **OS Push Notification** (`new Notification` + Service Worker `public/sw.js` with `requireInteraction: true`) visible even when the lecturer is outside the website (e.g., presenting PowerPoint/PDF slides or in another window). Clicking the OS push notification focuses the browser and switches to the course's Questions tab.
  - Display an in-app floating push toast and a projector popup modal where the lecturer can either type an immediate written reply or answer verbally and click **"Answered Verbally / Dismiss"**.
- **FR-12 (In-Site Threaded Replies & OS Push Notification to the Asking Student)**: Lecturers and students shall be able to post written replies and follow-up comments on questions directly inside the site (`question_replies` table). When a question receives a reply (`question:replied`), the system shall immediately send an **OS Push Notification**, audio chime, floating toast banner, and unread tab badge to the specific student who asked the question (`target_student_id`), even if that student is outside the browser window.
- **FR-12b (Lecturer Question History Filtering & CSV Export)**: The lecturer shall be able to view and search the full Question History in a clean interface supporting filters by scope (`Current Course` / `All My Courses`), session/lecture (`All Lectures`, `Live Only`, `Offline Only`, or a specific lecture session), status (`Pending`, `Answered in Writing`, `Answered Verbally`), author (`All Students`, `Anonymous Only`, or a specific student), free-text search, and 1-click `.csv` export (`GET /api/questions/history-export.csv`).

### 3.4 Feature 3: On-the-Spot Multiple-Choice (KISS) Polls (Single & Multi-Select)
- **FR-13 (Instant Poll Creation with Per-Option Inputs & Multi-Select Toggle)**: The lecturer shall be able to create a live poll by typing a question, adding or removing individual option input fields (`+ Add Option` button, minimum 2 options), and optionally enabling **"Allow students to select multiple options"** (`allow_multiple = true`).
- **FR-14 (Session Link & Direct QR Voting — Single or Multiple Selection)**: The active poll shall pop up automatically on the smartphones of students already inside the session link AND provide a direct QR code for immediate scanning. In single-choice polls (`allow_multiple = false`), tapping an option casts the vote immediately; in multi-select polls (`allow_multiple = true`), students can check multiple options and submit/update their combined selection.
- **FR-15 (Projector-Only Live Results)**: Once a student submits their vote(s), their phone displays a clean confirmation (*"Vote Recorded"*), while the live bar-chart distribution updates in real time **exclusively on the lecturer's projected screen**.

### 3.5 Feature 4: Live Recording / Upload & ML Summary with Approval Workflow
- **FR-16 (Live Recording or File Upload)**: The lecturer shall be able to click **"Start Recording"** (capturing live lecture speech/audio in the browser) OR upload a recorded lecture file/transcript.
- **FR-17 (LLM Summary Incorporating Live Q&A)**: The LLM service shall generate a structured summary of the lecture (Executive Overview, Core Concepts, Action Items) and automatically integrate a section summarizing the **Questions Asked During the Lecture**.
- **FR-18 (Lecturer Edit & Publish to Course)**: The generated summary is initially saved as a **Draft** for the lecturer to review/edit. Once the lecturer clicks **"Publish to Course"**, all enrolled students can view the summary organized by lecture date on their course page.

### 3.6 Feature 5: Configurable Homework & On-Demand LLM Peer Comparison
- **FR-19 (Configurable Assignment Submission Type)**: When opening a new homework assignment, the lecturer shall specify the allowed submission format: `GITHUB_ONLY` (GitHub repository URL), `FILE_OR_TEXT` (code/text/file upload), or `BOTH`.
- **FR-20 (On-Demand Student LLM Review & Cohort Comparison)**: After uploading their homework, a student can click **"Get LLM Feedback & Peer Comparison"** at any time. The system fetches the student's work (including automatically pulling `README.md` / code metadata if a GitHub repo URL was provided) and compares it anonymously against all other students' submissions received up to that moment.
- **FR-21 (Lecturer Submission & LLM Review Inspector)**: The lecturer shall view the full list of students who submitted an assignment, open/download their files or GitHub links, and inspect (or trigger) the LLM review and peer comparison generated for each student.

---

## 4. Non-Functional Requirements (NFR)
- **NFR-01 (KISS Mobile Experience)**: Zero native app installation; responsive mobile-first web UI.
- **NFR-02 (Real-Time Synchronization)**: Sub-500ms WebSocket synchronization across student phones, lecturer mobile admin camera, and lecturer desktop projector view.
- **NFR-03 (Privacy Compliance)**: No government ID numbers (ת.ז.) are stored or exported (per Assignment Q&A #6); peer homework comparisons are strictly anonymized when shown to students.
