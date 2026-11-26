/* global io, cocoSsd */

const socket = io();

const state = {
  user: null,
  courses: [],
  allCourses: [],
  activeCourseId: null,
  activeSession: null,
  activePoll: null,
  assignments: [],
  selectedAssignmentId: null,
  pendingQrToken: null,
  pendingPollId: null,
  cocoModel: null,
  webcamStream: null,
  speechRecognition: null,
  isRecording: false,
  currentLiveModalQuestionId: null
};

// Parse URL query parameters (?qr=TOKEN&courseId=1 or ?pollId=1)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('qr')) state.pendingQrToken = urlParams.get('qr');
if (urlParams.get('courseId')) state.activeCourseId = Number(urlParams.get('courseId'));
if (urlParams.get('pollId')) state.pendingPollId = Number(urlParams.get('pollId'));

// ============================================================================
// 1. AUDIO CHIME SYNTHESIZER & OS DESKTOP NOTIFICATIONS (Cross-Window Alerts)
// ============================================================================
let audioCtx = null;
function playQuestionAlertChime() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const notes = [587.33, 880.0, 1174.66]; // D5 -> A5 -> D6 chime
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.28, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.45);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.46);
    });
  } catch (e) {
    console.warn('Audio chime blocked until user interaction:', e);
  }
}

function triggerDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, {
      body,
      icon: 'https://ui-avatars.com/api/?name=Q+A&background=dc2626&color=fff'
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

// ============================================================================
// 2. INITIALIZATION & GOOGLE OAUTH / DEMO ACCOUNTS
// ============================================================================
async function initApp() {
  if (state.pendingQrToken) {
    const notice = document.getElementById('qrScanNotice');
    notice.classList.remove('hidden');
    notice.innerHTML = `📷 <strong>Session QR Code Scanned (${state.pendingQrToken})!</strong> Sign in with Google below to automatically enroll in the course and verify your GPS attendance.`;
  }

  const res = await fetch('/api/auth/config');
  const data = await res.json();
  state.googleClientId = data.googleClientId;

  // Restore an existing session (signed server token) without re-prompting Google
  const savedToken = localStorage.getItem('liveclass_token');
  if (savedToken) {
    try {
      const meRes = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } });
      if (meRes.ok) {
        const me = await meRes.json();
        await onSignedIn(me.user, savedToken);
        return;
      }
    } catch {
      /* fall through to Google sign-in */
    }
    localStorage.removeItem('liveclass_token');
  }

  initGoogleSignIn();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

// Real Google Identity Services sign-in (ID token verified on the server)
function initGoogleSignIn() {
  if (!state.googleClientId) {
    // Google sign-in not configured — email/password login still works
    document.querySelector('.auth-divider')?.classList.add('hidden');
    return;
  }
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    // GSI script is loaded async — retry shortly
    setTimeout(initGoogleSignIn, 200);
    return;
  }
  if (!state.gsiInitialized) {
    google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      ux_mode: 'popup'
    });
    state.gsiInitialized = true;
  }
  const container = document.getElementById('googleSignInButton');
  container.innerHTML = '';
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'filled_blue',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left'
  });
}

async function handleGoogleCredential(response) {
  showAuthError('');
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showAuthError(data.error || 'Google sign-in failed');
      return;
    }
    await onSignedIn(data.user, data.token);
  } catch (err) {
    showAuthError(`Google sign-in failed: ${err.message}`);
  }
}

async function onSignedIn(user, token) {
  state.user = user;
  if (token) localStorage.setItem('liveclass_token', token);
  localStorage.removeItem('liveclass_user');

  // If student scanned a QR link before logging in, auto-enroll & check-in immediately!
  if (state.pendingQrToken && state.user.role === 'STUDENT') {
    await performStudentCheckIn(state.pendingQrToken);
    state.pendingQrToken = null;
  }

  await refreshDashboard();
}

// Email + password sign-in / registration (no Gmail required)
document.querySelectorAll('.auth-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.authmode;
    document.querySelectorAll('.auth-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('passwordLoginForm').classList.toggle('hidden', mode !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
    showAuthError('');
  });
});

async function submitPasswordAuth(url, payload) {
  showAuthError('');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showAuthError(data.error || 'Sign-in failed');
      return;
    }
    document.getElementById('passwordLoginForm').reset();
    document.getElementById('registerForm').reset();
    await onSignedIn(data.user, data.token);
  } catch (err) {
    showAuthError(`Sign-in failed: ${err.message}`);
  }
}

document.getElementById('passwordLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitPasswordAuth('/api/auth/login', {
    email: document.getElementById('loginEmail').value,
    password: document.getElementById('loginPassword').value
  });
});

document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitPasswordAuth('/api/auth/register', {
    name: document.getElementById('registerName').value,
    email: document.getElementById('registerEmail').value,
    password: document.getElementById('registerPassword').value
  });
});

document.getElementById('btnEnableAlerts').addEventListener('click', async () => {
  playQuestionAlertChime();
  if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    alert(`Sound Chime initialized & OS Desktop Notifications permission: ${perm}`);
  } else {
    alert('Sound Chime initialized!');
  }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('liveclass_token');
  localStorage.removeItem('liveclass_user');
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  state.user = null;
  document.getElementById('userControls').classList.add('hidden');
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('studentDashboard').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  initGoogleSignIn();
});

document.getElementById('btnResetDemoData')?.addEventListener('click', async () => {
  if (!confirm('Reset all courses, attendance, questions, polls, summaries, and homework to start a clean demo from zero?')) {
    return;
  }
  await fetch('/api/admin/reset', { method: 'POST' });
  state.activeCourseId = null;
  state.activeSession = null;
  state.activePoll = null;
  await refreshDashboard();
});

socket.on('system:reset', async () => {
  state.activeCourseId = null;
  state.activeSession = null;
  state.activePoll = null;
  if (state.user) await refreshDashboard();
});

