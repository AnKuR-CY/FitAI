// GLOBAL APP STATE
let fatChartInstance = null;
let calChartInstance = null;
let currentDashboardTimeframe = 'week'; // 'week' or 'month'
let scannedMealCalories = null; // Stored to add to dashboard
let localFoodScans = [];
let availableSlotsInterval = null;
let liveWorkoutState = {
  active: false,
  dayTitle: '',
  workoutTitle: '',
  exercises: [],
  currentIndex: 0,
  secondsLeft: 90,
  isPaused: true,
  timerInterval: null
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  // 1. File Origin Check
  checkFileOrigin();
  
  // 2. Authentication Setup
  checkAuthState();
  initAuthForms();
  
  // 3. App Core Initializations
  initHealthCheck();
  initRoutineGenerator();
  initFoodScanner();
  initPhysioBooking();
  initDoctorDashboard();
  renderTrackerUI();
  
  // Set default dates on modals
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('log-date').value = todayStr;
  document.getElementById('book-date').value = todayStr;
});

// --- 1. LOCAL ORIGIN & FILE PROTOCOL CHECK ---
function checkFileOrigin() {
  const warningBanner = document.getElementById('file-origin-warning');
  if (window.location.protocol === 'file:') {
    warningBanner.classList.remove('hidden');
    showToast('Open via server (http://localhost:3000) for full backend features.', 'warning');
  } else {
    warningBanner.classList.add('hidden');
  }
}

// --- 2. AUTHENTICATED FETCH HELPER (TOKEN INTERCEPTOR) ---
async function authenticatedFetch(url, options = {}) {
  const token = localStorage.getItem('fitai_token');
  
  // Add Authorization headers
  if (!options.headers) {
    options.headers = {};
  }
  
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const res = await fetch(url, options);
    
    // Auto logout if unauthorized or forbidden
    if (res.status === 401 || res.status === 403) {
      console.warn('Session expired or invalid token. Redirecting to login...');
      if (localStorage.getItem('fitai_token')) {
        showToast('Session expired. Please log in again.', 'warning');
        handleLogout();
      }
      throw new Error('Unauthorized');
    }
    
    return res;
  } catch (err) {
    if (err.message === 'Unauthorized') {
      return null;
    }
    throw err;
  }
}

// --- 3. AUTHENTICATION CONTROLLER & STATE ---
function checkAuthState() {
  const token = localStorage.getItem('fitai_token');
  const username = localStorage.getItem('fitai_username');
  const role = localStorage.getItem('fitai_role') || 'user';
  
  const authOverlay = document.getElementById('auth-overlay');
  const userBadge = document.getElementById('user-profile-badge');
  const userDisplay = document.getElementById('user-display-name');
  const logoutBtn = document.getElementById('logout-nav-btn');
  
  if (token && username) {
    // Logged in state
    authOverlay.classList.add('hidden');
    userBadge.classList.remove('hidden');
    userDisplay.textContent = username;
    logoutBtn.classList.remove('hidden');
    
    // Show/hide sections based on role
    const heroSec = document.querySelector('.hero-section');
    const featuresSec = document.getElementById('features');
    const routineSec = document.getElementById('routine');
    const nutritionSec = document.getElementById('nutrition');
    const physioSec = document.getElementById('physio');
    const dashboardSec = document.getElementById('dashboard');
    const doctorDashboardSec = document.getElementById('doctor-dashboard');
    const navLinks = document.querySelector('.nav-links');
    const navCta = document.querySelector('.nav-cta');

    if (role === 'doctor') {
      if (heroSec) heroSec.classList.add('hidden');
      if (featuresSec) featuresSec.classList.add('hidden');
      if (routineSec) routineSec.classList.add('hidden');
      if (nutritionSec) nutritionSec.classList.add('hidden');
      if (physioSec) physioSec.classList.add('hidden');
      if (dashboardSec) dashboardSec.classList.add('hidden');
      if (doctorDashboardSec) doctorDashboardSec.classList.remove('hidden');
      if (navLinks) navLinks.classList.add('hidden');
      if (navCta) navCta.classList.add('hidden');

      document.getElementById('doctor-title-name').textContent = localStorage.getItem('fitai_name') || username;
      document.getElementById('doctor-spec-label').textContent = localStorage.getItem('fitai_spec') || 'Specialist Portal';

      // Clear automatic refresh interval if doctor
      if (availableSlotsInterval) {
        clearInterval(availableSlotsInterval);
        availableSlotsInterval = null;
      }

      // Load Doctor Data
      fetchDoctorSlots();
      fetchDoctorBookings();
    } else {
      if (heroSec) heroSec.classList.remove('hidden');
      if (featuresSec) featuresSec.classList.remove('hidden');
      if (routineSec) routineSec.classList.remove('hidden');
      if (nutritionSec) nutritionSec.classList.remove('hidden');
      if (physioSec) physioSec.classList.remove('hidden');
      if (dashboardSec) dashboardSec.classList.remove('hidden');
      if (doctorDashboardSec) doctorDashboardSec.classList.add('hidden');
      if (navLinks) navLinks.classList.remove('hidden');
      if (navCta) navCta.classList.remove('hidden');

      // Fetch and initialize user data
      initDashboard();
      fetchUserRoutine();
      fetchAppointments();
      fetchFoodScans();
      fetchWorkoutHistory();
      fetchAvailableTherapists();

      // Start automatic refresh of slots (every 15s)
      if (!availableSlotsInterval) {
        availableSlotsInterval = setInterval(fetchAvailableTherapists, 15000);
      }
    }
  } else {
    // Logged out state
    authOverlay.classList.remove('hidden');
    userBadge.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    
    // Clear dynamic structures
    clearUserState();
  }
}

function clearUserState() {
  // Clear automatic refresh interval
  if (availableSlotsInterval) {
    clearInterval(availableSlotsInterval);
    availableSlotsInterval = null;
  }

  // Clear charts
  if (fatChartInstance) { fatChartInstance.destroy(); fatChartInstance = null; }
  if (calChartInstance) { calChartInstance.destroy(); calChartInstance = null; }
  
  // Clear live tracker state
  if (liveWorkoutState && liveWorkoutState.timerInterval) {
    clearInterval(liveWorkoutState.timerInterval);
  }
  liveWorkoutState = {
    active: false,
    dayTitle: '',
    workoutTitle: '',
    exercises: [],
    currentIndex: 0,
    secondsLeft: 90,
    isPaused: true,
    timerInterval: null
  };
  renderTrackerUI();

  // Reset lists
  document.getElementById('appointments-list-container').innerHTML = '<div class="no-appointments">Log in to view sessions.</div>';
  document.getElementById('routine-list').innerHTML = '<div class="routine-preview-desc">Log in to see your training schedule.</div>';
  document.getElementById('routine-title').textContent = 'My Workout Routine';
  document.getElementById('routine-overview').textContent = 'Please log in to generate an AI plan.';
  
  // Reset history lists
  const scanHistory = document.getElementById('scan-history-list');
  if (scanHistory) scanHistory.innerHTML = '<div class="history-placeholder">No meal scans yet.</div>';
  const scanCount = document.getElementById('scan-history-count');
  if (scanCount) scanCount.textContent = '0 meals';
  const workoutHistory = document.getElementById('workout-history-list');
  if (workoutHistory) workoutHistory.innerHTML = '<div class="history-placeholder">No logged sessions.</div>';
  const workoutCount = document.getElementById('workout-history-count');
  if (workoutCount) workoutCount.textContent = '0 completed';

  // Restore sections visibility
  const heroSec = document.querySelector('.hero-section');
  const featuresSec = document.getElementById('features');
  const routineSec = document.getElementById('routine');
  const nutritionSec = document.getElementById('nutrition');
  const physioSec = document.getElementById('physio');
  const dashboardSec = document.getElementById('dashboard');
  const doctorDashboardSec = document.getElementById('doctor-dashboard');
  const navLinks = document.querySelector('.nav-links');
  const navCta = document.querySelector('.nav-cta');

  if (heroSec) heroSec.classList.remove('hidden');
  if (featuresSec) featuresSec.classList.remove('hidden');
  if (routineSec) routineSec.classList.remove('hidden');
  if (nutritionSec) nutritionSec.classList.remove('hidden');
  if (physioSec) physioSec.classList.remove('hidden');
  if (dashboardSec) dashboardSec.classList.remove('hidden');
  if (doctorDashboardSec) doctorDashboardSec.classList.add('hidden');
  if (navLinks) navLinks.classList.remove('hidden');
  if (navCta) navCta.classList.remove('hidden');
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginTabBtn = document.getElementById('tab-login-btn');
  const registerTabBtn = document.getElementById('tab-register-btn');
  
  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTabBtn.classList.add('active');
    registerTabBtn.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    loginTabBtn.classList.remove('active');
    registerTabBtn.classList.add('active');
  }
}

