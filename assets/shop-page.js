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

  function loadShopifyProducts() {
    const el = document.getElementById('shopify-product-data');
    if (!el) return [];

    try {
      const raw = JSON.parse(el.textContent);
      return raw.map(function (p, index) {
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
          featured: index,
          badge: getBadge(p)
        };
      });
    } catch (e) {
      console.error('Shop page: failed to parse product data', e);
      return [];
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
    'Industry',
    'Protection',
    'Protection Type',
    'Cert Level',
    'Certification',
    'Material',
    'Gender',
    'Season',
    'Season & Feature',
    'Feature'
  ];

  /** "Other" category is hidden from filters (tags without a colon) */
  var HIDDEN_CATEGORIES = ['Other'];

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
    'hi-vis':          { key: 'Protection', value: 'Hi-Vis' },
    'welding':         { key: 'Industry',   value: 'Welding' },
    'chemical':        { key: 'Industry',   value: 'Chemical' },
    'oil-gas':         { key: 'Industry',   value: 'Oil & Gas' },
    'manufacturing':   { key: 'Industry',   value: 'Manufacturing' },
    'automotive':      { key: 'Industry',   value: 'Automotive' },
    'construction':    { key: 'Industry',   value: 'Construction' },
    'railway':         { key: 'Industry',   value: 'Railway' },
    'electricians':    { key: 'Industry',   value: 'Electricians' },
    'flame-resistant': { key: 'Protection', value: 'Flame Resistant' },
    'arc-flash':       { key: 'Protection', value: 'Arc Flash' },
    'winter':          { key: 'Season',     value: 'Winter' },
    'summer':          { key: 'Season',     value: 'Summer' }
  };

  var COLLECTION_TITLES = {
    'hi-vis':          'Hi-Vis Collection',
    'welding':         'Welding Gear',
    'chemical':        'Chemical Protection',
    'oil-gas':         'Oil & Gas Workwear',
    'manufacturing':   'Manufacturing Workwear',
    'automotive':      'Automotive Workwear',
    'construction':    'Construction Workwear',
    'railway':         'Railway Workwear',
    'electricians':    'Electricians Workwear',
    'flame-resistant': 'Flame Resistant',
    'arc-flash':       'Arc Flash Protection',
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
    currentPage: 1
  };

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

    var qs = params.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newUrl);
  }

  /* ============================================================
     HELPERS
     ============================================================ */

  function formatPrice(amount) {
    return '\u00a3' + amount.toFixed(2);
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function buildTagSummary(parsedTags) {
    var parts = [];
    var show = ['Protection', 'Protection Type', 'Cert Level', 'Certification', 'Season', 'Season & Feature'];
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

    return '<div class="shop-card" role="listitem" data-product-id="' + product.id + '"' + (isHighlighted ? ' data-highlighted="true"' : '') + '>' +
      '<div class="shop-card__media">' +
        '<img class="shop-card__img shop-card__img--primary" src="' + product.image + '" alt="' + escapeHTML(product.name) + '" loading="lazy" width="600" height="800">' +
        secondaryImgHTML +
        badgeHTML +
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
        '<button class="shop-card__add-btn" type="button">Add to Cart</button>' +
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

    // Bind card click → quick view
    grid.querySelectorAll('.shop-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.shop-card__add-btn') || e.target.closest('.shop-card__quickview-trigger')) return;
        openQuickView(card.dataset.productId);
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
    if (product.variants.length > 0) {
      sizesHTML = product.variants.map(function (v, i) {
        var activeClass = i === 0 ? ' shop-quickview__size-btn--active' : '';
        var disabledAttr = v.available ? '' : ' disabled style="opacity:0.4;text-decoration:line-through;"';
        return '<button class="shop-quickview__size-btn' + activeClass + '" type="button"' + disabledAttr + '>' + escapeHTML(v.title) + '</button>';
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
        '<button class="shop-quickview__add-btn" type="button">Add to Cart</button>' +
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

  function init() {
    // Load real products from Liquid JSON
    PRODUCTS = loadShopifyProducts();

    // Build filter groups dynamically from product tags
    FILTER_GROUPS = buildFilterGroups(PRODUCTS);

    // Read URL params (depends on FILTER_GROUPS being set)
    readURLParams();

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