// ============================================================================
// 3. DASHBOARD ROUTING & COURSE SELECTION
// ============================================================================
async function refreshDashboard() {
  if (!state.user) return;

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('userControls').classList.remove('hidden');
  document.getElementById('userAvatar').src = state.user.picture;
  document.getElementById('userName').textContent = state.user.name;

  const badge = document.getElementById('userRoleBadge');
  badge.textContent = state.user.role;
  badge.className = `role-pill ${state.user.role.toLowerCase()}`;

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', state.user.role !== 'ADMIN');
  });

  // Load courses
  const cRes = await fetch(`/api/courses?userId=${state.user.id}&role=${state.user.role}`);
  const cData = await cRes.json();
  state.courses = cData.courses || [];
  state.allCourses = cData.allCourses || [];

  const listToUse = state.courses.length > 0 ? state.courses : state.allCourses;
  if (!state.activeCourseId || !listToUse.some((c) => c.id === state.activeCourseId)) {
    state.activeCourseId = listToUse[0]?.id || null;
  }

  const courseSelect = document.getElementById('courseSelect');
  courseSelect.innerHTML = '';
  if (listToUse.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No Courses Yet — Click "+ Course" ➡️';
    courseSelect.appendChild(opt);
  } else {
    listToUse.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.code} — ${c.name}`;
      if (c.id === state.activeCourseId) opt.selected = true;
      courseSelect.appendChild(opt);
    });
  }

  if (state.user.role === 'ADMIN') {
    document.getElementById('studentDashboard').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    await loadAdminCourseData();
  } else {
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('studentDashboard').classList.remove('hidden');
    await loadStudentCourseData();
  }
}

document.getElementById('courseSelect').addEventListener('change', async (e) => {
  state.activeCourseId = Number(e.target.value);
  await refreshDashboard();
});

// Create New Course Modal
document.getElementById('btnNewCourseModal').addEventListener('click', () => {
  document.getElementById('newCourseModal').classList.remove('hidden');
});
document.getElementById('btnCancelCourseModal').addEventListener('click', () => {
  document.getElementById('newCourseModal').classList.add('hidden');
});
document.getElementById('createCourseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('newCourseCode').value;
  const name = document.getElementById('newCourseName').value;
  const description = document.getElementById('newCourseDesc').value;
  const res = await fetch('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lecturerId: state.user.id, code, name, description })
  });
  const data = await res.json();
  if (data.course) {
    state.activeCourseId = data.course.id;
    document.getElementById('newCourseModal').classList.add('hidden');
    e.target.reset();
    await refreshDashboard();
  }
});

// Admin Tabs Navigation
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Student Tabs Navigation (One Feature Per Tab)
document.querySelectorAll('.student-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.student-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.stu-tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.stutab).classList.add('active');
  });
});

// ============================================================================
// 4. LECTURER (ADMIN) WORKFLOWS
// ============================================================================
async function loadAdminCourseData() {
  if (!state.activeCourseId) {
    renderAdminSessionAndPhotoAudit(null);
    populateStudentHistoryDropdown([]);
    renderAttendanceHistoryMatrix({ sessions: [], students: [] });
    renderAdminQuestions([]);
    renderAdminPoll(null);
    renderAdminSummaries([]);
    await renderAdminAssignments([]);
    return;
  }

  const [sesRes, histRes, qaRes, pollRes, sumRes, assignRes] = await Promise.all([
    fetch(`/api/courses/${state.activeCourseId}/active-session`),
    fetch(`/api/courses/${state.activeCourseId}/attendance-history`),
    fetch(`/api/courses/${state.activeCourseId}/questions`),
    fetch(`/api/courses/${state.activeCourseId}/poll?role=ADMIN`),
    fetch(`/api/courses/${state.activeCourseId}/summaries?role=ADMIN`),
    fetch(`/api/courses/${state.activeCourseId}/assignments`)
  ]);

  const sesData = await sesRes.json();
  state.activeSession = sesData.session;
  renderAdminSessionAndPhotoAudit(state.activeSession);

  const histData = await histRes.json();
  populateStudentHistoryDropdown(histData.students);
  renderAttendanceHistoryMatrix(histData);

  const qaData = await qaRes.json();
  renderAdminQuestions(qaData.questions || []);

  const pollData = await pollRes.json();
  state.activePoll = pollData.poll;
  renderAdminPoll(state.activePoll);

  const sumData = await sumRes.json();
  renderAdminSummaries(sumData.summaries || []);

  const assignData = await assignRes.json();
  state.assignments = assignData.assignments || [];
  await renderAdminAssignments(state.assignments);
}

// --- 4.1 Live Session QR, GPS & Photo Audit ---
function renderAdminSessionAndPhotoAudit(session) {
  const statusBadge = document.getElementById('sessionStatusBadge');
  const btnEnd = document.getElementById('btnEndSession');
  const fraudBanner = document.getElementById('fraudAlertBanner');

  if (!session) {
    statusBadge.textContent = 'No Sessions Yet';
    statusBadge.className = 'status-badge closed';
    btnEnd.classList.add('hidden');
    fraudBanner.classList.add('hidden');
    document.getElementById('liveAttendanceTableBody').innerHTML =
      '<tr><td colspan="6">Start a session above to collect attendance.</td></tr>';
    return;
  }

  statusBadge.textContent = session.is_active ? '🟢 LIVE SESSION ACTIVE' : '⚪ SESSION ENDED';
  statusBadge.className = `status-badge ${session.is_active ? 'live' : 'closed'}`;
  btnEnd.classList.toggle('hidden', !session.is_active);

  if (session.qr_data_url) {
    document.getElementById('sessionQrImage').src = session.qr_data_url;
  }
  document.getElementById('sessionQrToken').textContent = `Token: ${session.qr_token}`;
  document.getElementById('activeSessionTitle').textContent = session.title;
  document.getElementById('lecturerGpsDisplay').textContent =
    `Lecturer GPS: (${session.lecturer_lat.toFixed(4)}, ${session.lecturer_lng.toFixed(4)}) | Max Radius: ${session.max_distance_meters}m`;
  if (session.checkin_url) {
    document.getElementById('sessionDirectLink').href = session.checkin_url;
  }

  // KPI & Fraud Discrepancy Alert (Registered Students vs Counted in Photo)
  document.getElementById('kpiRegisteredCount').textContent = session.present_count;
  document.getElementById('kpiPhotoCount').textContent =
    session.photo_headcount !== null && session.photo_headcount !== undefined
      ? session.photo_headcount
      : '—';

  const kpiStatus = document.getElementById('kpiAuditStatus');
  if (session.fraud_alert) {
    kpiStatus.textContent = `⚠️ +${session.discrepancy_count} Excess`;
    kpiStatus.className = 'kpi-value kpi-status danger';
    fraudBanner.classList.remove('hidden');
    document.getElementById('fraudAlertText').innerHTML = `
      <strong>${session.present_count} students</strong> are marked PRESENT digitally, but the AI Classroom Photo Counter detected only <strong>${session.photo_headcount} people</strong> in the room (<strong>${session.discrepancy_count} excess check-in(s)</strong>)!
      You can manually uncheck absent students in the roster table below.
    `;
  } else if (session.photo_headcount !== null && session.photo_headcount !== undefined) {
    kpiStatus.textContent = '✅ Verified Match';
    kpiStatus.className = 'kpi-value kpi-status ok';
    fraudBanner.classList.add('hidden');
  } else {
    kpiStatus.textContent = 'No Photo Yet';
    kpiStatus.className = 'kpi-value kpi-status';
    fraudBanner.classList.add('hidden');
  }

  if (session.photo_headcount !== null && session.photo_headcount !== undefined) {
    document.getElementById('manualPhotoCountInput').value = session.photo_headcount;
  }

  // If a photo was pushed from the Lecturer's Mobile Admin Camera, render it on the PC canvas!
  if (session.photo_data_url) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('photoAuditCanvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = session.photo_data_url;
  } else {
    drawSampleClassroomIllustration(session.photo_headcount ?? 4);
  }

  // Render Live Roster with Manual Toggle buttons
  const tbody = document.getElementById('liveAttendanceTableBody');
  tbody.innerHTML = '';
  const recordMap = new Map();
  (session.attendance_records || []).forEach((r) => recordMap.set(r.student_id, r));

  (session.enrolled_students || []).forEach((stu) => {
    const rec = recordMap.get(stu.id);
    const status = rec ? rec.status : 'ABSENT';
    const dist = rec ? `${rec.distance_meters}m` : '—';
    const time = rec ? rec.checked_in_at : 'Not checked in';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${stu.name}</strong></td>
      <td>${stu.email}</td>
      <td>${dist}</td>
      <td><span class="status-pill ${status}">${status}${rec?.manual_override ? ' (Edited)' : ''}</span></td>
      <td>${time}</td>
      <td>
        <button class="btn btn-sm ${status === 'PRESENT' ? 'btn-outline' : 'btn-primary'}"
                onclick="toggleManualStatus(${session.id}, ${stu.id}, '${status === 'PRESENT' ? 'ABSENT' : 'PRESENT'}')">
          ${status === 'PRESENT' ? '❌ Mark Absent' : '✅ Mark Present'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.toggleManualStatus = async function (sessionId, studentId, newStatus) {
  await fetch('/api/attendance/manual', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, studentId, status: newStatus })
  });
  await loadAdminCourseData();
};

document.getElementById('btnStartSession').addEventListener('click', async () => {
  if (!state.activeCourseId) {
    document.getElementById('newCourseModal').classList.remove('hidden');
    return alert('Create your first course to start a live class session!');
  }
  const title =
    document.getElementById('newSessionTitle').value.trim() ||
    `Live Lecture (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  const maxDistanceMeters = Number(document.getElementById('newSessionRadius').value || 60);

  let lecturerLat = 32.1045;
  let lecturerLng = 35.2075;
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2500 })
      );
      lecturerLat = pos.coords.latitude;
      lecturerLng = pos.coords.longitude;
    } catch {
      // Fallback to default Ariel University classroom coordinates
    }
  }

  await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: state.activeCourseId,
      title,
      lecturerLat,
      lecturerLng,
      maxDistanceMeters
    })
  });
  await loadAdminCourseData();
});

