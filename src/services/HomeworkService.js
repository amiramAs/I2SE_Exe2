class HomeworkService {
  constructor(dbManager, llmService) {
    this.db = dbManager.getDb();
    this.llmService = llmService;
  }

  /**
   * Lecturer opens an assignment and defines the allowed submission format:
   * 'GITHUB_ONLY', 'FILE_OR_TEXT', or 'BOTH'
   */
  createAssignment(courseId, title, description, submissionType = 'BOTH', dueDate = null) {
    if (!title || !title.trim()) {
      throw new Error('Assignment title is required.');
    }
    if (!['GITHUB_ONLY', 'FILE_OR_TEXT', 'BOTH'].includes(submissionType)) {
      throw new Error('Invalid submission_type. Must be GITHUB_ONLY, FILE_OR_TEXT, or BOTH.');
    }

    const res = this.db
      .prepare(`
        INSERT INTO assignments (course_id, title, description, submission_type, due_date)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(courseId, title.trim(), (description || '').trim(), submissionType, dueDate);

    return this.getAssignmentById(Number(res.lastInsertRowid));
  }

  getAssignmentById(assignmentId) {
    return this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  }

  getAssignmentsByCourse(courseId) {
    return this.db
      .prepare(`
        SELECT a.*,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count
        FROM assignments a
        WHERE a.course_id = ?
        ORDER BY a.id DESC
      `)
      .all(courseId);
  }

  /**
   * Student submits or updates their homework for an assignment according to the lecturer's configured submission_type
   */
  submitHomework({ assignmentId, studentId, repoUrl = '', content = '', fileName = '' }) {
    const assignment = this.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new Error('Assignment not found.');
    }

    const cleanRepo = (repoUrl || '').trim();
    const cleanContent = (content || '').trim();
    const cleanFile = (fileName || '').trim();

    if (assignment.submission_type === 'GITHUB_ONLY' && !cleanRepo) {
      throw new Error('This assignment requires a GitHub Repository URL.');
    }
    if (assignment.submission_type === 'FILE_OR_TEXT' && !cleanContent && !cleanFile) {
      throw new Error('This assignment requires a file or text/code submission.');
    }
    if (assignment.submission_type === 'BOTH' && !cleanRepo && !cleanContent && !cleanFile) {
      throw new Error('Please provide a GitHub Repository URL and/or upload your homework file/code.');
    }

    this.db
      .prepare(`
        INSERT INTO submissions (assignment_id, student_id, repo_url, file_name, content, submitted_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET
          repo_url = excluded.repo_url,
          file_name = COALESCE(NULLIF(excluded.file_name, ''), submissions.file_name),
          content = excluded.content,
          submitted_at = datetime('now')
      `)
      .run(assignmentId, studentId, cleanRepo || null, cleanFile || null, cleanContent || null);

    return this.getStudentSubmission(assignmentId, studentId);
  }

  getStudentSubmission(assignmentId, studentId) {
    return this.db
      .prepare(`
        SELECT s.*, u.name AS student_name, u.email AS student_email
        FROM submissions s
        INNER JOIN users u ON u.id = s.student_id
        WHERE s.assignment_id = ? AND s.student_id = ?
      `)
      .get(assignmentId, studentId);
  }

  getSubmissionById(submissionId) {
    return this.db
      .prepare(`
        SELECT s.*, u.name AS student_name, u.email AS student_email
        FROM submissions s
        INNER JOIN users u ON u.id = s.student_id
        WHERE s.id = ?
      `)
      .get(submissionId);
  }

  /**
   * Best-effort fetch of a public GitHub repository's README/metadata when a student submits a GitHub link
   */
  async fetchGitHubRepoSummary(repoUrl) {
    if (!repoUrl) return '';
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (!match) return '';
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
        headers: { Accept: 'application/vnd.github.v3.raw', 'User-Agent': 'LiveClass-AI' },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        const text = await resp.text();
        return text.slice(0, 1500);
      }
    } catch {
      // Offline or rate-limited; proceed gracefully
    }
    return '';
  }

  /**
   * Triggered on-demand when the student clicks "Get LLM Review & Peer Comparison" (or when inspected by the lecturer).
   * Compares the student's work against all other students who have submitted up to this moment.
   */
  async generateOnDemandReview(submissionId) {
    const target = this.getSubmissionById(submissionId);
    if (!target) {
      throw new Error('Submission not found.');
    }

    const assignment = this.getAssignmentById(target.assignment_id);
    const peerSubmissions = this.db
      .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id != ? ORDER BY id ASC')
      .all(target.assignment_id, target.student_id);

    let enrichedContent = target.content || '';
    if (target.repo_url && enrichedContent.length < 200) {
      const readmeExcerpt = await this.fetchGitHubRepoSummary(target.repo_url);
      if (readmeExcerpt) {
        enrichedContent = `${enrichedContent}\n\n[Fetched GitHub README]:\n${readmeExcerpt}`.trim();
      }
    }

    const feedback = await this.llmService.reviewAndCompareHomework(
      { ...target, content: enrichedContent },
      peerSubmissions,
      assignment
    );

    this.db
      .prepare('UPDATE submissions SET llm_review = ?, llm_comparison = ?, score = ? WHERE id = ?')
      .run(feedback.llm_review, feedback.llm_comparison, feedback.score, submissionId);

    return this.getSubmissionById(submissionId);
  }

  /**
   * Returns all student submissions for an assignment so the Lecturer can inspect/download work and view LLM reviews
   */
  getAssignmentSubmissions(assignmentId) {
    return this.db
      .prepare(`
        SELECT s.*, u.name AS student_name, u.email AS student_email, u.picture AS student_picture
        FROM submissions s
        INNER JOIN users u ON u.id = s.student_id
        WHERE s.assignment_id = ?
        ORDER BY s.submitted_at DESC
      `)
      .all(assignmentId);
  }
}

module.exports = HomeworkService;
