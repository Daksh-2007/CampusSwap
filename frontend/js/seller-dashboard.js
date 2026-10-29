/**
 * CampusSwap Seller Dashboard
 * Integrates with:
 * - GET /api/me
 * - GET /api/products
 * - GET /api/products/:id
 * - POST /api/products (multipart/form-data or json)
 * - PATCH /api/products/:id (multipart/form-data or json)
 * - DELETE /api/products/:id
 */

// Easy to configure for production or custom environment
const API_BASE_URL = window.CAMPUS_SWAP_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'campus_swap_token';
const LEGACY_TOKEN_KEY = 'campus_swap_access_token';

// Active dashboard state
let currentUser = null;
let currentProducts = [];
let editProductModal = null;
let deleteProductModal = null;
let targetDeleteId = null;
let reactivateProductModal = null;
let targetReactivateId = null;
let removeProductModal = null;
let targetRemoveId = null;

/**
 * Retrieve session token from sessionStorage or localStorage
 */
function getStoredToken() {
  return (
    sessionStorage.getItem(TOKEN_KEY) ||
    sessionStorage.getItem(LEGACY_TOKEN_KEY) ||
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(LEGACY_TOKEN_KEY)
  );
}

/**
 * Display alert messages to the user
 */
function showDashboardAlert(message, type = 'danger', timeout = 0) {
  const alertEl = document.getElementById('dashboardAlert');
  if (!alertEl) return;

  alertEl.className = `alert alert-${type} d-block alert-dismissible fade show shadow-sm mb-4`;
  alertEl.innerHTML = `
    <div class="d-flex align-items-center justify-content-between">
      <div>${message}</div>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;

  if (timeout > 0) {
    setTimeout(() => {
      clearDashboardAlert();
    }, timeout);
  }
}

function clearDashboardAlert() {
  const alertEl = document.getElementById('dashboardAlert');
  if (alertEl) {
    alertEl.className = 'alert d-none';
    alertEl.innerHTML = '';
  }
}

/**
 * Handle session expiration or missing authentication
 */
function handleAuthExpiry(message = 'Your session has expired. Please sign in again.') {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  showDashboardAlert(`<strong>Session Expired:</strong> ${message} <a href="login.html" class="btn btn-sm btn-outline-light ms-2">Sign In</a>`, 'warning');
  
  const spinner = document.getElementById('loadingSpinner');
  if (spinner) spinner.classList.add('d-none');
  
  const content = document.getElementById('dashboardContent');
  if (content) content.classList.add('d-none');

  const emptyState = document.getElementById('emptyState');
  if (emptyState) {
    emptyState.classList.remove('d-none');
    emptyState.innerHTML = `
      <div class="stat-icon bg-warning bg-opacity-25 text-warning mx-auto mb-3">
        <i class="bi bi-shield-lock"></i>
      </div>
      <h3 class="h5 fw-semibold text-white mb-2">Authentication Required</h3>
      <p class="text-secondary small mb-3">Please sign in to your seller account to manage your listings.</p>
      <a href="login.html" class="btn btn-primary px-4"><i class="bi bi-box-arrow-in-right me-2"></i>Go to Sign In</a>
    `;
  }
}

/**
 * Build authorized fetch options
 */
function getAuthHeaders(isFormData = false) {
  const token = getStoredToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/**
 * Load authenticated user profile
 */
async function loadUserProfile() {
  const token = getStoredToken();
  if (!token) {
    handleAuthExpiry('No active session found.');
    return false;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401 || res.status === 403) {
      handleAuthExpiry();
      return false;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success || !json?.data) {
      handleAuthExpiry(json?.message || 'Could not verify user account.');
      return false;
    }

    currentUser = json.data;
    const nameEl = document.getElementById('sellerNameDisplay');
    const emailEl = document.getElementById('sellerEmailDisplay');
    if (nameEl) nameEl.textContent = currentUser.full_name || 'Seller Account';
    if (emailEl) emailEl.textContent = currentUser.email || '';

    return true;
  } catch (err) {
    console.error('Error fetching user profile:', err);
    showDashboardAlert(`Failed to connect to backend at <code>${API_BASE_URL}</code>. Ensure the server is running on port 5000.`, 'danger');
    return false;
  }
}

/**
 * Load and display seller listings
 * Calls GET /api/products/seller/me which returns all listings for the authenticated seller
 * (including active and inactive items).
 */
async function loadSellerProducts() {
  const spinner = document.getElementById('loadingSpinner');
  const tableContainer = document.getElementById('productsTableContainer');
  const emptyState = document.getElementById('emptyState');
  const listingsCountBadge = document.getElementById('listingsCountBadge');
  
  if (spinner) spinner.classList.remove('d-none');
  if (tableContainer) tableContainer.classList.add('d-none');
  if (emptyState) emptyState.classList.add('d-none');

  const token = getStoredToken();
  try {
    // Try the authenticated seller endpoint first to get all active and inactive listings
    let res = await fetch(`${API_BASE_URL}/products/seller/me?limit=100`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    // Fallback if route is not reachable
    if (res.status === 404) {
      res = await fetch(`${API_BASE_URL}/products?limit=100`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    }

    if (res.status === 401 || res.status === 403) {
      handleAuthExpiry();
      return;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || 'Failed to fetch products');
    }

    const allProducts = json.data || [];
    // Ensure listings belong to the authenticated seller
    if (currentUser?.id) {
      currentProducts = allProducts.filter(p => !p.seller_id || p.seller_id === currentUser.id);
    } else {
      currentProducts = allProducts;
    }

    renderProductsTable(currentProducts);
    updateMetrics(currentProducts);

    if (listingsCountBadge) {
      const activeCount = currentProducts.filter(p => p.status === 'active').length;
      listingsCountBadge.textContent = `${currentProducts.length} total (${activeCount} active)`;
    }
  } catch (err) {
    console.error('Error loading products:', err);
    showDashboardAlert(`<strong>Error loading listings:</strong> ${err.message}`, 'danger');
  } finally {
    if (spinner) spinner.classList.add('d-none');
  }
}

/**
 * Update summary stats cards
 */
function updateMetrics(products) {
  const totalEl = document.getElementById('statTotalListings');
  const activeEl = document.getElementById('statActiveListings');
  const inactiveEl = document.getElementById('statInactiveListings');
  const forSaleEl = document.getElementById('statForSale');
  const forRentEl = document.getElementById('statForRent');

  const total = products.length;
  const active = products.filter(p => p.status === 'active').length;
  const inactive = products.filter(p => p.status === 'inactive').length;
  const forSale = products.filter(p => p.listing_type === 'buy' || p.listing_type === 'both').length;
  const forRent = products.filter(p => p.listing_type === 'rent' || p.listing_type === 'both').length;

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (inactiveEl) inactiveEl.textContent = inactive;
  if (forSaleEl) forSaleEl.textContent = forSale;
  if (forRentEl) forRentEl.textContent = forRent;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format currency in INR / local symbol
 */
function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  return `₹${Number(val).toLocaleString('en-IN')}`;
}

/**
 * Render products table
 */
function renderProductsTable(products) {
  const tableContainer = document.getElementById('productsTableContainer');
  const tbody = document.getElementById('productsTableBody');
  const emptyState = document.getElementById('emptyState');

  if (!tbody || !tableContainer || !emptyState) return;

  if (products.length === 0) {
    tableContainer.classList.add('d-none');
    emptyState.classList.remove('d-none');
    return;
  }

  emptyState.classList.add('d-none');
  tableContainer.classList.remove('d-none');

  tbody.innerHTML = products.map(product => {
    // Primary image
    const images = product.product_images || [];
    let imageHtml = '';
    if (images.length > 0 && images[0].public_url) {
      imageHtml = `<img src="${escapeHtml(images[0].public_url)}" alt="${escapeHtml(product.title)}" class="product-thumb">`;
    } else {
      imageHtml = `<div class="product-thumb-placeholder"><i class="bi bi-image"></i></div>`;
    }

    // Condition badge
    const conditionLabels = {
      new: 'Brand New',
      like_new: 'Like New',
      good: 'Good',
      fair: 'Fair'
    };
    const conditionText = conditionLabels[product.item_condition] || product.item_condition || 'Good';

    // Pricing details
    let pricingHtml = '';
    if (product.listing_type === 'buy') {
      pricingHtml = `<span class="fw-semibold text-white">${formatCurrency(product.sale_price)}</span> <span class="badge badge-listing-type ms-1">Buy</span>`;
    } else if (product.listing_type === 'rent') {
      pricingHtml = `<span class="fw-semibold text-white">${formatCurrency(product.rent_price_per_day)}</span><span class="text-secondary small">/day</span> <span class="badge badge-listing-type ms-1">Rent</span>`;
    } else {
      pricingHtml = `
        <div><span class="fw-semibold text-white">${formatCurrency(product.sale_price)}</span> <span class="badge badge-listing-type ms-1">Buy</span></div>
        <div class="small text-secondary">${formatCurrency(product.rent_price_per_day)}/day (Rent)</div>
      `;
    }

    // Status badge - distinct "Inactive (Hidden from Buyers)" and "Active"
    const isStatusActive = product.status === 'active';
    const statusBadge = isStatusActive
      ? `<span class="badge badge-status-active"><i class="bi bi-check-circle me-1"></i>Active</span>`
      : `<span class="badge badge-status-inactive" title="This listing is hidden from campus buyers"><i class="bi bi-eye-slash me-1"></i>Inactive (Hidden from Buyers)</span>`;

    // Date
    const dateFormatted = product.created_at ? new Date(product.created_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }) : '—';

    // Action buttons: Edit is always available. Deactivate for active, Reactivate for inactive.
    const statusActionBtn = isStatusActive
      ? `
        <button 
          type="button" 
          class="btn btn-outline-danger action-btn-deactivate" 
          data-id="${escapeHtml(product.id)}" 
          data-title="${escapeHtml(product.title)}"
          title="Deactivate Listing (hide from buyers)"
        >
          <i class="bi bi-eye-slash me-1"></i>Deactivate
        </button>
      `
      : `
        <button 
          type="button" 
          class="btn btn-outline-success action-btn-reactivate" 
          data-id="${escapeHtml(product.id)}" 
          data-title="${escapeHtml(product.title)}"
          title="Reactivate Listing (make visible to buyers)"
        >
          <i class="bi bi-arrow-counterclockwise me-1"></i>Reactivate
        </button>
      `;

    return `
      <tr id="product-row-${escapeHtml(product.id)}" class="${isStatusActive ? '' : 'row-inactive'}">
        <td>
          <div class="d-flex align-items-center gap-3">
            ${imageHtml}
            <div>
              <div class="fw-semibold text-white mb-1">${escapeHtml(product.title)}</div>
              <div class="text-secondary small">
                <span class="badge bg-secondary bg-opacity-25 me-1 text-light border border-secondary border-opacity-25">${escapeHtml(product.category || 'General')}</span>
                <span class="badge badge-condition">${escapeHtml(conditionText)}</span>
              </div>
            </div>
          </div>
        </td>
        <td>${pricingHtml}</td>
        <td>${statusBadge}</td>
        <td class="text-secondary small">${dateFormatted}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button 
              type="button" 
              class="btn btn-outline-light action-btn-edit" 
              data-id="${escapeHtml(product.id)}" 
              title="Edit Listing"
            >
              <i class="bi bi-pencil me-1"></i>Edit
            </button>
            ${statusActionBtn}
            <button 
              type="button" 
              class="btn btn-outline-danger action-btn-remove" 
              data-id="${escapeHtml(product.id)}" 
              data-title="${escapeHtml(product.title)}"
              title="Permanently Remove Item"
            >
              <i class="bi bi-trash3 me-1"></i>Remove
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach button events
  tbody.querySelectorAll('.action-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      openEditModal(id);
    });
  });

  tbody.querySelectorAll('.action-btn-deactivate').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const title = btn.getAttribute('data-title');
      openDeleteModal(id, title);
    });
  });

  tbody.querySelectorAll('.action-btn-reactivate').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const title = btn.getAttribute('data-title');
      openReactivateModal(id, title);
    });
  });

  tbody.querySelectorAll('.action-btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const title = btn.getAttribute('data-title');
      openRemoveModal(id, title);
    });
  });
}


