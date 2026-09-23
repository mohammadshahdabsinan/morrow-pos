// Firebase Configuration - REST API (no SDK needed)
const firebaseConfig = window.FIREBASE_CONFIG || {};
const FIRESTORE_API_URL = 'https://firestore.googleapis.com/v1/projects';

let firebaseReady = false;
if (firebaseConfig.projectId && firebaseConfig.apiKey) {
  firebaseReady = true;
  console.log('✓ Firebase REST API configured');
} else {
  console.warn('Firebase config not found - offline mode only');
}

const STORAGE_KEY = 'morrow-pos-v2';
const FIREBASE_COLLECTION = 'shops';
const SHOP_ID = 'default-shop';

let isOnline = navigator.onLine;
let isSyncing = false;
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 5000; // Min 5 seconds between syncs

// Track online/offline status
window.addEventListener('online', () => {
  isOnline = true;
  updateSyncStatus();
  syncToFirebase();
});

window.addEventListener('offline', () => {
  isOnline = false;
  updateSyncStatus();
});

const palette = ['terracotta', 'ochre', 'sage', 'blue', 'cocoa'];

const defaultState = {
  settings: {
    businessName: 'Your Business Name',
    businessPhone: '',
    country: 'India',
    locale: 'en-IN',
    currency: 'Rs',
    taxEnabled: false,
    taxRate: 0,
    taxLabel: 'Tax',
    taxMode: 'exclusive'
  },
  categories: [],
  products: [],
  sales: [],
  bill: []
};

const state = loadState();
let activeCategory = 'all';
let searchText = '';
let filterDateRange = 'all';
let filterPaymentMethod = '';
let filterStatus = '';
let selectedFilterDate = null; // null = all time, otherwise specific date (YYYY-MM-DD)
const transactionCache = {}; // cache for filtered results: { "2026-09-23": [...transactions] }
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const categoryList = document.querySelector('#category-list');
const dashboardCategoryList = document.querySelector('#dashboard-category-list');
const productGrid = document.querySelector('#product-grid');
const catalogProductList = document.querySelector('#catalog-product-list');
const categoryForm = document.querySelector('#category-form');
const productForm = document.querySelector('#product-form');
const settingsForm = document.querySelector('#settings-form');
const customItemForm = document.querySelector('#custom-item-form');
const billItems = document.querySelector('#bill-items');
const paymentMethod = document.querySelector('#payment-method');
const searchInput = document.querySelector('#search-input');
const subtotalEl = document.querySelector('#subtotal');
const taxEl = document.querySelector('#tax');
const totalEl = document.querySelector('#total');
const taxLabelEl = document.querySelector('#tax-label-text');
const buttonTotalEl = document.querySelector('#button-total');
const orderCountEl = document.querySelector('#order-count');
const todayRevenueEl = document.querySelector('#today-revenue');
const billNumberEl = document.querySelector('#bill-number');
const countryStatusEl = document.querySelector('#country-status');
const taxEnabledInput = document.querySelector('#tax-enabled');
const taxRateInput = document.querySelector('#tax-rate');
const taxModeInput = document.querySelector('#tax-mode');
const taxLabelInput = document.querySelector('#tax-label');
const currencyInput = document.querySelector('#currency-symbol');
const countryInput = document.querySelector('#business-country');
const localeInput = document.querySelector('#business-locale');
const businessNameInput = document.querySelector('#business-name');
const businessPhoneInput = document.querySelector('#business-phone');
const businessNameDisplay = document.querySelector('#business-name-display');
const categorySortInput = document.querySelector('#category-sort');
const dashboardProductSortInput = document.querySelector('#dashboard-product-sort');
const catalogProductSortInput = document.querySelector('#catalog-product-sort');
const viewTitle = document.querySelector('#view-title');
const billPanel = document.querySelector('#bill-panel');
const customItemName = document.querySelector('#custom-item-name');
const customItemPrice = document.querySelector('#custom-item-price');
let currentView = 'sell';
let categorySort = 'name-asc';
let productSort = 'name-asc';
const salesHistory = document.querySelector('#sales-history');
const salesFilter = document.querySelector('#sales-filter');
const paymentMethodFilter = document.querySelector('#payment-method-filter');
const transactionStatusFilter = document.querySelector('#transaction-status-filter');
const filterDatePicker = document.querySelector('#filter-date-picker');
const importDataInput = document.querySelector('#import-data');

// Stat card elements
const statTotalSales = document.querySelector('#stat-total-sales');
const statTotalRevenue = document.querySelector('#stat-total-revenue');
const statTodaySales = document.querySelector('#stat-today-sales');
const statTodayRevenue = document.querySelector('#stat-today-revenue');

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return structuredClone(defaultState);
    return {
      settings: {
        ...defaultState.settings,
        ...(stored.settings || {})
      },
      categories: stored.categories?.length ? stored.categories : defaultState.categories,
      products: stored.products?.length ? stored.products : defaultState.products,
      sales: Array.isArray(stored.sales) ? stored.sales : [],
      bill: Array.isArray(stored.bill) ? stored.bill : []
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const now = Date.now();
  if (now - lastSyncTime >= SYNC_THROTTLE_MS) {
    syncToFirebase();
  }
}

// Shows a brief confirmation message after a save action, so it's clear
// the action actually happened instead of the UI silently doing nothing.
function showToast(message, type = 'success') {
  let toast = document.querySelector('#app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast visible' + (type === 'error' ? ' error' : '');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

// Highlights a form's submit button while there are unsaved edits, and
// clears the highlight once the form is submitted, so it's clear whether
// there's anything left to save.
function trackFormDirtyState(form) {
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  const markDirty = () => submitBtn.classList.add('has-changes');
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);
  form.addEventListener('submit', () => submitBtn.classList.remove('has-changes'));
}

async function syncToFirebase() {
  if (!isOnline || isSyncing || !firebaseReady) return;

  const now = Date.now();
  if (now - lastSyncTime < SYNC_THROTTLE_MS) return;

  isSyncing = true;
  lastSyncTime = now;
  updateSyncStatus();

  try {
    const updateMask = 'updateMask.fieldPaths=settings&updateMask.fieldPaths=categories&updateMask.fieldPaths=products&updateMask.fieldPaths=sales&updateMask.fieldPaths=lastSyncedAt&updateMask.fieldPaths=deviceId';
    const url = `${FIRESTORE_API_URL}/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_COLLECTION}/${SHOP_ID}?key=${firebaseConfig.apiKey}&${updateMask}`;

    const docData = {
      fields: {
        settings: { mapValue: { fields: Object.entries(state.settings).reduce((acc, [k, v]) => {
          acc[k] = { stringValue: String(v) };
          return acc;
        }, {}) } },
        categories: { arrayValue: { values: state.categories.map(cat => ({ mapValue: { fields: {
          id: { stringValue: cat.id },
          name: { stringValue: cat.name }
        } } })) } },
        products: { arrayValue: { values: state.products.map(prod => ({ mapValue: { fields: {
          id: { stringValue: prod.id },
          name: { stringValue: prod.name },
          categoryId: { stringValue: prod.categoryId },
          price: { integerValue: String(prod.price) }
        } } })) } },
        sales: { arrayValue: { values: state.sales.map(sale => ({ mapValue: { fields: {
          id: { stringValue: sale.id },
          number: { integerValue: String(sale.number) },
          subtotal: { integerValue: String(sale.subtotal || 0) },
          tax: { integerValue: String(sale.tax || 0) },
          total: { integerValue: String(sale.total) },
          paymentMethod: { stringValue: sale.paymentMethod || '' },
          status: { stringValue: sale.status || 'Pending' },
          reason: { stringValue: sale.reason || '' },
          taxRate: { stringValue: String(sale.taxRate || 0) },
          taxMode: { stringValue: sale.taxMode || 'exclusive' },
          taxLabel: { stringValue: sale.taxLabel || 'Tax' },
          items: { arrayValue: { values: (sale.items || []).map(item => ({ mapValue: { fields: {
            productId: { stringValue: item.productId || '' },
            name: { stringValue: item.name || '' },
            price: { integerValue: String(item.price || 0) },
            quantity: { integerValue: String(item.quantity || 0) }
          } } })) } },
          createdAt: { stringValue: sale.createdAt }
        } } })) } },
        lastSyncedAt: { stringValue: new Date().toISOString() },
        deviceId: { stringValue: getDeviceId() }
      }
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(docData)
    });

    if (response.ok) {
      console.log('✓ Data synced to Firebase');
      localStorage.setItem('last-firebase-sync', new Date().toISOString());
    } else {
      console.error('Firebase sync error:', response.status);
    }
    updateSyncStatus();
  } catch (error) {
    console.error('Firebase sync error:', error);
  } finally {
    isSyncing = false;
    updateSyncStatus();
  }
}

