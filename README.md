# LiveClass AI — End-to-End Web-Based Teaching Tool (`I2SE_Exe2`)

> **Course:** Introduction to Software Engineering (OOP & OOD) — Exercise 2: *Vibe Coding & Deep Designing*  
> **Goal:** Design, specify, and implement a simple, anti-spoofing, and LLM-ready web application for live classroom teaching.

---

## 1. Problem Definition & Scope (Task 1)

### The Problem
Current online and classroom teaching tools fail to provide a seamless, trustworthy in-class experience:
1. **Attendance Spoofing & Administrative Friction**: Paper sheets waste class time, while simple digital forms or static QR codes are immediately forwarded to absent students via WhatsApp. Furthermore, lecturers lack a unified way to filter attendance history by student across all lectures or export spreadsheets effortlessly.
2. **Disconnected Live & Post-Class Q&A**: Students hesitate to interrupt lectures verbally, and chat messages go unnoticed when the lecturer's screen is focused on presentation slides.
3. **High-Friction Polling**: Existing polling apps (Kahoot, Mentimeter) require separate game PINs and pull students out of the lesson context.
4. **Shallow Video Summaries**: Automatic meeting summaries (e.g., standard Zoom summaries) fail to structure key pedagogical takeaways or incorporate the actual live questions raised in class.
5. **Isolated Homework Evaluation**: Students receive delayed grades without deep architectural feedback or any benchmark showing how their solution compares to their classmates' approaches.

### Our Solution & Project Scope: **LiveClass AI**
**LiveClass AI** is a full-stack, mobile-first web application (requiring zero native app installation — **KISS**) built around a single classroom projector + smartphone workflow:
- **Sign-In (Google or Email/Password) & First-Lecture Auto-Enrollment**: Users sign in with Google **or** with email + password (self-registration, no Gmail required). Each user has a fixed role stored in the DB (default `STUDENT`; lecturers are `ADMIN`). Built-in demo accounts: `admin@test.com` (ADMIN), `test1@test.com`, `test2@test.com`, `test3@test.com` (STUDENT) — password `1234`. Lecturers manage **multiple courses**. In Lecture #1, scanning the session QR code automatically enrolls the student in the course and marks attendance. From Lecture #2 onward, the course appears permanently in **"My Courses"**, allowing check-in either via QR scan or directly from the course page (with active session & GPS verification).
- **Feature 1 — Dual-Factor Attendance, Mobile Admin Classroom Photo Counter & History Filter**:
  - Combines **Session QR Scan** + **Haversine GPS Proximity Check** (verifying the student is physically near the lecturer).
  - **Phone-to-PC AI Classroom Photo Audit**: The lecturer can log in as `ADMIN` on their smartphone, snap a photo of the classroom (or upload an image), and send it to the server. The AI counts the people in the photo and updates the **Lecturer's Laptop Screen live via Socket.IO**, raising a prominent alert if `Digitally Registered Students > People Counted in Photo`.
  - **Manual Editing, Per-Student History Filter & CSV Export**: The lecturer can manually edit attendance in the live roster, view the full course attendance history filtered by a specific student across all lectures (or by session), and export an Excel-compatible `.csv` spreadsheet.
- **Feature 2 — Projector-First Live & Offline Q&A (With Anonymity, Bidirectional OS Push & Lecturer Question History)**:
  - Students can ask questions by name or **Anonymously** through the same session link.
  - **OS Push Notifications to Lecturer (Even Outside the Browser)**: Whenever a student asks a question (live or offline, across any course), the lecturer receives an **audible chime (Web Audio API)** + a native **OS Push Notification (`new Notification` + Service Worker `sw.js` with `requireInteraction: true`)** visible even when the lecturer is outside the browser window (e.g., presenting PowerPoint slides) + an in-app floating push toast + a **Projector Popup Modal** where the lecturer can either type an instant written reply or answer verbally and click *"Answered Verbally / Dismiss"*. Clicking the OS notification focuses the window and opens the Questions tab.
  - **In-Site Threaded Replies & OS Push to the Student Who Asked**: Lecturers and students can reply to questions directly inside the website (`question_replies` thread). As soon as a question receives a reply (`question:replied`), the **student who asked the question receives an OS Push Notification** (even if outside the website), an audible chime, a floating toast banner, and an unread reply badge on their Q&A tab.
  - **Lecturer Question History & CSV Export**: Lecturers can browse and filter the complete history of questions across the current course or all their courses—filtering by lecture/session (`Live`, `Offline`, or specific lecture), answer status (`Pending`, `Answered in Writing`, `Answered Verbally`), student/anonymous author, and free-text search—and export the history to an Excel-compatible `.csv` spreadsheet.
