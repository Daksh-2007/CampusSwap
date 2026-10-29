/**
 * CampusSwap Authentication JavaScript
 * Handles registration, login, session management, and profile retrieval.
 */

// API Configuration
const API_BASE_URL = window.CAMPUS_SWAP_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'campus_swap_token';
const LEGACY_TOKEN_KEY = 'campus_swap_access_token';

function getStoredToken() {
  return (
    sessionStorage.getItem(TOKEN_KEY) ||
    sessionStorage.getItem(LEGACY_TOKEN_KEY) ||
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(LEGACY_TOKEN_KEY)
  );
}

// Email validation regular expression
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Display an alert message in the provided container
 * @param {HTMLElement} alertEl - The alert container element
 * @param {string} message - Message or HTML string to show
 * @param {'danger' | 'success' | 'warning' | 'info'} type - Bootstrap alert type
 */
function showAlert(alertEl, message, type = 'danger') {
  if (!alertEl) return;
  alertEl.className = `alert alert-${type} d-block`;
  alertEl.innerHTML = message;
}

/**
 * Hide the alert container
 * @param {HTMLElement} alertEl - The alert container element
 */
function clearAlert(alertEl) {
  if (!alertEl) return;
  alertEl.className = 'alert d-none';
  alertEl.innerHTML = '';
}

/**
 * Toggle button loading state with spinner
 */
function setButtonLoading(buttonEl, spinnerEl, textEl, isLoading, defaultText) {
  if (!buttonEl) return;
  buttonEl.disabled = isLoading;
  if (isLoading) {
    if (spinnerEl) spinnerEl.classList.remove('d-none');
    if (textEl) textEl.textContent = 'Please wait...';
  } else {
    if (spinnerEl) spinnerEl.classList.add('d-none');
    if (textEl) textEl.textContent = defaultText;
  }
}

/**
 * Wire up password visibility toggle buttons
 */
function setupPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-password');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
          icon.classList.remove('bi-eye');
          icon.classList.add('bi-eye-slash');
        }
      } else {
        input.type = 'password';
        if (icon) {
          icon.classList.remove('bi-eye-slash');
          icon.classList.add('bi-eye');
        }
      }
    });
  });
}

/**
 * Fetch authenticated user profile using GET /api/me
 * @param {string} token - JWT Access Token
 * @returns {Promise<{success: boolean, data?: {id: string, email: string, full_name?: string}, message?: string}>}
 */
async function fetchUserProfile(token) {
  try {
    const response = await fetch(`${API_BASE_URL}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const result = await response.json().catch(() => ({
      success: false,
      message: 'Invalid response from server'
    }));

    if (!response.ok || !result.success) {
      return {
        success: false,
        message: result.message || `Profile request failed (status ${response.status})`
      };
    }

    return {
      success: true,
      data: result.data
    };
  } catch (err) {
    console.error('Fetch profile error:', err);
    return {
      success: false,
      message: 'Failed to connect to backend server at ' + API_BASE_URL
    };
  }
}

/**
 * Check backend health
 */
async function checkBackendHealth(statusContainerId) {
  const container = document.getElementById(statusContainerId);
  if (!container) return;

  container.innerHTML = '<span class="spinner-border spinner-border-sm text-info"></span> Checking API...';
  try {
    const res = await fetch(`${API_BASE_URL.replace('/api', '')}/api/health`);
    const data = await res.json();
    if (res.ok && data.success) {
      container.innerHTML = `<span class="text-success"><i class="bi bi-check-circle-fill"></i> Connected: ${data.message}</span>`;
    } else {
      container.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle-fill"></i> API returned error</span>`;
    }
  } catch (err) {
    container.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle-fill"></i> Cannot reach backend at ${API_BASE_URL}</span>`;
  }
}

// -------------------------------------------------------------
// Registration Page Logic
// -------------------------------------------------------------
function initRegisterPage() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  setupPasswordToggles();

  const alertEl = document.getElementById('registerAlert');
  const submitBtn = document.getElementById('registerSubmitBtn');
  const spinnerEl = document.getElementById('registerSpinner');
  const btnTextEl = document.getElementById('registerBtnText');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertEl);

    const fullNameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    const fullName = fullNameInput ? fullNameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

    // Validation 1: Required full name
    if (!fullName) {
      showAlert(alertEl, 'Please enter your full name.', 'warning');
      fullNameInput?.focus();
      return;
    }

    // Validation 2: Required email & format
    if (!email) {
      showAlert(alertEl, 'Please enter your email address.', 'warning');
      emailInput?.focus();
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      showAlert(alertEl, 'Please enter a valid email address (e.g., student@university.edu).', 'warning');
      emailInput?.focus();
      return;
    }

    // Validation 3: Password length >= 8
    if (!password) {
      showAlert(alertEl, 'Please enter a password.', 'warning');
      passwordInput?.focus();
      return;
    }
    if (password.length < 8) {
      showAlert(alertEl, 'Password must be at least 8 characters long.', 'warning');
      passwordInput?.focus();
      return;
    }

    // Validation 4: Matching passwords
    if (!confirmPassword) {
      showAlert(alertEl, 'Please confirm your password.', 'warning');
      confirmPasswordInput?.focus();
      return;
    }
    if (password !== confirmPassword) {
      showAlert(alertEl, 'Passwords do not match. Please re-enter your password.', 'danger');
      confirmPasswordInput?.focus();
      return;
    }

    // Submit registration request
    setButtonLoading(submitBtn, spinnerEl, btnTextEl, true, 'Create Account');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          full_name: fullName,
          email: email,
          password: password
        })
      });

      const data = await response.json().catch(() => ({
        success: false,
        message: 'Non-JSON server response'
      }));

      if (response.ok && data.success) {
        // Successful registration
        form.reset();
        const successMessage = data.requiresEmailConfirmation
          ? `<strong>Registration Successful!</strong> ${data.message} <br><div class="mt-2"><a href="login.html" class="btn btn-sm btn-outline-light">Go to Sign In</a></div>`
          : `<strong>Registration Successful!</strong> ${data.message || 'You can now sign in with your credentials.'} <br><div class="mt-2"><a href="login.html" class="btn btn-sm btn-outline-light">Go to Sign In</a></div>`;

        showAlert(alertEl, successMessage, 'success');
      } else {
        // Backend validation or registration error
        const errorMsg = data.message || `Registration failed (status code ${response.status})`;
        showAlert(alertEl, `<strong>Registration Error:</strong> ${errorMsg}`, 'danger');
      }
    } catch (err) {
      console.error('Registration network error:', err);
      showAlert(
        alertEl,
        `<strong>Connection Failure:</strong> Unable to reach backend at <code>${API_BASE_URL}</code>. Ensure the backend server is running on port 5000.`,
        'danger'
      );
    } finally {
      setButtonLoading(submitBtn, spinnerEl, btnTextEl, false, 'Create Account');
    }
  });
}