/**
 * Setup Listing Type dynamic field behavior
 */
function setupListingTypeFields(typeSelectId, salePriceGroupSelector, rentPriceGroupSelector, saleInputId, rentInputId) {
  const select = document.getElementById(typeSelectId);
  const saleGroup = document.querySelector(salePriceGroupSelector);
  const rentGroup = document.querySelector(rentPriceGroupSelector);
  const saleInput = document.getElementById(saleInputId);
  const rentInput = document.getElementById(rentInputId);

  if (!select) return;

  function update() {
    const val = select.value;
    if (val === 'buy') {
      if (saleGroup) saleGroup.style.display = 'block';
      if (rentGroup) rentGroup.style.display = 'none';
      if (saleInput) saleInput.required = true;
      if (rentInput) rentInput.required = false;
    } else if (val === 'rent') {
      if (saleGroup) saleGroup.style.display = 'none';
      if (rentGroup) rentGroup.style.display = 'block';
      if (saleInput) saleInput.required = false;
      if (rentInput) rentInput.required = true;
    } else { // 'both'
      if (saleGroup) saleGroup.style.display = 'block';
      if (rentGroup) rentGroup.style.display = 'block';
      if (saleInput) saleInput.required = true;
      if (rentInput) rentInput.required = true;
    }
  }

  select.addEventListener('change', update);
  update();
}

