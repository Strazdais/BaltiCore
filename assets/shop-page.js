/**
 * Shop Page — Hydrox Workwear
 *
 * Reads real Shopify product data from a Liquid-generated JSON script tag.
 * Parses "Category: Value" tags (e.g. "Industry: Welding", "Gender: Men").
 * Filter groups are built dynamically from whatever tags exist on your products.
 *
 * Features:
 * - Dynamic filter sidebar + mobile drawer
 * - Sort dropdown (featured / price / newest / best-selling)
 * - URL param sync (collection, product, filters, sort)
 * - Quick-view drawer
 * - Load-more pagination
 */

(function () {
  'use strict';

  /* ============================================================
     LOAD PRODUCT DATA FROM SHOPIFY (Liquid JSON)
     ============================================================ */

  /**
   * Convert raw product JSON objects into our internal format.
   * @param {Array} raw  - Array of product objects from Liquid JSON
   * @param {number} startIndex - Starting index for featured ordering
   */
  function mapProducts(raw, startIndex) {
    return raw.map(function (p, i) {
      return {
        id: String(p.id),
        handle: p.handle,
        name: p.name,
        vendor: p.vendor || '',
        url: p.url || ('/products/' + p.handle),
        price: p.price,
        comparePrice: p.comparePrice,
        available: p.available,
        image: p.image || 'https://placehold.co/600x800/e8eaed/6b7280?text=No+Image',
        imageAlt: p.imageAlt || p.image || null,
        rawTags: p.tags || [],
        parsedTags: parseTags(p.tags || []),
        type: p.type || '',
        createdAt: p.createdAt || '',
        variants: p.variants || [],
        featured: startIndex + i,
        badge: getBadge(p)
      };
    });
  }

  function loadShopifyProducts() {
    var el = document.getElementById('shopify-product-data');
    if (!el) return [];

    try {
      var raw = JSON.parse(el.textContent);
      return mapProducts(raw, 0);
    } catch (e) {
      console.error('Shop page: failed to parse product data', e);
      return [];
    }
  }

  /**
   * Read pagination metadata embedded by Liquid.
   * Returns { currentPage, totalPages, totalProducts } or null.
   */
  function loadPaginationInfo() {
    var el = document.getElementById('shopify-product-pagination');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch remaining product pages (2, 3, …) asynchronously via the
   * Shopify Section Rendering API. Each page returns a full HTML fragment
   * from which we extract the JSON product data.
   */
  function fetchRemainingPages(totalPages, callback) {
    var remaining = totalPages - 1;
    if (remaining <= 0) return callback([]);

    var allExtra = [];
    var done = 0;

    // Find the section ID for the Section Rendering API
    var sectionEl = document.querySelector('.shopify-section[id*="main-shop"]');
    var sId = sectionEl ? sectionEl.id.replace('shopify-section-', '') : 'main-shop';

    for (var page = 2; page <= totalPages; page++) {
      (function (pg) {
        // Use Shopify Section Rendering API: returns only this section's HTML
        var url = window.location.pathname + '?page=' + pg + '&sections=' + sId;

        fetch(url)
          .then(function (res) { return res.json(); })
          .then(function (json) {
            var products = [];
            try {
              var html = json[sId] || '';
              var parser = new DOMParser();
              var doc = parser.parseFromString(html, 'text/html');
              var dataEl = doc.getElementById('shopify-product-data');
              if (dataEl) {
                var raw = JSON.parse(dataEl.textContent);
                products = mapProducts(raw, (pg - 1) * 50);
              }
            } catch (e) {
              console.warn('Shop page: failed to parse page ' + pg, e);
            }
            allExtra = allExtra.concat(products);
            done++;
            if (done >= remaining) callback(allExtra);
          })
          .catch(function (err) {
            console.warn('Shop page: failed to fetch page ' + pg, err);
            done++;
            if (done >= remaining) callback(allExtra);
          });
      })(page);
    }
  }

  /**
   * Parse Shopify tags in "Category: Value" format.
   * Returns an object like { "Industry": ["Welding"], "Gender": ["Men", "Women"] }
   * Tags without a colon are grouped under "Other".
   */
  function parseTags(tags) {
    var result = {};
    tags.forEach(function (tag) {
      var colonIndex = tag.indexOf(':');
      var category, value;
      if (colonIndex > 0) {
        category = tag.substring(0, colonIndex).trim();
        value = tag.substring(colonIndex + 1).trim();
      } else {
        category = 'Other';
        value = tag.trim();
      }
      if (!value) return;
      if (!result[category]) result[category] = [];
      if (result[category].indexOf(value) === -1) {
        result[category].push(value);
      }
    });
    return result;
  }

  /** Determine badge from product data */
  function getBadge(p) {
    if (p.comparePrice && p.comparePrice > p.price) return 'sale';
    // Check for "new" — created in last 30 days
    if (p.createdAt) {
      var created = new Date(p.createdAt);
      var thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (created > thirtyDaysAgo) return 'new';
    }
    return null;
  }

  /* ============================================================
     BUILD FILTER GROUPS DYNAMICALLY FROM PRODUCT TAGS
     ============================================================ */

  /**
   * Preferred category ordering. Categories found in products but not
   * listed here will appear at the end in alphabetical order.
   * The key is what appears before the colon in tags.
   */
  var PREFERRED_ORDER = [
    'Gender',
    'Product Type',
    'Protection',
    'Industry',
    'Material',
    'Season',
    'Certification'
  ];

  /** Categories hidden from filters (duplicates, uncategorised tags, etc.) */
  var HIDDEN_CATEGORIES = ['Other', 'Type'];

  /**
   * Pre-defined tag values for categories that should always appear in the
   * filter sidebar, even before any products are tagged. Values discovered
   * on actual products are merged in automatically so there is no duplication.
   * Categories NOT listed here still appear dynamically when products carry
   * those tags — this list only guarantees visibility for specific groups.
   */
  var PREDEFINED_VALUES = {
    'Product Type': [
      'Jackets', 'Softshell Jackets', 'Rain Jackets', 'Winter Jackets',
      'Trousers', 'Shorts', 'Bib Overalls', 'Coveralls',
      'T-Shirts', 'Base Layers', 'Hoodies', 'Sweatshirts',
      'Vests', 'Hats', 'Rainwear', 'Fleece', 'Thermal Wear'
    ],
    'Season': [
      'All Season', 'Winter', 'Summer'
    ]
  };

  function buildFilterGroups(products) {
    // Collect all category → unique values from all products
    var categoryMap = {};
    products.forEach(function (product) {
      var tags = product.parsedTags;
      for (var cat in tags) {
        if (HIDDEN_CATEGORIES.indexOf(cat) !== -1) continue;
        if (!categoryMap[cat]) categoryMap[cat] = {};
        tags[cat].forEach(function (val) {
          categoryMap[cat][val] = true;
        });
      }
    });

    // Merge pre-defined values (ensures categories always appear)
    for (var cat in PREDEFINED_VALUES) {
      if (!categoryMap[cat]) categoryMap[cat] = {};
      PREDEFINED_VALUES[cat].forEach(function (val) {
        if (!categoryMap[cat][val]) categoryMap[cat][val] = true;
      });
    }

    // Build ordered list
    var groups = [];
    var used = {};

    PREFERRED_ORDER.forEach(function (cat) {
      if (categoryMap[cat]) {
        groups.push({
          key: cat,
          label: cat,
          values: Object.keys(categoryMap[cat]).sort()
        });
        used[cat] = true;
      }
    });

    // Remaining categories not in preferred order
    Object.keys(categoryMap).sort().forEach(function (cat) {
      if (!used[cat]) {
        groups.push({
          key: cat,
          label: cat,
          values: Object.keys(categoryMap[cat]).sort()
        });
      }
    });

    return groups;
  }

  /* ============================================================
     COLLECTION MAP (URL entry state)
     ============================================================ */

  var COLLECTION_MAP = {
    // Protection
    'hi-vis':          { key: 'Protection', value: 'Hi-Vis' },
    'flame-resistant': { key: 'Protection', value: 'Flame Resistant' },
    'arc-flash':       { key: 'Protection', value: 'Arc Flash' },
    // Industry
    'workwear':        { key: 'Industry',   value: 'Workwear' },
    'welding':         { key: 'Industry',   value: 'Welding' },
    'chemical':        { key: 'Industry',   value: 'Chemical' },
    'oil-gas':         { key: 'Industry',   value: 'Oil & Gas' },
    'manufacturing':   { key: 'Industry',   value: 'Manufacturing' },
    'automotive':      { key: 'Industry',   value: 'Automotive' },
    'construction':    { key: 'Industry',   value: 'Construction' },
    'railway':         { key: 'Industry',   value: 'Railway' },
    'electricians':    { key: 'Industry',   value: 'Electricians' },
    // Product Type
    'trousers':        { key: 'Product Type', value: 'Trousers' },
    'pants':           { key: 'Product Type', value: 'Trousers' },
    'jackets':         { key: 'Product Type', value: 'Jackets' },
    'hoodies':         { key: 'Product Type', value: 'Hoodies' },
    'coveralls':       { key: 'Product Type', value: 'Coveralls' },
    'shorts':          { key: 'Product Type', value: 'Shorts' },
    'vests':           { key: 'Product Type', value: 'Vests' },
    'hats':            { key: 'Product Type', value: 'Hats' },
    // Season
    'winter':          { key: 'Season',     value: 'Winter' },
    'summer':          { key: 'Season',     value: 'Summer' }
  };

  var COLLECTION_TITLES = {
    'hi-vis':          'Hi-Vis Collection',
    'flame-resistant': 'Flame Resistant',
    'arc-flash':       'Arc Flash Protection',
    'workwear':        'Workwear',
    'welding':         'Welding Gear',
    'chemical':        'Chemical Protection',
    'oil-gas':         'Oil & Gas Workwear',
    'manufacturing':   'Manufacturing Workwear',
    'automotive':      'Automotive Workwear',
    'construction':    'Construction Workwear',
    'railway':         'Railway Workwear',
    'electricians':    'Electricians Workwear',
    'trousers':        'Trousers',
    'pants':           'Trousers',
    'jackets':         'Jackets',
    'hoodies':         'Hoodies',
    'coveralls':       'Coveralls',
    'shorts':          'Shorts',
    'vests':           'Vests',
    'hats':            'Hats',
    'winter':          'Winter Workwear',
    'summer':          'Summer Workwear'
  };

  /* ============================================================
     STATE
     ============================================================ */

  var ITEMS_PER_PAGE = 12;
  var PRODUCTS = [];
  var FILTER_GROUPS = [];

  var state = {
    activeFilters: {},
    sort: 'featured',
    collection: null,
    highlightProduct: null,
    currentPage: 1,
    showSavedOnly: false
  };

  /* ============================================================
     WISHLIST (localStorage)
     ============================================================ */

  var savedProducts = JSON.parse(localStorage.getItem('shopWishlist') || '[]');

  function toggleWishlist(productId) {
    var idx = savedProducts.indexOf(productId);
    if (idx === -1) {
      savedProducts.push(productId);
    } else {
      savedProducts.splice(idx, 1);
    }
    localStorage.setItem('shopWishlist', JSON.stringify(savedProducts));
    updateWishlistCount();
  }

  function updateWishlistCount() {
    var el = document.getElementById('shopWishlistCount');
    if (el) el.textContent = savedProducts.length > 0 ? savedProducts.length : '';
  }

  /* ============================================================
     SEARCH STATE
     ============================================================ */

  var searchTerm = '';
  var searchTimeout = null;

  function searchProducts(products, term) {
    if (!term) return products;
    var lower = term.toLowerCase();
    return products.filter(function (p) {
      if (p.name.toLowerCase().indexOf(lower) !== -1) return true;
      if (p.vendor.toLowerCase().indexOf(lower) !== -1) return true;
      for (var i = 0; i < p.rawTags.length; i++) {
        if (p.rawTags[i].toLowerCase().indexOf(lower) !== -1) return true;
      }
      return false;
    });
  }

  /* ============================================================
     BACK TO TOP BUTTON
     ============================================================ */

  function injectBackToTop() {
    var btn = document.createElement('button');
    btn.id = 'shopBackToTop';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
    document.body.appendChild(btn);

    var style = document.createElement('style');
    style.textContent = '#shopBackToTop{position:fixed;bottom:24px;right:24px;z-index:999;width:44px;height:44px;border-radius:50%;border:1px solid #ccc;background:rgba(255,255,255,0.95);color:#333;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);transition:opacity .2s,transform .2s;}#shopBackToTop:hover{background:#333;color:#fff;border-color:#333;}';
    document.head.appendChild(style);

    window.addEventListener('scroll', function () {
      btn.style.display = window.scrollY > 500 ? 'flex' : 'none';
    });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ============================================================
     WISHLIST + SEARCH STYLES
     ============================================================ */

  function injectExtraStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '.shop-card__wishlist{position:absolute;top:8px;right:8px;z-index:3;width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.9);color:#999;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;box-shadow:0 1px 4px rgba(0,0,0,0.1);}',
      '.shop-card__wishlist:hover{color:#e53e3e;transform:scale(1.1);}',
      '.shop-card__wishlist--active{color:#e53e3e;}',
      '.shop-card__media{position:relative;}',
      '.shop-search{position:relative;flex:1;min-width:200px;max-width:400px;}',
      '.shop-search__input{width:100%;padding:8px 36px 8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:#fff;transition:border-color .2s;}',
      '.shop-search__input:focus{outline:none;border-color:#333;}',
      '.shop-search__clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#999;padding:4px;display:none;line-height:1;}',
      '.shop-search__clear:hover{color:#333;}',
      '.shop-toolbar{flex-wrap:wrap;gap:8px;}',
      '.shop-wishlist-filter{display:flex;align-items:center;gap:6px;padding:6px 14px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:#666;transition:all .2s;}',
      '.shop-wishlist-filter:hover{border-color:#333;color:#333;}',
      '.shop-wishlist-filter--active{background:#333;color:#fff;border-color:#333;}',
      '.shop-wishlist-filter__count{font-weight:600;}'
    ].join('');
    document.head.appendChild(style);
  }

  /* ============================================================
     FILTER LOGIC
     ============================================================ */

  /**
   * Check if a product matches a single filter group.
   * A product's parsedTags[key] is an array of values.
   * The filter is satisfied if any selected value is in that array (OR within group).
   */
  function productMatchesGroup(product, groupKey, selectedValues) {
    var productValues = product.parsedTags[groupKey] || [];
    for (var i = 0; i < selectedValues.length; i++) {
      if (productValues.indexOf(selectedValues[i]) !== -1) return true;
    }
    return false;
  }

  /** Filter products: AND between groups, OR within group */
  function filterProducts(products, filters) {
    var activeKeys = [];
    for (var k in filters) {
      if (filters[k] && filters[k].length > 0) activeKeys.push(k);
    }
    if (activeKeys.length === 0) return products;

    return products.filter(function (product) {
      return activeKeys.every(function (key) {
        return productMatchesGroup(product, key, filters[key]);
      });
    });
  }

  /** Sort products */
  function sortProducts(products, sortKey) {
    var sorted = products.slice();
    switch (sortKey) {
      case 'price-asc':
        sorted.sort(function (a, b) { return a.price - b.price; });
        break;
      case 'price-desc':
        sorted.sort(function (a, b) { return b.price - a.price; });
        break;
      case 'newest':
        sorted.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        break;
      case 'best-selling':
        sorted.sort(function (a, b) { return a.featured - b.featured; });
        break;
      case 'featured':
      default:
        sorted.sort(function (a, b) { return a.featured - b.featured; });
        break;
    }
    return sorted;
  }

  /** Count products matching a filter value, excluding current group from active filters */
  function countForValue(allProducts, currentFilters, groupKey, value) {
    var otherFilters = {};
    for (var k in currentFilters) {
      if (k !== groupKey && currentFilters[k] && currentFilters[k].length) {
        otherFilters[k] = currentFilters[k];
      }
    }
    var baseFiltered = filterProducts(allProducts, otherFilters);
    return baseFiltered.filter(function (p) {
      var vals = p.parsedTags[groupKey] || [];
      return vals.indexOf(value) !== -1;
    }).length;
  }

  function totalActiveCount(filters) {
    var count = 0;
    for (var k in filters) {
      if (filters[k]) count += filters[k].length;
    }
    return count;
  }

  /* ============================================================
     URL PARAM SYNC
     ============================================================ */

  function readURLParams() {
    var params = new URLSearchParams(window.location.search);

    searchTerm = params.get('q') || '';
    state.collection = params.get('collection') || null;
    state.highlightProduct = params.get('product') || null;
    state.sort = params.get('sort') || 'featured';

    state.activeFilters = {};
    FILTER_GROUPS.forEach(function (group) {
      var val = params.get(group.key);
      if (val) {
        state.activeFilters[group.key] = val.split(',');
      }
    });

    // Apply collection pre-filter
    if (state.collection && COLLECTION_MAP[state.collection]) {
      var mapping = COLLECTION_MAP[state.collection];
      if (!state.activeFilters[mapping.key] || !state.activeFilters[mapping.key].length) {
        state.activeFilters[mapping.key] = [mapping.value];
      }
    }
  }

  function writeURLParams() {
    var params = new URLSearchParams();

    if (state.collection) params.set('collection', state.collection);
    if (state.sort && state.sort !== 'featured') params.set('sort', state.sort);

    FILTER_GROUPS.forEach(function (group) {
      if (state.activeFilters[group.key] && state.activeFilters[group.key].length) {
        params.set(group.key, state.activeFilters[group.key].join(','));
      }
    });

    if (searchTerm) params.set('q', searchTerm);
    var qs = params.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newUrl);
  }

  /* ============================================================
     HELPERS
     ============================================================ */

  function formatPrice(amount) {
    return '\u20ac' + amount.toFixed(2);
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function refreshCartSections() {
    fetch('/?sections=cart-drawer,cart-icon-bubble')
      .then(function (r) { return r.json(); })
      .then(function (sectionData) {
        var cartDrawer = document.querySelector('cart-drawer');

        // Update cart icon bubble (item count)
        if (sectionData['cart-icon-bubble']) {
          var bubble = document.getElementById('cart-icon-bubble');
          if (bubble) {
            var tmp2 = document.createElement('div');
            tmp2.innerHTML = sectionData['cart-icon-bubble'];
            var newBubble = tmp2.querySelector('#cart-icon-bubble');
            if (newBubble) bubble.innerHTML = newBubble.innerHTML;
          }
        }

        // Update cart drawer contents and open it
        if (sectionData['cart-drawer'] && cartDrawer) {
          var tmp = document.createElement('div');
          tmp.innerHTML = sectionData['cart-drawer'];
          var newDrawerInner = tmp.querySelector('#CartDrawer');
          var existingDrawer = document.getElementById('CartDrawer');
          if (newDrawerInner && existingDrawer) {
            existingDrawer.innerHTML = newDrawerInner.innerHTML;
          } else {
            // Fallback: replace entire cart-drawer element contents
            var newCDE = tmp.querySelector('cart-drawer');
            if (newCDE) cartDrawer.innerHTML = newCDE.innerHTML;
          }
          // Re-bind overlay close handler after innerHTML replacement
          var overlay = cartDrawer.querySelector('#CartDrawer-Overlay');
          if (overlay) {
            overlay.addEventListener('click', function () { cartDrawer.close(); });
          }
          // Re-bind escape key on the drawer
          cartDrawer.classList.remove('is-empty');
          // Open the cart drawer to show the user what was added
          setTimeout(function () {
            cartDrawer.classList.add('animate', 'active');
            document.body.classList.add('overflow-hidden');
          }, 100);
        }
      });
  }

  function buildTagSummary(parsedTags) {
    var parts = [];
    var show = ['Product Type', 'Protection', 'Certification', 'Season'];
    show.forEach(function (cat) {
      if (parsedTags[cat]) {
        parsedTags[cat].forEach(function (v) { parts.push(v); });
      }
    });
    return parts.join(' \u00b7 ');
  }

  /* ============================================================
     RENDER: FILTER SIDEBAR
     ============================================================ */

  function renderFilterGroups(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    FILTER_GROUPS.forEach(function (group, idx) {
      var div = document.createElement('div');
      div.className = 'shop-filter-group';
      div.dataset.open = idx < 3 ? 'true' : 'false';

      var listHTML = '';
      group.values.forEach(function (value) {
        var count = countForValue(PRODUCTS, state.activeFilters, group.key, value);
        var isChecked = state.activeFilters[group.key] && state.activeFilters[group.key].indexOf(value) !== -1;
        var isDisabled = count === 0 && !isChecked;
        var disabledClass = isDisabled ? ' shop-filter-group__label--disabled' : '';

        listHTML += '<li class="shop-filter-group__item">' +
          '<label class="shop-filter-group__label' + disabledClass + '">' +
          '<input type="checkbox" class="shop-filter-group__checkbox"' +
          ' data-group="' + escapeHTML(group.key) + '" data-value="' + escapeHTML(value) + '"' +
          (isChecked ? ' checked' : '') + (isDisabled ? ' disabled' : '') + '>' +
          '<span>' + escapeHTML(value) + '</span>' +
          '<span class="shop-filter-group__count">' + count + '</span>' +
          '</label></li>';
      });

      div.innerHTML =
        '<button class="shop-filter-group__toggle" type="button" aria-expanded="' + div.dataset.open + '">' +
        '<span>' + escapeHTML(group.label) + '</span>' +
        '<svg class="shop-filter-group__caret" width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5l3 3 3-3"/></svg>' +
        '</button>' +
        '<ul class="shop-filter-group__list">' + listHTML + '</ul>';

      container.appendChild(div);
    });

    // Bind toggle buttons
    container.querySelectorAll('.shop-filter-group__toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = this.closest('.shop-filter-group');
        var isOpen = group.dataset.open === 'true';
        group.dataset.open = isOpen ? 'false' : 'true';
        this.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // Bind checkboxes
    container.querySelectorAll('.shop-filter-group__checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var groupKey = this.dataset.group;
        var value = this.dataset.value;
        if (!state.activeFilters[groupKey]) state.activeFilters[groupKey] = [];

        if (this.checked) {
          if (state.activeFilters[groupKey].indexOf(value) === -1) {
            state.activeFilters[groupKey].push(value);
          }
        } else {
          state.activeFilters[groupKey] = state.activeFilters[groupKey].filter(function (v) { return v !== value; });
        }

        state.currentPage = 1;
        update();
      });
    });
  }

  /* ============================================================
     RENDER: ACTIVE FILTER PILLS
     ============================================================ */

  function renderActivePills() {
    ['shopActiveFilters', 'shopActiveFiltersMobile'].forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = '';

      FILTER_GROUPS.forEach(function (group) {
        if (!state.activeFilters[group.key]) return;
        state.activeFilters[group.key].forEach(function (value) {
          var pill = document.createElement('button');
          pill.className = 'shop-filter-pill';
          pill.type = 'button';
          pill.innerHTML = escapeHTML(value) + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          pill.addEventListener('click', function () {
            state.activeFilters[group.key] = state.activeFilters[group.key].filter(function (v) { return v !== value; });
            state.currentPage = 1;
            update();
          });
          container.appendChild(pill);
        });
      });
    });

    var clearBtn = document.getElementById('shopClearAllFilters');
    if (clearBtn) {
      clearBtn.style.display = totalActiveCount(state.activeFilters) > 0 ? '' : 'none';
    }
  }

  /* ============================================================
     RENDER: PRODUCT GRID
     ============================================================ */

  function renderCardSizeSelector(product) {
    if (!product.variants || product.variants.length <= 1) return '';
    var btns = product.variants.map(function (v) {
      var disabledAttr = v.available ? '' : ' disabled style="opacity:0.4;text-decoration:line-through;cursor:not-allowed;"';
      return '<button class="shop-card__size-btn" type="button" data-variant-id="' + v.id + '" data-variant-price="' + v.price + '"' + disabledAttr + '>' + escapeHTML(v.title) + '</button>';
    }).join('');
    return '<div class="shop-card__sizes" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">' + btns + '</div>';
  }

  // Inject size button styles once
  (function injectSizeStyles() {
    if (document.getElementById('shop-size-styles')) return;
    var style = document.createElement('style');
    style.id = 'shop-size-styles';
    style.textContent =
      '.shop-card__size-btn{padding:4px 10px;font-size:12px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;transition:all .15s;}' +
      '.shop-card__size-btn:hover:not(:disabled){border-color:#333;}' +
      '.shop-card__size-btn--active{background:#333;color:#fff;border-color:#333;}';
    document.head.appendChild(style);
  })();

  function renderProductCard(product) {
    var tagSummary = buildTagSummary(product.parsedTags);
    var hasSale = product.comparePrice && product.comparePrice > product.price;

    var badgeHTML = '';
    if (product.badge === 'sale') badgeHTML = '<span class="shop-card__badge shop-card__badge--sale">Sale</span>';
    else if (product.badge === 'new') badgeHTML = '<span class="shop-card__badge shop-card__badge--new">New</span>';

    var priceClass = hasSale ? 'shop-card__price shop-card__price--sale' : 'shop-card__price';
    var comparePriceHTML = hasSale ? '<span class="shop-card__compare-price">' + formatPrice(product.comparePrice) + '</span>' : '';

    var secondaryImgHTML = '';
    if (product.imageAlt && product.imageAlt !== product.image) {
      secondaryImgHTML = '<img class="shop-card__img shop-card__img--secondary" src="' + product.imageAlt + '" alt="' + escapeHTML(product.name) + ' alternate view" loading="lazy" width="600" height="800">';
    }

    var isHighlighted = state.highlightProduct === product.id;

    var isSaved = savedProducts.indexOf(product.id) !== -1;
    var heartClass = isSaved ? 'shop-card__wishlist shop-card__wishlist--active' : 'shop-card__wishlist';

    return '<div class="shop-card" role="listitem" data-product-id="' + product.id + '"' + (isHighlighted ? ' data-highlighted="true"' : '') + '>' +
      '<div class="shop-card__media">' +
        '<img class="shop-card__img shop-card__img--primary" src="' + product.image + '" alt="' + escapeHTML(product.name) + '" loading="lazy" width="600" height="800">' +
        secondaryImgHTML +
        badgeHTML +
        '<button class="' + heartClass + '" type="button" aria-label="Save ' + escapeHTML(product.name) + '" data-wishlist="' + product.id + '">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (isSaved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>' +
        '</button>' +
        '<button class="shop-card__quickview-trigger" type="button" aria-label="Quick view ' + escapeHTML(product.name) + '" data-quickview="' + product.id + '">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' +
        '</button>' +
      '</div>' +
      '<div class="shop-card__info">' +
        '<p class="shop-card__vendor">' + escapeHTML(product.vendor) + '</p>' +
        '<h3 class="shop-card__name">' + escapeHTML(product.name) + '</h3>' +
        (tagSummary ? '<p class="shop-card__tags">' + escapeHTML(tagSummary) + '</p>' : '') +
        '<div class="shop-card__price-row">' +
          '<span class="' + priceClass + '">' + formatPrice(product.price) + '</span>' +
          comparePriceHTML +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderGrid(products) {
    var grid = document.getElementById('shopProductGrid');
    var empty = document.getElementById('shopEmptyState');
    var pagination = document.getElementById('shopPagination');

    if (!grid) return;

    if (products.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      if (empty) empty.style.display = '';
      if (pagination) pagination.style.display = 'none';
      return;
    }

    grid.style.display = '';
    if (empty) empty.style.display = 'none';

    var visibleProducts = products.slice(0, state.currentPage * ITEMS_PER_PAGE);
    grid.innerHTML = visibleProducts.map(renderProductCard).join('');

    // Pagination
    var hasMore = visibleProducts.length < products.length;
    if (pagination) {
      pagination.style.display = hasMore ? '' : 'none';
      var info = document.getElementById('shopPaginationInfo');
      if (info) {
        info.textContent = 'Showing ' + visibleProducts.length + ' of ' + products.length + ' products';
      }
    }

    // Bind quick-view triggers
    grid.querySelectorAll('[data-quickview]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openQuickView(btn.dataset.quickview);
      });
    });

    // Bind card click to quick view
    grid.querySelectorAll('.shop-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.shop-card__wishlist') || e.target.closest('.shop-card__quickview-trigger')) return;
        openQuickView(card.dataset.productId);
      });
    });

    // Bind wishlist hearts
    grid.querySelectorAll('[data-wishlist]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleWishlist(btn.dataset.wishlist);
        update();
      });
    });

    // Scroll to highlighted product
    if (state.highlightProduct) {
      var highlighted = grid.querySelector('[data-product-id="' + state.highlightProduct + '"]');
      if (highlighted) {
        setTimeout(function () { highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
        setTimeout(function () { highlighted.removeAttribute('data-highlighted'); }, 3000);
      }
      state.highlightProduct = null;
    }
  }

  /* ============================================================
     RENDER: QUICK VIEW DRAWER
     ============================================================ */

  function openQuickView(productId) {
    var product = PRODUCTS.find(function (p) { return p.id === productId; });
    if (!product) return;

    var drawer = document.getElementById('shopQuickview');
    var content = document.getElementById('shopQuickviewContent');
    if (!drawer || !content) return;

    var hasSale = product.comparePrice && product.comparePrice > product.price;
    var priceClass = hasSale ? 'shop-quickview__price shop-quickview__price--sale' : 'shop-quickview__price';
    var comparePriceHTML = hasSale ? '<span class="shop-quickview__compare-price">' + formatPrice(product.comparePrice) + '</span>' : '';

    // All tags as pills
    var allTags = [];
    for (var cat in product.parsedTags) {
      product.parsedTags[cat].forEach(function (v) { allTags.push(v); });
    }
    var tagsHTML = allTags.map(function (t) { return '<li class="shop-quickview__tag">' + escapeHTML(t) + '</li>'; }).join('');

    // Variant sizes
    var sizesHTML = '';
    var hasMultipleVariants = product.variants.length > 1;
    if (product.variants.length > 0) {
      sizesHTML = product.variants.map(function (v, i) {
        var activeClass = (!hasMultipleVariants && i === 0) ? ' shop-quickview__size-btn--active' : '';
        var disabledAttr = v.available ? '' : ' disabled style="opacity:0.4;text-decoration:line-through;"';
        return '<button class="shop-quickview__size-btn' + activeClass + '" type="button" data-variant-id="' + v.id + '" data-variant-price="' + v.price + '"' + disabledAttr + '>' + escapeHTML(v.title) + '</button>';
      }).join('');
    }

    // Image thumbnails
    var thumbsHTML = '<img class="shop-quickview__thumb shop-quickview__thumb--active" src="' + product.image + '" alt="' + escapeHTML(product.name) + '" data-src="' + product.image + '">';
    if (product.imageAlt && product.imageAlt !== product.image) {
      thumbsHTML += '<img class="shop-quickview__thumb" src="' + product.imageAlt + '" alt="' + escapeHTML(product.name) + ' alt" data-src="' + product.imageAlt + '">';
    }

    content.innerHTML =
      '<img class="shop-quickview__image" src="' + product.image + '" alt="' + escapeHTML(product.name) + '" id="shopQuickviewMainImg">' +
      '<div class="shop-quickview__images">' + thumbsHTML + '</div>' +
      '<div class="shop-quickview__body">' +
        '<p class="shop-quickview__vendor">' + escapeHTML(product.vendor) + '</p>' +
        '<h2 class="shop-quickview__name">' + escapeHTML(product.name) + '</h2>' +
        '<ul class="shop-quickview__tags-list">' + tagsHTML + '</ul>' +
        '<div class="shop-quickview__price-row">' +
          '<span class="' + priceClass + '">' + formatPrice(product.price) + '</span>' +
          comparePriceHTML +
        '</div>' +
        (sizesHTML ? '<div class="shop-quickview__section">' +
          '<p class="shop-quickview__section-label">Size</p>' +
          '<div class="shop-quickview__sizes" id="shopQuickviewSizes">' + sizesHTML + '</div>' +
        '</div>' : '') +
        '<div class="shop-quickview__section">' +
          '<p class="shop-quickview__section-label">Quantity</p>' +
          '<div class="shop-quickview__quantity">' +
            '<button class="shop-quickview__qty-btn" type="button" id="shopQtyMinus">&minus;</button>' +
            '<input class="shop-quickview__qty-value" type="text" value="1" id="shopQtyInput" readonly>' +
            '<button class="shop-quickview__qty-btn" type="button" id="shopQtyPlus">+</button>' +
          '</div>' +
        '</div>' +
        '<button class="shop-quickview__add-btn" type="button" data-variant-id="' + (hasMultipleVariants ? '' : (product.variants[0] ? product.variants[0].id : product.id)) + '">' + (hasMultipleVariants ? 'Select Size' : 'Add to Cart') + '</button>' +
        '<a href="' + product.url + '" class="shop-quickview__view-full">View full product details</a>' +
      '</div>';

    // Bind thumbnail clicks
    content.querySelectorAll('.shop-quickview__thumb').forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        content.querySelectorAll('.shop-quickview__thumb').forEach(function (t) { t.classList.remove('shop-quickview__thumb--active'); });
        thumb.classList.add('shop-quickview__thumb--active');
        document.getElementById('shopQuickviewMainImg').src = thumb.dataset.src;
      });
    });

    // Bind size buttons
    var sizesContainer = document.getElementById('shopQuickviewSizes');
    if (sizesContainer) {
      sizesContainer.querySelectorAll('.shop-quickview__size-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          sizesContainer.querySelectorAll('.shop-quickview__size-btn').forEach(function (b) { b.classList.remove('shop-quickview__size-btn--active'); });
          btn.classList.add('shop-quickview__size-btn--active');
          // Update Add to Cart button with selected variant
          var addBtn = content.querySelector('.shop-quickview__add-btn');
          if (addBtn) {
            addBtn.dataset.variantId = btn.dataset.variantId;
            addBtn.textContent = 'Add to Cart';
          }
          // Update price display
          if (btn.dataset.variantPrice) {
            var priceEl = content.querySelector('.shop-quickview__price');
            if (priceEl) priceEl.textContent = formatPrice(parseFloat(btn.dataset.variantPrice));
          }
        });
      });
    }

    // Bind quantity
    var qtyInput = document.getElementById('shopQtyInput');
    var qtyMinus = document.getElementById('shopQtyMinus');
    var qtyPlus = document.getElementById('shopQtyPlus');
    if (qtyMinus) qtyMinus.addEventListener('click', function () {
      var v = parseInt(qtyInput.value, 10);
      if (v > 1) qtyInput.value = v - 1;
    });
    if (qtyPlus) qtyPlus.addEventListener('click', function () {
      var v = parseInt(qtyInput.value, 10);
      qtyInput.value = v + 1;
    });

    // Bind Add to Cart in quick view
    var qvAddBtn = content.querySelector('.shop-quickview__add-btn');
    if (qvAddBtn) {
      qvAddBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var variantId = qvAddBtn.dataset.variantId;
        if (!variantId) {
          qvAddBtn.textContent = '\u26a0 Select Size';
          setTimeout(function () { qvAddBtn.textContent = 'Select Size'; }, 1500);
          return;
        }
        var qty = parseInt((document.getElementById('shopQtyInput') || {}).value || '1', 10);
        qvAddBtn.textContent = 'Adding...';
        qvAddBtn.disabled = true;

        fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity: qty }] })
        })
        .then(function (response) { return response.json(); })
        .then(function () {
          qvAddBtn.textContent = 'Added \u2713';
          setTimeout(function () { qvAddBtn.textContent = 'Add to Cart'; qvAddBtn.disabled = false; }, 1500);
          refreshCartSections();
        })
        .catch(function (err) {
          console.error('Add to cart failed:', err);
          qvAddBtn.textContent = 'Error';
          setTimeout(function () { qvAddBtn.textContent = 'Add to Cart'; qvAddBtn.disabled = false; }, 1500);
        });
      });
    }

    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('shop-drawer-open');
  }

  function closeQuickView() {
    var drawer = document.getElementById('shopQuickview');
    if (drawer) {
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('shop-drawer-open');
    }
  }

  /* ============================================================
     RENDER: HEADER & BREADCRUMB
     ============================================================ */

  function renderHeader(productCount) {
    var titleEl = document.getElementById('shopPageTitle');
    var countEl = document.getElementById('shopProductCount');
    var breadcrumb = document.getElementById('shopBreadcrumbCurrent');

    if (state.collection && COLLECTION_TITLES[state.collection]) {
      var title = COLLECTION_TITLES[state.collection];
      if (titleEl) titleEl.textContent = title;
      if (breadcrumb) breadcrumb.textContent = title;
    } else {
      if (titleEl) titleEl.textContent = 'Shop All Workwear';
      if (breadcrumb) breadcrumb.textContent = 'Shop';
    }

    if (countEl) {
      countEl.textContent = productCount + ' product' + (productCount !== 1 ? 's' : '');
    }
  }

  /* ============================================================
     MOBILE DRAWER
     ============================================================ */

  function openMobileDrawer() {
    var drawer = document.getElementById('shopMobileDrawer');
    if (drawer) {
      drawer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('shop-drawer-open');
    }
  }

  function closeMobileDrawer() {
    var drawer = document.getElementById('shopMobileDrawer');
    if (drawer) {
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('shop-drawer-open');
    }
  }

  /* ============================================================
     MAIN UPDATE CYCLE
     ============================================================ */

  function update() {
    var filtered = filterProducts(PRODUCTS, state.activeFilters);
    filtered = searchProducts(filtered, searchTerm);
    if (state.showSavedOnly) {
      filtered = filtered.filter(function (p) { return savedProducts.indexOf(p.id) !== -1; });
    }
    var sorted = sortProducts(filtered, state.sort);

    renderHeader(sorted.length);
    renderFilterGroups('shopFilterGroups');
    renderFilterGroups('shopMobileFilterGroups');
    renderActivePills();
    renderGrid(sorted);
    writeURLParams();

    var countBadge = document.getElementById('shopMobileFilterCount');
    var count = totalActiveCount(state.activeFilters);
    if (countBadge) countBadge.textContent = count > 0 ? count : '';

    var drawerCount = document.getElementById('shopDrawerResultCount');
    if (drawerCount) drawerCount.textContent = sorted.length;
  }

  /* ============================================================
     INIT
     ============================================================ */

  function injectSearchBar() {
    var toolbar = document.querySelector('.shop-toolbar');
    if (!toolbar) return;
    var sortWrapper = toolbar.querySelector('.shop-toolbar__sort');
    
    var searchDiv = document.createElement('div');
    searchDiv.className = 'shop-search';
    searchDiv.innerHTML = '<input type="text" class="shop-search__input" id="shopSearchInput" placeholder="Search products..." autocomplete="off">' +
      '<button class="shop-search__clear" id="shopSearchClear" type="button" aria-label="Clear search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    
    toolbar.insertBefore(searchDiv, sortWrapper);

    var input = document.getElementById('shopSearchInput');
    var clearBtn = document.getElementById('shopSearchClear');

    if (searchTerm) {
      input.value = searchTerm;
      clearBtn.style.display = 'block';
    }

    input.addEventListener('input', function () {
      clearTimeout(searchTimeout);
      var val = input.value.trim();
      clearBtn.style.display = val ? 'block' : 'none';
      searchTimeout = setTimeout(function () {
        searchTerm = val;
        state.currentPage = 1;
        update();
      }, 300);
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      searchTerm = '';
      state.currentPage = 1;
      update();
      input.focus();
    });
  }

  function injectWishlistFilter() {
    var toolbar = document.querySelector('.shop-toolbar');
    if (!toolbar) return;
    var sortWrapper = toolbar.querySelector('.shop-toolbar__sort');

    var btn = document.createElement('button');
    btn.className = 'shop-wishlist-filter';
    btn.id = 'shopWishlistFilter';
    btn.type = 'button';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> Saved <span class="shop-wishlist-filter__count" id="shopWishlistCount"></span>';
    
    toolbar.insertBefore(btn, sortWrapper);

    btn.addEventListener('click', function () {
      state.showSavedOnly = !state.showSavedOnly;
      btn.classList.toggle('shop-wishlist-filter--active', state.showSavedOnly);
      state.currentPage = 1;
      update();
    });
  }

    function init() {
    // Load first page of products from Liquid JSON (max 250)
    PRODUCTS = loadShopifyProducts();

    // Build filter groups dynamically from product tags
    FILTER_GROUPS = buildFilterGroups(PRODUCTS);

    // Read URL params (depends on FILTER_GROUPS being set)
    readURLParams();

    // Check if there are more pages of products to fetch
    var pagination = loadPaginationInfo();
    if (pagination && pagination.totalPages > 1) {
      fetchRemainingPages(pagination.totalPages, function (extraProducts) {
        if (extraProducts.length > 0) {
          // De-duplicate by product ID (in case of overlap)
          var existingIds = {};
          PRODUCTS.forEach(function (p) { existingIds[p.id] = true; });
          extraProducts.forEach(function (p) {
            if (!existingIds[p.id]) {
              PRODUCTS.push(p);
              existingIds[p.id] = true;
            }
          });
          // Rebuild filters with full product set and re-render
          FILTER_GROUPS = buildFilterGroups(PRODUCTS);
          update();
        }
      });
    }

    // Inject extra UI
    injectBackToTop();
    injectExtraStyles();
    injectSearchBar();
    injectWishlistFilter();
    updateWishlistCount();

    // Sort dropdown
    var sortSelect = document.getElementById('shopSortSelect');
    if (sortSelect) {
      sortSelect.value = state.sort;
      sortSelect.addEventListener('change', function () {
        state.sort = this.value;
        state.currentPage = 1;
        update();
      });
    }

    // Clear all filters
    var clearAllBtn = document.getElementById('shopClearAllFilters');
    if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllFilters);

    var emptyClearBtn = document.getElementById('shopEmptyClearBtn');
    if (emptyClearBtn) emptyClearBtn.addEventListener('click', clearAllFilters);

    var drawerClearBtn = document.getElementById('shopDrawerClearAll');
    if (drawerClearBtn) drawerClearBtn.addEventListener('click', function () {
      clearAllFilters();
      closeMobileDrawer();
    });

    // Mobile drawer
    var mobileFilterBtn = document.getElementById('shopMobileFilterBtn');
    if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', openMobileDrawer);

    var drawerClose = document.getElementById('shopDrawerClose');
    if (drawerClose) drawerClose.addEventListener('click', closeMobileDrawer);

    var drawerOverlay = document.getElementById('shopDrawerOverlay');
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeMobileDrawer);

    var drawerApply = document.getElementById('shopDrawerApply');
    if (drawerApply) drawerApply.addEventListener('click', closeMobileDrawer);

    // Quick view
    var qvClose = document.getElementById('shopQuickviewClose');
    if (qvClose) qvClose.addEventListener('click', closeQuickView);

    var qvOverlay = document.getElementById('shopQuickviewOverlay');
    if (qvOverlay) qvOverlay.addEventListener('click', closeQuickView);

    // Load more
    var loadMoreBtn = document.getElementById('shopLoadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', function () {
      state.currentPage++;
      var filtered = filterProducts(PRODUCTS, state.activeFilters);
      var sorted = sortProducts(filtered, state.sort);
      renderGrid(sorted);
    });

    // Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeQuickView();
        closeMobileDrawer();
      }
    });

    // Initial render
    update();

    // Open quick view if product param present
    if (state.highlightProduct) {
      var product = PRODUCTS.find(function (p) { return p.id === state.highlightProduct; });
      if (product) {
        var pid = state.highlightProduct;
        setTimeout(function () { openQuickView(pid); }, 500);
      }
    }
  }

  function clearAllFilters() {
    state.activeFilters = {};
    state.collection = null;
    state.currentPage = 1;
    update();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