document.getElementById('btnEndSession').addEventListener('click', async () => {
  if (!state.activeSession) return;
  await fetch(`/api/sessions/${state.activeSession.id}/end`, { method: 'POST' });
  await loadAdminCourseData();
});

// --- 4.2 Mobile Admin Classroom Photo AI Person Counter (TensorFlow.js coco-ssd + Server Sync) ---
function drawSampleClassroomIllustration(count = 4) {
  const canvas = document.getElementById('photoAuditCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#334155';
  ctx.fillRect(20, 20, canvas.width - 40, 45);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('CLASSROOM CAMERA AUDIT VIEW — AI PERSON DETECTION', 40, 48);

  const positions = [
    [60, 120], [180, 125], [300, 118], [420, 122],
    [90, 205], [230, 205], [370, 205]
  ];

  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const [x, y] = positions[i];
    // Draw student silhouette
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(x + 30, y + 22, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 8, y + 42, 44, 34);

    // Draw AI Bounding Box
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, 60, 82);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x, y - 18, 60, 18);
    ctx.fillStyle = '#052e16';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`person #${i + 1}`, x + 3, y - 5);
  }
}

async function runCocoPersonDetectionOnCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  try {
    if (!state.cocoModel && window.cocoSsd) {
      state.cocoModel = await cocoSsd.load();
    }
    if (state.cocoModel) {
      const predictions = await state.cocoModel.detect(canvas, 40, 0.22);
      const persons = predictions.filter((p) => p.class === 'person');
      persons.forEach((p, idx) => {
        const [x, y, w, h] = p.bbox;
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x, Math.max(0, y - 18), 78, 18);
        ctx.fillStyle = '#052e16';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`person #${idx + 1}`, x + 4, Math.max(12, y - 5));
      });
      if (persons.length > 0) return persons.length;
    }
  } catch (e) {
    console.warn('COCO-SSD fallback used:', e);
  }
  return Number(document.getElementById('manualPhotoCountInput').value || 4);
}