function initAuthForms() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  
  // Handle Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    
    setLoadingState(submitBtn, true, 'Logging In...');
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      // Save session credentials
      localStorage.setItem('fitai_token', data.token);
      localStorage.setItem('fitai_username', data.username);
      localStorage.setItem('fitai_role', data.role || 'user');
      localStorage.setItem('fitai_name', data.name || '');
      localStorage.setItem('fitai_spec', data.specialization || '');
      
      showToast(`Welcome back, ${data.username}!`, 'success');
      
      // Clean inputs
      usernameInput.value = '';
      passwordInput.value = '';
      
      // Refresh state
      checkAuthState();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setLoadingState(submitBtn, false, 'Log In');
    }
  });
  
  // Handle Registration Toggle check
  const isDoctorCheckbox = document.getElementById('register-is-doctor');
  const doctorFields = document.getElementById('doctor-registration-fields');
  if (isDoctorCheckbox && doctorFields) {
    isDoctorCheckbox.addEventListener('change', () => {
      if (isDoctorCheckbox.checked) {
        doctorFields.classList.remove('hidden');
        document.getElementById('register-doctor-name').required = true;
        document.getElementById('register-doctor-spec').required = true;
        document.getElementById('register-doctor-passcode').required = true;
      } else {
        doctorFields.classList.add('hidden');
        document.getElementById('register-doctor-name').required = false;
        document.getElementById('register-doctor-spec').required = false;
        document.getElementById('register-doctor-passcode').required = false;
      }
    });
  }

  // Handle Registration Submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('register-username');
    const passwordInput = document.getElementById('register-password');
    const confirmInput = document.getElementById('register-confirm-password');
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    
    if (passwordInput.value !== confirmInput.value) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    
    setLoadingState(submitBtn, true, 'Creating Account...');

    const isDoctor = isDoctorCheckbox?.checked || false;
    const requestBody = {
      username: usernameInput.value,
      password: passwordInput.value
    };
    if (isDoctor) {
      requestBody.role = 'doctor';
      requestBody.name = document.getElementById('register-doctor-name').value;
      requestBody.specialization = document.getElementById('register-doctor-spec').value;
      requestBody.passcode = document.getElementById('register-doctor-passcode').value;
    }
    
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      
      // Save session credentials (auto login)
      localStorage.setItem('fitai_token', data.token);
      localStorage.setItem('fitai_username', data.username);
      localStorage.setItem('fitai_role', data.role || 'user');
      localStorage.setItem('fitai_name', data.name || '');
      localStorage.setItem('fitai_spec', data.specialization || '');
      
      showToast(`Welcome to FitAI, ${data.username}!`, 'success');
      
      // Clean inputs
      usernameInput.value = '';
      passwordInput.value = '';
      confirmInput.value = '';
      if (isDoctorCheckbox) isDoctorCheckbox.checked = false;
      if (doctorFields) doctorFields.classList.add('hidden');
      document.getElementById('register-doctor-name').value = '';
      document.getElementById('register-doctor-spec').value = '';
      document.getElementById('register-doctor-passcode').value = '';
      
      // Refresh state
      checkAuthState();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setLoadingState(submitBtn, false, 'Create Account & Login');
    }
  });
}

async function handleLogout() {
  const token = localStorage.getItem('fitai_token');
  if (token) {
    // Clear local storage session
    localStorage.removeItem('fitai_token');
    localStorage.removeItem('fitai_username');
    localStorage.removeItem('fitai_role');
    localStorage.removeItem('fitai_name');
    localStorage.removeItem('fitai_spec');
    
    showToast('Logged out successfully', 'info');
    checkAuthState();

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Logout error on backend:', err);
    }
  }
}

// --- Loading Helper ---
function setLoadingState(btnElement, isLoading, loadingText = '') {
  const textSpan = btnElement.querySelector('.btn-text');
  const spinnerSpan = btnElement.querySelector('.btn-spinner');
  
  if (isLoading) {
    btnElement.disabled = true;
    if (textSpan) textSpan.textContent = loadingText;
    if (spinnerSpan) spinnerSpan.classList.remove('hidden');
  } else {
    btnElement.disabled = false;
    if (textSpan) textSpan.textContent = loadingText; // original text passed
    if (spinnerSpan) spinnerSpan.classList.add('hidden');
  }
}

// --- 4. HEALTH CHECK & API STATUS ---
async function initHealthCheck() {
  const badge = document.getElementById('api-status-badge');
  try {
    const res = await fetch('/api/health');
    const status = await res.json();
    if (status.hasApiKey) {
      badge.textContent = 'AI ACTIVE';
      badge.className = 'api-badge status-ai';
    } else {
      badge.textContent = 'SIMULATED MODE';
      badge.className = 'api-badge status-mock';
    }
  } catch (err) {
    console.error('Server health check failed:', err);
    badge.textContent = 'OFFLINE';
    badge.className = 'api-badge status-default';
  }
}