/**
 * Setup Image previewing for file inputs
 */
function setupImagePreview(fileInputId, previewContainerId) {
  const fileInput = document.getElementById(fileInputId);
  const container = document.getElementById(previewContainerId);

  if (!fileInput || !container) return;

  fileInput.addEventListener('change', () => {
    container.innerHTML = '';
    const files = Array.from(fileInput.files || []);

    if (files.length > 5) {
      alert('You can select a maximum of 5 images per listing.');
      fileInput.value = '';
      return;
    }

    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const chip = document.createElement('div');
        chip.className = 'image-preview-chip';
        chip.innerHTML = `<img src="${e.target.result}" alt="Preview" class="rounded">`;
        container.appendChild(chip);
      };
      reader.readAsDataURL(file);
    });
  });
}

/**
 * Handle Create Listing Submission
 */
async function handleCreateProduct(e) {
  e.preventDefault();
  const form = document.getElementById('createProductForm');
  const alertEl = document.getElementById('createModalAlert');
  const submitBtn = document.getElementById('createSubmitBtn');
  const spinner = document.getElementById('createSpinner');

  if (alertEl) alertEl.className = 'alert d-none';

  // Gather values
  const title = document.getElementById('createTitle')?.value.trim();
  const category = document.getElementById('createCategory')?.value.trim();
  const item_condition = document.getElementById('createCondition')?.value;
  const listing_type = document.getElementById('createListingType')?.value;
  const sale_price = document.getElementById('createSalePrice')?.value;
  const rent_price_per_day = document.getElementById('createRentPrice')?.value;
  const pickup_address = document.getElementById('createPickupAddress')?.value.trim();
  const description = document.getElementById('createDescription')?.value.trim();
  const imageFiles = document.getElementById('createImages')?.files;

  // Validation
  if (!title) {
    showModalAlert(alertEl, 'Listing Title is required.');
    return;
  }
  if (!category) {
    showModalAlert(alertEl, 'Category is required.');
    return;
  }
  if ((listing_type === 'buy' || listing_type === 'both') && (!sale_price || isNaN(Number(sale_price)) || Number(sale_price) < 0)) {
    showModalAlert(alertEl, 'Valid sale price is required for buy listings.');
    return;
  }
  if ((listing_type === 'rent' || listing_type === 'both') && (!rent_price_per_day || isNaN(Number(rent_price_per_day)) || Number(rent_price_per_day) < 0)) {
    showModalAlert(alertEl, 'Valid daily rental price is required for rent listings.');
    return;
  }

  // Build FormData for multipart request
  const formData = new FormData();
  formData.append('title', title);
  formData.append('category', category);
  formData.append('item_condition', item_condition);
  formData.append('listing_type', listing_type);
  if (description) formData.append('description', description);
  if (pickup_address) formData.append('pickup_address', pickup_address);

  if (listing_type === 'buy' || listing_type === 'both') {
    formData.append('sale_price', sale_price);
  }
  if (listing_type === 'rent' || listing_type === 'both') {
    formData.append('rent_price_per_day', rent_price_per_day);
  }

  if (imageFiles && imageFiles.length > 0) {
    for (let i = 0; i < Math.min(imageFiles.length, 5); i++) {
      formData.append('images', imageFiles[i]);
    }
  }

  const token = getStoredToken();
  if (!token) {
    showModalAlert(alertEl, 'Please sign in to your seller account before creating a listing.', 'danger');
    handleAuthExpiry('No active session found.');
    return;
  }

  // Submit
  setBtnLoading(submitBtn, spinner, true, 'Creating...');
  try {
    const res = await fetch(`${API_BASE_URL}/products`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
        // Do NOT set Content-Type header when sending FormData! Fetch sets multipart boundary automatically.
      },
      body: formData
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      if (res.status === 403 && json?.message?.includes('Seller account required')) {
        showModalAlert(alertEl, 'Your account has the "buyer" role. An administrator must promote your role to "seller" in the database before you can create listings.', 'danger');
        return;
      }
      handleAuthExpiry();
      return;
    }

    if (!res.ok || !json?.success) {
      const errDetail = json?.errors ? json.errors.join(', ') : (json?.message || 'Failed to create listing');
      showModalAlert(alertEl, errDetail, 'danger');
      return;
    }

    // Success
    form.reset();
    document.getElementById('createImagePreviews').innerHTML = '';
    const modalEl = document.getElementById('createProductModal');
    const modal = (typeof bootstrap !== 'undefined' && bootstrap?.Modal)
      ? (bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl))
      : null;
    if (modal) modal.hide();

    showDashboardAlert(`<strong>Success!</strong> Listing "<strong>${escapeHtml(json.data.title)}</strong>" was created successfully.`, 'success', 5000);
    await loadSellerProducts();
  } catch (err) {
    console.error('Error creating product:', err);
    showModalAlert(alertEl, `Network or server error: ${err.message}`, 'danger');
  } finally {
    setBtnLoading(submitBtn, spinner, false, 'Create Listing');
  }
}

