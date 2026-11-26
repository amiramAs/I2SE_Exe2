# Statement of Work (SoW) — Task 4

**Project Title:** LiveClass AI — Interactive & Anti-Spoofing Classroom Teaching Platform  
**Course:** Introduction to Software Engineering (Ex2: Vibe Coding & Deep Designing)  
**Date:** November 2026  

---

## 1. Project Background & Purpose

Modern university lectures suffer from tool fragmentation and low student engagement. Lecturers juggle separate platforms for attendance (easily spoofed via shared codes or WhatsApp forwarding), Q&A (students hesitate to interrupt or lecturer misses chat messages while presenting slides), polling (third-party apps requiring separate PINs), lecture summaries (generic Zoom summaries lacking pedagogical structure), and homework feedback (isolated grading without peer context).

**LiveClass AI** unifies these five workflows into a single, mobile-friendly web application centered around Google OAuth, multi-course enrollment on the first QR scan, and real-time synchronization between student smartphones, the lecturer's smartphone (`ADMIN` camera), and the lecturer's projector laptop.

---

## 2. Scope of Work

The project encompasses the complete software engineering lifecycle:
1. **Requirements & Specification Engineering**:
   - Product specification in Hebrew (`אפיון מטלה 2.docx`) and full English software engineering documentation (`README.md`, Technical Tools Report, SoW, SRS, Use Cases & Client Stories).
2. **Object-Oriented Analysis & Design (OOAD)**:
   - Layered Service-Oriented Architecture, relational SQLite Entity-Relationship Diagram (ERD), Low-Level UML Class Diagrams, and Sequence Diagrams for all 5 features.
3. **Full-Stack Web Application Implementation ("Vibe Coding & Composing")**:
   - **Google OAuth 2.0 & Multi-Course Enrollment**: Sign in with Google or email/password (self-registration). Each user has a fixed role (`STUDENT` by default, lecturers `ADMIN`). Scanning the session QR code on Lecture #1 automatically enrolls the student in the course so it appears in *"My Courses"* from Lecture #2 onward.
   - **Feature 1 — Dual-Factor Attendance, Phone-to-PC Photo Audit & History Filter**: QR + Haversine GPS distance check + Lecturer Mobile Admin Camera photo upload that counts people via AI and updates the lecturer's PC live via Socket.IO with a fraud alert if `Registered > Photo Count`. Includes manual attendance editing, per-student attendance history filtering across all lectures, and CSV/Excel export.
   - **Feature 2 — Projector-First Live & Offline Q&A (With Anonymity, Bidirectional OS Push & Question History)**: Named or anonymous questions; every incoming question plays an audio chime, fires an OS Push Notification (`new Notification` + Service Worker `sw.js`, visible even when the lecturer is outside the browser presenting PowerPoint), and pops up on the projected screen with both an inline reply box and 1-click verbal dismissal; replying to any question inside the site sends an OS Push Notification to the student who asked; includes full Lecturer Question History with filtering (by course, lecture/session, status, student/anonymous, and search) and CSV export.
   - **Feature 3 — On-the-Spot Multiple-Choice KISS Polls (Single & Multi-Select)**: Instant polls built with dynamic per-option input fields (`+ Add Option`) and an optional multi-select toggle (`allow_multiple`) allowing students to select more than one option; accessible via the open session link or direct poll QR code; student phones show vote confirmation only while live bar-chart results display exclusively on the lecturer's projector screen.
   - **Feature 4 — Live Recording / Upload & ML Summary with Approval**: Browser live speech recording or file upload summarized by LLM (incorporating live session Q&A) into an editable lecturer draft that is published to the course page upon approval.
   - **Feature 5 — Configurable Homework & On-Demand LLM Peer Comparison**: Lecturer defines allowed format (`GITHUB_ONLY`, `FILE_OR_TEXT`, or `BOTH`); students click *"Get LLM Review & Peer Comparison"* whenever they want to compare their work anonymously against all classmates who have submitted so far; lecturer inspects all submissions and LLM reviews.
4. **Quality Assurance & Live Classroom Demonstration**:
   - Automated unit and service integration test suite (`tests/system.test.js` via `node --test`) addressing every OOP class, plus a 10-minute live classroom presentation script.

### Out of Scope (Per Assignment Guidelines)
- Direct integration with university legacy systems (Moodle, Zoom APIs, or *Meida Ishi* / Personal Information portal).
- Native iOS/Android App Store binaries (delivered instead as a responsive mobile Web Application for instant zero-install access).

---

## 3. Deliverables & Milestones

| Milestone | Deliverable | Target Artifact / Location | Status |
| :--- | :--- | :--- | :--- |
| **M1: Problem & Tools** | Problem Definition, Scope & Technical Tools Report | `README.md`, `docs/01_Technical_Tools_Report.md`, `אפיון מטלה 2.docx` | Completed |
| **M2: Requirements** | Statement of Work (SoW), SRS Document, Use Cases | `docs/02_Statement_of_Work_SoW.md`, `docs/03_SRS_Document.md`, `docs/04_Use_Cases_Client_Stories.md` | Completed |
| **M3: Architecture & OOD** | Component Architecture, Class & Sequence Diagrams | `docs/05_Software_Components_Architecture.md`, `docs/06_Class_and_Sequence_Diagrams.md` | Completed |
| **M4: Implementation** | Full-Stack Web Application (Node.js, SQLite, Socket.IO, AI) | `src/`, `public/`, `package.json` | Completed |
| **M5: Verification & Demo** | Testing Strategy, Automated Test Suite & 10-Min Demo Guide | `docs/07_Testing_Strategy.md`, `tests/system.test.js`, `docs/08_Demo_Guide_and_Conclusion.md` | Completed |

---

## 4. Assumptions & Risk Management

| Risk | Probability | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Indoor GPS drift** in lecture halls causes valid students to fail attendance check-in. | Medium | High | Allow configurable geofence radius (default 60m), display measured distance in meters, and allow the lecturer to manually toggle any student's status in the live table or history matrix. |
| **Browser blocks audio chime / notifications** when lecturer switches to PowerPoint. | Medium | Medium | Provide a dedicated *"Enable Sound & OS Alerts"* button in the lecturer topbar that initializes `AudioContext` and requests `Notification.requestPermission()`. |
| **External API Quota / Network Failure** during live 10-minute classroom demo. | Low | High | Implement dual-mode AI services (Client-side TensorFlow.js + Gemini API + deterministic local analytical engine) and 1-click Demo OAuth profiles so every feature works reliably offline or online. |

---

## 5. Acceptance Criteria

1. A student scanning the session QR code on Lecture #1 is authenticated via Google, automatically enrolled in the course, and verified via GPS proximity within $<5$ seconds.
2. Capturing or uploading a classroom photo from the lecturer's phone (`ADMIN`) counts visible persons, syncs live to the lecturer's PC screen, and displays a fraud alert if digital check-ins exceed the visual headcount.
3. The lecturer can manually edit attendance, filter the course attendance history by a specific student across all lectures, and export an Excel-compatible `.csv` spreadsheet.
4. A student question (live or post-class, anonymous or named) triggers an audible chime, an OS Push Notification (even when the lecturer is outside the browser window), and a projector popup banner with inline reply support; replying to a question inside the site triggers an OS Push Notification to the student who asked, and the lecturer can browse/filter the full question history and export it to CSV.
5. All automated unit and integration tests pass (`npm test` exits with code `0`).