async function syncCanvasPhotoAuditToServer(detectedCount) {
  if (!state.activeSession) return alert('Start a session first.');
  const canvas = document.getElementById('photoAuditCanvas');
  const photoDataUrl = canvas.toDataURL('image/jpeg', 0.75);

  document.getElementById('manualPhotoCountInput').value = detectedCount;
  await fetch(`/api/sessions/${state.activeSession.id}/photo-audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoDataUrl, detectedCount })
  });
}

document.getElementById('classroomPhotoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.getElementById('photoAuditCanvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const count = await runCocoPersonDetectionOnCanvas(canvas);
      await syncCanvasPhotoAuditToServer(count);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('btnSimulateCrowdPhoto').addEventListener('click', async () => {
  drawSampleClassroomIllustration(4);
  await syncCanvasPhotoAuditToServer(4);
});

document.getElementById('btnSyncPhotoCount').addEventListener('click', async () => {
  const count = Number(document.getElementById('manualPhotoCountInput').value || 0);
  drawSampleClassroomIllustration(count);
  await syncCanvasPhotoAuditToServer(count);
});

document.getElementById('btnOpenLiveWebcam').addEventListener('click', async () => {
  const box = document.getElementById('webcamContainer');
  const video = document.getElementById('webcamVideo');
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach((t) => t.stop());
    state.webcamStream = null;
    box.classList.add('hidden');
    return;
  }
  try {
    state.webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = state.webcamStream;
    box.classList.remove('hidden');
  } catch (err) {
    alert('Could not open camera: ' + err.message);
  }
});

document.getElementById('btnCaptureWebcamFrame').addEventListener('click', async () => {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('photoAuditCanvas');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const count = await runCocoPersonDetectionOnCanvas(canvas);
  await syncCanvasPhotoAuditToServer(count);
});

// --- 4.3 Attendance History & Per-Student Filter Across All Lectures ---
function populateStudentHistoryDropdown(studentRows) {
  const sel = document.getElementById('historyStudentFilter');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">All Enrolled Students (Full Class Matrix)</option>';
  (studentRows || []).forEach((row) => {
    const opt = document.createElement('option');
    opt.value = row.student.id;
    opt.textContent = `${row.student.name} (${row.attendance_rate}% — ${row.present_sessions}/${row.total_sessions} lectures)`;
    if (String(row.student.id) === String(currentVal)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderAttendanceHistoryMatrix(history) {
  const thead = document.getElementById('historyTableHead');
  const tbody = document.getElementById('historyTableBody');
  const summaryCard = document.getElementById('studentFilterSummaryCard');

  const sessions = history.sessions || [];
  const students = history.students || [];

  if (history.filter_student_id && students.length === 1) {
    const s = students[0];
    summaryCard.classList.remove('hidden');
    summaryCard.innerHTML = `
      <div>
        <strong>👩‍🎓 Filtered Student History: ${s.student.name}</strong> (${s.student.email})
      </div>
      <div>
        Attended <strong>${s.present_sessions} of ${s.total_sessions}</strong> lectures
        (<span class="status-pill PRESENT">${s.attendance_rate}% Attendance Rate</span>)
      </div>
    `;
  } else {
    summaryCard.classList.add('hidden');
  }

  thead.innerHTML = `
    <tr>
      <th>Student</th>
      <th>Email</th>
      <th>Attendance Rate</th>
      ${sessions.map((s) => `<th>${s.title}<br/><small>${s.created_at.slice(0, 10)}</small></th>`).join('')}
    </tr>
  `;

  tbody.innerHTML = '';
  students.forEach((row) => {
    const tr = document.createElement('tr');
    const sessionCells = row.sessions
      .map(
        (ses) => `
        <td>
          <span class="status-pill ${ses.status}">${ses.status}</span>
          ${ses.distance_meters !== null ? `<br/><small>${ses.distance_meters}m</small>` : ''}
          <br/>
          <button class="btn btn-sm btn-outline mt-8"
                  onclick="toggleManualStatus(${ses.session_id}, ${row.student.id}, '${ses.status === 'PRESENT' ? 'ABSENT' : 'PRESENT'}')">
            Toggle
          </button>
        </td>
      `
      )
      .join('');

    tr.innerHTML = `
      <td><strong>${row.student.name}</strong></td>
      <td>${row.student.email}</td>
      <td><strong>${row.attendance_rate}%</strong> (${row.present_sessions}/${row.total_sessions})</td>
      ${sessionCells}
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('historyStudentFilter').addEventListener('change', async (e) => {
  const studentId = e.target.value;
  const url = `/api/courses/${state.activeCourseId}/attendance-history${studentId ? `?studentId=${studentId}` : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  renderAttendanceHistoryMatrix(data);
});

document.getElementById('btnExportCsvCurrent').addEventListener('click', () => {
  window.open(`/api/courses/${state.activeCourseId}/attendance-export.csv`, '_blank');
});

document.getElementById('btnExportHistoryCsv').addEventListener('click', () => {
  const studentId = document.getElementById('historyStudentFilter').value;
  window.open(
    `/api/courses/${state.activeCourseId}/attendance-export.csv${studentId ? `?studentId=${studentId}` : ''}`,
    '_blank'
  );
});

// --- 4.4 Feature 2: Live & Offline Q&A ---
function renderAdminQuestions(questions) {
  const unreadCount = questions.filter((q) => !q.is_dismissed && !q.lecturer_reply).length;
  document.getElementById('adminQaBadge').textContent = unreadCount;

  const list = document.getElementById('adminQuestionsList');
  if (questions.length === 0) {
    list.innerHTML = '<p class="card-desc">No questions submitted for this course yet.</p>';
    return;
  }

  list.innerHTML = questions
    .map(
      (q) => `
      <div class="qa-item ${!q.is_dismissed ? 'live-unread' : ''}">
        <div class="qa-meta">
          <span><strong>${q.display_author}</strong> • ${q.is_live ? '🔴 Asked LIVE in Class' : '🌙 Asked Offline After Class'} (${q.session_title || 'Course General'})</span>
          <span>${q.created_at}</span>
        </div>
        <div class="qa-content">${q.content}</div>
        ${q.lecturer_reply
          ? `<div class="qa-reply-box"><strong>👨‍🏫 Lecturer Reply:</strong> ${q.lecturer_reply}</div>`
          : `
            <div class="qa-reply-form">
              <input type="text" id="replyInput_${q.id}" placeholder="Type written reply (for offline questions or course archive)..." />
              <button class="btn btn-sm btn-accent" onclick="sendLecturerReply(${q.id})">Send Reply</button>
              ${!q.is_dismissed
            ? `<button class="btn btn-sm btn-outline" onclick="dismissQuestion(${q.id})">✅ Answered Verbally (Dismiss)</button>`
            : ''
          }
            </div>
          `
        }
      </div>
    `
    )
    .join('');
}

window.sendLecturerReply = async function (questionId) {
  const input = document.getElementById(`replyInput_${questionId}`);
  const replyText = input.value.trim();
  if (!replyText) return;
  await fetch(`/api/questions/${questionId}/reply`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyText })
  });
  await loadAdminCourseData();
};

window.dismissQuestion = async function (questionId) {
  await fetch(`/api/questions/${questionId}/dismiss`, { method: 'PATCH' });
  if (state.currentLiveModalQuestionId === questionId) {
    document.getElementById('liveQuestionModal').classList.add('hidden');
  }
  await loadAdminCourseData();
};

document.getElementById('btnDismissLiveQuestion').addEventListener('click', async () => {
  if (state.currentLiveModalQuestionId) {
    await window.dismissQuestion(state.currentLiveModalQuestionId);
  } else {
    document.getElementById('liveQuestionModal').classList.add('hidden');
  }
});

document.getElementById('btnTestAudioChime').addEventListener('click', () => {
  playQuestionAlertChime();
});

// --- 4.5 Feature 3: On-the-Spot Multiple-Choice KISS Polls ---
document.getElementById('createPollForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = document.getElementById('pollQuestionInput').value.trim();
  const options = document
    .getElementById('pollOptionsInput')
    .value.split('\n')
    .map((o) => o.trim())
    .filter(Boolean);

  if (options.length < 2) return alert('Please enter at least 2 options (one per line).');

  const res = await fetch('/api/polls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: state.activeCourseId,
      sessionId: state.activeSession?.id || null,
      question,
      options
    })
  });
  const data = await res.json();
  if (data.poll) {
    state.activePoll = data.poll;
    renderAdminPoll(state.activePoll);
  }
});

function renderAdminPoll(poll) {
  const box = document.getElementById('adminPollResultsBox');
  const btnClose = document.getElementById('btnClosePoll');

  if (!poll) {
    btnClose.classList.add('hidden');
    box.innerHTML = '<p class="card-desc">No poll created for this course yet.</p>';
    return;
  }

  btnClose.classList.toggle('hidden', !poll.is_active);
  const barsHtml = (poll.results || [])
    .map(
      (r) => `
      <div class="poll-bar-row">
        <div class="poll-bar-label">
          <span>${r.label}</span>
          <span>${r.count} votes (${r.percentage}%)</span>
        </div>
        <div class="poll-bar-track">
          <div class="poll-bar-fill" style="width: ${r.percentage}%"></div>
        </div>
      </div>
    `
    )
    .join('');

  box.innerHTML = `
    <div class="qr-projector-box" style="margin-bottom:16px">
      ${poll.qr_data_url
      ? `<div class="qr-image-wrap"><img src="${poll.qr_data_url}" style="width:140px;height:140px" alt="Poll QR"/></div>`
      : ''
    }
      <div>
        <span class="status-badge ${poll.is_active ? 'live' : 'closed'}">${poll.is_active ? '🟢 LIVE POLL' : 'CLOSED'}</span>
        <h4 class="mt-8">${poll.question}</h4>
        <p class="card-desc">Total Student Votes: <strong>${poll.total_votes}</strong></p>
      </div>
    </div>
    ${barsHtml}
  `;
}

document.getElementById('btnClosePoll').addEventListener('click', async () => {
  if (!state.activePoll) return;
  await fetch(`/api/polls/${state.activePoll.id}/close`, { method: 'POST' });
  await loadAdminCourseData();
});

// --- 4.6 Feature 4: Live Recording / File Upload & ML Lecture Summary ---
document.getElementById('btnToggleRecording').addEventListener('click', () => {
  const btn = document.getElementById('btnToggleRecording');
  const indicator = document.getElementById('recordingTimer');
  const textarea = document.getElementById('summaryTranscriptInput');

  if (!state.isRecording) {
    state.isRecording = true;
    btn.textContent = '⏹ Stop Live Recording';
    btn.className = 'btn btn-danger';
    indicator.classList.remove('hidden');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      state.speechRecognition = new SpeechRecognition();
      state.speechRecognition.continuous = true;
      state.speechRecognition.interimResults = false;
      state.speechRecognition.lang = 'en-US';
      state.speechRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            textarea.value += (textarea.value ? ' ' : '') + event.results[i][0].transcript;
          }
        }
      };
      state.speechRecognition.start();
    } else if (!textarea.value.trim()) {
      textarea.value =
        'Today we discussed the Strategy and Observer design patterns in Object-Oriented Design. The Strategy pattern encapsulates interchangeable algorithms behind a common interface, whereas the Observer pattern enables event-driven notifications such as our real-time Socket.IO classroom alerts.';
    }
  } else {
    state.isRecording = false;
    btn.textContent = '⏺ Start Live Recording';
    btn.className = 'btn btn-primary';
    indicator.classList.add('hidden');
    if (state.speechRecognition) {
      state.speechRecognition.stop();
      state.speechRecognition = null;
    }
    if (!textarea.value.trim()) {
      textarea.value =
        'Recorded Live Lecture: We examined how dual-factor attendance combines QR tokens with Haversine GPS proximity and AI computer vision headcount verification, followed by low-level UML class and sequence diagrams.';
    }
  }
});

document.getElementById('lectureFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('summaryTitleInput').value = `Recorded Lecture: ${file.name}`;
  if (file.type.startsWith('text/') || /\.(txt|md|srt|vtt)$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('summaryTranscriptInput').value = ev.target.result;
    };
    reader.readAsText(file);
  } else {
    document.getElementById('summaryTranscriptInput').value =
      `[Uploaded Media Recording: ${file.name} (${Math.round(file.size / 1024)} KB)]\nIn this recorded lecture session, the lecturer demonstrated object-oriented decomposition, SRS functional traceability, real-time WebSocket event handling, and automated unit testing strategies.`;
  }
});

document.getElementById('btnGenerateSummary').addEventListener('click', async () => {
  const title =
    document.getElementById('summaryTitleInput').value.trim() ||
    state.activeSession?.title ||
    `Lecture Summary (${new Date().toLocaleDateString()})`;
  const transcript = document.getElementById('summaryTranscriptInput').value.trim();
  if (!transcript) return alert('Please record or enter/upload a lecture transcript first.');

  const res = await fetch('/api/summaries/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: state.activeCourseId,
      sessionId: state.activeSession?.id || null,
      title,
      transcript
    })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadAdminCourseData();
});

function renderAdminSummaries(summaries) {
  const list = document.getElementById('adminSummariesList');
  if (summaries.length === 0) {
    list.innerHTML = '<p class="card-desc">No lecture summaries generated yet.</p>';
    return;
  }

  list.innerHTML = summaries
    .map(
      (s) => `
      <div class="summary-card">
        <div class="card-header">
          <strong>${s.title}</strong>
          <span class="status-badge ${s.is_published ? 'live' : 'closed'}">
            ${s.is_published ? '✅ PUBLISHED TO STUDENTS' : '📝 DRAFT (Only Lecturer Sees This)'}
          </span>
        </div>
        <textarea id="summaryEdit_${s.id}" rows="7">${s.summary_markdown}</textarea>
        <div class="form-split">
          <small class="card-desc">${s.created_at}</small>
          <button class="btn btn-sm btn-primary" onclick="publishSummary(${s.id})">
            ${s.is_published ? '💾 Update Published Summary' : '🚀 Approve & Publish to Course Page'}
          </button>
        </div>
      </div>
    `
    )
    .join('');
}

window.publishSummary = async function (summaryId) {
  const summaryMarkdown = document.getElementById(`summaryEdit_${summaryId}`).value;
  await fetch(`/api/summaries/${summaryId}/publish`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaryMarkdown })
  });
  await loadAdminCourseData();
};

// --- 4.7 Feature 5: Configurable Homework Assignments & Submissions Inspector ---
document.getElementById('createAssignmentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('assignTitle').value.trim();
  const description = document.getElementById('assignDesc').value.trim();
  const submissionType = document.getElementById('assignType').value;
  const dueDate = document.getElementById('assignDue').value;

  await fetch('/api/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: state.activeCourseId,
      title,
      description,
      submissionType,
      dueDate
    })
  });
  e.target.reset();
  await loadAdminCourseData();
});

async function renderAdminAssignments(assignments) {
  const sel = document.getElementById('adminAssignmentSelect');
  sel.innerHTML = '';
  if (assignments.length === 0) {
    document.getElementById('adminSubmissionsList').innerHTML =
      '<p class="card-desc">No assignments created yet.</p>';
    return;
  }

  if (!state.selectedAssignmentId || !assignments.some((a) => a.id === state.selectedAssignmentId)) {
    state.selectedAssignmentId = assignments[0].id;
  }

  assignments.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.title} [${a.submission_type}] (${a.submission_count} submissions)`;
    if (a.id === state.selectedAssignmentId) opt.selected = true;
    sel.appendChild(opt);
  });

  await loadAdminSubmissionsForSelected(state.selectedAssignmentId);
}

document.getElementById('adminAssignmentSelect').addEventListener('change', async (e) => {
  state.selectedAssignmentId = Number(e.target.value);
  await loadAdminSubmissionsForSelected(state.selectedAssignmentId);
});

async function loadAdminSubmissionsForSelected(assignmentId) {
  const res = await fetch(`/api/assignments/${assignmentId}/submissions`);
  const data = await res.json();
  const subs = data.submissions || [];
  const box = document.getElementById('adminSubmissionsList');

  if (subs.length === 0) {
    box.innerHTML = '<p class="card-desc">No student submissions yet for this assignment.</p>';
    return;
  }

  box.innerHTML = subs
    .map(
      (s) => `
      <div class="submission-card">
        <div class="card-header">
          <div>
            <strong>👩‍🎓 ${s.student_name}</strong> <small>(${s.student_email})</small>
          </div>
          ${s.score ? `<span class="status-pill PRESENT">LLM Benchmark: ${s.score}/100</span>` : ''}
        </div>
        ${s.repo_url
          ? `<p>🔗 <strong>GitHub Repo:</strong> <a href="${s.repo_url}" target="_blank">${s.repo_url}</a></p>`
          : ''
        }
        ${s.file_name ? `<p>📄 <strong>Uploaded File:</strong> ${s.file_name}</p>` : ''}
        ${s.content ? `<div class="markdown-box">${s.content}</div>` : ''}
        <div class="mt-8">
          <button class="btn btn-sm btn-accent" onclick="triggerLlmHomeworkAnalysis(${s.id})">
            🤖 ${s.llm_review ? 'Refresh LLM Review & Peer Comparison' : 'Run LLM Review & Peer Comparison'}
          </button>
        </div>
        ${s.llm_review
          ? `
            <div class="markdown-box mt-8"><strong>🤖 LLM Deep Review:</strong>\n${s.llm_review}</div>
            <div class="markdown-box mt-8"><strong>📊 Anonymous Comparison to Classmates:</strong>\n${s.llm_comparison}</div>
          `
          : ''
        }
      </div>
    `
    )
    .join('');
}

window.triggerLlmHomeworkAnalysis = async function (submissionId) {
  await fetch(`/api/submissions/${submissionId}/analyze`, { method: 'POST' });
  if (state.user.role === 'ADMIN') {
    await loadAdminSubmissionsForSelected(state.selectedAssignmentId);
  } else {
    await loadStudentCourseData();
  }
};

// ============================================================================
// 5. STUDENT MOBILE WEB APP WORKFLOWS
// ============================================================================
async function loadStudentCourseData() {
  renderStudentEnrolledCourses();
  if (!state.activeCourseId) {
    renderStudentSessionCheckIn(null);
    renderStudentPoll(null);
    renderStudentQuestions([]);
    renderStudentSummaries([]);
    await renderStudentAssignments([]);
    return;
  }

  const [sesRes, pollRes, qaRes, sumRes, assignRes] = await Promise.all([
    fetch(`/api/courses/${state.activeCourseId}/active-session`),
    fetch(`/api/courses/${state.activeCourseId}/poll?role=STUDENT&studentId=${state.user.id}`),
    fetch(`/api/courses/${state.activeCourseId}/questions`),
    fetch(`/api/courses/${state.activeCourseId}/summaries?role=STUDENT`),
    fetch(`/api/courses/${state.activeCourseId}/assignments`)
  ]);

  const sesData = await sesRes.json();
  state.activeSession = sesData.session;
  renderStudentSessionCheckIn(state.activeSession);

  const pollData = await pollRes.json();
  renderStudentPoll(pollData.poll);

  const qaData = await qaRes.json();
  renderStudentQuestions(qaData.questions || []);

  const sumData = await sumRes.json();
  renderStudentSummaries(sumData.summaries || []);

  const assignData = await assignRes.json();
  await renderStudentAssignments(assignData.assignments || []);
}

function renderStudentEnrolledCourses() {
  const grid = document.getElementById('studentCoursesGrid');
  const list = state.courses.length > 0 ? state.courses : state.allCourses;
  if (list.length === 0) {
    grid.innerHTML = '<span class="text-muted">No courses enrolled yet — scan the Lecturer QR code to join!</span>';
    return;
  }
  grid.innerHTML = list
    .map(
      (c) => `
      <div class="course-chip ${c.id === state.activeCourseId ? 'active' : ''}"
           onclick="selectStudentCourse(${c.id})">
        <strong>${c.code} — ${c.name}</strong>
        <div style="font-size:0.78rem;color:#475569;margin-top:4px">
          ${c.active_session_id ? '🟢 Live Lecture Active Now' : '⚪ Offline Mode (Q&A, Summaries, Homework)'}
        </div>
      </div>
    `
    )
    .join('');
}

window.selectStudentCourse = async function (courseId) {
  state.activeCourseId = courseId;
  document.getElementById('courseSelect').value = courseId;
  await loadStudentCourseData();
};

function renderStudentSessionCheckIn(session) {
  const badge = document.getElementById('studentSessionBadge');
  const info = document.getElementById('studentSessionInfo');
  const btn = document.getElementById('btnStudentCheckIn');

  if (!session || !session.is_active) {
    badge.textContent = 'No Active Live Session';
    badge.className = 'status-badge closed';
    info.textContent =
      'There is no live lecture session open right now. You can still ask offline post-class questions, read published AI lecture summaries, or submit homework below!';
    btn.disabled = true;
    return;
  }

  badge.textContent = '🟢 LIVE SESSION OPEN';
  badge.className = 'status-badge live';
  info.innerHTML = `Active Session: <strong>${session.title}</strong> (Allowed GPS Radius: ${session.max_distance_meters}m from Lecturer).`;
  btn.disabled = false;
}

async function performStudentCheckIn(qrTokenOverride = null) {
  const simulateFar = document.getElementById('simulateFarGpsCheckbox')?.checked;
  let studentLat = state.activeSession?.lecturer_lat || 32.1045;
  let studentLng = state.activeSession?.lecturer_lng || 35.2075;

  if (simulateFar) {
    // Shift latitude by ~260 meters outside classroom geofence
    studentLat += 0.0024;
  } else {
    // Inside classroom (~9m from lecturer)
    studentLat += 0.00007;
    studentLng += 0.00005;
  }

  const res = await fetch('/api/attendance/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qrToken: qrTokenOverride,
      courseId: state.activeCourseId,
      sessionId: state.activeSession?.id,
      studentId: state.user.id,
      studentLat,
      studentLng
    })
  });
  const data = await res.json();
  const resBox = document.getElementById('studentCheckInResult');
  resBox.classList.remove('hidden');

  if (data.error) {
    resBox.className = 'alert alert-danger mt-12';
    resBox.textContent = `❌ ${data.error}`;
    return;
  }

  const c = data.checkIn;
  if (c.verified) {
    resBox.className = 'alert alert-success mt-12';
    resBox.innerHTML = `✅ <strong>Attendance Verified & Enrolled!</strong> Dual-factor check passed: GPS distance to lecturer is <strong>${c.distance_meters}m</strong> (within ${c.max_distance_meters}m classroom limit).`;
  } else {
    resBox.className = 'alert alert-danger mt-12';
    resBox.innerHTML = `🚨 <strong>GPS Proximity Failed (${c.status})!</strong> Your measured distance is <strong>${c.distance_meters}m</strong> from the lecturer (max allowed: ${c.max_distance_meters}m).`;
  }
}