async function loadFromFirebase() {
  if (!isOnline || !firebaseReady) return null;

  try {
    const url = `${FIRESTORE_API_URL}/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_COLLECTION}/${SHOP_ID}?key=${firebaseConfig.apiKey}`;

    const response = await fetch(url);
    if (response.ok) {
      const doc = await response.json();
      if (doc.fields) {
        const fields = doc.fields;
        const lastSyncedAt = fields.lastSyncedAt?.stringValue;
        const localLastSync = localStorage.getItem('last-firebase-sync');

        if (localLastSync && lastSyncedAt && lastSyncedAt === localLastSync) {
          console.log('✓ Firebase data unchanged, using local cache');
          return null;
        }

        console.log('✓ Data loaded from Firebase');
        localStorage.setItem('last-firebase-sync', lastSyncedAt || '');

        const parseArray = (arr, mapper) => {
          if (!arr || !arr.arrayValue || !arr.arrayValue.values) return [];
          return arr.arrayValue.values.map(mapper);
        };

        return {
          settings: fields.settings?.mapValue?.fields ? Object.entries(fields.settings.mapValue.fields).reduce((acc, [k, v]) => {
            acc[k] = v.stringValue || v.booleanValue || v.integerValue;
            return acc;
          }, {}) : defaultState.settings,
          categories: parseArray(fields.categories, v => ({
            id: v.mapValue.fields.id.stringValue,
            name: v.mapValue.fields.name.stringValue
          })),
          products: parseArray(fields.products, v => ({
            id: v.mapValue.fields.id.stringValue,
            name: v.mapValue.fields.name.stringValue,
            categoryId: v.mapValue.fields.categoryId.stringValue,
            price: Number(v.mapValue.fields.price.integerValue)
          })),
          sales: parseArray(fields.sales, v => ({
            id: v.mapValue.fields.id.stringValue,
            number: Number(v.mapValue.fields.number.integerValue),
            subtotal: Number(v.mapValue.fields.subtotal?.integerValue || 0),
            tax: Number(v.mapValue.fields.tax?.integerValue || 0),
            total: Number(v.mapValue.fields.total.integerValue),
            paymentMethod: v.mapValue.fields.paymentMethod?.stringValue || '',
            status: v.mapValue.fields.status?.stringValue || 'Pending',
            reason: v.mapValue.fields.reason?.stringValue || '',
            taxRate: Number(v.mapValue.fields.taxRate?.stringValue || 0),
            taxMode: v.mapValue.fields.taxMode?.stringValue || 'exclusive',
            taxLabel: v.mapValue.fields.taxLabel?.stringValue || 'Tax',
            items: parseArray(v.mapValue.fields.items, item => ({
              productId: item.mapValue.fields.productId?.stringValue || '',
              name: item.mapValue.fields.name?.stringValue || '',
              price: Number(item.mapValue.fields.price?.integerValue || 0),
              quantity: Number(item.mapValue.fields.quantity?.integerValue || 0)
            })),
            createdAt: v.mapValue.fields.createdAt.stringValue
          }))
        };
      }
    }
  } catch (error) {
    console.error('Firebase load error:', error);
  }
  return null;
}

function getDeviceId() {
  let deviceId = localStorage.getItem('device-id');
  if (!deviceId) {
    deviceId = 'device-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem('device-id', deviceId);
  }
  return deviceId;
}

function updateSyncStatus() {
  const statusPill = document.querySelector('.status-pill');
  if (!statusPill) return;

  const statusDot = statusPill.querySelector('.status-dot');

  if (!isOnline) {
    statusPill.textContent = '⚠ Offline';
    statusPill.innerHTML = '<span class="status-dot"></span>Offline';
    statusDot.style.background = '#ff6b6b';
  } else if (isSyncing) {
    statusPill.textContent = '⟳ Syncing...';
    statusPill.innerHTML = '<span class="status-dot"></span>Syncing...';
    statusDot.style.background = '#ffa500';
  } else {
    statusPill.textContent = '✓ Synced';
    statusPill.innerHTML = '<span class="status-dot"></span>Synced';
    statusDot.style.background = '#51cf66';
  }
}

