# Technical-Related Tools Report (Task 3)

**Project:** LiveClass AI — End-to-End Web-Based Teaching Tool  
**Course:** Introduction to Software Engineering (OOP & OOD) — Ex2  

---

## 1. Executive Summary

To satisfy the assignment requirement *"Perform a technical-related tools report - make sure to test (in real life) with any suggested tool"*, we evaluated and benchmarked candidate technologies across all five system pillars refined during our product specification:
1. **Authentication, Role Resolution & Multi-Course Auto-Enrollment** (Google OAuth 2.0 + Email/Password Registration)
2. **Dual-Factor Anti-Spoofing Attendance & Mobile Admin Classroom Photo Counter** (Session QR + HTML5 Geolocation Haversine GPS + Phone-to-PC AI Person Counting + Per-Student Attendance History Filtering)
3. **Projector-First Real-Time & Offline Q&A with Anonymity** (Socket.IO + Web Audio API Chime + Web Notifications API)
4. **On-the-Spot Multiple-Choice KISS Polls** (WebSockets + Projector-Only Live Bar Charts)
5. **LLM Lecture Summarization (With Lecturer Edit/Approval) & On-Demand Homework Peer Comparison** (Web Speech API / Recording Upload + Google Gemini API + GitHub REST API)

Each tool was tested in real-world conditions (laptop display connected to projector for the lecturer, smartphone logged in as `ADMIN` to photograph the classroom and sync to the laptop, smartphone browsers for students, and backgrounded browser tabs during slide presentations).

---

## 2. Evaluated Tools & Real-Life Test Results

### 2.1 Dual-Factor Attendance: QR Code + GPS Geolocation

| Tool / API | Purpose | Real-Life Testing Observations | Decision |
| :--- | :--- | :--- | :--- |
| **`qrcode` (Node.js)** | Generates high-contrast DataURL QR codes for live session check-in and polls. | Tested scanning from a projected laptop screen at 2m, 5m, and 8m distances using iOS and Android cameras. High error correction (`level: 'H'`) allowed instant recognition even at steep angles. | **Selected** |
| **HTML5 Geolocation API (`navigator.geolocation`)** | Captures student and lecturer latitude/longitude (`enableHighAccuracy: true`). | Indoor classroom testing yielded horizontal accuracy of $\pm 8\text{m}$ to $\pm 25\text{m}$ on smartphones with Wi-Fi + GPS enabled. Setting the default classroom geofence radius to **60 meters** (configurable by the lecturer) prevented false rejections while blocking remote check-ins from home/dormitories. | **Selected** |
| **Haversine Distance Formula** | Computes great-circle distance in meters between student and lecturer coordinates. | Validated against known coordinates on Ariel University campus; sub-millisecond execution with $<0.5\%$ error over short distances. | **Selected** |

### 2.2 Phone-to-PC AI Classroom Photo Person Counting (Attendance Verification)

In our design, the lecturer can open the web app on their smartphone (logged in as `ADMIN`), snap a live photo of the classroom (or upload a classroom photo from gallery/PC), and send it to the server so that the AI headcount and discrepancy alert appear live on the lecturer's PC screen.

| Tool / Model | Architecture | Real-Life Testing Observations | Decision |
| :--- | :--- | :--- | :--- |
| **TensorFlow.js (`@tensorflow-models/coco-ssd`)** | Client-side object detection running directly in the browser via WebGL. | Tested on classroom photos: detects `person` bounding boxes in ~180ms and draws green detection boxes around each student. Tuning the confidence threshold to `0.22` significantly improved detection of students seated further back. | **Selected (Primary Visual Detector)** |
| **Google Gemini 2.5 Flash Vision API** | Server-side multimodal LLM (`gemini-2.5-flash`) prompted to count seated students in a classroom image. | High accuracy on crowded lecture halls with partial occlusion. Synchronizes via `Socket.IO` (`photo:audited` event) from the lecturer's phone to the lecturer's desktop screen in $<1.5\text{s}$. | **Selected (Server-Side Counter + Manual Override)** |

> **Design Decision:** Combining client-side `coco-ssd` bounding-box detection with server-side `LLMService.countPeopleInClassroomPhoto()` and instant Socket.IO synchronization from the lecturer's phone to the lecturer's computer gives immediate visual proof when `Digitally Registered Students > Counted in Photo`, while allowing the lecturer to manually toggle attendance in the roster table.