/**
 * Open Edit Modal and prefill data
 */
async function openEditModal(productId) {
  const alertEl = document.getElementById('editModalAlert');
  if (alertEl) alertEl.className = 'alert d-none';

  const modalEl = document.getElementById('editProductModal');
  if (!editProductModal) {
    editProductModal = new bootstrap.Modal(modalEl);
  }

  // Pre-fill fields with current item in state
  let product = currentProducts.find(p => p.id === productId);

  // If not found or to get full detail, fetch GET /api/products/:id
  if (!product) {
    try {
      const res = await fetch(`${API_BASE_URL}/products/${productId}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json?.data) {
        product = json.data;
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!product) {
    showDashboardAlert('Product not found or inaccessible.', 'danger');
    return;
  }

  document.getElementById('editProductId').value = product.id;
  document.getElementById('editTitle').value = product.title || '';
  document.getElementById('editCategory').value = product.category || '';
  document.getElementById('editCondition').value = product.item_condition || 'good';
  document.getElementById('editListingType').value = product.listing_type || 'buy';
  document.getElementById('editStatus').value = product.status || 'active';
  document.getElementById('editSalePrice').value = product.sale_price !== null ? product.sale_price : '';
  document.getElementById('editRentPrice').value = product.rent_price_per_day !== null ? product.rent_price_per_day : '';
  document.getElementById('editPickupAddress').value = product.pickup_address || '';
  document.getElementById('editDescription').value = product.description || '';
  document.getElementById('editImages').value = '';
  document.getElementById('editImagePreviews').innerHTML = '';

  // Show existing images
  const existingImagesContainer = document.getElementById('editExistingImages');
  if (existingImagesContainer) {
    existingImagesContainer.innerHTML = '';
    const images = product.product_images || [];
    if (images.length > 0) {
      images.forEach(img => {
        if (img.public_url) {
          const chip = document.createElement('div');
          chip.className = 'image-preview-chip';
          chip.innerHTML = `<img src="${escapeHtml(img.public_url)}" alt="Product Image">`;
          existingImagesContainer.appendChild(chip);
        }
      });
    } else {
      existingImagesContainer.innerHTML = '<span class="text-secondary small">No existing images</span>';
    }
  }

  // Trigger listing type field visibility update
  document.getElementById('editListingType').dispatchEvent(new Event('change'));

  editProductModal.show();
}

/**
 * Handle Edit Listing Submission (PATCH /api/products/:id)
 */
async function handleEditProduct(e) {
  e.preventDefault();
  const form = document.getElementById('editProductForm');
  const alertEl = document.getElementById('editModalAlert');
  const submitBtn = document.getElementById('editSubmitBtn');
  const spinner = document.getElementById('editSpinner');

  if (alertEl) alertEl.className = 'alert d-none';

  const id = document.getElementById('editProductId').value;
  const title = document.getElementById('editTitle')?.value.trim();
  const category = document.getElementById('editCategory')?.value.trim();
  const item_condition = document.getElementById('editCondition')?.value;
  const listing_type = document.getElementById('editListingType')?.value;
  const status = document.getElementById('editStatus')?.value;
  const sale_price = document.getElementById('editSalePrice')?.value;
  const rent_price_per_day = document.getElementById('editRentPrice')?.value;
  const pickup_address = document.getElementById('editPickupAddress')?.value.trim();
  const description = document.getElementById('editDescription')?.value.trim();
  const imageFiles = document.getElementById('editImages')?.files;

  // Validation
  if (!title) {
    showModalAlert(alertEl, 'Listing Title is required.');
    return;
  }
  if (!category) {
    showModalAlert(alertEl, 'Category is required.');
    return;
  }
  if ((listing_type === 'buy' || listing_type === 'both') && (!sale_price || Number(sale_price) < 0)) {
    showModalAlert(alertEl, 'Valid sale price is required for buy listings.');
    return;
  }
  if ((listing_type === 'rent' || listing_type === 'both') && (!rent_price_per_day || Number(rent_price_per_day) < 0)) {
    showModalAlert(alertEl, 'Valid daily rental price is required for rent listings.');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('category', category);
  formData.append('item_condition', item_condition);
  formData.append('listing_type', listing_type);
  formData.append('status', status);
  formData.append('description', description);
  formData.append('pickup_address', pickup_address);

  if (listing_type === 'buy' || listing_type === 'both') {
    formData.append('sale_price', sale_price);
  }
  if (listing_type === 'rent' || listing_type === 'both') {
    formData.append('rent_price_per_day', rent_price_per_day);
  }

  if (imageFiles && imageFiles.length > 0) {
    for (let i = 0; i < Math.min(imageFiles.length, 5); i++) {
      formData.append('images', imageFiles[i]);
    }
  }

  const token = getStoredToken();
  if (!token) {
    handleAuthExpiry();
    return;
  }

  setBtnLoading(submitBtn, spinner, true, 'Saving changes...');
  try {
    const res = await fetch(`${API_BASE_URL}/products/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      if (res.status === 403) {
        showModalAlert(alertEl, json?.message || 'You can only update your own listings.', 'danger');
        return;
      }
      handleAuthExpiry();
      return;
    }

    if (!res.ok || !json?.success) {
      const errDetail = json?.errors ? json.errors.join(', ') : (json?.message || 'Failed to update listing');
      showModalAlert(alertEl, errDetail, 'danger');
      return;
    }

    if (editProductModal) editProductModal.hide();
    showDashboardAlert(`<strong>Updated:</strong> Listing "<strong>${escapeHtml(json.data.title)}</strong>" updated successfully.`, 'success', 5000);
    await loadSellerProducts();
  } catch (err) {
    console.error('Error updating product:', err);
    showModalAlert(alertEl, `Network or server error: ${err.message}`, 'danger');
  } finally {
    setBtnLoading(submitBtn, spinner, false, 'Save Changes');
  }
}

/**
 * Open confirmation modal to deactivate product
 */
function openDeleteModal(productId, productTitle) {
  targetDeleteId = productId;
  const modalEl = document.getElementById('deleteProductModal');
  const titleDisplay = document.getElementById('deleteProductTitleDisplay');
  const alertEl = document.getElementById('deleteModalAlert');
  if (alertEl) alertEl.className = 'alert d-none';
  if (titleDisplay) titleDisplay.textContent = productTitle || 'this listing';

  if (!deleteProductModal) {
    deleteProductModal = new bootstrap.Modal(modalEl);
  }
  deleteProductModal.show();
}

/**
 * Confirm soft deactivation (DELETE /api/products/:id)
 */
async function handleConfirmDelete() {
  if (!targetDeleteId) return;

  const alertEl = document.getElementById('deleteModalAlert');
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  const spinner = document.getElementById('deleteSpinner');

  const token = getStoredToken();
  if (!token) {
    handleAuthExpiry();
    return;
  }

  setBtnLoading(confirmBtn, spinner, true, 'Deactivating...');
  try {
    const res = await fetch(`${API_BASE_URL}/products/${targetDeleteId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      if (res.status === 403) {
        showModalAlert(alertEl, json?.message || 'You can only deactivate your own listings.', 'danger');
        return;
      }
      handleAuthExpiry();
      return;
    }

    if (!res.ok || !json?.success) {
      showModalAlert(alertEl, json?.message || 'Failed to deactivate listing', 'danger');
      return;
    }

    if (deleteProductModal) deleteProductModal.hide();
    showDashboardAlert(`<strong>Deactivated:</strong> Listing was successfully deactivated.`, 'info', 5000);
    await loadSellerProducts();
  } catch (err) {
    console.error('Error deactivating product:', err);
    showModalAlert(alertEl, `Error: ${err.message}`, 'danger');
  } finally {
    setBtnLoading(confirmBtn, spinner, false, 'Yes, Deactivate');
    targetDeleteId = null;
  }
}

/**
 * Open confirmation modal to reactivate product
 */
function openReactivateModal(productId, productTitle) {
  targetReactivateId = productId;
  const modalEl = document.getElementById('reactivateProductModal');
  const titleDisplay = document.getElementById('reactivateProductTitleDisplay');
  const alertEl = document.getElementById('reactivateModalAlert');
  if (alertEl) alertEl.className = 'alert d-none';
  if (titleDisplay) titleDisplay.textContent = productTitle || 'this listing';

  if (!reactivateProductModal) {
    reactivateProductModal = new bootstrap.Modal(modalEl);
  }
  reactivateProductModal.show();
}

/**
 * Confirm reactivation (PATCH /api/products/:id with status: 'active')
 */
async function handleConfirmReactivate() {
  if (!targetReactivateId) return;

  const alertEl = document.getElementById('reactivateModalAlert');
  const confirmBtn = document.getElementById('confirmReactivateBtn');
  const spinner = document.getElementById('reactivateSpinner');

  const token = getStoredToken();
  if (!token) {
    handleAuthExpiry();
    return;
  }

  setBtnLoading(confirmBtn, spinner, true, 'Reactivating...');
  try {
    const res = await fetch(`${API_BASE_URL}/products/${targetReactivateId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'active' })
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      if (res.status === 403) {
        showModalAlert(alertEl, json?.message || 'You can only reactivate your own listings.', 'danger');
        return;
      }
      handleAuthExpiry();
      return;
    }

    if (!res.ok || !json?.success) {
      showModalAlert(alertEl, json?.message || 'Failed to reactivate listing', 'danger');
      return;
    }

    if (reactivateProductModal) reactivateProductModal.hide();
    showDashboardAlert(`<strong>Reactivated:</strong> Listing "<strong>${escapeHtml(json.data.title)}</strong>" is now active and visible to buyers.`, 'success', 5000);
    await loadSellerProducts();
  } catch (err) {
    console.error('Error reactivating product:', err);
    showModalAlert(alertEl, `Error: ${err.message}`, 'danger');
  } finally {
    setBtnLoading(confirmBtn, spinner, false, 'Reactivate Listing');
    targetReactivateId = null;
  }
}