// --- 5. TOAST NOTIFICATION HELPERS ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : type === 'info' ? 'toast-info' : ''}`;
  
  let iconClass = 'ti-circle-check';
  if (type === 'error') iconClass = 'ti-alert-circle';
  if (type === 'warning') iconClass = 'ti-alert-triangle';
  if (type === 'info') iconClass = 'ti-info-circle';
  
  toast.innerHTML = `
    <i class="ti ${iconClass} toast-icon"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.4s forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

// --- 6. MODAL CONTROLLERS ---
function openDemoModal() {
  document.getElementById('demo-modal').classList.remove('hidden');
}

function closeDemoModal() {
  document.getElementById('demo-modal').classList.add('hidden');
}

function openBookingModal(therapist, day, time) {
  document.getElementById('book-therapist-input').value = therapist;
  document.getElementById('book-therapist-name').textContent = therapist;
  document.getElementById('book-default-slot').textContent = `${day} @ ${time}`;
  
  const dateInput = document.getElementById('book-date');
  const today = new Date();
  if (day === 'Tomorrow') {
    today.setDate(today.getDate() + 1);
    dateInput.value = today.toISOString().split('T')[0];
  } else if (day === 'Today') {
    dateInput.value = today.toISOString().split('T')[0];
  } else if (day && day.match(/^\d{4}-\d{2}-\d{2}$/)) {
    dateInput.value = day;
  } else {
    dateInput.value = today.toISOString().split('T')[0];
  }
  
  document.getElementById('booking-modal').classList.remove('hidden');
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  document.getElementById('book-slot-id-input').value = '';
}

function openLogModal() {
  document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('log-modal').classList.remove('hidden');
}

function closeLogModal() {
  document.getElementById('log-modal').classList.add('hidden');
}

// --- 7. AI ROUTINE GENERATOR ---
function initRoutineGenerator() {
  const form = document.getElementById('routine-form');
  const btn = document.getElementById('generate-routine-btn');
  
  // Physique Photo Upload elements
  const dropZone = document.getElementById('routine-drop-zone');
  const fileInput = document.getElementById('routine-photo-input');
  const previewContainer = document.getElementById('routine-preview-container');
  const previewImg = document.getElementById('routine-preview-img');
  const cancelBtn = document.getElementById('cancel-routine-photo-btn');
  
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    ['dragleave', 'dragend'].forEach(type => {
      dropZone.addEventListener(type, () => {
        dropZone.classList.remove('dragover');
      });
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      
      if (e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelection(e.target.files[0]);
      }
    });
    
    function handleFileSelection(file) {
      if (!file.type.startsWith('image/')) {
        showToast('Please upload an image file.', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image size exceeds 5MB limit.', 'error');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImg.src = e.target.result;
        dropZone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
    
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering dropZone click
      fileInput.value = '';
      previewImg.src = '';
      previewContainer.classList.add('hidden');
      dropZone.classList.remove('hidden');
    });
  }
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoadingState(btn, true, 'Generating Plan...');
    
    const formData = new FormData();
    formData.append('goal', document.getElementById('goal-select').value);
    formData.append('days', document.getElementById('days-select').value);
    formData.append('level', document.getElementById('level-select').value);
    formData.append('equipment', document.getElementById('equipment-select').value);
    
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      formData.append('photo', fileInput.files[0]);
    }
    
    try {
      const res = await authenticatedFetch('/api/routine', {
        method: 'POST',
        body: formData
      });
      
      if (!res) return; // logout triggered
      const data = await res.json();
      
      if (!res.ok && !data.routine) {
        throw new Error(data.error || 'Failed to generate workout plan');
      }
      
      if (res.ok) {
        if (data.isMock) {
          // If Gemini API is mock but backend succeeded by returning simulated split
          showToast(`Simulated routine loaded. Gemini error: ${data.errorMsg || 'API Key Unauthorized'}`, 'warning');
        } else {
          showToast('Workout plan generated successfully!', 'success');
        }
      } else {
        showToast(data.error || 'Showing simulated routine split.', 'warning');
      }
      
      const badge = document.getElementById('api-status-badge');
      if (data.isMock) {
        badge.textContent = 'SIMULATED AI';
        badge.className = 'api-badge status-mock';
      } else {
        badge.textContent = 'AI ACTIVE';
        badge.className = 'api-badge status-ai';
      }
      
      renderGeneratedRoutine(data);
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setLoadingState(btn, false, 'Generate My AI Routine');
    }
  });
}

async function fetchUserRoutine() {
  try {
    const res = await authenticatedFetch('/api/routine');
    if (!res) return;
    
    if (res.status === 404) {
      // User hasn't generated a routine yet, leave it empty
      document.getElementById('routine-title').textContent = 'My Workout Routine';
      document.getElementById('routine-overview').textContent = 'Fill out the generator details on the left to customize a weekly training schedule.';
      document.getElementById('routine-list').innerHTML = '';
      return;
    }
    
    const data = await res.json();
    
    const badge = document.getElementById('api-status-badge');
    if (data.isMock) {
      badge.textContent = 'SIMULATED AI';
      badge.className = 'api-badge status-mock';
    } else {
      badge.textContent = 'AI ACTIVE';
      badge.className = 'api-badge status-ai';
    }
    
    renderGeneratedRoutine(data);
  } catch (err) {
    console.error('Failed to load user routine:', err);
  }
}

function renderGeneratedRoutine(data) {
  document.getElementById('routine-title').textContent = data.title || 'Your Personalized Routine';
  document.getElementById('routine-overview').textContent = data.overview || '';
  
  const listContainer = document.getElementById('routine-list');
  listContainer.innerHTML = '';
  
  if (!data.routine || !Array.isArray(data.routine)) {
    listContainer.innerHTML = '<div class="no-appointments">No routine details found.</div>';
    return;
  }
  
  data.routine.forEach((workout, idx) => {
    const isRest = !workout.exercises || workout.exercises.length === 0 || workout.name.toLowerCase().includes('rest');
    
    const row = document.createElement('div');
    row.className = `routine-day-row ${isRest ? 'disabled-day' : ''}`;
    row.style.cursor = isRest ? 'default' : 'pointer';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    
    let innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <div class="day-meta">
          <span class="day-name">${workout.day}</span>
          <span class="day-workout-title">${workout.name}</span>
        </div>
        <div>
          ${isRest 
            ? '<span class="day-action text-muted">Rest</span>' 
            : '<span class="day-action highlight" style="display:inline-flex; align-items:center; gap:4px;">Exercises <i class="ti ti-chevron-down"></i></span>'
          }
        </div>
      </div>
    `;
    
    if (!isRest) {
      let sublistHtml = `<div class="exercise-sublist hidden" id="ex-sub-${idx}">`;
      workout.exercises.forEach(ex => {
        sublistHtml += `
          <div class="exercise-sub-item">
            <div class="ex-sub-header">
              <span>${ex.name}</span>
              <span class="ex-sub-meta">${ex.sets} sets × ${ex.reps}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-secondary); margin-top:2px;">
              <span>Rest: ${ex.rest}</span>
            </div>
            ${ex.coachingCue ? `<div class="ex-sub-cue"><i class="ti ti-info-circle" style="font-size:10px;"></i> ${ex.coachingCue}</div>` : ''}
          </div>
        `;
      });
      sublistHtml += `
        <button class="btn-start-workout">
          <i class="ti ti-player-play-filled"></i> Start Live Workout
        </button>
      </div>`;
      innerHTML += sublistHtml;
    }
    
    row.innerHTML = innerHTML;
    
    if (!isRest) {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-start-workout')) {
          e.stopPropagation();
          startLiveWorkoutSession(workout);
          return;
        }
        if (e.target.closest('.exercise-sub-item')) return;
        
        const drawer = row.querySelector('.exercise-sublist');
        const chevron = row.querySelector('.day-action i');
        const isHidden = drawer.classList.contains('hidden');
        
        // Close other day rows
        document.querySelectorAll('.exercise-sublist').forEach(d => d.classList.add('hidden'));
        document.querySelectorAll('.day-action i').forEach(c => {
          c.className = 'ti ti-chevron-down';
        });
        
        if (isHidden) {
          drawer.classList.remove('hidden');
          chevron.className = 'ti ti-chevron-up';
          row.classList.add('active-day');
        } else {
          drawer.classList.add('hidden');
          chevron.className = 'ti ti-chevron-down';
          row.classList.remove('active-day');
        }
      });
    }
    
    listContainer.appendChild(row);
  });
}