// -------------------------------------------------------------
// Login Page Logic
// -------------------------------------------------------------
function initLoginPage() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  setupPasswordToggles();

  const alertEl = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const spinnerEl = document.getElementById('loginSpinner');
  const btnTextEl = document.getElementById('loginBtnText');
  const profileCard = document.getElementById('profileCard');
  const loginCard = document.getElementById('loginCard');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userEmailDisplay = document.getElementById('userEmailDisplay');
  const userIdDisplay = document.getElementById('userIdDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // Check if session token already exists in sessionStorage on load
  const existingToken = getStoredToken();
  if (existingToken) {
    loadExistingSession(existingToken);
  }

  async function loadExistingSession(token) {
    showAlert(alertEl, '<span class="spinner-border spinner-border-sm me-1"></span> Verifying active session...', 'info');
    const profileRes = await fetchUserProfile(token);

    if (profileRes.success && profileRes.data) {
      clearAlert(alertEl);
      showUserProfile(profileRes.data);
    } else {
      // Token invalid or expired
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      clearAlert(alertEl);
      showLoginForm();
    }
  }

  function showUserProfile(userData) {
    if (loginCard) loginCard.classList.add('d-none');
    if (profileCard) profileCard.classList.remove('d-none');
    if (userNameDisplay) userNameDisplay.textContent = userData.full_name || 'Campus Student';
    if (userEmailDisplay) userEmailDisplay.textContent = userData.email || 'N/A';
    if (userIdDisplay) userIdDisplay.textContent = userData.id || 'N/A';
  }

  function showLoginForm() {
    if (loginCard) loginCard.classList.remove('d-none');
    if (profileCard) profileCard.classList.add('d-none');
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      showLoginForm();
      showAlert(alertEl, 'You have been signed out successfully.', 'info');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertEl);

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email) {
      showAlert(alertEl, 'Please enter your email address.', 'warning');
      emailInput?.focus();
      return;
    }

    if (!password) {
      showAlert(alertEl, 'Please enter your password.', 'warning');
      passwordInput?.focus();
      return;
    }

    setButtonLoading(submitBtn, spinnerEl, btnTextEl, true, 'Sign In');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json().catch(() => ({
        success: false,
        message: 'Invalid response from server'
      }));

      if (response.ok && data.success && data.session?.access_token) {
        // 1. Store access token in sessionStorage and localStorage
        const token = data.session.access_token;
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(TOKEN_KEY, token);

        showAlert(alertEl, '<span class="spinner-border spinner-border-sm me-1"></span> Authentication successful! Loading profile...', 'success');

        // 2. Call GET /api/me with Authorization: Bearer <access_token>
        const profileRes = await fetchUserProfile(token);

        if (profileRes.success && profileRes.data) {
          clearAlert(alertEl);
          // Show authenticated user's name/email
          showUserProfile(profileRes.data);
          form.reset();
        } else {
          showAlert(
            alertEl,
            `<strong>Profile Verification Warning:</strong> Logged in, but fetching <code>/api/me</code> failed: ${profileRes.message}`,
            'warning'
          );
        }
      } else {
        // Handle specific login error conditions
        if (data.code === 'email_not_confirmed' || response.status === 403) {
          showAlert(
            alertEl,
            `<strong>Email Confirmation Required:</strong> ${data.message || 'Please confirm your email address before logging in.'}`,
            'warning'
          );
        } else if (response.status === 401 || data.code === 'invalid_credentials') {
          showAlert(
            alertEl,
            '<strong>Invalid Credentials:</strong> The email or password you entered is incorrect.',
            'danger'
          );
        } else {
          showAlert(
            alertEl,
            `<strong>Login Failed:</strong> ${data.message || 'Unable to sign in. Please verify your credentials.'}`,
            'danger'
          );
        }
      }
    } catch (err) {
      console.error('Login network error:', err);
      showAlert(
        alertEl,
        `<strong>API Connection Failure:</strong> Unable to connect to backend at <code>${API_BASE_URL}</code>. Make sure your server is running on port 5000.`,
        'danger'
      );
    } finally {
      setButtonLoading(submitBtn, spinnerEl, btnTextEl, false, 'Sign In');
    }
  });
}

// Auto-initialize based on elements present on current page
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('registerForm')) {
    initRegisterPage();
  }
  if (document.getElementById('loginForm')) {
    initLoginPage();
  }

  // Health check button hook if available
  const healthBtn = document.getElementById('checkHealthBtn');
  if (healthBtn) {
    healthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      checkBackendHealth('healthStatus');
    });
  }
});