/**
 * Open confirmation modal to permanently remove product
 */
function openRemoveModal(productId, productTitle) {
  targetRemoveId = productId;
  const modalEl = document.getElementById('removeProductModal');
  const titleDisplay = document.getElementById('removeProductTitleDisplay');
  const alertEl = document.getElementById('removeModalAlert');
  if (alertEl) alertEl.className = 'alert d-none';
  if (titleDisplay) titleDisplay.textContent = productTitle || 'this listing';

  if (!removeProductModal) {
    removeProductModal = new bootstrap.Modal(modalEl);
  }
  removeProductModal.show();
}

/**
 * Confirm permanent removal (DELETE /api/products/:id?permanent=true)
 */
async function handleConfirmRemove() {
  if (!targetRemoveId) return;

  const alertEl = document.getElementById('removeModalAlert');
  const confirmBtn = document.getElementById('confirmRemoveBtn');
  const spinner = document.getElementById('removeSpinner');

  const token = getStoredToken();
  if (!token) {
    handleAuthExpiry();
    return;
  }

  setBtnLoading(confirmBtn, spinner, true, 'Removing item...');
  try {
    const res = await fetch(`${API_BASE_URL}/products/${targetRemoveId}?permanent=true`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const json = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      if (res.status === 403) {
        showModalAlert(alertEl, json?.message || 'You can only remove your own listings.', 'danger');
        return;
      }
      handleAuthExpiry();
      return;
    }

    if (!res.ok || !json?.success) {
      showModalAlert(alertEl, json?.message || 'Failed to remove listing', 'danger');
      return;
    }

    if (removeProductModal) removeProductModal.hide();
    showDashboardAlert(`<strong>Removed:</strong> Listing was permanently removed from your catalog.`, 'info', 5000);
    await loadSellerProducts();
  } catch (err) {
    console.error('Error removing product:', err);
    showModalAlert(alertEl, `Error: ${err.message}`, 'danger');
  } finally {
    setBtnLoading(confirmBtn, spinner, false, 'Permanently Remove');
    targetRemoveId = null;
  }
}