// --- 7.5 LIVE EXERCISE TRACKER STATE & LOGIC ---
function parseExDuration(repsText) {
  if (!repsText) return 90;
  const sMatch = repsText.match(/(\d+)s/i);
  if (sMatch) return parseInt(sMatch[1]);
  const secMatch = repsText.match(/(\d+)\s*sec/i);
  if (secMatch) return parseInt(secMatch[1]);
  return 90; // Default to 90s stopwatch
}

function startLiveWorkoutSession(workoutData) {
  if (!workoutData || !workoutData.exercises || workoutData.exercises.length === 0) {
    showToast('Cannot start session: No exercises in this workout.', 'error');
    return;
  }
  
  if (liveWorkoutState.timerInterval) {
    clearInterval(liveWorkoutState.timerInterval);
  }
  
  liveWorkoutState = {
    active: true,
    dayTitle: workoutData.day,
    workoutTitle: workoutData.name,
    exercises: workoutData.exercises,
    currentIndex: 0,
    secondsLeft: parseExDuration(workoutData.exercises[0].reps),
    isPaused: true,
    timerInterval: null
  };
  
  renderTrackerUI();
  
  const trackerPanel = document.getElementById('live-tracker-panel');
  if (trackerPanel) {
    trackerPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  showToast(`Loaded ${workoutData.day}'s workout: ${workoutData.name}!`, 'info');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderTrackerUI() {
  const container = document.getElementById('live-tracker-panel');
  if (!container) return;
  
  if (!liveWorkoutState.active) {
    container.innerHTML = `
      <div class="tracker-placeholder">
        <div class="tracker-placeholder-icon">🏋️‍♂️</div>
        <div class="tracker-placeholder-title">Ready to Train?</div>
        <p class="tracker-placeholder-desc">Expand a workout day in your routine below and click <strong>"Start Live Workout"</strong> to load exercises into this real-time tracker.</p>
      </div>
    `;
    return;
  }
  
  if (liveWorkoutState.currentIndex >= liveWorkoutState.exercises.length) {
    renderCompletionScreen(container);
    return;
  }
  
  const currentEx = liveWorkoutState.exercises[liveWorkoutState.currentIndex];
  
  let html = `
    <div class="exercise-header">
      <span style="font-family:'Syne',sans-serif; font-size:13px; font-weight:700; color:var(--text-primary);">${liveWorkoutState.dayTitle} — ${liveWorkoutState.workoutTitle}</span>
      <span class="live-badge" style="background: ${liveWorkoutState.isPaused ? 'rgba(251,146,60,0.1)' : 'rgba(87,212,255,0.1)'}; color: ${liveWorkoutState.isPaused ? 'var(--accent-orange)' : 'var(--accent-blue)'}; border: 0.5px solid ${liveWorkoutState.isPaused ? 'rgba(251,146,60,0.2)' : 'rgba(87,212,255,0.2)'}; padding: 4px 10px; border-radius: 100px; font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
        <span class="live-dot" style="width:6px; height:6px; border-radius:50%; background: ${liveWorkoutState.isPaused ? 'var(--accent-orange)' : 'var(--accent-blue)'}; animation: ${liveWorkoutState.isPaused ? 'none' : 'pulse 1.5s infinite'};"></span>
        ${liveWorkoutState.isPaused ? 'Paused' : 'Active'}
      </span>
    </div>
    
    <div class="live-timer-card">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-blue); font-weight: 700; margin-bottom: 4px;">Active Exercise</div>
      <div style="font-family:'Syne',sans-serif; font-size:16px; font-weight:800; color:var(--text-primary);">${currentEx.name}</div>
      <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${currentEx.sets} sets × ${currentEx.reps}</div>
      
      <div class="live-timer-digits ${liveWorkoutState.secondsLeft <= 10 ? 'warning-time' : ''}" id="tracker-timer-digits">
        ${formatTime(liveWorkoutState.secondsLeft)}
      </div>
      
      ${currentEx.coachingCue ? `
        <div style="font-size: 11px; color: var(--accent-green); background: rgba(184,255,87,0.05); padding: 8px 12px; border-radius: 8px; border: 0.5px solid rgba(184,255,87,0.15); margin-top: 4px; display:flex; gap:6px; max-width: 90%; text-align: left;">
          <i class="ti ti-info-circle" style="font-size:13px; flex-shrink:0; margin-top:1px;"></i>
          <span>${currentEx.coachingCue}</span>
        </div>
      ` : ''}
      
      <div class="live-timer-controls">
        <button class="btn-tracker-control btn-play" id="tracker-play-btn" title="${liveWorkoutState.isPaused ? 'Play' : 'Pause'}">
          <i class="ti ${liveWorkoutState.isPaused ? 'ti-player-play-filled' : 'ti-player-pause-filled'}"></i>
        </button>
        <button class="btn-tracker-control" id="tracker-next-btn" title="Next Exercise / Done">
          <i class="ti ti-player-skip-forward-filled"></i>
        </button>
        <button class="btn-tracker-control btn-stop" id="tracker-stop-btn" title="Stop & Exit Workout">
          <i class="ti ti-square-filled"></i>
        </button>
      </div>
    </div>
    
    <div class="exercise-list">
  `;
  
  liveWorkoutState.exercises.forEach((ex, idx) => {
    let statusClass = 'ex-next';
    let statusText = 'Up Next';
    let itemClass = '';
    
    if (idx < liveWorkoutState.currentIndex) {
      statusClass = 'ex-done';
      statusText = 'Done ✓';
    } else if (idx === liveWorkoutState.currentIndex) {
      statusClass = 'ex-active';
      statusText = 'In Progress';
      itemClass = 'active-exercise';
    }
    
    html += `
      <div class="exercise-item ${itemClass}">
        <div>
          <div class="exercise-name" style="${idx === liveWorkoutState.currentIndex ? 'color: var(--accent-blue);' : ''}">${ex.name}</div>
          <div class="exercise-info">${ex.sets} sets × ${ex.reps} | Rest: ${ex.rest}</div>
        </div>
        <span class="exercise-status ${statusClass}">${statusText}</span>
      </div>
    `;
  });
  
  html += `</div>`;
  container.innerHTML = html;
  
  document.getElementById('tracker-play-btn').addEventListener('click', toggleTrackerTimer);
  document.getElementById('tracker-next-btn').addEventListener('click', () => {
    advanceWorkoutExercise(true);
  });
  document.getElementById('tracker-stop-btn').addEventListener('click', exitWorkoutSession);
}

function toggleTrackerTimer() {
  if (liveWorkoutState.isPaused) {
    liveWorkoutState.isPaused = false;
    liveWorkoutState.timerInterval = setInterval(tickTrackerTimer, 1000);
  } else {
    liveWorkoutState.isPaused = true;
    if (liveWorkoutState.timerInterval) {
      clearInterval(liveWorkoutState.timerInterval);
    }
  }
  renderTrackerUI();
}

function tickTrackerTimer() {
  if (liveWorkoutState.isPaused) return;
  
  liveWorkoutState.secondsLeft--;
  
  const digits = document.getElementById('tracker-timer-digits');
  if (digits) {
    digits.textContent = formatTime(liveWorkoutState.secondsLeft);
    if (liveWorkoutState.secondsLeft <= 10) {
      digits.classList.add('warning-time');
    } else {
      digits.classList.remove('warning-time');
    }
  }
  
  if (liveWorkoutState.secondsLeft <= 0) {
    showToast(`Time's up for ${liveWorkoutState.exercises[liveWorkoutState.currentIndex].name}!`, 'info');
    advanceWorkoutExercise(false);
  }
}

function advanceWorkoutExercise(userTriggered = false) {
  if (liveWorkoutState.timerInterval) {
    clearInterval(liveWorkoutState.timerInterval);
  }
  
  if (userTriggered) {
    showToast('Exercise marked as completed!', 'success');
  }
  
  liveWorkoutState.currentIndex++;
  
  if (liveWorkoutState.currentIndex < liveWorkoutState.exercises.length) {
    const nextEx = liveWorkoutState.exercises[liveWorkoutState.currentIndex];
    liveWorkoutState.secondsLeft = parseExDuration(nextEx.reps);
    liveWorkoutState.isPaused = false;
    liveWorkoutState.timerInterval = setInterval(tickTrackerTimer, 1000);
  }
  
  renderTrackerUI();
}

function exitWorkoutSession() {
  if (confirm('Are you sure you want to stop and exit this workout session? Your progress will be lost.')) {
    if (liveWorkoutState.timerInterval) {
      clearInterval(liveWorkoutState.timerInterval);
    }
    liveWorkoutState.active = false;
    renderTrackerUI();
    showToast('Workout session exited.', 'warning');
  }
}

function renderCompletionScreen(container) {
  if (liveWorkoutState.timerInterval) {
    clearInterval(liveWorkoutState.timerInterval);
  }
  
  container.innerHTML = `
    <div class="live-completion-screen">
      <div class="completion-icon">🏆</div>
      <div class="tracker-placeholder-title" style="font-size:18px; color:var(--accent-green); text-shadow: 0 0 10px rgba(184,255,87,0.25);">Workout Complete!</div>
      <p style="font-size:12px; color:var(--text-secondary); margin-top:6px; max-width:260px;">Awesome work completing your <strong>${liveWorkoutState.workoutTitle}</strong> session!</p>
      
      <div style="display:flex; justify-content:space-around; gap:16px; margin: 18px 0; width:100%; max-width:280px; background:rgba(255,255,255,0.02); border:0.5px solid var(--border-light); border-radius:12px; padding:12px;">
        <div>
          <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Exercises</div>
          <div style="font-family:'Syne',sans-serif; font-size:18px; font-weight:700; color:var(--accent-blue);">${liveWorkoutState.exercises.length} Completed</div>
        </div>
        <div>
          <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Est. Burn</div>
          <div style="font-family:'Syne',sans-serif; font-size:18px; font-weight:700; color:var(--accent-green);">~300 kcal</div>
        </div>
      </div>
      
      <button class="btn-primary-small w-full" id="sync-workout-dash-btn" style="padding: 12px; font-family:'Syne',sans-serif; font-size:12px; font-weight:700;">
        <i class="ti ti-refresh"></i> Sync Workout to Dashboard
      </button>
      <button class="btn-ghost-small mt-2 w-full" id="close-completion-btn" style="padding: 10px;">
        Back to Routine
      </button>
    </div>
  `;
  
  document.getElementById('sync-workout-dash-btn').addEventListener('click', syncWorkoutToDashboard);
  document.getElementById('close-completion-btn').addEventListener('click', () => {
    liveWorkoutState.active = false;
    renderTrackerUI();
  });
}

async function syncWorkoutToDashboard() {
  const syncBtn = document.getElementById('sync-workout-dash-btn');
  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="btn-spinner" style="margin-right:6px;"><i class="ti ti-loader-quarter animate-spin"></i></span> Syncing...';
  
  const todayStr = new Date().toISOString().split('T')[0];
  
  try {
    const statsRes = await authenticatedFetch('/api/dashboard/stats');
    if (!statsRes) return;
    const statsData = await statsRes.json();
    
    const todayLog = statsData.logs.find(l => l.date === todayStr);
    const existingCalories = todayLog ? todayLog.calories || 0 : 0;
    
    const logRes = await authenticatedFetch('/api/dashboard/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: todayStr,
        calories: existingCalories + 300,
        workoutDone: true
      })
    });
    
    if (!logRes) return;
    if (!logRes.ok) throw new Error('Failed to update dashboard log');
    
    // Sync to workout history log
    await authenticatedFetch('/api/workout-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutName: liveWorkoutState.workoutTitle,
        exercisesCount: liveWorkoutState.exercises.length,
        date: todayStr
      })
    });
    fetchWorkoutHistory();

    showToast('Workout successfully synced to your Dashboard!', 'success');
    syncBtn.innerHTML = 'Synced Successfully ✓';
    syncBtn.style.background = 'var(--accent-green)';
    syncBtn.style.borderColor = 'var(--accent-green)';
    syncBtn.style.color = 'var(--bg-primary)';
    
    initDashboard();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
    syncBtn.disabled = false;
    syncBtn.innerHTML = '<i class="ti ti-refresh"></i> Sync Workout to Dashboard';
  }
}

