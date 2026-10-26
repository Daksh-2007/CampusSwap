/**
 * CampusSwap Buyer Marketplace & Persistent Cart Logic
 * 
 * Features:
 * - Fetches active products via GET /api/products
 * - Client & server query filters: Search, Category, Listing Type (buy/rent/both), Sort Order
 * - Product Details View modal with gallery & full description
 * - Add to Cart for Buy (qty based)
 * - Add to Cart for Rent (date picker with rental duration and estimated cost calculation)
 * - Persistent cart using localStorage (separated buy items and rental items)
 * - Dynamic Navbar showing auth status and cart item count
 */

// Configuration & Storage Keys
const API_BASE_URL = window.CAMPUS_SWAP_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'campus_swap_token';
const LEGACY_TOKEN_KEY = 'campus_swap_access_token';
const CART_STORAGE_KEY = 'campusswap_cart_v1';

// Global State
let allProducts = [];
let currentCategory = 'all';
let currentType = 'all';
let currentSearch = '';
let currentSort = 'created_at';
let currentOrder = 'desc';
let activeModalProduct = null;
let currentRentalTarget = null; // For date modal configuration

// Utility: Token retrieval
function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(LEGACY_TOKEN_KEY);
}

// Utility: Format currency (e.g. ₹)
function formatPrice(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return '₹' + Number(amount).toFixed(2);
}

// Utility: Format date for display
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Utility: Calculate rental days between two dates inclusive
function calculateRentalDays(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 0;
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  // Difference in full days (minimum 1 day for same day pickup/return)
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
}

// ============================================================================
// CART PERSISTENCE & MANAGEMENT (localStorage)
// ============================================================================

/**
 * Cart Structure:
 * Array of items:
 * {
 *   id: string (unique line item id: e.g. `${product.id}_buy` or `${product.id}_rent_${start}_${end}`),
 *   productId: string,
 *   title: string,
 *   mode: 'buy' | 'rent',
 *   pricePerUnit: number, // sale_price for buy, rent_price_per_day for rent
 *   quantity: number,     // applicable for buy
 *   rentalStartDate?: string,
 *   rentalEndDate?: string,
 *   rentalDays?: number,
 *   totalEstimatedCost: number,
 *   image: string | null,
 *   category: string,
 *   sellerId: string
 * }
 */
function getCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse cart storage:', err);
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartUI();
  } catch (err) {
    console.error('Failed to save cart to localStorage:', err);
  }
}

function addToCartBuy(product) {
  if (!product || !product.id) return;
  const cart = getCart();
  const lineItemId = `${product.id}_buy`;

  const existingIndex = cart.findIndex(item => item.id === lineItemId);
  const thumb = (product.product_images && product.product_images[0]?.public_url) || null;
  const salePrice = Number(product.sale_price) || 0;

  if (existingIndex > -1) {
    cart[existingIndex].quantity = (cart[existingIndex].quantity || 1) + 1;
    cart[existingIndex].totalEstimatedCost = cart[existingIndex].quantity * salePrice;
  } else {
    cart.push({
      id: lineItemId,
      productId: product.id,
      title: product.title,
      mode: 'buy',
      pricePerUnit: salePrice,
      quantity: 1,
      totalEstimatedCost: salePrice,
      image: thumb,
      category: product.category,
      sellerId: product.seller_id
    });
  }

  saveCart(cart);
  showToastNotification(`Added "${product.title}" to cart for purchase!`, 'success');
}

function addToCartRent(product, startDate, endDate) {
  if (!product || !product.id || !startDate || !endDate) return;
  const days = calculateRentalDays(startDate, endDate);
  if (days <= 0) {
    showToastNotification('Please select a valid return date on or after the start date.', 'warning');
    return;
  }

  const cart = getCart();
  const lineItemId = `${product.id}_rent_${startDate}_${endDate}`;
  const dailyRate = Number(product.rent_price_per_day) || 0;
  const estimatedCost = days * dailyRate;
  const thumb = (product.product_images && product.product_images[0]?.public_url) || null;

  const existingIndex = cart.findIndex(item => item.id === lineItemId);
  if (existingIndex > -1) {
    // If the exact same dates are already queued, simply notify the user
    showToastNotification(`This rental period is already in your cart!`, 'info');
  } else {
    cart.push({
      id: lineItemId,
      productId: product.id,
      title: product.title,
      mode: 'rent',
      pricePerUnit: dailyRate,
      quantity: 1,
      rentalStartDate: startDate,
      rentalEndDate: endDate,
      rentalDays: days,
      totalEstimatedCost: estimatedCost,
      image: thumb,
      category: product.category,
      sellerId: product.seller_id
    });
    saveCart(cart);
    showToastNotification(`Added "${product.title}" for ${days} days rental!`, 'success');
  }
}

