# 10-Minute Live Classroom Demo Guide & Conclusion — Tasks 11 & 12

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Live Classroom Demo Script (10 Minutes — Task 11)

This step-by-step script is designed for presenting **LiveClass AI** live in class with the lecturer's computer connected to the projector and smartphones interacting in real time.

### Preparation (Before Demo Starts)
1. Run `npm start` on the laptop connected to the classroom projector.
2. Open `http://localhost:3000` (or your LAN IP / tunnel URL shown in the terminal header so students/your phone on Wi-Fi can scan the QR codes directly!).

---

### Minute 0:00 – 1:30 | Sign-In & Multi-Course Dashboard
1. Sign in on the laptop as the lecturer — with **Google** (`1234amiram@gmail.com`) or with email/password (`admin@test.com` / `1234`).
2. Show the **Multi-Course Switcher** at the top (`Introduction to Software Engineering - Ex2`, `Algorithms & Data Structures`). Use `admin@test.com` (lecturer) on the laptop and `test1@test.com` / `test2@test.com` / `test3@test.com` (students) on other devices — password `1234`.
3. Click **"Start Live Lecture Session"** -> the system captures the classroom GPS coordinates and projects a large **Session QR Code** on the projector.

### Minute 1:30 – 4:00 | Feature 1: Dual-Factor Attendance, Phone Admin Camera & History Filter
1. **First-Lecture QR Scan**: Open the student view on a smartphone (or a second browser window), scan/click the session link.
   - Point out that the student is **automatically enrolled in the course** (so from Lecture #2 onward it appears under **"My Courses"**) and their **GPS distance** (e.g., `12m from lecturer`) is verified via the Haversine formula!
2. **Phone-to-PC AI Classroom Photo Audit**:
   - On your smartphone (signed in as an `ADMIN` account), tap **"Snap / Upload Classroom Photo"** and select one of the classroom photos (or snap a live photo).
   - Watch the **Lecturer's Laptop Screen (Projector)** update automatically via Socket.IO with the **AI Person Headcount** (bounding boxes drawn around detected people) and a **Red Discrepancy Alert** when `Registered Students > Counted in Photo`!
3. **Manual Edit, Student History Filter & CSV Export**:
   - Manually toggle a student's attendance status in the live table.
   - Switch to the **"Attendance History & Filter"** view, filter by a single student across all lectures of the semester, and click **"Export CSV (Excel)"**.

### Minute 4:00 – 5:30 | Feature 2: Q&A with Bidirectional OS Push Notifications, In-Site Replies & Lecturer Question History
1. From the student phone, type a question, check **"Ask Anonymously"**, and hit Send.
2. Immediately on the lecturer's machine (even when minimized or behind PowerPoint slides):
   - An **audible chime** plays + a native **OS Push Notification** pops up over PowerPoint + a **Large Projector Question Modal** appears with an inline reply input box.
3. Type a reply directly in the modal (or in the Questions tab) and click **"💬 Send Reply"** (or click **"✅ Answered Verbally / Dismiss"**).
4. Immediately on the **asking student's device**, an **OS Push Notification**, chime, and floating toast pop up with the reply! Show that students and lecturers can also add follow-up replies in the thread inside the site.
5. Open the lecturer's **`💬 2. Questions`** tab to demonstrate **Lecturer Question History**: filter questions by course, lecture session (`Live` / `Offline` / specific lecture), answer status, or student/anonymous author, search by keyword, and export the history to CSV (`📥 Export History CSV`).

### Minute 5:30 – 7:00 | Feature 3: On-the-Spot Multiple-Choice KISS Poll (Single & Multi-Select)
1. On the lecturer dashboard, type a quick question (e.g., *"Which design patterns did we use today?"*), add/edit individual option boxes using **`+ Add Option`** (*Strategy*, *Observer*, *Singleton*, *Factory*), optionally check **"Allow students to select multiple options"**, and click **"Open Poll"**.
2. Show that students can vote either **directly inside their open session screen** or via the **dedicated Poll QR Code**.
3. Vote from the student phone (selecting one or multiple options): notice that the student's phone only shows **"Vote Recorded"** (no chart spoilers!), while the **Live Bar Chart** animates in real time on the lecturer's projector screen.

### Minute 7:00 – 8:30 | Feature 4: Live Recording / Upload & ML Summary with Approval
1. Click **"Start Recording"** on the lecturer dashboard and speak a couple of sentences (or upload a lecture recording/transcript).
2. Click **"Generate AI Summary"** -> show how the LLM produces a structured summary that **automatically includes the live Q&A questions asked during the lecture**.
3. Edit a line in the draft and click **"Publish to Course"** -> on a student device (e.g. `test1@test.com`) show the published summary listed under the course's Lecture Summaries tab by date.

### Minute 8:30 – 10:00 | Feature 5: Configurable Homework & On-Demand LLM Peer Comparison
1. Show the Lecturer Assignment creation panel where the lecturer selects allowed submission format: **GitHub Repo Link**, **File/Code/Text**, or **Both**.
2. In the Student view, submit a GitHub repository link (using one of the repos from the lecturer's supplementary list) or code solution, and click **"Get LLM Review & Peer Comparison"**.
3. Show the generated deep review and **anonymous comparison against all peers who submitted so far**, then go back to the lecturer laptop to show how the teacher can inspect all student submissions and their LLM reviews.

---

## 2. Assignment Conclusion & Results Summary (Task 12)

### What We Achieved
1. **End-to-End Requirement Traceability**: Every single feature from both the lecturer's assignment specification and our product specification (`אפיון מטלה 2.docx`) was formally specified (Tools Report, SoW, SRS, Use Cases, Architecture, UML Class & Sequence Diagrams, Testing Strategy) and implemented in a cohesive full-stack web application.
2. **Effective Anti-Spoofing Without Hurtful Friction (KISS)**: Combining a single start-of-class QR scan (which also auto-enrolls students on Lecture 1) with Haversine GPS proximity verification and a live **Phone-to-PC AI Classroom Photo Counter** gives the lecturer immediate situational awareness of attendance fraud while retaining full manual control and per-student historical filtering.
3. **Projector-Aware Classroom Ergonomics**: Designing Live Q&A (with Web Audio + OS notifications + projector popups) and KISS Polls (student phone confirmation + projector-only live charts) around the reality that the lecturer's laptop is connected to the classroom projector eliminates awkward context switching.
4. **Pedagogical AI Integration**: Rather than generic video summaries or isolated grading, LiveClass AI integrates live classroom questions into lecture summaries (with lecturer approval before publishing) and empowers students to request on-demand LLM homework feedback benchmarked anonymously against their classmates.
