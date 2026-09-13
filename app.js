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
    taxLabel: 'Tax'
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
  syncToFirebase();
}

async function syncToFirebase() {
  if (!isOnline || isSyncing || !firebaseReady) return;

  isSyncing = true;
  updateSyncStatus();

  try {
    const url = `${FIRESTORE_API_URL}/${firebaseConfig.projectId}/databases/(default)/documents/${FIREBASE_COLLECTION}/${SHOP_ID}?key=${firebaseConfig.apiKey}`;

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
          price: { integerValue: String(prod.price) },
          stock: { integerValue: String(prod.stock) }
        } } })) } },
        sales: { arrayValue: { values: state.sales.map(sale => ({ mapValue: { fields: {
          id: { stringValue: sale.id },
          number: { integerValue: String(sale.number) },
          total: { integerValue: String(sale.total) },
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
        console.log('✓ Data loaded from Firebase');

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
            price: Number(v.mapValue.fields.price.integerValue),
            stock: Number(v.mapValue.fields.stock.integerValue)
          })),
          sales: parseArray(fields.sales, v => ({
            id: v.mapValue.fields.id.stringValue,
            number: Number(v.mapValue.fields.number.integerValue),
            total: Number(v.mapValue.fields.total.integerValue),
            createdAt: v.mapValue.fields.createdAt.stringValue
          })),
          bill: []
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

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const subtotal = state.bill.reduce((sum, item) => {
    const product = getProductById(item.productId);
    const price = item.custom ? item.price : product?.price;
    return sum + (price ? price * item.quantity : 0);
  }, 0);

  const taxRate = getTaxRateValue();
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  return { subtotal, tax, total, taxRate };
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

function ensureProductStock(productId, requestedQty = 1) {
  const product = getProductById(productId);
  if (!product) return false;

  const currentBillQty = state.bill
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);

  return currentBillQty + requestedQty <= product.stock;
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
    if (productSort === 'stock-asc') return first.stock - second.stock;
    if (productSort === 'stock-desc') return second.stock - first.stock;
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
    increase.disabled = product.stock <= getBillQuantity(product.id);
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
  table.innerHTML = '<thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');
  sortProducts(state.products).forEach((product) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(getCategoryName(product.categoryId))}</td><td>${escapeHtml(currency(product.price))}</td><td>${product.stock}</td><td></td>`;
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
  document.querySelector('#product-stock').value = product.stock;
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

  if (product.stock <= 0) {
    window.alert('This product is out of stock.');
    return;
  }

  const existingQty = state.bill.find((item) => item.productId === productId)?.quantity || 0;
  if (existingQty + 1 > product.stock) {
    window.alert(`Only ${product.stock} item(s) remain in stock.`);
    return;
  }

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
    if (!item.custom && !ensureProductStock(item.productId, 1)) {
      window.alert('There is not enough stock for another item.');
      return;
    }
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
  const orderCount = state.sales.length;
  const today = new Date().toDateString();
  const todayRevenue = state.sales
    .filter((sale) => new Date(sale.createdAt).toDateString() === today)
    .reduce((sum, sale) => sum + sale.total, 0);

  orderCountEl.textContent = String(orderCount);
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
    const dateMatch = filterDateRange !== 'today' || new Date(sale.createdAt).toDateString() === today;
    const paymentMatch = !filterPaymentMethod || sale.paymentMethod === filterPaymentMethod;
    const statusMatch = !filterStatus || sale.status === filterStatus;
    return dateMatch && paymentMatch && statusMatch;
  });
}

function renderTransactionStats() {
  const filteredSales = getFilteredSales();
  const today = new Date().toDateString();
  const todaySales = state.sales.filter(s => new Date(s.createdAt).toDateString() === today);

  const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);

  if (statTotalSales) statTotalSales.textContent = String(state.sales.length);
  if (statTotalRevenue) statTotalRevenue.textContent = currency(state.sales.reduce((sum, s) => sum + s.total, 0));
  if (statTodaySales) statTodaySales.textContent = String(todaySales.length);
  if (statTodayRevenue) statTodayRevenue.textContent = currency(todayRevenue);
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
    const statusBadge = sale.status ? `<span style="font-size:0.8rem;padding:2px 8px;border-radius:4px;background:${sale.status === 'Paid' ? '#e8f5e9' : sale.status === 'Pending' ? '#fff3cd' : '#ffebee'};color:${sale.status === 'Paid' ? '#2e7d32' : sale.status === 'Pending' ? '#856404' : '#c62828'}">${sale.status}</span>` : '';
    const reasonText = sale.reason ? `<div style="font-size:0.85rem;color:#666;margin-top:4px">💬 ${escapeHtml(sale.reason)}</div>` : '';

    row.innerHTML = `
      <div>
        <strong>Sale #${String(sale.number || '').padStart(4, '0')}</strong>
        <span>${escapeHtml(saleDate(sale))} · ${escapeHtml(sale.paymentMethod)} ${statusBadge}</span>
        ${reasonText}
      </div>
      <div class="sale-row-meta">
        <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
        <strong>${escapeHtml(formatSaleCurrency(sale, sale.total))}</strong>
        <button class="mini-btn" type="button" data-receipt-id="${sale.id}">Receipt</button>
      </div>
    `;
    salesHistory.appendChild(row);
  });

  salesHistory.querySelectorAll('[data-receipt-id]').forEach((button) => {
    button.addEventListener('click', () => printReceipt(button.dataset.receiptId));
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

  const receiptWindow = window.open('', '_blank', 'width=400,height=600');
  if (!receiptWindow) {
    window.alert('Allow pop-ups to print the receipt.');
    return;
  }

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
    window.onload = () => window.print();
  </script>
</body>
</html>`;

  receiptWindow.document.write(receiptHtml);
  receiptWindow.document.close();
}

function completeSale() {
  if (!state.bill.length) return;

  const stockIssue = state.bill.some((item) => {
    if (item.custom) return false;
    const product = getProductById(item.productId);
    return product && item.quantity > product.stock;
  });

  if (stockIssue) {
    window.alert('Stock does not allow this sale. Reduce quantities and try again.');
    return;
  }

  const { subtotal, tax, total } = getCurrentTotals();
  const saleNumber = state.sales.length + 1;

  state.bill.forEach((item) => {
    if (item.custom) return;
    const product = getProductById(item.productId);
    if (!product) return;
    product.stock = Math.max(0, product.stock - item.quantity);
  });

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
    taxLabel: (taxLabelInput.value || 'Tax').trim() || 'Tax'
  };

  saveState();
  renderAll();
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

categoryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const nameInput = document.querySelector('#category-name');
  const value = nameInput.value.trim();
  if (!value) return;

  state.categories.push({ id: createId('cat'), name: value });
  nameInput.value = '';
  saveState();
  buildCategoryOptions();
  renderAll();
  categoryForm.classList.add('hidden');
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
  const stock = Number(document.querySelector('#product-stock').value);

  if (!name || !categoryId || !price || price <= 0) return;

  if (productId) {
    const match = state.products.find((product) => product.id === productId);
    if (match) {
      match.name = name;
      match.categoryId = categoryId;
      match.price = price;
      match.stock = Math.max(0, stock);
    }
  } else {
    state.products.push({
      id: createId('prod'),
      name,
      categoryId,
      price,
      stock: Math.max(0, stock)
    });
  }

  productForm.reset();
  document.querySelector('#product-id').value = '';
  document.querySelector('#product-submit-button').textContent = 'Add product';
  document.querySelector('#product-price').value = '100';
  document.querySelector('#product-stock').value = '0';
  saveState();
  renderAll();
  productForm.classList.add('hidden');
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

document.querySelector('#reset-data').addEventListener('click', () => {
  const confirmReset = window.confirm('Clear all local products, categories, sales, and the current bill?');
  if (!confirmReset) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, structuredClone(defaultState));
  activeCategory = 'all';
  searchText = '';
  searchInput.value = '';
  buildCategoryOptions();
  renderAll();
});

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

buildCategoryOptions();
renderAll();
setView(currentView);

// Initialize Firebase sync on startup
(async () => {
  updateSyncStatus();
  if (isOnline) {
    try {
      const firebaseData = await loadFromFirebase();
      if (firebaseData && (firebaseData.products.length > 0 || firebaseData.categories.length > 0)) {
        Object.assign(state, firebaseData);
        saveState();
        renderAll();
      }
    } catch (error) {
      console.error('Initial Firebase load failed:', error);
    }
  }
})();