function updateCartBuyQuantity(lineItemId, newQty) {
  const cart = getCart();
  const index = cart.findIndex(item => item.id === lineItemId);
  if (index === -1) return;

  const qty = parseInt(newQty, 10);
  if (isNaN(qty) || qty <= 0) {
    removeFromCart(lineItemId);
    return;
  }

  cart[index].quantity = qty;
  cart[index].totalEstimatedCost = qty * cart[index].pricePerUnit;
  saveCart(cart);
}

function removeFromCart(lineItemId) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== lineItemId);
  saveCart(cart);
  showToastNotification('Item removed from cart', 'secondary');
}

function clearCart() {
  saveCart([]);
  showToastNotification('Cart cleared', 'secondary');
}

function updateCartUI() {
  const cart = getCart();
  const totalItemCount = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);

  // Update badge count
  const badgeEl = document.getElementById('cartBadgeCount');
  if (badgeEl) {
    badgeEl.textContent = totalItemCount;
    if (totalItemCount > 0) {
      badgeEl.classList.remove('d-none');
    } else {
      badgeEl.classList.add('d-none');
    }
  }

  // Update cart offcanvas content
  const cartItemsContainer = document.getElementById('cartItemsContainer');
  const cartEmptyState = document.getElementById('cartEmptyState');
  const cartFooter = document.getElementById('cartFooter');
  const cartSubtotalEl = document.getElementById('cartSubtotal');
  const cartItemsCountLabel = document.getElementById('cartItemsCountLabel');

  if (cartItemsCountLabel) {
    cartItemsCountLabel.textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`;
  }

  if (cart.length === 0) {
    if (cartEmptyState) cartEmptyState.classList.remove('d-none');
    if (cartItemsContainer) cartItemsContainer.classList.add('d-none');
    if (cartFooter) cartFooter.classList.add('d-none');
    return;
  }

  if (cartEmptyState) cartEmptyState.classList.add('d-none');
  if (cartItemsContainer) cartItemsContainer.classList.remove('d-none');
  if (cartFooter) cartFooter.classList.remove('d-none');

  let subtotal = 0;
  let itemsHtml = '';

  cart.forEach(item => {
    subtotal += Number(item.totalEstimatedCost) || 0;
    const isRental = item.mode === 'rent';

    const thumbHtml = item.image
      ? `<img src="${item.image}" alt="${escapeHtml(item.title)}" class="cart-thumb">`
      : `<div class="cart-thumb-placeholder"><i class="bi bi-box-seam"></i></div>`;

    itemsHtml += `
      <div class="cart-item-card mb-3" data-item-id="${item.id}">
        <div class="d-flex gap-3">
          ${thumbHtml}
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex justify-content-between align-items-start">
              <h4 class="h6 fw-semibold text-white mb-1 text-truncate" title="${escapeHtml(item.title)}">
                ${escapeHtml(item.title)}
              </h4>
              <button type="button" class="btn btn-link text-secondary p-0 ms-2 remove-cart-item-btn" data-id="${item.id}" title="Remove item">
                <i class="bi bi-trash3 text-danger"></i>
              </button>
            </div>
            
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="badge ${isRental ? 'badge-type-rent' : 'badge-type-buy'}">
                <i class="bi ${isRental ? 'bi-clock-history' : 'bi-bag-check'} me-1"></i>${isRental ? 'Rental' : 'Purchase'}
              </span>
              <span class="text-secondary small">${escapeHtml(item.category || 'General')}</span>
            </div>

            ${isRental ? `
              <div class="small text-warning bg-warning bg-opacity-10 p-2 rounded mb-2 border border-warning border-opacity-25">
                <div><i class="bi bi-calendar-event me-1"></i><strong>Dates:</strong> ${formatDate(item.rentalStartDate)} &rarr; ${formatDate(item.rentalEndDate)}</div>
                <div class="text-secondary small mt-0.5">Duration: <strong>${item.rentalDays} day(s)</strong> @ ${formatPrice(item.pricePerUnit)}/day</div>
              </div>
            ` : `
              <div class="d-flex align-items-center justify-content-between mb-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="text-secondary small">Qty:</span>
                  <div class="input-group input-group-sm" style="width: 100px;">
                    <button class="btn btn-outline-secondary btn-cart-minus" type="button" data-id="${item.id}">-</button>
                    <input type="text" class="form-control text-center bg-dark text-white p-0 border-secondary cart-qty-input" value="${item.quantity}" readonly>
                    <button class="btn btn-outline-secondary btn-cart-plus" type="button" data-id="${item.id}">+</button>
                  </div>
                </div>
                <div class="text-secondary small">@ ${formatPrice(item.pricePerUnit)} ea</div>
              </div>
            `}

            <div class="d-flex justify-content-between align-items-center pt-2 border-top border-secondary border-opacity-25 mt-1">
              <span class="text-secondary small">Subtotal:</span>
              <span class="fw-bold text-info">${formatPrice(item.totalEstimatedCost)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  if (cartItemsContainer) cartItemsContainer.innerHTML = itemsHtml;
  if (cartSubtotalEl) cartSubtotalEl.textContent = formatPrice(subtotal);

  // Bind cart item actions
  document.querySelectorAll('.remove-cart-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      removeFromCart(id);
    });
  });

  document.querySelectorAll('.btn-cart-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = cart.find(i => i.id === id);
      if (item) updateCartBuyQuantity(id, item.quantity - 1);
    });
  });

  document.querySelectorAll('.btn-cart-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = cart.find(i => i.id === id);
      if (item) updateCartBuyQuantity(id, item.quantity + 1);
    });
  });
}

