/* global socket, state, refreshDashboard */
// ============================================================================
// ADMIN USER MANAGEMENT TAB (👥 6. Users)
// All requests carry the signed session token; the server re-checks ADMIN role.
// ============================================================================

const um = {
  users: [],
  courses: [],
  selectedUserId: null,
  profile: null
};

function umEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function umDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? umEsc(value) : d.toLocaleString();
}

function umShowError(msg) {
  const el = document.getElementById('umError');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

async function umApi(url, options = {}) {
  const token = localStorage.getItem('liveclass_token');
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadUsersAdmin() {
  if (!state.user || state.user.role !== 'ADMIN') return;
  umShowError('');
  try {
    const data = await umApi('/api/admin/users');
    um.users = data.users || [];
    um.courses = data.courses || [];
    renderUmUserList();
    if (um.selectedUserId && um.users.some((u) => u.id === um.selectedUserId)) {
      await selectUmUser(um.selectedUserId);
    } else {
      um.selectedUserId = null;
      document.getElementById('umUserDetail').innerHTML =
        '<p class="text-muted">Select a user to view and manage their details.</p>';
    }
  } catch (err) {
    umShowError(err.message);
  }
}

function renderUmUserList() {
  const q = document.getElementById('umSearch').value.trim().toLowerCase();
  const role = document.getElementById('umRoleFilter').value;
  const list = document.getElementById('umUserList');
  const filtered = um.users.filter(
    (u) =>
      (!role || u.role === role) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding:12px">No users match.</p>';
    return;
  }

  list.innerHTML = filtered
    .map(
      (u) => `
      <button type="button" class="um-user-row ${u.id === um.selectedUserId ? 'active' : ''}" data-userid="${u.id}">
        <img src="${umEsc(u.picture)}" alt="" class="avatar" />
        <div class="um-user-row-info">
          <strong>${umEsc(u.name)}${u.id === state.user.id ? ' <small>(you)</small>' : ''}</strong>
          <small>${umEsc(u.email)}</small>
          <small class="text-muted">
            ${u.role === 'ADMIN' ? `📚 ${u.taught_count} taught` : `📚 ${u.enrolled_count} courses · ✅ ${u.present_count} · 💬 ${u.question_count} · 📊 ${u.vote_count} · 📂 ${u.submission_count}`}
          </small>
        </div>
        <span class="role-pill ${u.role.toLowerCase()}">${u.role}</span>
      </button>`
    )
    .join('');

  list.querySelectorAll('.um-user-row').forEach((btn) => {
    btn.addEventListener('click', () => selectUmUser(Number(btn.dataset.userid)));
  });
}

async function selectUmUser(userId) {
  um.selectedUserId = userId;
  renderUmUserList();
  umShowError('');
  try {
    um.profile = await umApi(`/api/admin/users/${userId}`);
    renderUmUserDetail();
  } catch (err) {
    umShowError(err.message);
  }
}

function umStatusPill(status) {
  const map = { PRESENT: ['✅ Present', 'um-ok'], OUT_OF_RANGE: ['📍 Out of range', 'um-warn'], ABSENT: ['❌ Absent', 'um-bad'] };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="um-pill ${cls}">${label}</span>`;
}

function renderUmUserDetail() {
  const p = um.profile;
  if (!p) return;
  const { user, enrolledCourses, taughtCourses, attendance, attendanceSummary, questions, pollVotes, submissions } = p;
  const isSelf = user.id === state.user.id;
  const enrolledIds = new Set(enrolledCourses.map((c) => c.id));
  const availableCourses = um.courses.filter((c) => !enrolledIds.has(c.id));
  const rate = attendanceSummary.total ? Math.round((attendanceSummary.present / attendanceSummary.total) * 100) : null;
  const loginMethods = [user.has_google ? 'Google' : null, user.has_password ? 'Email/Password' : null]
    .filter(Boolean)
    .join(' + ') || 'Not signed in yet';

  const detail = document.getElementById('umUserDetail');
  detail.innerHTML = `
    <div class="um-detail-header">
      <img src="${umEsc(user.picture)}" alt="" class="um-avatar-lg" />
      <div>
        <h3>${umEsc(user.name)} ${isSelf ? '<small class="text-muted">(you)</small>' : ''}</h3>
        <div class="text-muted">${umEsc(user.email)}</div>
        <div class="text-muted">Login: ${umEsc(loginMethods)} · Joined ${umDate(user.created_at)}</div>
      </div>
      <div class="um-role-box">
        <label class="text-muted">Role</label>
        <select id="umRoleSelect" class="select-input" ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
          <option value="STUDENT" ${user.role === 'STUDENT' ? 'selected' : ''}>STUDENT</option>
          <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
        </select>
        <button id="umSaveRole" class="btn btn-sm btn-primary" ${isSelf ? 'disabled' : ''}>Save Role</button>
      </div>
    </div>

    <div class="um-section">
      <h4>📚 Enrolled Courses (${enrolledCourses.length})</h4>
      <div class="um-chips">
        ${
          enrolledCourses
            .map(
              (c) => `<span class="um-chip" title="Enrolled ${umDate(c.enrolled_at)}">
                ${umEsc(c.code)} — ${umEsc(c.name)}
                <button type="button" class="um-chip-x" data-unenroll="${c.id}" title="Remove from course">✕</button>
              </span>`
            )
            .join('') || '<span class="text-muted">Not enrolled in any course.</span>'
        }
      </div>
      ${
        availableCourses.length
          ? `<div class="row-actions mt-8">
              <select id="umEnrollSelect" class="select-input" style="width:260px">
                ${availableCourses.map((c) => `<option value="${c.id}">${umEsc(c.code)} — ${umEsc(c.name)}</option>`).join('')}
              </select>
              <button id="umEnrollBtn" class="btn btn-sm btn-outline">+ Enroll</button>
            </div>`
          : ''
      }
      ${
        taughtCourses.length
          ? `<h4 class="mt-12">🎓 Courses Taught (${taughtCourses.length})</h4>
             <ul class="um-list">${taughtCourses
               .map((c) => `<li><strong>${umEsc(c.code)}</strong> — ${umEsc(c.name)} <span class="text-muted">(${c.enrolled_count} students, ${c.session_count} sessions)</span></li>`)
               .join('')}</ul>`
          : ''
      }
    </div>

    <div class="um-section">
      <h4>📍 Attendance ${rate !== null ? `— ${rate}% (${attendanceSummary.present}/${attendanceSummary.total})` : ''}</h4>
      ${
        attendance.length
          ? `<div class="table-responsive"><table class="data-table">
              <thead><tr><th>Date</th><th>Course</th><th>Session</th><th>Status</th><th>Distance</th></tr></thead>
              <tbody>${attendance
                .map(
                  (a) => `<tr>
                    <td>${umDate(a.session_date)}</td>
                    <td>${umEsc(a.course_code)}</td>
                    <td>${umEsc(a.session_title)}</td>
                    <td>${umStatusPill(a.status)}${a.manual_override ? ' <small class="text-muted">(manual)</small>' : ''}</td>
                    <td>${a.distance_meters != null && a.status !== 'ABSENT' ? `${Math.round(a.distance_meters)} m` : '—'}</td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="text-muted">No sessions yet.</p>'
      }
    </div>

    <div class="um-section">
      <h4>💬 Questions (${questions.length})</h4>
      ${
        questions.length
          ? `<ul class="um-list">${questions
              .map(
                (q) => `<li>
                  <div>${umEsc(q.content)}</div>
                  <small class="text-muted">${umEsc(q.course_code)}${q.session_title ? ` · ${umEsc(q.session_title)}` : ''} · ${umDate(q.created_at)}
                    · ${q.is_live ? 'Live' : 'Offline'}${q.is_anonymous ? ' · 🕶️ Anonymous to class' : ''}</small>
                  ${q.lecturer_reply ? `<div class="um-reply">↳ ${umEsc(q.lecturer_reply)}</div>` : ''}
                </li>`
              )
              .join('')}</ul>`
          : '<p class="text-muted">No questions asked.</p>'
      }
    </div>

    <div class="um-section">
      <h4>📊 Poll Votes (${pollVotes.length})</h4>
      ${
        pollVotes.length
          ? `<div class="table-responsive"><table class="data-table">
              <thead><tr><th>Date</th><th>Course</th><th>Poll</th><th>Answer</th></tr></thead>
              <tbody>${pollVotes
                .map(
                  (v) => `<tr>
                    <td>${umDate(v.voted_at)}</td>
                    <td>${umEsc(v.course_code)}</td>
                    <td>${umEsc(v.question)}${v.is_active ? ' <span class="um-pill um-ok">open</span>' : ''}</td>
                    <td><strong>${umEsc(v.chosen_option)}</strong></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="text-muted">No poll votes.</p>'
      }
    </div>

    <div class="um-section">
      <h4>📂 Homework Submissions (${submissions.length})</h4>
      ${
        submissions.length
          ? `<div class="table-responsive"><table class="data-table">
              <thead><tr><th>Submitted</th><th>Course</th><th>Assignment</th><th>Submission</th><th>Score</th><th>LLM Review</th></tr></thead>
              <tbody>${submissions
                .map(
                  (s) => `<tr>
                    <td>${umDate(s.submitted_at)}</td>
                    <td>${umEsc(s.course_code)}</td>
                    <td>${umEsc(s.assignment_title)}</td>
                    <td>${
                      s.repo_url
                        ? `<a href="${umEsc(s.repo_url)}" target="_blank" rel="noopener">GitHub repo</a>`
                        : umEsc(s.file_name || 'Text / code')
                    }</td>
                    <td>${s.score != null ? umEsc(s.score) : '—'}</td>
                    <td>${s.has_review ? '✅' : '—'}</td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="text-muted">No submissions.</p>'
      }
    </div>
  `;

  document.getElementById('umSaveRole')?.addEventListener('click', umSaveRole);
  document.getElementById('umEnrollBtn')?.addEventListener('click', umEnroll);
  detail.querySelectorAll('[data-unenroll]').forEach((btn) => {
    btn.addEventListener('click', () => umUnenroll(Number(btn.dataset.unenroll)));
  });
}

async function umSaveRole() {
  const role = document.getElementById('umRoleSelect').value;
  const user = um.profile.user;
  if (role === user.role) return;
  if (!confirm(`Change ${user.name}'s role to ${role}?`)) return;
  try {
    await umApi(`/api/admin/users/${user.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
    await loadUsersAdmin();
  } catch (err) {
    umShowError(err.message);
    renderUmUserDetail();
  }
}

async function umEnroll() {
  const courseId = Number(document.getElementById('umEnrollSelect').value);
  try {
    um.profile = await umApi(`/api/admin/users/${um.profile.user.id}/enrollments`, {
      method: 'POST',
      body: JSON.stringify({ courseId })
    });
    await loadUsersAdmin();
  } catch (err) {
    umShowError(err.message);
  }
}

async function umUnenroll(courseId) {
  const course = um.profile.enrolledCourses.find((c) => c.id === courseId);
  if (!confirm(`Remove ${um.profile.user.name} from ${course ? course.code : 'this course'}? (Past attendance and activity are kept.)`)) return;
  try {
    um.profile = await umApi(`/api/admin/users/${um.profile.user.id}/enrollments/${courseId}`, { method: 'DELETE' });
    await loadUsersAdmin();
  } catch (err) {
    umShowError(err.message);
  }
}

document.getElementById('umSearch').addEventListener('input', renderUmUserList);
document.getElementById('umRoleFilter').addEventListener('change', renderUmUserList);
document.getElementById('umRefresh').addEventListener('click', loadUsersAdmin);
document.querySelector('.tab-btn[data-tab="admin-users"]').addEventListener('click', loadUsersAdmin);

function umTabIsOpen() {
  return document.getElementById('admin-users').classList.contains('active');
}

// Live updates: role/enrollment changes apply immediately to the affected user's open browser.
socket.on('user:updated', async ({ userId }) => {
  if (!state.user) return;
  if (userId === state.user.id) {
    const token = localStorage.getItem('liveclass_token');
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const { user } = await res.json();
      const roleChanged = user.role !== state.user.role;
      state.user = user;
      await refreshDashboard();
      if (roleChanged) alert(`Your role was changed to ${user.role} by an administrator.`);
    }
  }
  if (state.user.role === 'ADMIN' && umTabIsOpen()) loadUsersAdmin();
});

// Keep activity fresh while the tab is open
['attendance:updated', 'question:new', 'poll:results_updated', 'submission:updated', 'course:created', 'system:reset'].forEach(
  (evt) => {
    socket.on(evt, () => {
      if (state.user && state.user.role === 'ADMIN' && umTabIsOpen()) loadUsersAdmin();
    });
  }
);