async function downloadFile(filename, content, type) {
  if (isNativeApp()) {
    // Native app: use Capacitor filesystem
    try {
      const Filesystem = window.Capacitor?.Plugins?.Filesystem;
      if (!Filesystem) {
        alert('Filesystem plugin not available');
        return;
      }

      // Save directly to Documents directory (simpler, more reliable)
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: 9  // 9 = Documents directory (standard, always exists)
      });

      alert(`✓ File saved to Documents:\n${filename}\n\nCheck your Documents folder in Files app.`);
      console.log('File saved:', filename);
    } catch (err) {
      console.error('Export error:', err);
      alert(`Export failed: ${err.message}\n\nTry using the website instead for now.`);
    }
  } else {
    // Browser: standard download
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function currency(value) {
  const symbol = state.settings?.currency || 'Rs';
  const locale = state.settings?.locale || 'en-IN';
  let formattedValue;
  try {
    formattedValue = Number(value).toLocaleString(locale, { maximumFractionDigits: 2 });
  } catch {
    formattedValue = Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  return `${symbol} ${formattedValue}`;
}

function getTaxRateValue() {
  if (!state.settings?.taxEnabled) return 0;
  const numericRate = Number(state.settings.taxRate) || 0;
  return Math.max(0, numericRate);
}

function getTaxMode() {
  return state.settings?.taxMode === 'inclusive' ? 'inclusive' : 'exclusive';
}

function getTaxLabel() {
  return (state.settings?.taxLabel || 'Tax').trim() || 'Tax';
}

function isValidLocale(locale) {
  try {
    new Intl.NumberFormat(locale);
    return true;
  } catch {
    return false;
  }
}

function getCurrentTotals() {
  const rawSum = state.bill.reduce((sum, item) => {
    const product = getProductById(item.productId);
    const price = item.custom ? item.price : product?.price;
    return sum + (price ? price * item.quantity : 0);
  }, 0);

  const taxRate = getTaxRateValue();
  const taxMode = getTaxMode();

  let subtotal, tax, total;
  if (taxMode === 'inclusive' && taxRate > 0) {
    total = rawSum;
    subtotal = total / (1 + taxRate / 100);
    tax = total - subtotal;
  } else {
    subtotal = rawSum;
    tax = subtotal * (taxRate / 100);
    total = subtotal + tax;
  }

  return { subtotal, tax, total, taxRate, taxMode };
}

function getCategoryName(categoryId) {
  const cat = state.categories.find((item) => item.id === categoryId);
  return cat ? cat.name : 'General';
}

function getProductById(id) {
  return state.products.find((product) => product.id === id);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function buildCategoryOptions() {
  const select = document.querySelector('#product-category');
  select.innerHTML = '';

  state.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  });
}

function renderCategories() {
  categoryList.innerHTML = '';
  dashboardCategoryList.innerHTML = '';

  const addFilterChip = (container, text, categoryId) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `category-chip ${activeCategory === categoryId ? 'active' : ''}`;
    chip.textContent = text;
    chip.addEventListener('click', () => {
      activeCategory = categoryId;
      renderAll();
    });
    container.appendChild(chip);
  };

  addFilterChip(dashboardCategoryList, 'All items', 'all');

  const categories = [...state.categories].sort((first, second) => {
    const result = first.name.localeCompare(second.name);
    return categorySort === 'name-desc' ? -result : result;
  });

  const table = document.createElement('table');
  table.className = 'catalog-table category-table';
  table.innerHTML = '<thead><tr><th>Category</th><th>Products</th><th>Actions</th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');

  categories.forEach((category) => {
    const row = document.createElement('tr');
    const productCount = state.products.filter((product) => product.categoryId === category.id).length;
    row.innerHTML = `<td><strong>${escapeHtml(category.name)}</strong></td><td>${productCount}</td><td></td>`;
    const actions = row.lastElementChild;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'mini-btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editCategory(category.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mini-btn danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteCategory(category.id));
    actions.append(edit, remove);
    body.appendChild(row);
    addFilterChip(dashboardCategoryList, category.name, category.id);
  });

  if (categories.length) categoryList.appendChild(table);
  else categoryList.innerHTML = '<div class="history-empty">No categories yet. Add a category to organize products.</div>';
}

function editCategory(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  const name = window.prompt('Category name', category.name)?.trim();
  if (!name) return;
  category.name = name;
  saveState();
  buildCategoryOptions();
  renderAll();
}

function deleteCategory(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  if (state.products.some((product) => product.categoryId === categoryId)) {
    window.alert('Move or delete the products in this category first.');
    return;
  }
  if (!window.confirm(`Delete ${category.name}?`)) return;
  state.categories = state.categories.filter((item) => item.id !== categoryId);
  activeCategory = 'all';
  saveState();
  buildCategoryOptions();
  renderAll();
}