// --- 8. FOOD PHOTO CALORIE SCANNER ---
function initFoodScanner() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('food-image-input');
  const previewContainer = document.getElementById('upload-preview-container');
  const previewImg = document.getElementById('upload-preview-img');
  const cancelBtn = document.getElementById('cancel-upload-btn');
  const scanBtn = document.getElementById('scan-food-btn');
  
  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  
  ['dragleave', 'dragend'].forEach(type => {
    dropZone.addEventListener(type, () => {
      dropZone.classList.remove('dragover');
    });
  });
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });
  
  function handleFileSelection(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image size exceeds 5MB limit.', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      dropZone.classList.add('hidden');
      previewContainer.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
  
  cancelBtn.addEventListener('click', () => {
    fileInput.value = '';
    previewImg.src = '';
    previewContainer.classList.add('hidden');
    dropZone.classList.remove('hidden');
    document.getElementById('add-to-dashboard-btn').classList.add('hidden');
    scannedMealCalories = null;
  });
  
  scanBtn.addEventListener('click', async () => {
    if (!fileInput.files.length) {
      showToast('No file selected.', 'error');
      return;
    }
    
    setLoadingState(scanBtn, true, 'Scanning Plate...');
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    
    try {
      const res = await authenticatedFetch('/api/scan-food', {
        method: 'POST',
        body: formData
      });
      
      if (!res) return;
      const data = await res.json();
      
      if (!res.ok && !data.calories) {
        throw new Error(data.error || 'Failed to scan food image.');
      }
      
      if (res.ok) {
        showToast('Meal analyzed successfully!', 'success');
      } else {
        showToast(data.error || 'Showing simulated food analysis.', 'warning');
      }
      
      renderScanResult(data);
      fetchFoodScans();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setLoadingState(scanBtn, false, 'Analyze Plate');
    }
  });

  const addDashBtn = document.getElementById('add-to-dashboard-btn');
  addDashBtn.addEventListener('click', async () => {
    if (!scannedMealCalories) return;
    
    addDashBtn.disabled = true;
    addDashBtn.textContent = 'Adding...';
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    try {
      const statsRes = await authenticatedFetch('/api/dashboard/stats');
      if (!statsRes) return;
      const statsData = await statsRes.json();
      const todayLog = statsData.logs.find(l => l.date === todayStr);
      const existingCalories = todayLog ? todayLog.calories || 0 : 0;
      
      const logRes = await authenticatedFetch('/api/dashboard/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: todayStr,
          calories: existingCalories + scannedMealCalories
        })
      });
      
      if (!logRes) return;
      if (!logRes.ok) throw new Error('Failed to update dashboard log');
      
      showToast(`Added ${scannedMealCalories} kcal to today's dashboard!`, 'success');
      addDashBtn.textContent = 'Added ✓';
      
      // Update charts & stats
      initDashboard();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
      addDashBtn.disabled = false;
      addDashBtn.textContent = 'Add Calories to Dashboard';
    }
  });
}

