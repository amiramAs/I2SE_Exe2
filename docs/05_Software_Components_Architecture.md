# Main Software Components & Architecture — Task 7

**Project:** LiveClass AI — Web-Based Teaching Tool  

---

## 1. Architectural Pattern

LiveClass AI employs a **Layered Service-Oriented Architecture (SOA)** combined with an **Event-Driven Real-Time WebSocket Bus (Socket.IO)**:

1. **Presentation Layer (`public/`)**:
   - Responsive Single-Page Application (SPA) serving three synchronized views:
     - **Lecturer Desktop Dashboard (`ADMIN` Projector View)**
     - **Lecturer Mobile Companion (`ADMIN` Smartphone Camera & Remote Control)**
     - **Student Mobile Web App (`STUDENT` View)**
   - Client-side AI & Media modules: TensorFlow.js (`coco-ssd`) person detector, Web Audio chime synthesizer, Web Notifications bridge, HTML5 Geolocation, and Web Speech / Audio Recorder.
2. **Controller & Real-Time Transport Layer (`src/server.js`)**:
   - Express REST API controllers + Socket.IO room-based event broadcaster (`course:<id>` and `session:<id>`).
3. **Domain Service Layer (`src/services/`)**:
   - Encapsulated OOP business logic classes: `AuthService`, `AttendanceService`, `QAService`, `PollService`, `LLMService`, `HomeworkService`, and `UserManagementService`.
4. **Data Access & Persistence Layer (`src/db/database.js`)**:
   - Relational SQLite database managed via Node.js v22 native `node:sqlite` (`DatabaseSync`).

---

## 2. Component Diagram

```mermaid
flowchart TB
    subgraph Client_Tier["Presentation Tier (Browser / Mobile PWA)"]
        LP["🖥️ Lecturer Projector UI"]
        LM["📱 Lecturer Mobile Camera UI"]
        SM["📱 Student Mobile UI"]
        TF["👁️ TensorFlow.js COCO-SSD & Audio/Notification Engine"]
    end

    subgraph Application_Tier["Application Tier (Node.js / Express / Socket.IO)"]
        API["REST API Router & Socket.IO Hub (server.js)"]
        AUTH["AuthService\n(Google OAuth, Email/Password)"]
        ATT["AttendanceService\n(QR, Haversine GPS, Photo Audit, History Filter, CSV)"]
        QA["QAService\n(Live Anonymous/Named Q&A, Offline Replies)"]
        POLL["PollService\n(Multiple-Choice Polls, Projector Results)"]
        LLM["LLMService\n(Lecture Summarizer, Vision Counter, Peer Homework Comparator)"]
        HW["HomeworkService\n(GitHub Repo Fetcher, File/Text Store)"]
    end

    subgraph Data_Tier["Data & External Services Tier"]
        SQL[("SQLite Database\n(database.sqlite)")]
        GAPI["Google OAuth & Gemini 2.5 API"]
        GH["GitHub REST API\n(Repo Inspector)"]
    end

    LP <--> API
    LM <--> API
    SM <--> API
    LM --> TF
    LP --> TF

    API --> AUTH
    API --> ATT
    API --> QA
    API --> POLL
    API --> LLM
    API --> HW

    AUTH --> SQL
    ATT --> SQL
    QA --> SQL
    POLL --> SQL
    HW --> SQL

    AUTH --> GAPI
    LLM --> GAPI
    HW --> LLM
    HW --> GH
```

---

## 3. Software Component Responsibilities

