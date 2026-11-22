# 10-Minute Live Classroom Demo Guide & Conclusion — Tasks 11 & 12

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Live Classroom Demo Script (10 Minutes — Task 11)

This step-by-step script is designed for presenting **LiveClass AI** live in class with the lecturer's computer connected to the projector and smartphones interacting in real time.

### Preparation (Before Demo Starts)
1. Run `npm start` on the laptop connected to the classroom projector.
2. Open `http://localhost:3000` (or your LAN IP / tunnel URL shown in the terminal header so students/your phone on Wi-Fi can scan the QR codes directly!).

---

### Minute 0:00 – 1:30 | Google Sign-In, Role Switcher & Multi-Course Dashboard
1. Sign in with **Google** on the laptop (or click **Quick Demo Login -> Lecturer ADMIN**).
2. Show the **Multi-Course Switcher** at the top (`Introduction to Software Engineering - Ex2`, `Algorithms & Data Structures`) and the 1-click **Role Switcher (`ADMIN` $\leftrightarrow$ `STUDENT`)**.
3. Click **"Start Live Lecture Session"** -> the system captures the classroom GPS coordinates and projects a large **Session QR Code** on the projector.

### Minute 1:30 – 4:00 | Feature 1: Dual-Factor Attendance, Phone Admin Camera & History Filter
1. **First-Lecture QR Scan**: Open the student view on a smartphone (or a second browser window), scan/click the session link.
   - Point out that the student is **automatically enrolled in the course** (so from Lecture #2 onward it appears under **"My Courses"**) and their **GPS distance** (e.g., `12m from lecturer`) is verified via the Haversine formula!
2. **Phone-to-PC AI Classroom Photo Audit**:
   - On your smartphone (switched to `ADMIN` mode), tap **"Snap / Upload Classroom Photo"** and select one of the classroom photos (or snap a live photo).
   - Watch the **Lecturer's Laptop Screen (Projector)** update automatically via Socket.IO with the **AI Person Headcount** (bounding boxes drawn around detected people) and a **Red Discrepancy Alert** when `Registered Students > Counted in Photo`!
3. **Manual Edit, Student History Filter & CSV Export**:
   - Manually toggle a student's attendance status in the live table.
   - Switch to the **"Attendance History & Filter"** view, filter by a single student across all lectures of the semester, and click **"Export CSV (Excel)"**.

### Minute 4:00 – 5:30 | Feature 2: Live Anonymous Projector Q&A & Offline Post-Class Replies
1. From the student phone, type a question, check **"Ask Anonymously"**, and hit Send.
2. Immediately on the lecturer's projected screen:
   - An **audible chime** plays + an **OS Desktop Notification** pops up (even if the browser is behind PowerPoint) + a **Large Projector Question Banner** appears for the whole class to see.
3. The lecturer answers verbally and clicks **"Got it / Dismiss"**.
4. Show an **Offline Post-Class Question** in the Q&A list where the lecturer types a written reply that appears immediately on the student's course page.

### Minute 5:30 – 7:00 | Feature 3: On-the-Spot Multiple-Choice KISS Poll
1. On the lecturer dashboard, type a quick multiple-choice question (e.g., *"Which design pattern best decouples our LLM service?"* with options *Strategy*, *Singleton*, *Factory*, *Observer*) and click **"Launch Live Poll"**.
2. Show that students can vote either **directly inside their open session screen** or via the **dedicated Poll QR Code**.
3. Vote from the student phone: notice that the student's phone only shows **"Vote Recorded"** (no chart spoilers!), while the **Live Bar Chart** animates in real time on the lecturer's projector screen.

### Minute 7:00 – 8:30 | Feature 4: Live Recording / Upload & ML Summary with Approval
1. Click **"Start Recording"** on the lecturer dashboard and speak a couple of sentences (or upload a lecture recording/transcript).
2. Click **"Generate AI Summary"** -> show how the LLM produces a structured summary that **automatically includes the live Q&A questions asked during the lecture**.
3. Edit a line in the draft and click **"Publish to Course"** -> switch to the Student view and show the published summary listed under the course's Lecture Summaries tab by date.

### Minute 8:30 – 10:00 | Feature 5: Configurable Homework & On-Demand LLM Peer Comparison
1. Show the Lecturer Assignment creation panel where the lecturer selects allowed submission format: **GitHub Repo Link**, **File/Code/Text**, or **Both**.
2. In the Student view, submit a GitHub repository link (using one of the repos from the lecturer's supplementary list) or code solution, and click **"Get LLM Review & Peer Comparison"**.
3. Show the generated deep review and **anonymous comparison against all peers who submitted so far**, then switch to the Lecturer view to show how the teacher can inspect all student submissions and their LLM reviews.

---

## 2. Assignment Conclusion & Results Summary (Task 12)

### What We Achieved
1. **End-to-End Requirement Traceability**: Every single feature from both the lecturer's assignment specification and our product specification (`אפיון מטלה 2.docx`) was formally specified (Tools Report, SoW, SRS, Use Cases, Architecture, UML Class & Sequence Diagrams, Testing Strategy) and implemented in a cohesive full-stack web application.
2. **Effective Anti-Spoofing Without Hurtful Friction (KISS)**: Combining a single start-of-class QR scan (which also auto-enrolls students on Lecture 1) with Haversine GPS proximity verification and a live **Phone-to-PC AI Classroom Photo Counter** gives the lecturer immediate situational awareness of attendance fraud while retaining full manual control and per-student historical filtering.
3. **Projector-Aware Classroom Ergonomics**: Designing Live Q&A (with Web Audio + OS notifications + projector popups) and KISS Polls (student phone confirmation + projector-only live charts) around the reality that the lecturer's laptop is connected to the classroom projector eliminates awkward context switching.
4. **Pedagogical AI Integration**: Rather than generic video summaries or isolated grading, LiveClass AI integrates live classroom questions into lecture summaries (with lecturer approval before publishing) and empowers students to request on-demand LLM homework feedback benchmarked anonymously against their classmates.