function renderScanResult(data) {
  scannedMealCalories = data.calories;
  const resultPanel = document.getElementById('scanner-result-panel');
  
  resultPanel.querySelector('#scan-default-header').innerHTML = `
    <div class="scan-img-placeholder">🥗</div>
    <div>
      <div class="scan-result-title">${data.dish}</div>
      <div class="scan-result-sub" style="color:var(--accent-orange); font-size:12px; margin-top:2px; font-weight:600;">${data.calories} kcal detected</div>
      <div class="scan-result-sub">Serving: ${data.servingSize}</div>
    </div>
  `;
  
  document.getElementById('protein-val').textContent = `${data.protein}g`;
  document.getElementById('carbs-val').textContent = `${data.carbs}g`;
  document.getElementById('fat-val').textContent = `${data.fat}g`;
  
  const totalGrams = data.protein + data.carbs + data.fat;
  const pPct = totalGrams ? Math.round((data.protein / totalGrams) * 100) : 0;
  const cPct = totalGrams ? Math.round((data.carbs / totalGrams) * 100) : 0;
  const fPct = totalGrams ? Math.round((data.fat / totalGrams) * 100) : 0;
  
  document.getElementById('protein-bar').style.width = `${Math.max(10, pPct)}%`;
  document.getElementById('carbs-bar').style.width = `${Math.max(10, cPct)}%`;
  document.getElementById('fat-bar').style.width = `${Math.max(10, fPct)}%`;
  
  const tagsList = document.getElementById('ingredients-list');
  tagsList.innerHTML = '';
  if (data.ingredients && Array.isArray(data.ingredients)) {
    data.ingredients.forEach(item => {
      const span = document.createElement('span');
      span.className = 'ingredient-tag';
      span.textContent = item;
      tagsList.appendChild(span);
    });
  } else {
    tagsList.innerHTML = '<span class="text-muted">None detected.</span>';
  }
  
  document.getElementById('nutrition-advice').textContent = data.advice || 'Balanced macro breakdown.';
  
  const addDashBtn = document.getElementById('add-to-dashboard-btn');
  addDashBtn.classList.remove('hidden');
  addDashBtn.disabled = false;
  addDashBtn.textContent = 'Add Calories to Dashboard';
}

// --- 9. PHYSIO CLINIC BOOKING ---
// --- 9. PHYSIO CLINIC BOOKING ---
function initPhysioBooking() {
  const form = document.getElementById('booking-form');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = form.querySelector('button[type="submit"]');
    setLoadingState(submitBtn, true, 'Booking Slot...');
    
    const slotId = document.getElementById('book-slot-id-input').value;
    const requestData = {
      therapistName: document.getElementById('book-therapist-input').value,
      date: document.getElementById('book-date').value,
      time: document.getElementById('book-time').value
    };
    if (slotId) {
      requestData.slotId = slotId;
    }
    
    try {
      const res = await authenticatedFetch('/api/physio/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });
      
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to book session. Please try again.');
      
      showToast('Appointment booked successfully!', 'success');
      closeBookingModal();
      fetchAppointments();
      fetchAvailableTherapists();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setLoadingState(submitBtn, false, 'Confirm Booking');
    }
  });
}

async function fetchAppointments() {
  const listContainer = document.getElementById('appointments-list-container');
  try {
    const res = await authenticatedFetch('/api/physio/appointments');
    if (!res) return;
    const appointments = await res.json();
    
    listContainer.innerHTML = '';
    
    if (appointments.length === 0) {
      listContainer.innerHTML = '<div class="no-appointments">No upcoming sessions. Book a therapist on the right!</div>';
      return;
    }
    
    appointments.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    appointments.forEach(app => {
      const item = document.createElement('div');
      item.className = 'appointment-item';
      
      const statusClass = app.status === 'completed' ? 'badge-ai' : app.status === 'accepted' ? 'badge-ai' : 'badge-mock';
      
      item.innerHTML = `
        <div class="appointment-meta">
          <span class="appointment-doctor">${app.therapistName}</span>
          <span class="appointment-schedule">${app.date} @ ${app.time}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="history-item-badge ${statusClass}">${app.status || 'pending'}</span>
          <button class="btn-ghost-small" style="color:var(--accent-red); font-size:11px; padding:4px 8px; border:0.5px solid rgba(239,68,68,0.2); border-radius:6px;" onclick="cancelPatientBooking('${app.id}')">Cancel</button>
        </div>
      `;
      listContainer.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to fetch appointments:', err);
    listContainer.innerHTML = '<div class="no-appointments" style="color:var(--accent-red);">Error loading sessions.</div>';
  }
}

// --- 10. ANALYTICS DASHBOARD ---
async function initDashboard() {
  const stats = await fetchDashboardStats();
  if (!stats) return;
  
  // Render stats cards
  document.getElementById('stat-fat-lost').textContent = stats.totalFatLost.toFixed(1);
  document.getElementById('stat-avg-calories').textContent = stats.avgDailyCalories.toLocaleString();
  document.getElementById('stat-workouts-done').textContent = stats.workoutsCompleted;
  document.getElementById('stat-total-workouts').textContent = ` / ${stats.totalWorkouts}`;
  document.getElementById('stat-streak').textContent = stats.streak;
  
  // Render completion %
  const pct = stats.totalWorkouts ? Math.round((stats.workoutsCompleted / stats.totalWorkouts) * 100) : 0;
  document.getElementById('stat-workout-completion').textContent = `${pct}% Completion`;
  
  // Process logs for charts
  const sortedLogs = stats.logs.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const filterCount = currentDashboardTimeframe === 'week' ? 7 : 30;
  const filteredLogs = sortedLogs.slice(-filterCount);
  
  renderWeightChart(filteredLogs);
  renderCaloriesChart(filteredLogs);
  
  // Remove existing submit handlers to avoid duplicate bindings
  const logForm = document.getElementById('log-form');
  const newLogForm = logForm.cloneNode(true);
  logForm.parentNode.replaceChild(newLogForm, logForm);
  
  // Set date on new form
  document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
  
  // Bind single submit listener
  newLogForm.addEventListener('submit', handleProgressLogSubmit);
}

async function fetchDashboardStats() {
  try {
    const res = await authenticatedFetch('/api/dashboard/stats');
    if (!res) return null;
    return await res.json();
  } catch (err) {
    console.error(err);
    showToast('Failed to load dashboard statistics.', 'error');
    return null;
  }
}

function setDashboardTimeframe(timeframe) {
  currentDashboardTimeframe = timeframe;
  document.getElementById('tab-week').classList.toggle('active', timeframe === 'week');
  document.getElementById('tab-month').classList.toggle('active', timeframe === 'month');
  
  initDashboard();
}

async function handleProgressLogSubmit(e) {
  e.preventDefault();
  
  const form = document.getElementById('log-form');
  const submitBtn = form.querySelector('button[type="submit"]');
  
  setLoadingState(submitBtn, true, 'Saving Log...');
  
  const dateVal = document.getElementById('log-date').value;
  const weightVal = document.getElementById('log-weight').value;
  const bodyFatVal = document.getElementById('log-bodyfat').value;
  const caloriesVal = document.getElementById('log-calories').value;
  const workoutVal = document.getElementById('log-workout').checked;
  
  const requestData = {
    date: dateVal,
    workoutDone: workoutVal
  };
  
  if (weightVal) requestData.weight = parseFloat(weightVal);
  if (bodyFatVal) requestData.bodyFat = parseFloat(bodyFatVal);
  if (caloriesVal) requestData.calories = parseInt(caloriesVal);
  
  try {
    const res = await authenticatedFetch('/api/dashboard/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });
    
    if (!res) return;
    if (!res.ok) throw new Error('Failed to record activity log.');
    
    showToast('Activity logged successfully!', 'success');
    closeLogModal();
    
    // Clear form inputs
    document.getElementById('log-weight').value = '';
    document.getElementById('log-bodyfat').value = '';
    document.getElementById('log-calories').value = '';
    document.getElementById('log-workout').checked = false;
    
    await initDashboard();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  } finally {
    setLoadingState(submitBtn, false, 'Save Daily Log');
  }
}

// --- 11. CHART.JS GRAPH BUILDERS ---
function renderWeightChart(logs) {
  const ctx = document.getElementById('fatChart').getContext('2d');
  
  const labels = logs.map(log => {
    const parts = log.date.split('-');
    return parts.length > 2 ? `${parts[1]}/${parts[2]}` : log.date;
  });
  
  const weightData = logs.map(log => log.weight);
  const fatData = logs.map(log => log.bodyFat);
  
  if (fatChartInstance) {
    fatChartInstance.destroy();
  }
  
  fatChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Body Fat %',
          data: fatData,
          borderColor: '#b8ff57',
          backgroundColor: 'rgba(184, 255, 87, 0.06)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#b8ff57',
          yAxisID: 'yFat',
        },
        {
          label: 'Weight kg',
          data: weightData,
          borderColor: '#57d4ff',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#57d4ff',
          borderDash: [4, 3],
          yAxisID: 'yWeight',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#6b7280', font: { size: 10, family: 'DM Sans' } },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        yFat: {
          type: 'linear',
          position: 'left',
          ticks: { 
            color: '#b8ff57', 
            font: { size: 10 },
            callback: (val) => `${val}%`
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        yWeight: {
          type: 'linear',
          position: 'right',
          ticks: { 
            color: '#57d4ff', 
            font: { size: 10 },
            callback: (val) => `${val}kg`
          },
          grid: { display: false }
        }
      }
    }
  });
}