document.getElementById('btnStudentCheckIn').addEventListener('click', () => performStudentCheckIn());

document.getElementById('btnSimulateFirstQrScan').addEventListener('click', async () => {
  const token = prompt(
    'Enter or paste Session QR Token (simulating camera QR scan on Lecture 1):',
    state.activeSession?.qr_token || 'TOKEN-LEC3-LIVE'
  );
  if (token) {
    await performStudentCheckIn(token.trim());
    await refreshDashboard();
  }
});

// Student Multiple-Choice Poll Voting (Confirmation only; results only on Lecturer Projector)
function renderStudentPoll(poll) {
  const body = document.getElementById('studentPollBody');
  if (!poll || !poll.is_active) {
    body.innerHTML = '<p class="card-desc">No active poll right now. When the lecturer launches a poll, it will pop up here automatically!</p>';
    return;
  }

  const optionsHtml = poll.options
    .map(
      (opt, idx) => `
      <button class="poll-option-btn ${poll.my_vote === idx ? 'selected' : ''}"
              onclick="submitStudentVote(${poll.id}, ${idx})">
        <strong>${String.fromCharCode(65 + idx)}.</strong> ${opt}
        ${poll.my_vote === idx ? ' ✅ (Your Vote)' : ''}
      </button>
    `
    )
    .join('');

  body.innerHTML = `
    <h4>${poll.question}</h4>
    <div class="student-poll-options">${optionsHtml}</div>
    ${poll.my_vote !== null
      ? `<div class="alert alert-success mt-12">✅ Your vote has been recorded! Live bar-chart results are displayed on the lecturer's projector screen.</div>`
      : ''
    }
  `;
}

window.submitStudentVote = async function (pollId, optionIndex) {
  const res = await fetch(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: state.user.id, optionIndex })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadStudentCourseData();
};

// Student Live & Offline Q&A
document.getElementById('studentAskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = document.getElementById('studentQuestionInput').value.trim();
  const isAnonymous = document.getElementById('studentAnonCheckbox').checked;

  await fetch('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: state.activeCourseId,
      sessionId: state.activeSession?.is_active ? state.activeSession.id : null,
      studentId: state.user.id,
      content,
      isAnonymous
    })
  });
  document.getElementById('studentQuestionInput').value = '';
  await loadStudentCourseData();
});

function renderStudentQuestions(questions) {
  const feed = document.getElementById('studentQuestionsFeed');
  if (questions.length === 0) {
    feed.innerHTML = '<p class="card-desc">No questions in this course yet.</p>';
    return;
  }
  feed.innerHTML = questions
    .map(
      (q) => `
      <div class="qa-item">
        <div class="qa-meta">
          <span><strong>${q.display_author}</strong> • ${q.is_live ? '🔴 Live Class Question' : '🌙 Post-Class Offline Question'}</span>
          <span>${q.created_at}</span>
        </div>
        <div class="qa-content">${q.content}</div>
        ${q.lecturer_reply
          ? `<div class="qa-reply-box"><strong>👨‍🏫 Lecturer Answer:</strong> ${q.lecturer_reply}</div>`
          : `<small class="card-desc">${q.is_dismissed ? '✅ Answered verbally by lecturer in class' : '⏳ Waiting for lecturer response'}</small>`
        }
      </div>
    `
    )
    .join('');
}

// Student Published AI Lecture Summaries
function renderStudentSummaries(summaries) {
  const list = document.getElementById('studentSummariesList');
  if (summaries.length === 0) {
    list.innerHTML = '<p class="card-desc">No published lecture summaries for this course yet.</p>';
    return;
  }
  list.innerHTML = summaries
    .map(
      (s) => `
      <div class="summary-card">
        <div class="card-header">
          <strong>📅 ${s.title}</strong>
          <small>${s.created_at.slice(0, 10)}</small>
        </div>
        <div class="markdown-box">${s.summary_markdown}</div>
      </div>
    `
    )
    .join('');
}

// Student Configurable Homework & On-Demand LLM Review + Peer Comparison
async function renderStudentAssignments(assignments) {
  const container = document.getElementById('studentAssignmentsList');
  if (assignments.length === 0) {
    container.innerHTML = '<p class="card-desc">No homework assignments opened for this course yet.</p>';
    return;
  }

  const blocks = [];
  for (const a of assignments) {
    const subRes = await fetch(`/api/assignments/${a.id}/submissions`);
    const subData = await subRes.json();
    const allSubs = subData.submissions || [];
    const mySub = allSubs.find((s) => s.student_id === state.user.id);

    const allowGithub = a.submission_type === 'GITHUB_ONLY' || a.submission_type === 'BOTH';
    const allowFileText = a.submission_type === 'FILE_OR_TEXT' || a.submission_type === 'BOTH';

    blocks.push(`
      <div class="submission-card">
        <div class="card-header">
          <div>
            <h4>${a.title}</h4>
            <p class="card-desc">${a.description}</p>
          </div>
          <div>
            <span class="pill-tag">Allowed Format: ${a.submission_type}</span>
            <span class="pill-tag">Peers Submitted: ${allSubs.length}</span>
          </div>
        </div>

        <form onsubmit="submitStudentHomework(event, ${a.id})">
          ${allowGithub
        ? `
              <div class="form-group">
                <label>🔗 GitHub Repository URL ${a.submission_type === 'GITHUB_ONLY' ? '(Required)' : ''}</label>
                <input type="url" id="hwRepo_${a.id}" value="${mySub?.repo_url || ''}" placeholder="https://github.com/username/I2SE_Exe2" ${a.submission_type === 'GITHUB_ONLY' ? 'required' : ''} />
              </div>
            `
        : ''
      }
          ${allowFileText
        ? `
              <div class="form-group">
                <label>📄 Upload Homework File or Paste Solution / Design Summary</label>
                <input type="file" onchange="loadHomeworkFileToText(event, ${a.id})" style="margin-bottom:8px" />
                <input type="hidden" id="hwFileName_${a.id}" value="${mySub?.file_name || ''}" />
                <textarea id="hwContent_${a.id}" rows="3" placeholder="Paste your code, architecture overview, or upload a file above...">${mySub?.content || ''}</textarea>
              </div>
            `
        : ''
      }
          <div class="form-split">
            <button type="submit" class="btn btn-primary">💾 Save / Upload My Homework</button>
            ${mySub
        ? `
                <button type="button" class="btn btn-accent" onclick="triggerLlmHomeworkAnalysis(${mySub.id})">
                  🤖 Get LLM Review &amp; Compare to Classmates (${allSubs.length} Submissions)
                </button>
              `
        : ''
      }
          </div>
        </form>

        ${mySub?.llm_review
        ? `
            <div class="alert alert-info mt-12">
              <strong>🎯 Estimated LLM Benchmark Score: ${mySub.score}/100</strong>
            </div>
            <div class="markdown-box mt-8"><strong>🤖 Your Individual LLM Deep Review:</strong>\n${mySub.llm_review}</div>
            <div class="markdown-box mt-8"><strong>📊 Anonymous Comparison to Other Students' Work:</strong>\n${mySub.llm_comparison}</div>
          `
        : ''
      }
      </div>
    `);
  }

  container.innerHTML = blocks.join('');
}

window.loadHomeworkFileToText = function (event, assignmentId) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById(`hwFileName_${assignmentId}`).value = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById(`hwContent_${assignmentId}`).value = ev.target.result.slice(0, 4000);
  };
  reader.readAsText(file);
};

window.submitStudentHomework = async function (event, assignmentId) {
  event.preventDefault();
  const repoEl = document.getElementById(`hwRepo_${assignmentId}`);
  const contentEl = document.getElementById(`hwContent_${assignmentId}`);
  const fileEl = document.getElementById(`hwFileName_${assignmentId}`);

  const res = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assignmentId,
      studentId: state.user.id,
      repoUrl: repoEl ? repoEl.value : '',
      content: contentEl ? contentEl.value : '',
      fileName: fileEl ? fileEl.value : ''
    })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadStudentCourseData();
};

// ============================================================================
// 6. REAL-TIME SOCKET.IO EVENTS (Projector Sync, Audio Chimes, Live Polls)
// ============================================================================
socket.on('attendance:updated', (session) => {
  if (!state.user || session.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') {
    state.activeSession = { ...state.activeSession, ...session };
    renderAdminSessionAndPhotoAudit(state.activeSession);
  }
});

socket.on('photo:audited', (session) => {
  if (!state.user || session.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') {
    state.activeSession = { ...state.activeSession, ...session };
    renderAdminSessionAndPhotoAudit(state.activeSession);
    if (session.fraud_alert) {
      playQuestionAlertChime();
    }
  }
});

socket.on('question:new', (question) => {
  if (!state.user || question.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') {
    loadAdminCourseData();
    // If question was asked LIVE during class, play chime, fire OS notification, and pop up on Projector!
    if (question.is_live) {
      playQuestionAlertChime();
      triggerDesktopNotification(
        `✋ New Live Question (${question.display_author})`,
        question.content
      );
      state.currentLiveModalQuestionId = question.id;
      document.getElementById('liveModalAuthor').textContent = question.display_author;
      document.getElementById('liveModalContent').textContent = question.content;
      document.getElementById('liveQuestionModal').classList.remove('hidden');
    }
  } else {
    loadStudentCourseData();
  }
});

socket.on('question:updated', (question) => {
  if (!state.user || question.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') loadAdminCourseData();
  else loadStudentCourseData();
});

socket.on('poll:started', (payload) => {
  if (!state.user || payload.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') {
    state.activePoll = payload.lecturerPoll;
    renderAdminPoll(state.activePoll);
  } else {
    renderStudentPoll(payload.studentPoll);
  }
});

socket.on('poll:results_updated', (lecturerPoll) => {
  if (!state.user || lecturerPoll.course_id !== state.activeCourseId) return;
  // Results update ONLY on the Lecturer's projected screen!
  if (state.user.role === 'ADMIN') {
    state.activePoll = { ...state.activePoll, ...lecturerPoll };
    renderAdminPoll(state.activePoll);
  }
});

socket.on('poll:closed', (poll) => {
  if (!state.user || poll.course_id !== state.activeCourseId) return;
  if (state.user.role === 'ADMIN') renderAdminPoll(poll);
  else loadStudentCourseData();
});

socket.on('summary:published', (summary) => {
  if (!state.user || summary.course_id !== state.activeCourseId) return;
  if (state.user.role === 'STUDENT') loadStudentCourseData();
});

initApp();