function filteredProducts() {
  const filtered = state.products.filter((product) => {
    const matchesCategory = activeCategory === 'all' || product.categoryId === activeCategory;
    const matchesSearch = product.name.toLowerCase().includes(searchText.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return sortProducts(filtered);
}

function sortProducts(products) {
  return [...products].sort((first, second) => {
    if (productSort === 'price-asc') return first.price - second.price;
    if (productSort === 'price-desc') return second.price - first.price;
    const result = first.name.localeCompare(second.name);
    return productSort === 'name-desc' ? -result : result;
  });
}

function renderProducts() {
  const products = filteredProducts();
  productGrid.innerHTML = '';

  if (!products.length) {
    const empty = document.createElement('div');
    empty.className = 'bill-empty';
    empty.style.gridColumn = '1 / -1';
    empty.textContent = 'No products match this category or search.';
    productGrid.appendChild(empty);
    renderCatalogProducts();
    return;
  }

  products.forEach((product, index) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    const visual = document.createElement('div');
    visual.className = 'product-visual';
    visual.style.background = ['#cf7356', '#d0ab5b', '#8aa67b', '#7e90a8', '#a77d63'][index % 5];
    const letter = product.name.trim().charAt(0).toUpperCase() || 'A';
    visual.textContent = letter;

    const meta = document.createElement('div');
    meta.className = 'product-meta';
    meta.innerHTML = `
      <span class="category-name">${getCategoryName(product.categoryId)}</span>
      <strong>${product.name}</strong>
      <span>${currency(product.price)}</span>
    `;

    const quantity = document.createElement('div');
    quantity.className = 'dashboard-quantity';
    const decrease = document.createElement('button');
    decrease.type = 'button';
    decrease.textContent = '-';
    decrease.addEventListener('click', () => updateProductQuick(product.id, 'decrease'));
    const count = document.createElement('span');
    count.textContent = String(getBillQuantity(product.id));
    const increase = document.createElement('button');
    increase.type = 'button';
    increase.textContent = '+';
    increase.addEventListener('click', () => updateProductQuick(product.id, 'increase'));
    quantity.append(decrease, count, increase);

    card.appendChild(visual);
    card.appendChild(meta);
    card.appendChild(quantity);
    productGrid.appendChild(card);
  });

  renderCatalogProducts();
}

function getBillQuantity(productId) {
  return state.bill.find((item) => item.productId === productId)?.quantity || 0;
}

function updateProductQuick(productId, action) {
  const existing = state.bill.find((item) => item.productId === productId);
  if (action === 'increase') {
    addToBill(productId);
    return;
  }
  if (!existing) return;
  updateBillItem(existing.id, 'decrease');
}

function renderCatalogProducts() {
  catalogProductList.innerHTML = '';
  if (!state.products.length) {
    catalogProductList.innerHTML = '<div class="history-empty">No products yet. Add your first product above.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'catalog-table';
  table.innerHTML = '<thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Actions</th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');
  sortProducts(state.products).forEach((product) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(getCategoryName(product.categoryId))}</td><td>${escapeHtml(currency(product.price))}</td><td></td>`;
    const actions = row.lastElementChild;
    const editButton = document.createElement('button');
    editButton.className = 'mini-btn';
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => editProduct(product.id));
    const deleteButton = document.createElement('button');
    deleteButton.className = 'mini-btn danger';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => deleteProduct(product.id));
    actions.append(editButton, deleteButton);
    body.appendChild(row);
  });
  catalogProductList.appendChild(table);
}

function editProduct(productId) {
  const product = getProductById(productId);
  if (!product) return;

  const form = document.querySelector('#product-form');
  document.querySelector('#product-id').value = product.id;
  document.querySelector('#product-name').value = product.name;
  document.querySelector('#product-category').value = product.categoryId;
  document.querySelector('#product-price').value = product.price;
  document.querySelector('#product-submit-button').textContent = 'Update product';
  form.classList.remove('hidden');
  document.querySelector('#product-name').focus();
}

function deleteProduct(productId) {
  const product = getProductById(productId);
  if (!product) return;

  const confirmed = window.confirm(`Delete ${product.name}? This also removes it from the current bill.`);
  if (!confirmed) return;

  state.products = state.products.filter((item) => item.id !== productId);
  state.bill = state.bill.filter((item) => item.productId !== productId);
  saveState();
  renderAll();
}

function renderBill() {
  billItems.innerHTML = '';

  if (!state.bill.length) {
    const empty = document.createElement('div');
    empty.className = 'bill-empty';
    empty.innerHTML = '<div><strong>Your bill is empty</strong><div>Select products to start selling.</div></div>';
    billItems.appendChild(empty);
    updateTotals();
    return;
  }

  state.bill.forEach((item) => {
    const product = getProductById(item.productId);
    if (!product && !item.custom) return;
    const itemName = item.custom ? item.name : product.name;
    const itemPrice = item.custom ? item.price : product.price;

    const billItem = document.createElement('div');
    billItem.className = 'bill-item';

    const visual = document.createElement('div');
    visual.className = 'bill-item-visual';
    visual.style.background = ['#cf7356', '#d0ab5b', '#8aa67b', '#7e90a8', '#a77d63'][Math.abs(item.id.length) % 5];
    visual.textContent = itemName.charAt(0).toUpperCase();

    const meta = document.createElement('div');
    meta.className = 'bill-item-meta';
    meta.innerHTML = `
      <strong>${escapeHtml(itemName)}</strong>
      <span>${currency(itemPrice)} each${item.custom ? ' · one-off item' : ''}</span>
    `;

    const quantity = document.createElement('div');
    quantity.className = 'qty-control';
    quantity.innerHTML = `
      <button type="button" data-action="decrease" data-id="${item.id}">-</button>
      <span>${item.quantity}</span>
      <button type="button" data-action="increase" data-id="${item.id}">+</button>
    `;

    const total = document.createElement('div');
    total.className = 'line-total';
    total.innerHTML = `
      <span>${currency(item.quantity * itemPrice)}</span>
    `;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-btn';
    removeButton.dataset.id = item.id;
    removeButton.textContent = 'Remove item';

    billItem.appendChild(visual);
    billItem.appendChild(meta);
    billItem.appendChild(total);
    billItem.appendChild(quantity);
    billItem.appendChild(removeButton);
    billItems.appendChild(billItem);
  });

  billItems.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => updateBillItem(button.dataset.id, button.dataset.action));
  });

  billItems.querySelectorAll('.remove-btn').forEach((button) => {
    button.addEventListener('click', () => removeFromBill(button.dataset.id));
  });

  updateTotals();
}

function addToBill(productId) {
  const product = getProductById(productId);
  if (!product) return;

  const existing = state.bill.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.bill.push({ id: createId('bill'), productId, quantity: 1 });
  }
  saveState();
  renderBill();
  renderProducts();
}

function updateBillItem(id, action) {
  const item = state.bill.find((entry) => entry.id === id);
  if (!item) return;

  if (action === 'increase') {
    item.quantity += 1;
  }
  if (action === 'decrease') item.quantity -= 1;

  if (item.quantity <= 0) {
    state.bill = state.bill.filter((entry) => entry.id !== id);
  }

  saveState();
  renderBill();
  renderProducts();
}

function removeFromBill(id) {
  state.bill = state.bill.filter((entry) => entry.id !== id);
  saveState();
  renderBill();
  renderProducts();
}

function updateTotals() {
  const { subtotal, tax, total } = getCurrentTotals();

  taxLabelEl.textContent = getTaxLabel();

  subtotalEl.textContent = currency(subtotal);
  taxEl.textContent = currency(tax);
  totalEl.textContent = currency(total);
  buttonTotalEl.textContent = currency(total);
}

function renderSalesStats() {
  const today = new Date().toDateString();
  const todaySales = state.sales.filter((sale) => new Date(sale.createdAt).toDateString() === today);
  const todayOrders = todaySales.length;
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);

  orderCountEl.textContent = String(todayOrders);
  todayRevenueEl.textContent = currency(todayRevenue);
}

function getSaleItems(sale) {
  return Array.isArray(sale.items) ? sale.items : [];
}

function saleDate(sale) {
  return new Date(sale.createdAt).toLocaleString(state.settings?.locale || 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function getFilteredSales() {
  const today = new Date().toDateString();
  return state.sales.filter((sale) => {
    // Date filtering: support 'all time', 'today', or specific selected date
    let dateMatch = true;
    if (selectedFilterDate) {
      // Specific date selected
      dateMatch = new Date(sale.createdAt).toDateString() === new Date(selectedFilterDate).toDateString();
    } else if (filterDateRange === 'today') {
      // Today only
      dateMatch = new Date(sale.createdAt).toDateString() === today;
    }
    // filterDateRange === 'all' means all time, so dateMatch stays true

    const paymentMatch = !filterPaymentMethod || sale.paymentMethod === filterPaymentMethod;
    const statusMatch = !filterStatus || sale.status === filterStatus;
    return dateMatch && paymentMatch && statusMatch;
  });
}

function renderTransactionStats() {
  const filteredSales = getFilteredSales();
  const today = new Date().toDateString();
  // Only count "Paid" transactions in totals (exclude Pending, Failed, Wrong Bill)
  const paidSales = state.sales.filter(s => s.status === 'Paid');
  const paidToday = paidSales.filter(s => new Date(s.createdAt).toDateString() === today);
  const paidSelectedDate = selectedFilterDate ? paidSales.filter(s => new Date(s.createdAt).toDateString() === new Date(selectedFilterDate).toDateString()) : [];

  const totalRevenue = paidSales.reduce((sum, sale) => sum + sale.total, 0);
  const todayRevenue = paidToday.reduce((sum, sale) => sum + sale.total, 0);
  const selectedDateRevenue = paidSelectedDate.reduce((sum, sale) => sum + sale.total, 0);

  // All-time totals (only paid transactions)
  if (statTotalSales) statTotalSales.textContent = String(paidSales.length);
  if (statTotalRevenue) statTotalRevenue.textContent = currency(totalRevenue);

  // Today's totals (only paid transactions)
  if (statTodaySales) statTodaySales.textContent = String(paidToday.length);
  if (statTodayRevenue) statTodayRevenue.textContent = currency(todayRevenue);

  // Selected date totals (only paid transactions)
  const statSelectedDateSales = document.querySelector('#stat-selected-date-sales');
  const statSelectedDateRevenue = document.querySelector('#stat-selected-date-revenue');
  if (selectedFilterDate) {
    if (statSelectedDateSales) statSelectedDateSales.textContent = String(paidSelectedDate.length);
    if (statSelectedDateRevenue) statSelectedDateRevenue.textContent = currency(selectedDateRevenue);
  }
}

function renderSalesHistory() {
  if (!salesHistory) return;

  const visibleSales = getFilteredSales();

  salesHistory.innerHTML = '';
  if (!visibleSales.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No sales match your filters.';
    salesHistory.appendChild(empty);
    return;
  }

  visibleSales.forEach((sale) => {
    const row = document.createElement('div');
    row.className = 'sale-row';
    const itemCount = getSaleItems(sale).reduce((sum, item) => sum + item.quantity, 0);
    const reasonText = sale.reason ? `<div style="font-size:0.85rem;color:#666;margin-top:4px">💬 ${escapeHtml(sale.reason)}</div>` : '';

    row.innerHTML = `
      <div>
        <strong>Sale #${String(sale.number || '').padStart(4, '0')}</strong>
        <span>${escapeHtml(saleDate(sale))} · ${escapeHtml(sale.paymentMethod)}</span>
        ${reasonText}
      </div>
      <div class="sale-row-meta">
        <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
        <strong>${escapeHtml(formatSaleCurrency(sale, sale.total))}</strong>
        <select class="sale-status-select" data-sale-id="${sale.id}" style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;background:white">
          <option value="Paid" ${sale.status === 'Paid' ? 'selected' : ''}>Paid</option>
          <option value="Pending" ${sale.status === 'Pending' ? 'selected' : ''}>Pending</option>
          <option value="Failed" ${sale.status === 'Failed' ? 'selected' : ''}>Failed</option>
          <option value="Wrong Bill" ${sale.status === 'Wrong Bill' ? 'selected' : ''}>Wrong Bill</option>
        </select>
        <button class="mini-btn" type="button" data-receipt-id="${sale.id}">Receipt</button>
      </div>
    `;
    salesHistory.appendChild(row);
  });

  salesHistory.querySelectorAll('[data-receipt-id]').forEach((button) => {
    button.addEventListener('click', () => printReceipt(button.dataset.receiptId));
  });

  // Add listeners to status selectors
  salesHistory.querySelectorAll('.sale-status-select').forEach((select) => {
    select.addEventListener('change', () => {
      const saleId = select.dataset.saleId;
      const sale = state.sales.find(s => s.id === saleId);
      if (sale) {
        sale.status = select.value;
        saveState();
        renderTransactionStats();
        renderSalesHistory();
      }
    });
  });
}

function formatSaleCurrency(sale, value) {
  const currentSettings = state.settings;
  state.settings = {
    ...currentSettings,
    currency: sale.currency || currentSettings.currency,
    locale: sale.locale || currentSettings.locale
  };
  const formatted = currency(value);
  state.settings = currentSettings;
  return formatted;
}

function printReceipt(saleId) {
  const sale = state.sales.find((entry) => entry.id === saleId);
  if (!sale) return;

  const printerIP = localStorage.getItem('printer-ip');

  if (printerIP) {
    printToNetworkPrinter(sale, printerIP);
  } else {
    printViaDialog(sale);
  }
}

function printToNetworkPrinter(sale, printerIP) {
  const businessName = sale.businessName || state.settings.businessName || 'Your Business Name';
  const businessPhone = sale.businessPhone || state.settings.businessPhone || '';

  let escPos = '';

  const lineWidth = 48;
  const separator = '-'.repeat(lineWidth);
  const twoColumnLine = (left, right) => {
    const spacing = lineWidth - left.length - right.length;
    return spacing > 0 ? left + ' '.repeat(spacing) + right : `${left} ${right}`;
  };

  escPos += '\x1b\x61\x01';
  escPos += '\x1d\x21\x11';
  escPos += businessName + '\n';
  escPos += '\x1d\x21\x00';
  if (businessPhone) {
    escPos += businessPhone + '\n';
  }

  escPos += '\n';
  escPos += `Receipt #${String(sale.number).padStart(4, '0')}\n`;
  escPos += `${saleDate(sale)}\n`;
  escPos += `Payment: ${sale.paymentMethod}\n`;
  escPos += '\x1b\x61\x00';

  escPos += `\n${separator}\n`;
  getSaleItems(sale).forEach((item) => {
    const qty = item.quantity;
    const price = item.price * qty;
    const unitPrice = formatSaleCurrency(sale, item.price);
    const lineTotal = formatSaleCurrency(sale, price);
    const name = item.name.substring(0, lineWidth);

    escPos += `${name}\n`;
    escPos += twoColumnLine(`  ${qty} x ${unitPrice}`, lineTotal) + '\n';
  });

  escPos += `${separator}\n`;
  escPos += twoColumnLine('Subtotal', formatSaleCurrency(sale, sale.subtotal || 0)) + '\n';
  if (sale.tax > 0) {
    escPos += twoColumnLine(sale.taxLabel, formatSaleCurrency(sale, sale.tax)) + '\n';
  }
  escPos += '\x1d\x21\x01';
  escPos += twoColumnLine('Total', formatSaleCurrency(sale, sale.total)) + '\n';
  escPos += '\x1d\x21\x00';

  escPos += '\n';
  escPos += '\x1b\x61\x01';
  escPos += 'Thank you!\n';
  escPos += 'Come again soon\n';

  escPos += '\n\n';
  escPos += '\x1d\x56\x00';

  sendToPrinter(printerIP, escPos, sale);
}

function isNativeApp() {
  return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// Capacitor's WebView has no real popup/multi-window support, so window.open()
// navigates the whole app away with no way back. Show the same HTML in an
// in-page overlay with a real Close button instead.
function showHtmlDocumentModal(htmlDocument) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;flex-direction:column;padding:16px;';

  const closeBar = document.createElement('div');
  closeBar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px;';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'padding:10px 16px;border:none;border-radius:6px;background:#cf7356;color:white;font-size:14px;';
  closeBtn.addEventListener('click', () => overlay.remove());
  closeBar.appendChild(closeBtn);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;width:100%;border:none;border-radius:8px;background:white;';
  iframe.srcdoc = htmlDocument;

  overlay.appendChild(closeBar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
}

function sendToPrinter(printerIP, escPosData, sale) {
  if (isNativeApp()) {
    window.Capacitor.Plugins.ThermalPrinter.printRaw({ ip: printerIP, port: 9100, data: escPosData })
      .then(() => {
        console.log('✓ Sent to thermal printer (native)');
        alert('✓ Printing to thermal printer...');
      })
      .catch((error) => {
        console.error('Printer error (native):', error);
        alert('Printer not found. Using browser print instead.');
        if (sale) printViaDialog(sale);
      });
    return;
  }

  // Browser: try thermal first, fall back to browser print
  // Note: HTTPS → HTTP requests are blocked by browsers, so this may fail on HTTPS sites
  const url = `http://${printerIP}:9100`;
  let timeoutId = setTimeout(() => {
    console.warn('Thermal printer timeout, falling back to browser print');
    alert('Thermal printer not responding. Using browser print instead.');
    if (sale) printViaDialog(sale);
  }, 3000);

  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: escPosData,
    signal: AbortSignal.timeout(3000)
  })
  .then(() => {
    clearTimeout(timeoutId);
    console.log('✓ Sent to thermal printer');
    alert('✓ Printing to thermal printer...');
  })
  .catch((error) => {
    clearTimeout(timeoutId);
    console.warn('Thermal printer failed, falling back to browser print:', error);
    alert('Thermal printer not available. Using browser print instead.');
    if (sale) printViaDialog(sale);
  });
}

function printViaDialog(sale) {
  const businessName = sale.businessName || state.settings.businessName || 'Your Business Name';
  const businessPhone = sale.businessPhone || state.settings.businessPhone || '';
  const itemsHtml = getSaleItems(sale).map((item) => `
    <div style="display:flex;justify-content:space-between;margin:6px 0;font-size:13px;border-bottom:1px dotted #999;padding-bottom:4px">
      <div style="flex:1">
        <strong>${escapeHtml(item.name || 'Product')}</strong><br>
        <span style="font-size:11px;color:#555">${item.quantity} x ${escapeHtml(formatSaleCurrency(sale, item.price))}</span>
      </div>
      <div style="text-align:right;white-space:nowrap;margin-left:8px">
        <strong>${escapeHtml(formatSaleCurrency(sale, item.price * item.quantity))}</strong>
      </div>
    </div>
  `).join('');

  const receiptHtml = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt #${sale.number}</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      width: 80mm;
      margin: 0;
      padding: 8mm;
      background: white;
      color: #222;
      line-height: 1.4;
    }
    .receipt-header {
      text-align: center;
      margin-bottom: 8px;
      border-bottom: 2px solid #000;
      padding-bottom: 6px;
    }
    .business-name {
      font-size: 16px;
      font-weight: bold;
      margin: 0;
    }
    .business-tag {
      font-size: 11px;
      color: #666;
      margin: 2px 0 0 0;
    }
    .business-phone {
      font-size: 11px;
      margin: 2px 0 0 0;
    }
    .receipt-meta {
      font-size: 12px;
      text-align: center;
      margin: 6px 0;
    }
    .items {
      margin: 8px 0;
      padding: 4px 0;
      border-top: 1px solid #999;
      border-bottom: 1px solid #999;
    }
    .totals {
      margin: 8px 0;
      font-size: 13px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      margin: 4px 0;
    }
    .total-row.final {
      font-weight: bold;
      font-size: 14px;
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 4px 0;
      margin: 6px 0;
    }
    .thank-you {
      text-align: center;
      font-size: 12px;
      margin-top: 8px;
      font-style: italic;
      color: #555;
    }
    @media print {
      body { width: 80mm; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <div class="receipt-header">
    <p class="business-name">${escapeHtml(businessName)}</p>
    <p class="business-tag">Xtra Zone Billing</p>
    ${businessPhone ? `<p class="business-phone">☎ ${escapeHtml(businessPhone)}</p>` : ''}
  </div>

  <div class="receipt-meta">
    <strong>Receipt #${String(sale.number).padStart(4, '0')}</strong><br>
    ${escapeHtml(saleDate(sale))}<br>
    Payment: ${escapeHtml(sale.paymentMethod)}
  </div>

  <div class="items">
    ${itemsHtml}
  </div>

  <div class="totals">
    <div class="total-row">
      <span>Subtotal:</span>
      <strong>${escapeHtml(formatSaleCurrency(sale, sale.subtotal))}</strong>
    </div>
    ${Number(sale.tax) > 0 ? `<div class="total-row">
      <span>${escapeHtml(sale.taxLabel || 'Tax')}:</span>
      <strong>${escapeHtml(formatSaleCurrency(sale, sale.tax))}</strong>
    </div>` : ''}
    <div class="total-row final">
      <span>TOTAL:</span>
      <strong>${escapeHtml(formatSaleCurrency(sale, sale.total))}</strong>
    </div>
  </div>

  <div class="thank-you">
    Thank you for your business!
  </div>

  <script>
    window.onload = () => {
      window.print();
      setTimeout(() => window.close(), 100);
    };
    window.onafterprint = () => window.close();
  </script>
</body>
</html>`;

  if (isNativeApp()) {
    showHtmlDocumentModal(receiptHtml);
    return;
  }

  const receiptWindow = window.open('', '_blank', 'width=400,height=600');
  if (!receiptWindow) {
    window.alert('Allow pop-ups to print the receipt.');
    return;
  }
  receiptWindow.document.write(receiptHtml);
  receiptWindow.document.close();
}

function completeSale() {
  if (!state.bill.length) return;

  const { subtotal, tax, total } = getCurrentTotals();
  const saleNumber = state.sales.length + 1;

  const statusChoice = window.confirm('Did the payment succeed?\n\nOK = Paid\nCancel = Pending/Failed');
  const status = statusChoice ? 'Paid' : '';
  let reason = '';

  if (!statusChoice) {
    reason = window.prompt('Optional: Add a note for this transaction\n(e.g., "Card declined", "Waiting for check", "Will pay later")', '');
  }

  const sale = {
    id: createId('sale'),
    number: saleNumber,
    businessName: state.settings.businessName,
    businessPhone: state.settings.businessPhone,
    country: state.settings.country,
    locale: state.settings.locale,
    currency: state.settings.currency,
    subtotal,
    tax,
    total,
    taxRate: getTaxRateValue(),
    taxMode: getTaxMode(),
    taxLabel: getTaxLabel(),
    paymentMethod: paymentMethod.value,
    status: status || 'Pending',
    reason: reason || '',
    items: state.bill.map((item) => {
      const product = getProductById(item.productId);
      return {
        productId: item.productId,
        name: item.custom ? item.name : (product?.name || 'Product'),
        price: item.custom ? item.price : (product?.price || 0),
        quantity: item.quantity
      };
    }),
    createdAt: new Date().toISOString()
  };

  state.sales.unshift(sale);
  state.bill = [];
  saveState();
  renderBill();
  renderSalesStats();
  renderTransactionStats();
  renderSalesHistory();
  billNumberEl.textContent = `#${String(state.sales.length + 1).padStart(4, '0')}`;
  printReceipt(sale.id);
}

function renderSettings() {
  if (!settingsForm) return;

  taxEnabledInput.checked = Boolean(state.settings?.taxEnabled);
  taxRateInput.value = Number(state.settings?.taxRate || 0);
  taxModeInput.value = getTaxMode();
  taxLabelInput.value = state.settings?.taxLabel || 'Tax';
  currencyInput.value = state.settings?.currency || 'Rs';
  countryInput.value = state.settings?.country || 'India';
  localeInput.value = state.settings?.locale || 'en-IN';
  businessNameInput.value = state.settings?.businessName || 'Your Business Name';
  businessPhoneInput.value = state.settings?.businessPhone || '';
}

function renderAll() {
  renderSettings();
  renderCategories();
  renderProducts();
  renderBill();
  renderSalesStats();
  renderTransactionStats();
  renderSalesHistory();
  countryStatusEl.textContent = state.settings?.country || 'India';
  businessNameDisplay.textContent = state.settings?.businessName || 'Your Business Name';
  billNumberEl.textContent = `#${String(state.sales.length + 1).padStart(4, '0')}`;
}

function setView(view) {
  currentView = view;
  document.body.classList.toggle('dashboard-view', view === 'sell');
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== view);
  });
  const viewNames = {
    sell: 'Dashboard',
    catalog: 'Catalog',
    settings: 'Business settings',
    tools: 'Data tools',
    transactions: 'Transactions'
  };
  viewTitle.textContent = viewNames[view] || 'Dashboard';
}

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const locale = (localeInput.value || 'en-IN').trim() || 'en-IN';
  if (!isValidLocale(locale)) {
    window.alert('Enter a valid number locale, for example en-IN, en-US, or ar-AE.');
    localeInput.focus();
    return;
  }

  state.settings = {
    businessName: (businessNameInput.value || 'Your Business Name').trim() || 'Your Business Name',
    businessPhone: (businessPhoneInput.value || '').trim(),
    country: (countryInput.value || 'India').trim() || 'India',
    locale,
    currency: (currencyInput.value || 'Rs').trim() || 'Rs',
    taxEnabled: Boolean(taxEnabledInput.checked),
    taxRate: Number(taxRateInput.value || 0),
    taxMode: taxModeInput.value === 'inclusive' ? 'inclusive' : 'exclusive',
    taxLabel: (taxLabelInput.value || 'Tax').trim() || 'Tax'
  };

  saveState();
  renderAll();
  showToast('✓ Settings saved');
});