function renderCaloriesChart(logs) {
  const ctx = document.getElementById('calChart').getContext('2d');
  
  const labels = logs.map(log => {
    const parts = log.date.split('-');
    return parts.length > 2 ? `${parts[1]}/${parts[2]}` : log.date;
  });
  
  const calorieData = logs.map(log => log.calories || 0);
  const goalLine = logs.map(() => 2000);
  
  if (calChartInstance) {
    calChartInstance.destroy();
  }
  
  calChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Calories',
          data: calorieData,
          backgroundColor: (context) => {
            const val = context.raw;
            return val > 2000 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(251, 146, 60, 0.7)';
          },
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Goal',
          data: goalLine,
          type: 'line',
          borderColor: 'rgba(255, 255, 255, 0.25)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#6b7280', font: { size: 10, family: 'DM Sans' } },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          min: 1000,
          ticks: { color: '#6b7280', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        }
      }
    }
  });
}

// --- 11. PERSISTENT USER HISTORY LOADERS & RENDERING ---
async function fetchFoodScans() {
  try {
    const res = await authenticatedFetch('/api/food-scans');
    if (!res) return;
    const scans = await res.json();
    
    const countEl = document.getElementById('scan-history-count');
    if (countEl) countEl.textContent = `${scans.length} meal${scans.length === 1 ? '' : 's'}`;
    
    const listEl = document.getElementById('scan-history-list');
    if (!listEl) return;
    
    if (scans.length === 0) {
      listEl.innerHTML = '<div class="history-placeholder">No meal scans yet.</div>';
      return;
    }
    
    localFoodScans = scans;
    
    listEl.innerHTML = scans.map((scan, idx) => {
      const dateStr = new Date(scan.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="history-item" style="cursor:pointer;" onclick="loadScanFromHistory(${idx})">
          <div class="history-item-left">
            <div class="history-item-name">${scan.dish}</div>
            <div class="history-item-sub">${dateStr}</div>
          </div>
          <div class="history-item-right">
            <div class="history-item-val">${scan.calories} kcal</div>
            <span class="history-item-badge ${scan.isMock ? 'badge-mock' : 'badge-ai'}">${scan.isMock ? 'Mock' : 'Gemini'}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load food scans:', err);
  }
}

function loadScanFromHistory(idx) {
  const scan = localFoodScans[idx];
  if (scan) {
    renderScanResult(scan);
    const resultPanel = document.getElementById('scanner-result-panel');
    if (resultPanel) {
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

async function fetchWorkoutHistory() {
  try {
    const res = await authenticatedFetch('/api/workout-history');
    if (!res) return;
    const history = await res.json();
    
    const countEl = document.getElementById('workout-history-count');
    if (countEl) countEl.textContent = `${history.length} completed`;
    
    const listEl = document.getElementById('workout-history-list');
    if (!listEl) return;
    
    if (history.length === 0) {
      listEl.innerHTML = '<div class="history-placeholder">No logged sessions.</div>';
      return;
    }
    
    listEl.innerHTML = history.map(w => {
      const dateStr = new Date(w.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="history-item">
          <div class="history-item-left">
            <div class="history-item-name">${w.workoutName}</div>
            <div class="history-item-sub">${dateStr}</div>
          </div>
          <div class="history-item-right">
            <div class="history-item-val blue-val">${w.exercisesCount} Exercises</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load workout history:', err);
  }
}

// --- 9.5 DYNAMIC PHYSIO AND DOCTOR DASHBOARD METHODS ---
async function fetchAvailableTherapists() {
  const container = document.getElementById('available-therapists-list');
  if (!container) return;

  try {
    const res = await fetch(`/api/physio/available-slots?t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to fetch available slots.');
    const slots = await res.json();

    container.innerHTML = '';

    if (slots.length === 0) {
      container.innerHTML = `
        <div class="slots-placeholder" style="grid-column: 1 / -1; text-align: center; width: 100%; padding: 40px 0;">
          No available physio slots at the moment. Please check back later!
        </div>
      `;
      return;
    }

    slots.forEach(slot => {
      const card = document.createElement('div');
      card.className = 'physio-card';

      const docName = slot.doctorName || 'Dr. Therapist';
      const cleanName = docName.replace(/^Dr\.\s*/i, '');
      const initials = cleanName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      const colors = ['av-blue', 'av-green', 'av-orange', 'av-purple'];
      const colorClass = colors[slot.id.charCodeAt(slot.id.length - 1) % colors.length] || 'av-blue';

      card.innerHTML = `
        <div class="physio-avatar ${colorClass}">${initials}</div>
        <div class="physio-details">
          <div class="physio-info-name">${slot.doctorName}</div>
          <div class="physio-info-spec">${slot.specialization || 'Physiotherapist'}</div>
          <div class="physio-rating">★★★★★ <span class="rating-num">${slot.rating || '5.0'}</span></div>
        </div>
        <div class="physio-slot">
          <div class="physio-time">${slot.time}</div>
          <div class="physio-date">${slot.date}</div>
          <button class="book-btn" onclick="openBookingModalWithSlot('${slot.id}', '${slot.doctorName}', '${slot.date}', '${slot.time}')">Book</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to fetch available therapists:', err);
    container.innerHTML = '<div class="slots-placeholder" style="grid-column: 1 / -1;">Error loading available therapists.</div>';
  }
}

function openBookingModalWithSlot(slotId, doctorName, date, time) {
  document.getElementById('book-slot-id-input').value = slotId;
  openBookingModal(doctorName, date, time);
}

async function cancelPatientBooking(appointmentId) {
  if (!confirm('Are you sure you want to cancel this appointment?')) {
    return;
  }
  try {
    const res = await authenticatedFetch('/api/physio/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to cancel appointment.');

    showToast('Appointment cancelled successfully.', 'warning');
    fetchAppointments();
    fetchAvailableTherapists();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

function initDoctorDashboard() {
  const form = document.getElementById('add-slot-form');
  if (form) {
    form.addEventListener('submit', addDoctorSlotSubmit);
  }
}

async function addDoctorSlotSubmit(e) {
  e.preventDefault();
  const dateSelect = document.getElementById('slot-date-select');
  const timeInput = document.getElementById('slot-time-input');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  setLoadingState(submitBtn, true, 'Opening Slot...');

  try {
    const res = await authenticatedFetch('/api/physio/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: dateSelect.value,
        time: timeInput.value
      })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to open availability slot.');

    showToast('Availability slot opened successfully!', 'success');
    timeInput.value = '';
    fetchDoctorSlots();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  } finally {
    setLoadingState(submitBtn, false, 'Open Slot');
  }
}

async function fetchDoctorSlots() {
  const listContainer = document.getElementById('doctor-slots-list');
  if (!listContainer) return;
  try {
    const res = await authenticatedFetch('/api/physio/doctor-slots');
    if (!res) return;
    const slots = await res.json();

    listContainer.innerHTML = '';

    if (slots.length === 0) {
      listContainer.innerHTML = '<div class="slots-placeholder">No open availability slots.</div>';
      return;
    }

    slots.forEach(slot => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      
      const deleteButtonHtml = !slot.booked 
        ? `<button class="btn-slot-delete" onclick="deleteDoctorSlot('${slot.id}')"><i class="ti ti-trash"></i></button>`
        : '';

      row.innerHTML = `
        <div class="slot-info-left">
          <span class="slot-info-date">${slot.date}</span>
          <span class="slot-info-time">${slot.time}</span>
        </div>
        <div class="slot-status-wrap">
          <span class="slot-status ${slot.booked ? 'status-booked' : 'status-open'}">
            ${slot.booked ? 'Booked' : 'Open'}
          </span>
          ${deleteButtonHtml}
        </div>
      `;
      listContainer.appendChild(row);
    });
  } catch (err) {
    console.error('Failed to fetch doctor slots:', err);
    listContainer.innerHTML = '<div class="slots-placeholder" style="color:var(--accent-red);">Error loading slots.</div>';
  }
}

async function deleteDoctorSlot(id) {
  if (!confirm('Are you sure you want to close/delete this availability slot?')) {
    return;
  }
  try {
    const res = await authenticatedFetch(`/api/physio/slots/${id}`, {
      method: 'DELETE'
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete slot.');

    showToast('Availability slot closed successfully.', 'warning');
    fetchDoctorSlots();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function fetchDoctorBookings() {
  const listContainer = document.getElementById('doctor-bookings-list');
  if (!listContainer) return;
  try {
    const res = await authenticatedFetch('/api/physio/doctor-bookings');
    if (!res) return;
    const bookings = await res.json();

    listContainer.innerHTML = '';

    if (bookings.length === 0) {
      listContainer.innerHTML = '<div class="sessions-placeholder">No booked appointments.</div>';
      return;
    }

    bookings.sort((a, b) => new Date(a.date) - new Date(b.date));

    bookings.forEach(booking => {
      const card = document.createElement('div');
      card.className = 'session-card';

      const initials = (booking.patientName || 'P').substring(0, 2).toUpperCase();
      
      let actionsHtml = '';
      if (booking.status === 'pending') {
        actionsHtml = `
          <div class="session-actions">
            <button class="btn-action btn-accept" onclick="completeDoctorBooking('${booking.id}', 'accepted')">
              <i class="ti ti-check"></i> Accept
            </button>
            <button class="btn-action btn-cancel" onclick="cancelDoctorBooking('${booking.id}')">
              <i class="ti ti-x"></i> Cancel
            </button>
          </div>
        `;
      } else if (booking.status === 'accepted') {
        actionsHtml = `
          <div class="session-actions">
            <button class="btn-action btn-complete" onclick="completeDoctorBooking('${booking.id}', 'completed')">
              <i class="ti ti-circle-check"></i> Complete
            </button>
            <button class="btn-action btn-cancel" onclick="cancelDoctorBooking('${booking.id}')">
              <i class="ti ti-x"></i> Cancel
            </button>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="session-header">
          <div class="session-header-left">
            <div class="patient-avatar">${initials}</div>
            <div class="patient-info">
              <div class="patient-username">Patient: ${booking.patientName}</div>
              <div class="session-time-badge">
                <i class="ti ti-calendar-event"></i> ${booking.date} @ ${booking.time}
              </div>
            </div>
          </div>
          <span class="session-status-tag ${booking.status}">${booking.status}</span>
        </div>
        ${actionsHtml}
      `;
      listContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to fetch doctor bookings:', err);
    listContainer.innerHTML = '<div class="sessions-placeholder" style="color:var(--accent-red);">Error loading bookings.</div>';
  }
}

async function completeDoctorBooking(appointmentId, status) {
  try {
    const res = await authenticatedFetch('/api/physio/doctor-bookings/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId, status })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update appointment status.');
    
    showToast(`Appointment status updated to ${status}!`, 'success');
    fetchDoctorBookings();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function cancelDoctorBooking(appointmentId) {
  if (!confirm('Are you sure you want to cancel this appointment? This will also open up the time slot again.')) {
    return;
  }
  try {
    const res = await authenticatedFetch('/api/physio/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to cancel appointment.');
    
    showToast('Appointment cancelled successfully.', 'warning');
    fetchDoctorBookings();
    fetchDoctorSlots();
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

// Expose to global scope for onclick triggers
window.openBookingModalWithSlot = openBookingModalWithSlot;
window.cancelPatientBooking = cancelPatientBooking;
window.deleteDoctorSlot = deleteDoctorSlot;
window.completeDoctorBooking = completeDoctorBooking;
window.cancelDoctorBooking = cancelDoctorBooking;