- **Feature 3 — On-the-Spot Multiple-Choice (KISS) Polls (Single & Multi-Select)**:
  - Lecturers create instant polls on the spot using dynamic per-option input boxes (`+ Add Option` / `×` remove) and can toggle **"Allow students to select multiple options"** (`allow_multiple`) for multi-select polls. Students vote either directly inside their open session screen or via a dedicated Poll QR code.
  - Student phones show a clean vote confirmation, while the **live bar chart updates exclusively on the lecturer's projected screen**.
- **Feature 4 — Live Lecture Recording / Upload & ML Summary with Lecturer Approval**:
  - Lecturers click **"Start Recording"** (live browser speech/audio capture) or upload a lecture recording/transcript.
  - The LLM generates a structured draft summary that also **incorporates the live Q&A questions asked during the session**. The lecturer can edit/approve the draft and click **"Publish to Course"**, making it visible to all enrolled students by lecture date.
- **Feature 5 — Configurable Homework & On-Demand LLM Peer Comparison**:
  - Lecturers open assignments and define allowed submission formats: **GitHub Repository URL**, **File/Code/Text Upload**, or **Both**.
  - Whenever a student wants, they click **"Get LLM Review & Peer Comparison"** on their submission to receive an in-depth LLM code/design review and an **anonymized comparison against all classmates who have submitted up to that point**. Lecturers can inspect all student submissions and their LLM reviews.
- **Admin User Management Dashboard (`👥 6. Users` Tab)**:
  - Lecturers (`ADMIN`) can view and search all registered users, promote/demote roles (`STUDENT` $\leftrightarrow$ `ADMIN` with self-demotion and last-admin protection), manage course enrollments, and inspect any student's full activity profile (attendance history, questions asked, poll votes, and homework submissions).

---

## 2. Software Engineering Documentation Index (Tasks 1–9, 11–12)

