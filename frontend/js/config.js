/**
 * CampusSwap Frontend Global Configuration
 * 
 * Centralized API base URL definition.
 * - Defaults to local backend during development (http://localhost:5000/api).
 * - Can be updated to production Render backend URL before deploying frontend.
 */
(function () {
  window.CAMPUS_SWAP_API_URL = window.CAMPUS_SWAP_API_URL || 'http://localhost:5000/api';
})();