| Component Class | File Location | Core Responsibilities |
| :--- | :--- | :--- |
| **`DatabaseManager`** | `src/db/database.js` | Initializes SQLite schema, executes parameterized queries, and seeds realistic courses, students (from lecturer's roster), sessions, and sample GitHub homework repositories. |
| **`AuthService`** | `src/services/AuthService.js` | Verifies Google OAuth tokens, registers/authenticates email+password users (scrypt hashes), resolves per-user `STUDENT`/`ADMIN` roles, and issues signed session tokens. |
| **`AttendanceService`** | `src/services/AttendanceService.js` | Manages multi-course enrollment on first QR scan, creates live sessions, computes Haversine GPS distance, processes mobile-to-PC classroom photo headcounts, flags over-registration alerts, supports manual attendance toggling, filters attendance history by student across all lectures, and generates CSV/Excel exports. |
| **`QAService`** | `src/services/QAService.js` | Handles live and offline student questions (with optional anonymity and projector dismissal), multi-reply threads (`question_replies`), lecturer/student replies that trigger real-time `question:replied` OS push notifications to the student who asked, multi-filter Lecturer Question History (`getQuestionHistory`), and CSV history export (`exportQuestionsCSV`). |
| **`PollService`** | `src/services/PollService.js` | Creates single-choice or multi-select (`allow_multiple`) polls with dynamic options, generates direct poll QR codes, records single or multi-option (`option_indices_json`) ballots per student, and aggregates vote counts and voter percentages exclusively for the lecturer's display. |
| **`LLMService`** | `src/services/LLMService.js` | Interfaces with Google Gemini API (plus deterministic analytical fallback) for: (1) Lecture transcript + live Q&A summarization with draft/publish workflow, (2) Server-side classroom photo headcount analysis, and (3) On-demand student homework deep review & cohort comparison. |
| **`HomeworkService`** | `src/services/HomeworkService.js` | Creates assignments with configurable submission modes (`GITHUB_ONLY`, `FILE_OR_TEXT`, `BOTH`), fetches GitHub repo metadata when a repo link is submitted, stores student submissions, and triggers `LLMService` peer comparisons. |
| **`UserManagementService`** | `src/services/UserManagementService.js` | Admin-only user directory and profile inspector: lists users with activity counts, updates user roles (`STUDENT`/`ADMIN`) with safety guards, manages course enrollments, and aggregates a user's attendance, questions, poll votes, and homework submissions. |

---

## 4. Entity-Relationship Diagram (Database Schema)

```mermaid
erDiagram
    USERS ||--o{ COURSES : "teaches (ADMIN)"
    USERS ||--o{ ENROLLMENTS : "enrolls in"
    COURSES ||--o{ ENROLLMENTS : "has"
    COURSES ||--o{ SESSIONS : "hosts"
    SESSIONS ||--o{ ATTENDANCE : "records"
    USERS ||--o{ ATTENDANCE : "checks into"
    COURSES ||--o{ QUESTIONS : "receives"
    SESSIONS ||--o{ QUESTIONS : "context for"
    QUESTIONS ||--o{ QUESTION_REPLIES : "has thread"
    USERS ||--o{ QUESTION_REPLIES : "authors"
    SESSIONS ||--o{ POLLS : "launches"
    POLLS ||--o{ POLL_VOTES : "collects"
    SESSIONS ||--o{ LECTURE_SUMMARIES : "summarizes"
    COURSES ||--o{ ASSIGNMENTS : "defines"
    ASSIGNMENTS ||--o{ SUBMISSIONS : "collects"
    USERS ||--o{ SUBMISSIONS : "submits"

    USERS {
        int id PK
        string email UK
        string name
        string role "ADMIN | STUDENT"
        string password_hash "scrypt, nullable (Google-only users)"
    }
    COURSES {
        int id PK
        string code
        string name
        int lecturer_id FK
    }
    SESSIONS {
        int id PK
        int course_id FK
        string title
        string qr_token
        float lecturer_lat
        float lecturer_lng
        int max_distance_meters
        int photo_headcount
        string photo_data_url
        int is_active
    }
    ATTENDANCE {
        int id PK
        int session_id FK
        int student_id FK
        float distance_meters
        string status "PRESENT | ABSENT | OUT_OF_RANGE"
        int manual_override
    }
    QUESTIONS {
        int id PK
        int course_id FK
        int session_id FK
        int student_id FK
        int is_anonymous
        string content
        int is_live
        int is_dismissed
        string lecturer_reply
        string replied_at
    }
    QUESTION_REPLIES {
        int id PK
        int question_id FK
        int user_id FK
        string author_name
        string author_role "ADMIN | STUDENT"
        string content
        string created_at
    }
    POLLS {
        int id PK
        int course_id FK
        int session_id FK
        string question
        string options_json
        int allow_multiple "0 = Single | 1 = Multi-Select"
        int is_active
    }
    POLL_VOTES {
        int id PK
        int poll_id FK
        int student_id FK
        int option_index
        string option_indices_json "JSON array for multi-select"
    }
    LECTURE_SUMMARIES {
        int id PK
        int course_id FK
        int session_id FK
        string title
        string raw_transcript
        string summary_markdown
        int is_published
    }
    ASSIGNMENTS {
        int id PK
        int course_id FK
        string title
        string submission_type "GITHUB_ONLY | FILE_OR_TEXT | BOTH"
    }
    SUBMISSIONS {
        int id PK
        int assignment_id FK
        int student_id FK
        string repo_url
        string content
        string llm_review
        string llm_comparison
    }
```