// Toast notification helper
function showToastNotification(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toastId = 'toast_' + Date.now();
  const bgClass = type === 'success' ? 'bg-success' : type === 'warning' ? 'bg-warning text-dark' : type === 'danger' ? 'bg-danger' : 'bg-primary';
  const toastHtml = `
    <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body small fw-medium">
          ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', toastHtml);
  const toastElement = document.getElementById(toastId);
  if (toastElement && window.bootstrap && window.bootstrap.Toast) {
    const toast = new window.bootstrap.Toast(toastElement, { delay: 3500 });
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
  }
}

// Escape HTML helper to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// AUTHENTICATION & NAV INTEGRATION
// ============================================================================
async function initAuthNav() {
  const token = getStoredToken();
  const authLoadingNav = document.getElementById('authNavLoading');
  const loggedOutNav = document.getElementById('navLoggedOut');
  const loggedInNav = document.getElementById('navLoggedIn');
  const userGreeting = document.getElementById('navUserGreeting');
  const navUserEmail = document.getElementById('navUserEmail');
  const navLogoutBtn = document.getElementById('navLogoutBtn');

  if (!token) {
    if (authLoadingNav) authLoadingNav.classList.add('d-none');
    if (loggedOutNav) loggedOutNav.classList.remove('d-none');
    if (loggedInNav) loggedInNav.classList.add('d-none');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data && data.success && data.data) {
      if (authLoadingNav) authLoadingNav.classList.add('d-none');
      if (loggedOutNav) loggedOutNav.classList.add('d-none');
      if (loggedInNav) loggedInNav.classList.remove('d-none');

      const displayName = data.data.full_name || data.data.email?.split('@')[0] || 'Student';
      if (userGreeting) userGreeting.textContent = displayName;
      if (navUserEmail) navUserEmail.textContent = data.data.email || '';
    } else {
      // Invalid/expired token
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      if (authLoadingNav) authLoadingNav.classList.add('d-none');
      if (loggedOutNav) loggedOutNav.classList.remove('d-none');
      if (loggedInNav) loggedInNav.classList.add('d-none');
    }
  } catch (err) {
    console.error('Navbar session verification error:', err);
    if (authLoadingNav) authLoadingNav.classList.add('d-none');
    if (loggedOutNav) loggedOutNav.classList.remove('d-none');
    if (loggedInNav) loggedInNav.classList.add('d-none');
  }

  if (navLogoutBtn) {
    navLogoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
      window.location.reload();
    });
  }
}

// ============================================================================
// MARKETPLACE API & PRODUCT FETCHING
// ============================================================================
async function fetchMarketplaceProducts() {
  const gridContainer = document.getElementById('productsGrid');
  const loadingSpinner = document.getElementById('marketplaceLoading');
  const emptyState = document.getElementById('marketplaceEmpty');
  const errorAlert = document.getElementById('marketplaceAlert');
  const countBadge = document.getElementById('marketplaceCountBadge');

  if (loadingSpinner) loadingSpinner.classList.remove('d-none');
  if (gridContainer) gridContainer.classList.add('d-none');
  if (emptyState) emptyState.classList.add('d-none');
  if (errorAlert) errorAlert.classList.add('d-none');

  try {
    // Build query params
    const params = new URLSearchParams();
    if (currentCategory && currentCategory !== 'all') {
      params.append('category', currentCategory);
    }
    if (currentType && currentType !== 'all') {
      params.append('listing_type', currentType);
    }
    if (currentSearch && currentSearch.trim()) {
      params.append('search', currentSearch.trim());
    }
    params.append('sort', currentSort);
    params.append('order', currentOrder);
    params.append('limit', '100'); // MVP page size

    const response = await fetch(`${API_BASE_URL}/products?${params.toString()}`);
    const result = await response.json().catch(() => ({ success: false, message: 'Invalid response from server' }));

    if (loadingSpinner) loadingSpinner.classList.add('d-none');

    if (!response.ok || !result.success) {
      if (errorAlert) {
        errorAlert.classList.remove('d-none');
        errorAlert.textContent = result.message || 'Failed to load active marketplace listings.';
      }
      return;
    }

    allProducts = result.data || [];

    // Dynamically populate available categories from returned products
    populateCategoryFilter(allProducts);

    // Update count badge
    if (countBadge) {
      countBadge.textContent = `${allProducts.length} active item${allProducts.length === 1 ? '' : 's'}`;
    }

    if (allProducts.length === 0) {
      if (emptyState) emptyState.classList.remove('d-none');
      if (gridContainer) gridContainer.classList.add('d-none');
    } else {
      if (emptyState) emptyState.classList.add('d-none');
      if (gridContainer) {
        gridContainer.classList.remove('d-none');
        renderProductCards(allProducts);
      }
    }
  } catch (err) {
    console.error('Fetch products error:', err);
    if (loadingSpinner) loadingSpinner.classList.add('d-none');
    if (errorAlert) {
      errorAlert.classList.remove('d-none');
      errorAlert.textContent = 'Could not connect to CampusSwap API server at ' + API_BASE_URL;
    }
  }
}

function populateCategoryFilter(products) {
  const container = document.getElementById('categoryPillsContainer');
  if (!container) return;

  // Extract distinct categories from current product list
  const existingCategories = new Set();
  products.forEach(p => {
    if (p.category && p.category.trim()) {
      existingCategories.add(p.category.trim());
    }
  });

  // Default common categories if not in set
  ['Books', 'Electronics', 'Lab Equipment', 'Calculators', 'Furniture', 'Dorm Accessories'].forEach(cat => {
    existingCategories.add(cat);
  });

  let pillsHtml = `
    <button type="button" class="category-pill ${currentCategory === 'all' ? 'active' : ''}" data-category="all">
      All Items
    </button>
  `;

  Array.from(existingCategories).sort().forEach(cat => {
    pillsHtml += `
      <button type="button" class="category-pill ${currentCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}" data-category="${escapeHtml(cat)}">
        ${escapeHtml(cat)}
      </button>
    `;
  });

  container.innerHTML = pillsHtml;

  // Wire up category pill clicks
  container.querySelectorAll('.category-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-category');
      currentCategory = cat;
      container.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchMarketplaceProducts();
    });
  });
}

function renderProductCards(products) {
  const gridContainer = document.getElementById('productsGrid');
  if (!gridContainer) return;

  let html = '';

  products.forEach(p => {
    const thumbUrl = (p.product_images && p.product_images[0]?.public_url) || null;
    const canBuy = p.listing_type === 'buy' || p.listing_type === 'both';
    const canRent = p.listing_type === 'rent' || p.listing_type === 'both';

    // Type badge
    let typeBadgeHtml = '';
    if (p.listing_type === 'both') {
      typeBadgeHtml = '<span class="badge badge-type-both"><i class="bi bi-arrow-repeat me-1"></i>Buy & Rent</span>';
    } else if (p.listing_type === 'buy') {
      typeBadgeHtml = '<span class="badge badge-type-buy"><i class="bi bi-tag-fill me-1"></i>For Sale</span>';
    } else if (p.listing_type === 'rent') {
      typeBadgeHtml = '<span class="badge badge-type-rent"><i class="bi bi-clock-history me-1"></i>For Rent</span>';
    }

    // Condition badge
    const cond = (p.item_condition || 'good').toLowerCase();
    const condLabel = cond === 'like_new' ? 'Like New' : cond.charAt(0).toUpperCase() + cond.slice(1);
    const condBadgeClass = `badge-cond-${cond}`;

    // Price section
    let priceHtml = '';
    if (p.listing_type === 'both') {
      priceHtml = `
        <div class="d-flex justify-content-between align-items-baseline mb-3">
          <div>
            <span class="price-sub d-block">Purchase:</span>
            <span class="price-tag">${formatPrice(p.sale_price)}</span>
          </div>
          <div class="text-end">
            <span class="price-sub d-block">Rent / day:</span>
            <span class="text-warning fw-bold fs-6">${formatPrice(p.rent_price_per_day)}</span>
          </div>
        </div>
      `;
    } else if (p.listing_type === 'buy') {
      priceHtml = `
        <div class="mb-3">
          <span class="price-sub d-block">Price:</span>
          <span class="price-tag">${formatPrice(p.sale_price)}</span>
        </div>
      `;
    } else if (p.listing_type === 'rent') {
      priceHtml = `
        <div class="mb-3">
          <span class="price-sub d-block">Rental Rate:</span>
          <span class="price-tag text-warning">${formatPrice(p.rent_price_per_day)}</span>
          <span class="text-secondary small"> / day</span>
        </div>
      `;
    }

    // Action buttons
    let actionsHtml = `
      <div class="mt-auto pt-2 d-flex flex-column gap-2">
        <button type="button" class="btn btn-outline-light btn-sm w-100 btn-view-details" data-id="${p.id}">
          <i class="bi bi-eye me-1"></i> View Details
        </button>
        <div class="d-flex gap-2">
    `;

    if (canBuy) {
      actionsHtml += `
        <button type="button" class="btn btn-primary btn-sm flex-grow-1 btn-add-buy" data-id="${p.id}" title="Add to cart for purchase">
          <i class="bi bi-cart-plus me-1"></i> Buy
        </button>
      `;
    }

    if (canRent) {
      actionsHtml += `
        <button type="button" class="btn btn-outline-warning btn-sm flex-grow-1 btn-add-rent" data-id="${p.id}" title="Configure rental dates">
          <i class="bi bi-calendar-plus me-1"></i> Rent
        </button>
      `;
    }

    actionsHtml += `
        </div>
      </div>
    `;

    const imageSection = thumbUrl
      ? `<img src="${thumbUrl}" alt="${escapeHtml(p.title)}" loading="lazy">`
      : `<div class="product-img-placeholder"><i class="bi bi-box-seam"></i><span style="font-size: 0.8rem; margin-top: 4px;">No photo</span></div>`;

    html += `
      <div class="col-sm-6 col-lg-4 col-xl-3">
        <div class="product-card">
          <div class="product-img-wrapper cursor-pointer btn-view-details" data-id="${p.id}">
            ${imageSection}
          </div>
          <div class="product-card-body">
            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
              <span class="badge bg-dark bg-opacity-75 text-secondary border border-secondary border-opacity-25 small text-truncate" style="max-width: 140px;">
                ${escapeHtml(p.category)}
              </span>
              <span class="badge ${condBadgeClass}">
                ${condLabel}
              </span>
            </div>

            <h3 class="product-title cursor-pointer btn-view-details" data-id="${p.id}" title="${escapeHtml(p.title)}">
              ${escapeHtml(p.title)}
            </h3>

            <div class="mb-2">
              ${typeBadgeHtml}
            </div>

            ${priceHtml}

            ${actionsHtml}
          </div>
        </div>
      </div>
    `;
  });

  gridContainer.innerHTML = html;

  // Bind actions
  gridContainer.querySelectorAll('.btn-view-details').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.getAttribute('data-id');
      openProductDetailsModal(id);
    });
  });

  gridContainer.querySelectorAll('.btn-add-buy').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-id');
      const product = allProducts.find(p => p.id === id);
      if (product) addToCartBuy(product);
    });
  });

  gridContainer.querySelectorAll('.btn-add-rent').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-id');
      const product = allProducts.find(p => p.id === id);
      if (product) openRentalDateModal(product);
    });
  });
}

// ============================================================================
// PRODUCT DETAILS VIEW MODAL
// ============================================================================
async function openProductDetailsModal(productId) {
  const modalEl = document.getElementById('productDetailModal');
  if (!modalEl || !window.bootstrap) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  const titleEl = document.getElementById('detailModalTitle');
  const catEl = document.getElementById('detailCategory');
  const condEl = document.getElementById('detailCondition');
  const typeEl = document.getElementById('detailListingType');
  const descEl = document.getElementById('detailDescription');
  const pickupEl = document.getElementById('detailPickupAddress');
  const priceContainer = document.getElementById('detailPricingContainer');
  const mainImageContainer = document.getElementById('detailMainImageContainer');
  const thumbnailsContainer = document.getElementById('detailThumbnailsContainer');
  const actionContainer = document.getElementById('detailActionContainer');

  // Find in memory or fetch fresh details via GET /api/products/:id
  let product = allProducts.find(p => p.id === productId);

  try {
    const res = await fetch(`${API_BASE_URL}/products/${productId}`);
    if (res.ok) {
      const fresh = await res.json();
      if (fresh.success && fresh.data) {
        product = fresh.data;
      }
    }
  } catch (err) {
    console.warn('Could not fetch fresh product details, using cached:', err);
  }

  if (!product) {
    showToastNotification('Product details unavailable.', 'danger');
    return;
  }

  activeModalProduct = product;

  // Populate data
  if (titleEl) titleEl.textContent = product.title;
  if (catEl) catEl.textContent = product.category;

  const cond = (product.item_condition || 'good').toLowerCase();
  if (condEl) {
    condEl.className = `badge badge-cond-${cond}`;
    condEl.textContent = cond === 'like_new' ? 'Like New' : cond.charAt(0).toUpperCase() + cond.slice(1);
  }

  if (typeEl) {
    if (product.listing_type === 'both') {
      typeEl.className = 'badge badge-type-both';
      typeEl.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Available to Buy or Rent';
    } else if (product.listing_type === 'buy') {
      typeEl.className = 'badge badge-type-buy';
      typeEl.innerHTML = '<i class="bi bi-tag-fill me-1"></i>For Direct Purchase';
    } else {
      typeEl.className = 'badge badge-type-rent';
      typeEl.innerHTML = '<i class="bi bi-clock-history me-1"></i>For Daily Rental';
    }
  }

  if (descEl) {
    descEl.textContent = product.description || 'No description provided by the seller.';
  }

  if (pickupEl) {
    if (product.pickup_address && product.pickup_address.trim()) {
      pickupEl.innerHTML = `<i class="bi bi-geo-alt-fill text-danger me-1"></i>${escapeHtml(product.pickup_address)}`;
      pickupEl.closest('.pickup-box')?.classList.remove('d-none');
    } else {
      pickupEl.closest('.pickup-box')?.classList.add('d-none');
    }
  }

  // Gallery
  const images = product.product_images || [];
  if (images.length > 0 && images[0].public_url) {
    mainImageContainer.innerHTML = `<img src="${images[0].public_url}" alt="${escapeHtml(product.title)}" class="gallery-main-img" id="detailMainImg">`;
    if (images.length > 1) {
      let thumbsHtml = '';
      images.forEach((img, idx) => {
        thumbsHtml += `<img src="${img.public_url}" alt="Thumbnail ${idx + 1}" class="gallery-thumbnail ${idx === 0 ? 'active' : ''}" data-src="${img.public_url}">`;
      });
      thumbnailsContainer.innerHTML = thumbsHtml;
      thumbnailsContainer.querySelectorAll('.gallery-thumbnail').forEach(thumb => {
        thumb.addEventListener('click', () => {
          thumbnailsContainer.querySelectorAll('.gallery-thumbnail').forEach(t => t.classList.remove('active'));
          thumb.classList.add('active');
          const mainImg = document.getElementById('detailMainImg');
          if (mainImg) mainImg.src = thumb.getAttribute('data-src');
        });
      });
    } else {
      thumbnailsContainer.innerHTML = '';
    }
  } else {
    mainImageContainer.innerHTML = `
      <div class="gallery-main-img d-flex flex-column align-items-center justify-content-center text-secondary py-5">
        <i class="bi bi-box-seam fs-1 mb-2"></i>
        <span>No images provided for this listing</span>
      </div>
    `;
    thumbnailsContainer.innerHTML = '';
  }

  // Pricing box
  let pricingHtml = '';
  const canBuy = product.listing_type === 'buy' || product.listing_type === 'both';
  const canRent = product.listing_type === 'rent' || product.listing_type === 'both';

  if (canBuy && canRent) {
    pricingHtml = `
      <div class="row g-2 mb-3">
        <div class="col-6">
          <div class="p-3 rounded-3 bg-dark bg-opacity-75 border border-secondary border-opacity-25 text-center">
            <span class="text-secondary small d-block mb-1">Buy Outright</span>
            <span class="price-tag fs-4">${formatPrice(product.sale_price)}</span>
          </div>
        </div>
        <div class="col-6">
          <div class="p-3 rounded-3 bg-dark bg-opacity-75 border border-secondary border-opacity-25 text-center">
            <span class="text-secondary small d-block mb-1">Daily Rental</span>
            <span class="text-warning fw-bold fs-4">${formatPrice(product.rent_price_per_day)}</span>
            <span class="text-secondary small">/day</span>
          </div>
        </div>
      </div>
    `;
  } else if (canBuy) {
    pricingHtml = `
      <div class="p-3 rounded-3 bg-dark bg-opacity-75 border border-secondary border-opacity-25 mb-3">
        <span class="text-secondary small d-block mb-1">Selling Price</span>
        <span class="price-tag fs-3">${formatPrice(product.sale_price)}</span>
      </div>
    `;
  } else if (canRent) {
    pricingHtml = `
      <div class="p-3 rounded-3 bg-dark bg-opacity-75 border border-secondary border-opacity-25 mb-3">
        <span class="text-secondary small d-block mb-1">Rental Daily Rate</span>
        <span class="text-warning fw-bold fs-3">${formatPrice(product.rent_price_per_day)}</span>
        <span class="text-secondary small">/day</span>
      </div>
    `;
  }
  if (priceContainer) priceContainer.innerHTML = pricingHtml;

  // Modal Action Buttons
  let actionsHtml = '';
  if (canBuy) {
    actionsHtml += `
      <button type="button" class="btn btn-primary py-2 px-3 flex-grow-1" id="modalBuyBtn">
        <i class="bi bi-cart-plus me-1"></i> Add to Cart (Buy)
      </button>
    `;
  }
  if (canRent) {
    actionsHtml += `
      <button type="button" class="btn btn-outline-warning py-2 px-3 flex-grow-1" id="modalRentBtn">
        <i class="bi bi-calendar-plus me-1"></i> Rent Item
      </button>
    `;
  }
  if (actionContainer) {
    actionContainer.innerHTML = actionsHtml;

    const modalBuyBtn = document.getElementById('modalBuyBtn');
    if (modalBuyBtn) {
      modalBuyBtn.addEventListener('click', () => {
        addToCartBuy(activeModalProduct);
        modal.hide();
      });
    }

    const modalRentBtn = document.getElementById('modalRentBtn');
    if (modalRentBtn) {
      modalRentBtn.addEventListener('click', () => {
        modal.hide();
        openRentalDateModal(activeModalProduct);
      });
    }
  }

  modal.show();
}

// ============================================================================
// RENTAL CONFIGURATION & DURATION/COST CALCULATOR MODAL
// ============================================================================
function openRentalDateModal(product) {
  currentRentalTarget = product;
  const modalEl = document.getElementById('rentalConfigModal');
  if (!modalEl || !window.bootstrap) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  const titleEl = document.getElementById('rentalModalProductTitle');
  const rateEl = document.getElementById('rentalModalDailyRate');
  const startDateInput = document.getElementById('rentalStartDate');
  const endDateInput = document.getElementById('rentalEndDate');
  const durationDisplay = document.getElementById('rentalDurationDays');
  const totalCostDisplay = document.getElementById('rentalEstimatedCost');
  const confirmBtn = document.getElementById('confirmRentalAddToCartBtn');

  if (titleEl) titleEl.textContent = product.title;
  if (rateEl) rateEl.textContent = formatPrice(product.rent_price_per_day);

  // Set default dates: Start today, End in 3 days
  const today = new Date();
  const startStr = today.toISOString().split('T')[0];
  const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  const endStr = threeDaysLater.toISOString().split('T')[0];

  if (startDateInput) {
    startDateInput.min = startStr;
    startDateInput.value = startStr;
  }
  if (endDateInput) {
    endDateInput.min = startStr;
    endDateInput.value = endStr;
  }

  function recalculateRental() {
    const s = startDateInput.value;
    const e = endDateInput.value;
    const days = calculateRentalDays(s, e);
    const dailyRate = Number(product.rent_price_per_day) || 0;
    const total = days * dailyRate;

    if (durationDisplay) durationDisplay.textContent = `${days} day${days === 1 ? '' : 's'}`;
    if (totalCostDisplay) totalCostDisplay.textContent = formatPrice(total);
    if (confirmBtn) {
      confirmBtn.disabled = days <= 0;
    }
  }

  startDateInput.onchange = () => {
    if (endDateInput.value < startDateInput.value) {
      endDateInput.value = startDateInput.value;
    }
    endDateInput.min = startDateInput.value;
    recalculateRental();
  };

  endDateInput.onchange = recalculateRental;

  recalculateRental();

  confirmBtn.onclick = () => {
    const s = startDateInput.value;
    const e = endDateInput.value;
    addToCartRent(currentRentalTarget, s, e);
    modal.hide();
  };

  modal.show();
}

// ============================================================================
// FILTERS & SEARCH EVENT LISTENERS
// ============================================================================
function setupFiltersAndSearch() {
  const searchInput = document.getElementById('marketplaceSearchInput');
  const searchForm = document.getElementById('marketplaceSearchForm');
  const typeFilterSelect = document.getElementById('filterListingType');
  const sortSelect = document.getElementById('sortSelect');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      currentSearch = searchInput ? searchInput.value.trim() : '';
      fetchMarketplaceProducts();
    });
  }

  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        fetchMarketplaceProducts();
      }, 400);
    });
  }

  if (typeFilterSelect) {
    typeFilterSelect.addEventListener('change', () => {
      currentType = typeFilterSelect.value;
      fetchMarketplaceProducts();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const val = sortSelect.value;
      if (val === 'created_at_desc') {
        currentSort = 'created_at';
        currentOrder = 'desc';
      } else if (val === 'created_at_asc') {
        currentSort = 'created_at';
        currentOrder = 'asc';
      } else if (val === 'sale_price_asc') {
        currentSort = 'sale_price';
        currentOrder = 'asc';
      } else if (val === 'sale_price_desc') {
        currentSort = 'sale_price';
        currentOrder = 'desc';
      } else if (val === 'rent_price_asc') {
        currentSort = 'rent_price_per_day';
        currentOrder = 'asc';
      } else if (val === 'title_asc') {
        currentSort = 'title';
        currentOrder = 'asc';
      }
      fetchMarketplaceProducts();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      currentCategory = 'all';
      currentType = 'all';
      currentSearch = '';
      currentSort = 'created_at';
      currentOrder = 'desc';

      if (searchInput) searchInput.value = '';
      if (typeFilterSelect) typeFilterSelect.value = 'all';
      if (sortSelect) sortSelect.value = 'created_at_desc';

      const pills = document.querySelectorAll('.category-pill');
      pills.forEach(p => p.classList.remove('active'));
      document.querySelector('.category-pill[data-category="all"]')?.classList.add('active');

      fetchMarketplaceProducts();
    });
  }

  // Clear cart button in offcanvas
  const clearCartBtn = document.getElementById('clearCartBtn');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to remove all items from your cart?')) {
        clearCart();
      }
    });
  }

  // Checkout button notice (per MVP requirements: no payment gateway yet)
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      const token = getStoredToken();
      if (!token) {
        showToastNotification('Please sign in to proceed with your order reservation!', 'warning');
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 1200);
        return;
      }

      showToastNotification('Ready for reservation! Order placement & payment processing will be finalized in the next milestone.', 'info');
    });
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initAuthNav();
  updateCartUI();
  setupFiltersAndSearch();
  fetchMarketplaceProducts();
});