document.querySelector('#export-data').addEventListener('click', () => {
  downloadFile(`xtra-zone-billing-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
});

document.querySelector('#import-data-button').addEventListener('click', () => {
  importDataInput.click();
});

importDataInput.addEventListener('change', async () => {
  const file = importDataInput.files?.[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.categories) || !Array.isArray(imported.products) || !Array.isArray(imported.sales)) {
      throw new Error('Invalid backup structure');
    }

    const confirmed = window.confirm('Replace the current local data with this backup?');
    if (!confirmed) return;

    Object.assign(state, {
      settings: { ...defaultState.settings, ...(imported.settings || {}) },
      categories: imported.categories,
      products: imported.products,
      sales: imported.sales,
      bill: Array.isArray(imported.bill) ? imported.bill : []
    });
    saveState();
    activeCategory = 'all';
    buildCategoryOptions();
    renderAll();
  } catch {
    window.alert('This file is not a valid Xtra Zone Billing backup.');
  } finally {
    importDataInput.value = '';
  }
});

salesFilter.addEventListener('change', () => {
  filterDateRange = salesFilter.value;
  // Clear date picker when switching to preset ranges
  filterDatePicker.value = '';
  selectedFilterDate = null;
  document.querySelector('#selected-date-card').style.display = 'none';
  document.querySelector('#selected-date-revenue-card').style.display = 'none';
  renderTransactionStats();
  renderSalesHistory();
});

paymentMethodFilter.addEventListener('change', () => {
  filterPaymentMethod = paymentMethodFilter.value;
  renderTransactionStats();
  renderSalesHistory();
});

transactionStatusFilter.addEventListener('change', () => {
  filterStatus = transactionStatusFilter.value;
  renderTransactionStats();
  renderSalesHistory();
});

filterDatePicker.addEventListener('change', () => {
  const selectedDate = filterDatePicker.value;
  if (selectedDate) {
    selectedFilterDate = selectedDate;
    // Show selected date stat cards
    document.querySelector('#selected-date-card').style.display = '';
    document.querySelector('#selected-date-revenue-card').style.display = '';
    const dateLabel = document.querySelector('#selected-date-label');
    if (dateLabel) dateLabel.textContent = new Date(selectedDate).toLocaleDateString();
  } else {
    selectedFilterDate = null;
    // Hide selected date stat cards
    document.querySelector('#selected-date-card').style.display = 'none';
    document.querySelector('#selected-date-revenue-card').style.display = 'none';
  }
  renderTransactionStats();
  renderSalesHistory();
});

categoryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const nameInput = document.querySelector('#category-name');
  const value = nameInput.value.trim();
  if (!value) {
    showToast('Enter a category name', 'error');
    return;
  }

  state.categories.push({ id: createId('cat'), name: value });
  nameInput.value = '';
  saveState();
  buildCategoryOptions();
  renderAll();
  categoryForm.classList.add('hidden');
  showToast('✓ Category saved');
});

customItemForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = customItemName.value.trim();
  const price = Number(customItemPrice.value);
  if (!name || !Number.isFinite(price) || price < 0) return;

  state.bill.push({ id: createId('custom'), custom: true, name, price, quantity: 1 });
  customItemForm.reset();
  saveState();
  renderBill();
});

productForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const productId = document.querySelector('#product-id').value;
  const name = document.querySelector('#product-name').value.trim();
  const categoryId = document.querySelector('#product-category').value;
  const price = Number(document.querySelector('#product-price').value);

  if (!name || !categoryId || !price || price <= 0) {
    showToast('Enter a name, category, and valid price', 'error');
    return;
  }

  if (productId) {
    const match = state.products.find((product) => product.id === productId);
    if (match) {
      match.name = name;
      match.categoryId = categoryId;
      match.price = price;
    }
  } else {
    state.products.push({
      id: createId('prod'),
      name,
      categoryId,
      price
    });
  }

  productForm.reset();
  document.querySelector('#product-id').value = '';
  document.querySelector('#product-submit-button').textContent = 'Add product';
  document.querySelector('#product-price').value = '100';
  saveState();
  renderAll();
  productForm.classList.add('hidden');
  showToast(productId ? '✓ Product updated' : '✓ Product added');
});

searchInput.addEventListener('input', (event) => {
  searchText = event.target.value;
  renderProducts();
});

document.querySelector('#toggle-category-form').addEventListener('click', () => {
  categoryForm.classList.toggle('hidden');
  if (!categoryForm.classList.contains('hidden')) {
    document.querySelector('#category-name').focus();
  }
});

document.querySelector('#toggle-product-form').addEventListener('click', () => {
  productForm.classList.toggle('hidden');
  if (!productForm.classList.contains('hidden')) {
    document.querySelector('#product-id').value = '';
    document.querySelector('#product-submit-button').textContent = 'Add product';
    document.querySelector('#product-name').focus();
  }
});

document.querySelector('#complete-sale').addEventListener('click', completeSale);

categorySortInput.addEventListener('change', () => {
  categorySort = categorySortInput.value;
  renderAll();
});

function changeProductSort(value) {
  productSort = value;
  dashboardProductSortInput.value = value;
  catalogProductSortInput.value = value;
  renderAll();
}

dashboardProductSortInput.addEventListener('change', () => changeProductSort(dashboardProductSortInput.value));
catalogProductSortInput.addEventListener('change', () => changeProductSort(catalogProductSortInput.value));

function exportTransactionsPDF() {
  const filteredSales = getFilteredSales();
  if (filteredSales.length === 0) {
    alert('No transactions to export. Apply filters and try again.');
    return;
  }

  const businessName = state.settings.businessName || 'Xtra Zone Billing';
  const currency = state.settings.currency || 'Rs';
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let tableRows = '';
  let totalRevenue = 0;

  filteredSales.forEach((sale) => {
    const itemCount = getSaleItems(sale).reduce((sum, item) => sum + item.quantity, 0);
    const saleDate = new Date(sale.createdAt).toLocaleDateString('en-IN', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    totalRevenue += sale.total;

    tableRows += `
      <tr>
        <td>${String(sale.number || '').padStart(4, '0')}</td>
        <td>${saleDate}</td>
        <td>${sale.paymentMethod || '-'}</td>
        <td style="text-align:center">${itemCount}</td>
        <td style="text-align:right">${currency} ${sale.total}</td>
        <td>${sale.status || '-'}</td>
      </tr>
    `;
  });

  const dateRangeLabel = filterDateRange === 'today' ? 'Today' : 'All Time';
  const paymentLabel = filterPaymentMethod ? ` (${filterPaymentMethod})` : '';
  const statusLabel = filterStatus ? ` (${filterStatus})` : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Transaction Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
        .header { margin-bottom: 30px; }
        .business-name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .report-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .report-meta { font-size: 12px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #f5f5f5; padding: 12px; text-align: left; border-bottom: 2px solid #ddd; font-weight: bold; }
        td { padding: 10px 12px; border-bottom: 1px solid #eee; }
        tr:hover { background: #f9f9f9; }
        .summary { margin-top: 30px; padding-top: 20px; border-top: 2px solid #ddd; }
        .summary-row { display: flex; justify-content: space-between; margin: 10px 0; font-size: 14px; }
        .summary-row.total { font-size: 16px; font-weight: bold; color: #2c5f2d; }
        @media print {
          body { margin: 0; }
          table { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="business-name">${escapeHtml(businessName)}</div>
        <div class="report-title">Transaction Report</div>
        <div class="report-meta">
          <div>Generated: ${dateStr}</div>
          <div>Period: ${dateRangeLabel}${paymentLabel}${statusLabel}</div>
          <div>Total Records: ${filteredSales.length}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Sale #</th>
            <th>Date & Time</th>
            <th>Payment Method</th>
            <th style="text-align:center">Items</th>
            <th style="text-align:right">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>Total Transactions:</span>
          <span>${filteredSales.length}</span>
        </div>
        <div class="summary-row total">
          <span>Total Revenue:</span>
          <span>${currency} ${totalRevenue}</span>
        </div>
      </div>
    </body>
    </html>
  `;

  if (isNativeApp()) {
    showHtmlDocumentModal(html);
    return;
  }

  const printWindow = window.open('', 'TransactionPDF');
  if (!printWindow) {
    window.alert('Allow pop-ups to export the PDF.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

const exportPdfBtn = document.querySelector('#export-pdf-btn');
if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', exportTransactionsPDF);
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelector('#new-bill').addEventListener('click', () => {
  state.bill = [];
  saveState();
  renderBill();
  renderProducts();
  setView('sell');
  billPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#go-to-cart').addEventListener('click', () => {
  billPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Thermal printer settings
const printerIPInput = document.querySelector('#printer-ip-input');
const savePrinterBtn = document.querySelector('#save-printer-btn');
const testPrinterBtn = document.querySelector('#test-printer-btn');
const clearPrinterBtn = document.querySelector('#clear-printer-btn');
const printerStatusDiv = document.querySelector('#printer-status');

// Load printer IP from Firebase or localStorage (with retry)
async function loadPrinterIP() {
  let printerIP = localStorage.getItem('printer-ip');
  if (printerIPInput && printerIP) {
    printerIPInput.value = printerIP;
  }

  if (!firebaseReady || !isOnline) {
    console.log('Firebase not ready or offline, using localStorage only');
    return;
  }

  // Try to fetch from Firebase with retries
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const firebaseIP = await fetchPrinterIPFromFirebase();
      if (firebaseIP && firebaseIP !== printerIP) {
        printerIP = firebaseIP;
        if (printerIPInput) printerIPInput.value = firebaseIP;
        localStorage.setItem('printer-ip', firebaseIP);
        console.log('✓ Printer IP loaded from Firebase:', firebaseIP);
      }
      return; // Success, exit
    } catch (err) {
      if (attempt === 3) {
        console.warn('Failed to fetch printer IP from Firebase after 3 attempts:', err);
      } else {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}

// Fetch printer IP from Firebase
async function fetchPrinterIPFromFirebase() {
  const docPath = `${FIRESTORE_API_URL}/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_COLLECTION}/${SHOP_ID}`;

  try {
    const response = await fetch(`${docPath}?key=${firebaseConfig.apiKey}`);
    if (!response.ok) return null;

    const data = await response.json();
    return data.fields?.printerIP?.stringValue || null;
  } catch (err) {
    console.error('Error fetching printer IP from Firebase:', err);
    return null;
  }
}

// Save printer IP to Firebase
async function savePrinterIPToFirebase(ip) {
  if (!firebaseReady || !isOnline) {
    console.log('Firebase not ready or offline, printer IP saved to localStorage only');
    return;
  }

  const docPath = `${FIRESTORE_API_URL}/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_COLLECTION}/${SHOP_ID}`;

  try {
    const response = await fetch(`${docPath}?key=${firebaseConfig.apiKey}&updateMask.fieldPaths=printerIP`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          printerIP: { stringValue: ip }
        }
      })
    });

    if (response.ok) {
      console.log('✓ Printer IP saved to Firebase');
    }
  } catch (err) {
    console.error('Error saving printer IP to Firebase:', err);
  }
}

if (printerIPInput) {
  // Initialize printer IP load (don't block page load)
  loadPrinterIP().catch(err => console.error('Failed to load printer IP:', err));

  if (savePrinterBtn) {
    printerIPInput.addEventListener('input', () => savePrinterBtn.classList.add('has-changes'));
  }
}

if (savePrinterBtn) {
  savePrinterBtn.addEventListener('click', async () => {
    const ip = printerIPInput.value.trim();

    if (!ip) {
      showPrinterStatus('Please enter a valid IP address', 'error');
      showToast('Enter a valid IP address', 'error');
      return;
    }

    if (!isValidIP(ip)) {
      showPrinterStatus('Invalid IP format. Use: 192.168.1.100', 'error');
      showToast('Invalid IP format', 'error');
      return;
    }

    localStorage.setItem('printer-ip', ip);
    await savePrinterIPToFirebase(ip);
    savePrinterBtn.classList.remove('has-changes');
    showPrinterStatus(`✓ Printer IP saved: ${ip}`, 'success');
    showToast('✓ Printer IP saved');
  });
}

if (testPrinterBtn) {
  testPrinterBtn.addEventListener('click', () => {
    const ip = printerIPInput.value.trim();

    if (!ip) {
      showPrinterStatus('Enter printer IP address first', 'error');
      return;
    }

    showPrinterStatus('Testing connection...', 'info');

    if (isNativeApp()) {
      window.Capacitor.Plugins.ThermalPrinter.testConnection({ ip, port: 9100 })
        .then(() => {
          showPrinterStatus('✓ Printer connected! Ready to print.', 'success');
        })
        .catch(() => {
          showPrinterStatus('✗ Printer not found. Check IP and WiFi.', 'error');
        });
      return;
    }

    // Browser: test with timeout
    let timeoutId = setTimeout(() => {
      showPrinterStatus('✗ Printer not responding (timeout). Check IP and WiFi.', 'error');
    }, 3000);

    fetch(`http://${ip}:9100`, {
      method: 'POST',
      mode: 'no-cors',
      body: 'TEST\n\n',
      signal: AbortSignal.timeout(3000)
    })
    .then(() => {
      clearTimeout(timeoutId);
      showPrinterStatus('✓ Printer connected! Ready to print.', 'success');
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      console.warn('Printer test failed:', err);
      showPrinterStatus('✗ Printer not found. Check IP and WiFi. (Note: Website may need app for thermal printing)', 'error');
    });
  });
}

if (clearPrinterBtn) {
  clearPrinterBtn.addEventListener('click', async () => {
    printerIPInput.value = '';
    localStorage.removeItem('printer-ip');
    await savePrinterIPToFirebase(''); // Save empty string to clear from Firebase
    showPrinterStatus('Printer IP cleared. Will use browser printing.', 'success');
  });
}

function isValidIP(ip) {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => parseInt(part) <= 255);
}

function showPrinterStatus(message, type) {
  if (!printerStatusDiv) return;

  printerStatusDiv.textContent = message;
  printerStatusDiv.style.display = 'block';

  if (type === 'success') {
    printerStatusDiv.style.background = '#d4edda';
    printerStatusDiv.style.color = '#155724';
    printerStatusDiv.style.border = '1px solid #c3e6cb';
  } else if (type === 'error') {
    printerStatusDiv.style.background = '#f8d7da';
    printerStatusDiv.style.color = '#721c24';
    printerStatusDiv.style.border = '1px solid #f5c6cb';
  } else {
    printerStatusDiv.style.background = '#d1ecf1';
    printerStatusDiv.style.color = '#0c5460';
    printerStatusDiv.style.border = '1px solid #bee5eb';
  }
}

buildCategoryOptions();
renderAll();
setView(currentView);

trackFormDirtyState(settingsForm);
trackFormDirtyState(productForm);
trackFormDirtyState(categoryForm);

// Initialize Firebase sync on startup
(async () => {
  updateSyncStatus();
  if (isOnline) {
    try {
      const firebaseData = await loadFromFirebase();
      if (firebaseData && (firebaseData.products.length > 0 || firebaseData.categories.length > 0)) {
        // Merge Firebase data but preserve local bill
        const localBill = state.bill;
        Object.assign(state, firebaseData);
        state.bill = localBill;
        saveState();
        renderAll();
      }
    } catch (error) {
      console.error('Initial Firebase load failed:', error);
    }
  }
})();