/**
 * Modal alert helper
 */
function showModalAlert(alertEl, message, type = 'danger') {
  if (!alertEl) return;
  alertEl.className = `alert alert-${type} d-block mb-3`;
  alertEl.innerHTML = message;
  if (typeof alertEl.scrollIntoView === 'function') {
    alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Button loading helper
 */
function setBtnLoading(button, spinner, isLoading, text) {
  if (!button) return;
  button.disabled = isLoading;
  if (spinner) {
    if (isLoading) spinner.classList.remove('d-none');
    else spinner.classList.add('d-none');
  }
  const span = button.querySelector('.btn-label') || button;
  if (span && text) span.textContent = text;
}

/**
 * Sign out action
 */
function handleSignOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.location.href = 'login.html';
}

/**
 * Initialize Dashboard
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Wire up Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleSignOut();
    });
  }

  // Refresh listings button
  const refreshBtn = document.getElementById('refreshListingsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadSellerProducts();
    });
  }

  // Setup form dynamic field listeners
  setupListingTypeFields('createListingType', '#createSalePriceGroup', '#createRentPriceGroup', 'createSalePrice', 'createRentPrice');
  setupListingTypeFields('editListingType', '#editSalePriceGroup', '#editRentPriceGroup', 'editSalePrice', 'editRentPrice');

  // Setup image previews
  setupImagePreview('createImages', 'createImagePreviews');
  setupImagePreview('editImages', 'editImagePreviews');

  // Form submit listeners
  const createForm = document.getElementById('createProductForm');
  if (createForm) createForm.addEventListener('submit', handleCreateProduct);

  const editForm = document.getElementById('editProductForm');
  if (editForm) editForm.addEventListener('submit', handleEditProduct);

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', handleConfirmDelete);

  const confirmReactivateBtn = document.getElementById('confirmReactivateBtn');
  if (confirmReactivateBtn) confirmReactivateBtn.addEventListener('click', handleConfirmReactivate);

  const confirmRemoveBtn = document.getElementById('confirmRemoveBtn');
  if (confirmRemoveBtn) confirmRemoveBtn.addEventListener('click', handleConfirmRemove);

  // Authenticate and load initial products
  const authenticated = await loadUserProfile();
  if (authenticated) {
    await Promise.all([
      loadSellerProducts(),
      loadIncomingRequests()
    ]);
  }

  // Refresh requests button
  const refreshRequestsBtn = document.getElementById('refreshRequestsBtn');
  if (refreshRequestsBtn) {
    refreshRequestsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadIncomingRequests();
    });
  }
});

// ============================================================================
// INCOMING REQUESTS LOGIC
// ============================================================================
async function loadIncomingRequests() {
  const token = getStoredToken();
  const loadingEl = document.getElementById('requestsLoadingSpinner');
  const emptyEl = document.getElementById('requestsEmptyState');
  const tableContainer = document.getElementById('requestsTableContainer');
  const tableBody = document.getElementById('requestsTableBody');
  const badgeEl = document.getElementById('incomingRequestsCountBadge');

  if (!token || !tableBody) return;

  if (loadingEl) loadingEl.classList.remove('d-none');
  if (emptyEl) emptyEl.classList.add('d-none');
  if (tableContainer) tableContainer.classList.add('d-none');
  tableBody.innerHTML = '';

  try {
    const res = await fetch(`${API_BASE_URL}/requests/seller`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to fetch incoming requests.');
    }

    const items = data.data?.all || [];
    const pendingCount = items.filter(i => i.status === 'pending').length;

    if (badgeEl) {
      badgeEl.textContent = pendingCount;
      if (pendingCount > 0) {
        badgeEl.className = 'badge bg-warning text-dark ms-1';
      } else {
        badgeEl.className = 'badge bg-secondary ms-1';
      }
    }

    if (loadingEl) loadingEl.classList.add('d-none');

    if (items.length === 0) {
      if (emptyEl) emptyEl.classList.remove('d-none');
      return;
    }

    if (tableContainer) tableContainer.classList.remove('d-none');

    items.forEach(req => {
      const isRent = req.type === 'rent';
      const isPending = req.status === 'pending';
      const isAccepted = req.status === 'accepted';
      const isRejected = req.status === 'rejected';

      let statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Pending</span>';
      if (isAccepted) {
        statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Accepted</span>';
      } else if (isRejected) {
        statusBadge = '<span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Rejected</span>';
      }

      let typeBadge = isRent
        ? '<span class="badge badge-type-rent"><i class="bi bi-clock-history me-1"></i>Rental</span>'
        : '<span class="badge badge-type-buy"><i class="bi bi-tag-fill me-1"></i>Direct Buy</span>';

      let termsHtml = '';
      if (isRent) {
        termsHtml = `<span class="small text-secondary">${escapeHtml(req.startDate)} &rarr; ${escapeHtml(req.endDate)}</span>`;
      } else {
        termsHtml = `<span class="small text-secondary">Qty: ${req.quantity}</span>`;
      }

      let actionsHtml = '';
      if (isPending) {
        actionsHtml = `
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-sm btn-success accept-request-btn" data-type="${req.type}" data-id="${req.id}">
              <i class="bi bi-check-lg me-1"></i>Accept
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger reject-request-btn" data-type="${req.type}" data-id="${req.id}">
              <i class="bi bi-x-lg me-1"></i>Reject
            </button>
          </div>
        `;
      } else {
        actionsHtml = `<span class="small text-secondary fst-italic">Decision finalized</span>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="d-flex align-items-center gap-2">
            <div>
              <div class="fw-semibold text-white">${escapeHtml(req.productTitle)}</div>
              <div class="text-secondary small">ID: ${req.productId.slice(0, 8)}...</div>
            </div>
          </div>
        </td>
        <td>
          <div class="text-light fw-medium small">${escapeHtml(req.requesterName)}</div>
        </td>
        <td>
          <div>${typeBadge}</div>
          <div class="mt-1">${termsHtml}</div>
        </td>
        <td>
          <div class="fw-bold text-info">${formatPrice(req.totalAmount)}</div>
        </td>
        <td>${statusBadge}</td>
        <td class="text-end">${actionsHtml}</td>
      `;
      tableBody.appendChild(tr);
    });

    // Wire up accept / reject action buttons
    tableBody.querySelectorAll('.accept-request-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleRequestAction(btn.getAttribute('data-type'), btn.getAttribute('data-id'), 'accept', btn);
      });
    });

    tableBody.querySelectorAll('.reject-request-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleRequestAction(btn.getAttribute('data-type'), btn.getAttribute('data-id'), 'reject', btn);
      });
    });

  } catch (err) {
    console.error('Error loading incoming requests:', err);
    if (loadingEl) loadingEl.classList.add('d-none');
    if (emptyEl) {
      emptyEl.classList.remove('d-none');
      emptyEl.querySelector('p').textContent = 'Error loading requests. Please try refreshing.';
    }
  }
}

async function handleRequestAction(type, id, action, btnEl) {
  const token = getStoredToken();
  if (!token) return;

  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${type}/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Failed to ${action} request.`);
    }

    showGlobalAlert(`Request ${action === 'accept' ? 'accepted' : 'rejected'} successfully.`, 'success');
    await loadIncomingRequests();
  } catch (err) {
    console.error(`Error performing ${action} on request:`, err);
    showGlobalAlert(err.message || 'Action failed.', 'danger');
    btnEl.disabled = false;
    btnEl.innerHTML = originalText;
  }
}