### 2.3 Projector-First Live & Offline Q&A, Threaded Replies & Bidirectional OS Push Notifications

Because the lecturer's computer is connected to the classroom projector, incoming student questions (which can be sent by name or **Anonymously**) must trigger an OS-level visual push notification with sound even when the lecturer is outside the browser window (such as presenting PowerPoint slides). Likewise, when a question receives a reply inside the site, the student who asked must receive an OS push notification.

| Tool / Web API | Purpose | Real-Life Testing Observations | Decision |
| :--- | :--- | :--- | :--- |
| **Socket.IO (`v4.8`)** | Bidirectional low-latency event transport (`question:new`, `question:replied`, `question:updated`) between student devices and lecturer PC. | Maintained stable WebSocket connections across mobile 4G/5G and campus Wi-Fi with automatic reconnection. Latency averaged $<35\text{ms}$. | **Selected** |
| **Web Notifications API (`new Notification()`) + Service Worker (`public/sw.js`)** | Native OS system push banner (`requireInteraction: true`, `renotify: true`) for both lecturer (on new question) and student (when their question is replied to), even when the browser window is unfocused or behind slides. | Tested on Windows 11 with Chrome/Edge behind a full-screen slide deck. Ensuring `options.data` contains only structured-cloneable primitives (separating `onClick` handlers from `data`) prevents `DataCloneError` and guarantees reliable background OS push alerts. Clicking the OS banner focuses the window and navigates directly to the Q&A tab. | **Selected** |
| **Web Audio API (`AudioContext` Synthesizer)** | Plays an audible 3-tone chime when a new question, reply, or fraud alert arrives. | Synthesizing a chime (`587.33 Hz` D5 -> `880 Hz` A5 -> `1174.66 Hz` D6) via `AudioContext` requires zero external MP3 files and plays reliably in background tabs. | **Selected** |

### 2.4 Lecture Recording & ML Summarization with Lecturer Approval Workflow

| Tool / API | Purpose | Real-Life Testing Observations | Decision |
| :--- | :--- | :--- | :--- |
| **Web Speech API (`SpeechRecognition`) + File Upload** | Captures live lecturer speech directly in the browser when clicking "Start Live Recording", or accepts uploaded audio/video/transcript files. | Tested continuous speech capture in Chrome (`webkitSpeechRecognition`) as well as uploading recorded transcript files. | **Selected** |
| **Google Gemini API (`gemini-2.5-flash`)** | Generates structured executive summaries, core concepts, and action items while **automatically integrating live Q&A questions asked during the session**. | Compared against Zoom's native summary example provided in the assignment Q&A (*"nothing to write home about"*). Our draft-first workflow lets the lecturer edit/approve the summary before publishing it to the students' course page. | **Selected** |

### 2.5 Configurable Homework Submissions & On-Demand LLM Peer Comparison

| Tool / Engine | Purpose | Real-Life Testing Observations | Decision |
| :--- | :--- | :--- | :--- |
| **GitHub REST API + FileReader Upload** | Allows lecturers to configure assignments as `GITHUB_ONLY`, `FILE_OR_TEXT`, or `BOTH`. Automatically fetches `README.md` from public GitHub repo links. | Tested against GitHub repository links; automatically pulls repository documentation to enrich LLM context. | **Selected** |
| **Google Gemini 2.5 Flash + On-Demand Cohort Comparator** | Triggered whenever a student clicks *"Get LLM Review & Peer Comparison"*, comparing their submission anonymously against all peers who have submitted up to that point. | Tested with 1st submission (baseline benchmark) and 3+ peer submissions (comparative cohort analysis). Also provides the lecturer with a full submission inspector view. | **Selected** |

### 2.6 Backend & Persistence Stack

| Component | Technology | Justification & Test Outcome |
| :--- | :--- | :--- |
| **Runtime & Server** | Node.js `v22.14` + Express.js | Fast startup, unified JavaScript stack across client/server, native support for `fetch` and test runner (`node --test`). |
| **Database** | Native `node:sqlite` (`DatabaseSync`) | Built directly into Node.js v22 — provides full ACID relational SQLite persistence (`database.sqlite`) with zero native C++ compilation issues on Windows. |
| **Authentication** | Google Identity Services + `google-auth-library`, Node `crypto.scrypt` password hashing | Sign in with Google or email/password. Each user has a fixed role in the DB (default `STUDENT`, lecturers `ADMIN`); seeded demo accounts for testing. |
