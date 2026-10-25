// Base API URL
const API_BASE = 'http://localhost:5000/api';

// DOM Elements
const authAlert = document.getElementById('authAlert');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const regSubmitBtn = document.getElementById('regSubmitBtn');
const loginSpinner = document.getElementById('loginSpinner');
const regSpinner = document.getElementById('regSpinner');
const loginBtnText = document.getElementById('loginBtnText');
const regBtnText = document.getElementById('regBtnText');
const authTabs = document.getElementById('authTabs');
const authTabsContent = document.getElementById('authTabsContent');
const authenticatedSection = document.getElementById('authenticatedSection');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const userIdDisplay = document.getElementById('userIdDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const refreshMeBtn = document.getElementById('refreshMeBtn');
const checkHealthLink = document.getElementById('checkHealthLink');
const healthStatusBadge = document.getElementById('healthStatusBadge');

/**
 * Display alert messages to user
 */
function showAlert(message, type = 'danger') {
  authAlert.className = `alert alert-${type} d-block`;
  authAlert.innerHTML = message;
}

function clearAlert() {
  authAlert.className = 'alert d-none';
  authAlert.innerHTML = '';
}

/**
 * Toggle button loading state
 */
function setLoading(button, spinner, textSpan, isLoading, defaultText) {
  button.disabled = isLoading;
  if (isLoading) {
    spinner.classList.remove('d-none');
    textSpan.textContent = 'Please wait...';
  } else {
    spinner.classList.add('d-none');
    textSpan.textContent = defaultText;
  }
}

/**
 * Check existing session storage on page load and verify with GET /api/me
 */
async function checkAuthStatus() {
  const token = sessionStorage.getItem('campus_swap_token');
  if (!token) {
    showLoggedOutView();
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const result = await response.json();

    if (response.ok && result.success && result.data) {
      showLoggedInView(result.data);
    } else {
      // Token is invalid/expired
      sessionStorage.removeItem('campus_swap_token');
      showLoggedOutView();
    }
  } catch (err) {
    console.error('Failed to verify session:', err);
    showLoggedOutView();
  }
}

function showLoggedInView(userData) {
  authTabs.classList.add('d-none');
  authTabsContent.classList.add('d-none');
  authenticatedSection.classList.remove('d-none');
  userEmailDisplay.textContent = userData.email || 'N/A';
  userIdDisplay.textContent = userData.id || 'N/A';
}

function showLoggedOutView() {
  authTabs.classList.remove('d-none');
  authTabsContent.classList.remove('d-none');
  authenticatedSection.classList.add('d-none');
}

/**
 * Handle Registration
 */
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  const fullName = document.getElementById('regFullName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  // Client-side validation
  if (!fullName) {
    showAlert('Please enter your full name.', 'warning');
    return;
  }
  if (!email || !email.includes('@')) {
    showAlert('Please enter a valid email address.', 'warning');
    return;
  }
  if (!password || password.length < 8) {
    showAlert('Password must be at least 8 characters long.', 'warning');
    return;
  }

  setLoading(regSubmitBtn, regSpinner, regBtnText, true, 'Create Account');

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        full_name: fullName,
        email,
        password
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      if (data.requiresEmailConfirmation) {
        showAlert(
          `<strong>Registration Successful!</strong> ${data.message}`,
          'info'
        );
      } else if (data.session && data.session.access_token) {
        // Immediate session provided
        sessionStorage.setItem('campus_swap_token', data.session.access_token);
        showAlert('Registration successful! Fetching user profile...', 'success');
        await checkAuthStatus();
        return;
      } else {
        showAlert(data.message || 'Registration successful! You may now sign in.', 'success');
      }

      // Reset form and switch to login tab
      registerForm.reset();
      const loginTabTrigger = document.querySelector('#tab-login');
      if (loginTabTrigger) {
        const bootstrapTab = new bootstrap.Tab(loginTabTrigger);
        bootstrapTab.show();
      }
    } else {
      showAlert(data.message || 'Registration failed. Please try again.', 'danger');
    }
  } catch (err) {
    console.error('Register network error:', err);
    showAlert('Unable to connect to the backend server. Make sure it is running on port 5000.', 'danger');
  } finally {
    setLoading(regSubmitBtn, regSpinner, regBtnText, false, 'Create Account');
  }
});

/**
 * Handle Login
 */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showAlert('Please provide both email and password.', 'warning');
    return;
  }

  setLoading(loginSubmitBtn, loginSpinner, loginBtnText, true, 'Sign In');

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok && data.success && data.session?.access_token) {
      // Store token safely in sessionStorage
      sessionStorage.setItem('campus_swap_token', data.session.access_token);
      showAlert('Sign in successful! Loading your account...', 'success');
      
      loginForm.reset();
      await checkAuthStatus();
    } else {
      // Check for email confirmation requirement
      if (data.code === 'email_not_confirmed' || response.status === 403) {
        showAlert(
          `<strong>Confirmation Required:</strong> ${data.message}`,
          'warning'
        );
      } else {
        showAlert(data.message || 'Login failed. Check your credentials.', 'danger');
      }
    }
  } catch (err) {
    console.error('Login network error:', err);
    showAlert('Unable to connect to the backend server. Make sure it is running on port 5000.', 'danger');
  } finally {
    setLoading(loginSubmitBtn, loginSpinner, loginBtnText, false, 'Sign In');
  }
});

/**
 * Handle Logout
 */
logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('campus_swap_token');
  clearAlert();
  showLoggedOutView();
  showAlert('You have been logged out.', 'info');
});

/**
 * Handle Re-testing GET /api/me
 */
refreshMeBtn.addEventListener('click', async () => {
  clearAlert();
  const token = sessionStorage.getItem('campus_swap_token');
  if (!token) {
    showAlert('No token found in session storage. Please log in first.', 'warning');
    showLoggedOutView();
    return;
  }

  refreshMeBtn.disabled = true;
  refreshMeBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Fetching...';

  try {
    const res = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const json = await res.json();
    if (res.ok && json.success) {
      showAlert('<code>GET /api/me</code> verified successfully!', 'success');
      showLoggedInView(json.data);
    } else {
      showAlert(`<code>GET /api/me</code> failed: ${json.message}`, 'danger');
    }
  } catch (e) {
    showAlert('Failed to connect to backend.', 'danger');
  } finally {
    refreshMeBtn.disabled = false;
    refreshMeBtn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Re-test GET /api/me';
  }
});

/**
 * Check backend health
 */
checkHealthLink.addEventListener('click', async (e) => {
  e.preventDefault();
  healthStatusBadge.innerHTML = '<span class="spinner-border spinner-border-sm text-info"></span> Checking...';
  try {
    const res = await fetch('http://localhost:5000/api/health');
    const data = await res.json();
    if (res.ok && data.success) {
      healthStatusBadge.innerHTML = `<span class="text-success"><i class="bi bi-check-circle"></i> Online: ${data.message}</span>`;
    } else {
      healthStatusBadge.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> Offline or unexpected response</span>`;
    }
  } catch (err) {
    healthStatusBadge.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> Cannot connect to http://localhost:5000</span>`;
  }
});

// Run session check on load
document.addEventListener('DOMContentLoaded', () => {
  checkAuthStatus();
});