All formal engineering deliverables required by the assignment are organized in the `docs/` folder (plus our Hebrew product specification in [אפיון מטלה 2.docx](file:///c:/Users/Lenovo/OneDrive%20-%20Ariel%20University/%D7%A9%D7%A0%D7%94%20%D7%91/%D7%9E%D7%95%D7%A0%D7%97%D7%A6/I2SE_Exe2/%D7%90%D7%A4%D7%99%D7%95%D7%9F%20%D7%9E%D7%98%D7%9C%D7%94%202.docx)):

| Assignment Task | Document Link | Description |
| :--- | :--- | :--- |
| **Task 1** | `README.md` (This File) | Repository overview, problem definition, project scope, and conclusion. |
| **Task 3** | [`docs/01_Technical_Tools_Report.md`](docs/01_Technical_Tools_Report.md) | Real-life evaluation & testing report of GPS Haversine, QR, TensorFlow.js `coco-ssd` + Gemini Vision, Socket.IO, Web Audio/Notifications, and Gemini LLM. |
| **Task 4** | [`docs/02_Statement_of_Work_SoW.md`](docs/02_Statement_of_Work_SoW.md) | Statement of Work (SoW): milestones, deliverables, scope boundaries, and risk mitigation. |
| **Task 5** | [`docs/03_SRS_Document.md`](docs/03_SRS_Document.md) | Software Requirements Specification (SRS): functional (`FR-01`..`FR-21`) and non-functional requirements. |
| **Task 6** | [`docs/04_Use_Cases_Client_Stories.md`](docs/04_Use_Cases_Client_Stories.md) | Use Case diagram, Agile User Stories, and detailed scenario flows. |
| **Task 7** | [`docs/05_Software_Components_Architecture.md`](docs/05_Software_Components_Architecture.md) | Layered system architecture, component responsibilities, and SQLite ER Diagram. |
| **Task 8** | [`docs/06_Class_and_Sequence_Diagrams.md`](docs/06_Class_and_Sequence_Diagrams.md) | Low-level OOP UML Class Diagram and Sequence Diagrams for all 5 features. |
| **Task 9** | [`docs/07_Testing_Strategy.md`](docs/07_Testing_Strategy.md) | Class-level testing strategy and traceability matrix mapped to Tasks 7 & 8. |
| **Tasks 11 & 12** | [`docs/08_Demo_Guide_and_Conclusion.md`](docs/08_Demo_Guide_and_Conclusion.md) | 10-minute live classroom presentation script and project conclusion. |

---

## 3. Quick Start — Running the Web Application & Tests (Task 10)

### Prerequisites
- **Node.js v22+** (uses Node's built-in `node:sqlite` and native `node --test` runner).

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Optional API Keys (`.env`)
The application works **100% out-of-the-box** with zero configuration (email/password login with built-in demo accounts, client-side TensorFlow.js person counting, and smart analytical LLM fallbacks). To enable real Google Sign-In and Gemini 2.5 Flash API calls, copy `.env.example` to `.env` and add your keys (`GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`, `ADMIN_EMAILS`, `JWT_SECRET`):
```bash
cp .env.example .env
```

### 3. Run the Automated Test Suite
```bash
npm test
```

### 4. Start the Full-Stack Server
```bash
npm start
```
Then open **`http://localhost:3000`** in your browser (or scan the displayed LAN QR code from your smartphone on the same Wi-Fi/hotspot network!).

### 5. Authentication & Demo Accounts
Users can **sign in with Google** or with **email + password**, and anyone can **create an account** without a Gmail address. Each user has a **fixed role stored in the database** — there is no role switcher.

| Account | Role | Sign-in |
| :--- | :--- | :--- |
| `1234amiram@gmail.com` | `ADMIN` (lecturer) | Google |
| `admin@test.com` | `ADMIN` (lecturer) | password `1234` |
| `test1@test.com`, `test2@test.com`, `test3@test.com` | `STUDENT` | password `1234` |

- These accounts are (re)created automatically on every server start (`DatabaseManager.seedInitialData()`).
- **Self-registered accounts are always `STUDENT`.** `ADMIN` is granted only by the seed or by a *verified* Google sign-in of an email listed in `ADMIN_EMAILS` — nobody can claim a lecturer address by registering with it.
- Passwords are stored as salted `scrypt` hashes and never returned by the API. After login the server issues an HMAC-signed session token (7 days) stored in the browser.
- **Google Sign-In** only works on origins registered in Google Cloud Console (e.g. `http://localhost:3000`). Phones opening the LAN IP (`http://192.168.x.x:3000`) should use email/password, or expose the app over a public HTTPS tunnel and register that origin.

**Auth API:** `POST /api/auth/google` (`{ credential }`), `POST /api/auth/register` (`{ name, email, password }`), `POST /api/auth/login` (`{ email, password }`), `GET /api/auth/me` (`Authorization: Bearer <token>`).

---

## 4. Conclusion & Summary of Results (Task 12)

By approaching classroom management as a **Deep Design** challenge first and a **Vibe Coding** composition second, **LiveClass AI** demonstrates that:
- **Dual-Factor Attendance (QR + GPS) + Mobile-to-PC AI Photo Counting** solves proxy attendance fraud without requiring intrusive biometric hardware or manual roll calls.
- **Projector-Aware UX** (cross-window audio/desktop notifications for live anonymous questions, and projector-only live bar charts for multiple-choice polls) aligns naturally with how lecturers actually teach in university halls.
- **Contextual LLM Workflows** (combining lecture transcripts with live class Q&A into lecturer-approved summaries, and giving students on-demand homework reviews benchmarked anonymously against their classmates) transform passive AI wrappers into high-value educational tools.
