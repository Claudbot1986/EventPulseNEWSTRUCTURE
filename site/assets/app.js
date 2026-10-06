/* EventPulse Web app.js — shared client logic for site/index.html,
 * /utforska, /karta, /event/.
 *
 * - Reads Supabase URL + anon key from <meta data-ep-config> in <head>
 * - Provides helpers: epFetch(), fetchCarousel(), fetchCategoryList(),
 *   fetchMapPins(), loadEvent()
 * - Pure vanilla, no build step
 *
 * Required meta tags in each HTML page:
 *   <meta name="ep-config" content='{"supabaseUrl":"...","anonKey":"..."}'>
 */
(function () {
  'use strict';

  const cfg = (() => {
    const tag = document.querySelector('meta[name="ep-config"]');
    if (!tag) throw new Error('Missing <meta name="ep-config">');
    try {
      return JSON.parse(tag.getAttribute('content'));
    } catch (e) {
      throw new Error('Invalid ep-config JSON: ' + e.message);
    }
  })();

  const SUPABASE_URL = cfg.supabaseUrl;
  const SUPABASE_ANON = cfg.anonKey;
  const REST = SUPABASE_URL + '/rest/v1';

  // ── Helpers ────────────────────────────────────────────────────────────
  async function epFetch(path, params = {}) {
    const url = new URL(REST + path);
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      url.searchParams.set(k, v);
    });
    const r = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
      },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`);
    }
    return r.json();
  }

  /** Format ISO date as Swedish short: "lör 26 okt" */
  function fmtDateSv(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const wdays = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
    const months = [
      'jan', 'feb', 'mar', 'apr', 'maj', 'jun',
      'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
    ];
    return `${wdays[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  }

  /** Format time as "19:30" */
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  /** Swedish price format: "120 kr" / "Gratis" */
  function fmtPrice(p) {
    if (p == null) return '';
    if (p === 0) return 'Gratis';
    return `${p} kr`;
  }

  // ── Event card builder ────────────────────────────────────────────────
  /**
   * Build a single <a class="event-card">. Pure DOM, no React.
   * @param {Object} ev — events row from Supabase
   */
  function buildEventCard(ev) {
    const a = document.createElement('a');
    a.className = 'event-card';
    // events-tabellen har inget slug-fält — använd id i URL:en.
    a.href = `/event/?id=${encodeURIComponent(ev.id)}`;
    a.setAttribute('aria-label', ev.title_sv || ev.title_en || 'Evenemang');
    // Används av dwell-tracker (categorySlugFromCard) + localStorage-bias
    if (ev.category_slug) a.dataset.cat = ev.category_slug;

    // Image (or empty placeholder)
    const imgWrap = document.createElement('div');
    imgWrap.className = 'event-card__image';
    if (ev.image_url) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = ev.image_url;
      imgWrap.appendChild(img);
    } else {
      imgWrap.classList.add('event-card__image--empty');
    }
    a.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'event-card__body';

    if (ev.start_time) {
      const d = document.createElement('p');
      d.className = 'event-card__date';
      d.textContent = fmtDateSv(ev.start_time);
      body.appendChild(d);
    }

    const t = document.createElement('h3');
    t.className = 'event-card__title';
    t.textContent = ev.title_sv || ev.title_en || 'Evenemang';
    body.appendChild(t);

    const venueLabel = ev.venue_full_name || ev.venue_city;
    if (venueLabel) {
      const v = document.createElement('p');
      v.className = 'event-card__venue';
      v.textContent = venueLabel;
      body.appendChild(v);
    }

    a.appendChild(body);
    return a;
  }

  /** Skeleton placeholder card while loading */
  function buildSkeletonCard() {
    const a = document.createElement('div');
    a.className = 'event-card';
    a.innerHTML = `
      <div class="event-card__image skeleton" style="aspect-ratio:4/3"></div>
      <div class="event-card__body">
        <div class="skeleton" style="height:11px;width:50%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:13px;width:90%;margin-bottom:4px"></div>
        <div class="skeleton" style="height:13px;width:60%"></div>
      </div>`;
    return a;
  }

  /** Empty/error state cell */
  function buildEmpty(msg) {
    const d = document.createElement('div');
    d.className = 'event-list__empty';
    d.textContent = msg;
    return d;
  }

  // ── Section heading (h2 + "see all" link) ─────────────────────────────
  function buildSectionHead(title, linkHref, linkLabel) {
    const head = document.createElement('div');
    head.className = 'section__head';
    const h = document.createElement('h2');
    h.className = 'section__title';
    h.textContent = title;
    head.appendChild(h);
    if (linkHref) {
      const a = document.createElement('a');
      a.className = 'section__link';
      a.href = linkHref;
      a.textContent = linkLabel || 'Visa alla →';
      head.appendChild(a);
    }
    return head;
  }

  function buildCarouselSkeleton(trackEl, count = 6) {
    trackEl.innerHTML = '';
    for (let i = 0; i < count; i++) trackEl.appendChild(buildSkeletonCard());
  }

  /** Sätt sektionstiteln för "För dig" baserat på om användaren har taste-spår. */
  function refreshForyouCopy(root, hasTaste) {
    const titleEl = root.querySelector('.section__title');
    const linkEl = root.querySelector('.section__link');
    if (titleEl) titleEl.textContent = hasTaste ? 'För dig' : 'Upptäck';
    if (linkEl) linkEl.textContent = hasTaste ? 'Rensa smak →' : 'Vad är det här?';
  }

  // ── Section data fetchers (carousels + lists) ──────────────────────────

  /** Fetch events for a "tonight" carousel */
  async function fetchTonight(limit = 12) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    return epFetch('/events', {
      select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city',
      status: 'eq.published',
      and: '(start_time.gte.' + startOfToday.toISOString() + ',start_time.lt.' + endOfToday.toISOString() + ')',
      order: 'start_time.asc',
      limit,
    });
  }

  /** Fetch events for "the weekend" (lör + sön) */
  async function fetchWeekend(limit = 12) {
    const now = new Date();
    // Find next Saturday
    const sat = new Date(now);
    sat.setHours(0, 0, 0, 0);
    const daysToSat = (6 - sat.getDay() + 7) % 7 || 7;
    sat.setDate(sat.getDate() + daysToSat);
    const mon = new Date(sat);
    mon.setDate(mon.getDate() + 2);
    return epFetch('/events', {
      select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city',
      status: 'eq.published',
      and: '(start_time.gte.' + sat.toISOString() + ',start_time.lt.' + mon.toISOString() + ')',
      order: 'start_time.asc',
      limit,
    });
  }

  /** Fetch events for a specific category_slug */
  async function fetchByCategory(catSlug, limit = 12) {
    return epFetch('/events', {
      select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city',
      status: 'eq.published',
      category_slug: 'eq.' + catSlug,
      start_time: 'gte.' + new Date().toISOString(),
      order: 'start_time.asc',
      limit,
    });
  }

  /** Fetch a list of categories with event counts (for Utforska page) */
  async function fetchCategoryStats() {
    // Categories are read from the categories table; counts via events.
    const cats = await epFetch('/categories', {
      select: 'slug,name_sv,name_en,icon',
      order: 'name_sv.asc',
    });
    // Event count per slug (cheap: events.category_slug grouped client-side).
    // Skip if too many events — for the homepage hero stats we'll use a
    // server-side RPC if needed; for now, return categories without counts
    // and let the Utforska page optionally query.
    return cats;
  }

  // ── Taste / personalization (client-side) ────────────────────────────
  // Håller reda på vilka events användaren dwell:at på (1s card_hold, 3s
  // list_view) eller klickat. Lagrat i localStorage — ingen backend-write
  // behövs för denna MVP. När vi senare wire:ar till /agent/feedback (BACKLOG
  // Fas C) skickas samma shape som appens `recordEventInteraction` — samma
  // fältnamn, samma metadata.

  const TASTE_KEY = 'ep:taste:v1';
  /** Shape speglar user_interactions + samma dwell-konventioner som appen:
   *  events[id] = { dwell_ms, clicks, last_seen, category, sources: ['card_hold','list_view','details_view'] }
   *  categories[slug] = { score, last_seen }
   *  För att kunna mappa → POST /agent/feedback { interaction, event_id, metadata }
   *  räcker det att iterera events och skicka en rad per signal. */
  function readTaste() {
    try {
      const raw = localStorage.getItem(TASTE_KEY);
      return raw ? JSON.parse(raw) : { events: {}, categories: {} };
    } catch { return { events: {}, categories: {} }; }
  }
  function writeTaste(t) {
    try {
      // Begränsa storlek — vi vill inte växa obegränsat
      if (Object.keys(t.events).length > 500) {
        const sorted = Object.entries(t.events)
          .sort((a, b) => (b[1].last_seen || 0) - (a[1].last_seen || 0))
          .slice(0, 400);
        t.events = Object.fromEntries(sorted);
      }
      localStorage.setItem(TASTE_KEY, JSON.stringify(t));
    } catch (e) {
      // localStorage kan vara full eller inaktiverat — vi failar tyst.
    }
  }
  /** Record signal — samma shape som agentClient.recordEventInteraction.
   *  Viktning: klick=1.0, dwell=0.4 (card_hold) eller 0.6 (list_view/details_view). */
  function recordEventSignal(eventId, categorySlug, kind /* 'click' | 'dwell' */, source = 'list_view', dwellMs = 0) {
    if (!eventId) return;
    const t = readTaste();
    const now = Date.now();
    const weight = kind === 'click' ? 1.0
      : source === 'card_hold' ? 0.4
      : source === 'list_view' ? 0.6
      : source === 'details_view' ? 0.6
      : 0.4;
    const ev = t.events[eventId] || { dwell_ms: 0, clicks: 0, last_seen: 0, sources: [] };
    if (kind === 'click') ev.clicks += 1;
    if (kind === 'dwell') ev.dwell_ms = (ev.dwell_ms || 0) + dwellMs;
    ev.last_seen = now;
    ev.category = categorySlug || ev.category;
    if (!ev.sources.includes(source)) ev.sources.push(source);
    t.events[eventId] = ev;
    if (ev.category) {
      const cat = t.categories[ev.category] || { score: 0, last_seen: 0 };
      cat.score = (cat.score || 0) + weight;
      cat.last_seen = now;
      t.categories[ev.category] = cat;
    }
    writeTaste(t);
  }
  /** Hämta topp-N kategorier sorterade på score. */
  function topCategories(n = 3) {
    const t = readTaste();
    return Object.entries(t.categories)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, n)
      .map(([slug, info]) => ({ slug, score: info.score }));
  }

  /** Fetch events för "För dig"-karusell.
   *  Algoritm: om användaren har taste-tracks, hämta events från top-kategorier.
   *  Annars: högst confidence_score som "default rec".
   *  Blendas med nya cards från andra kategorier för att inte bli en ekokammare.
   */
  async function fetchForYou(limit = 12) {
    const top = topCategories(3);
    const trustedCats = top.map((c) => c.slug);

    // Hämta 1 batch från toppkategorier (om någon), 1 batch av högst-rankerade
    const tasks = [];

    if (trustedCats.length > 0) {
      const catFilter = `in.(${trustedCats.join(',')})`;
      tasks.push(epFetch('/events', {
        select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city,category_slug,confidence_score',
        status: 'eq.published',
        start_time: 'gte.' + new Date().toISOString(),
        category_slug: catFilter,
        confidence_score: 'gte.65',
        order: 'confidence_score.desc,start_time.asc',
        limit: Math.ceil(limit * 0.6),
      }));
    }

    // Default: högst confidence-score för discovery
    tasks.push(epFetch('/events', {
      select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city,category_slug,confidence_score',
      status: 'eq.published',
      start_time: 'gte.' + new Date().toISOString(),
      confidence_score: 'gte.70',
      order: 'confidence_score.desc,start_time.asc',
      limit: limit,
    }));

    const results = await Promise.all(tasks);
    // Dedupe och välj
    const seen = new Set();
    const merged = [];
    for (const list of results) {
      for (const r of list) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
      }
      if (merged.length >= limit) break;
    }
    return merged.slice(0, limit);
  }

  /** Fetch a single event for /event/?id=... */
  async function fetchEvent(id) {
    // events-tabellen har ingen slug-kolumn — använd id som lookup-nyckel.
    return epFetch('/events', {
      select: 'id,source,title_en,title_sv,description_en,description_sv,start_time,end_time,venue_full_name,venue_full_address,venue_city,lat,lng,ticket_url,image_url,category_slug,price_min_sek,price_max_sek,is_free,eventpulse_summary',
      status: 'eq.published',
      id: 'eq.' + encodeURIComponent(id),
      limit: 1,
    }).then((rows) => rows[0] || null);
  }

  /** Fetch map pins — events with valid lat/lng, future only */
  async function fetchMapPins(limit = 500, catSlug = null) {
    const params = {
      select: 'id,title_sv,start_time,venue_full_name,venue_city,lat,lng,category_slug',
      status: 'eq.published',
      start_time: 'gte.' + new Date().toISOString(),
      // not.is.null=lat fungerar inte via PostgREST — använd lat gte -90 istället.
      lat: 'gte.-90',
      order: 'start_time.asc',
      limit,
    };
    if (catSlug) params.category_slug = 'eq.' + catSlug;
    return epFetch('/events', params);
  }

  // ── Mount helpers (per page) ────────────────────────────────────────────

  /** Mount a carousel section into <section data-ep-carousel="tonight|weekend|foryou|music|..."> */
  async function mountCarousel(root) {
    const kind = root.dataset.epCarousel; // 'tonight' | 'weekend' | 'foryou' | '<catSlug>'
    const track = root.querySelector('.carousel__track');
    const titleEl = root.querySelector('.section__title');
    const linkEl = root.querySelector('.section__link');

    buildCarouselSkeleton(track, 6);
    try {
      let rows;
      let title;
      let seeAll;
      if (kind === 'tonight') {
        rows = await fetchTonight(12);
        title = 'Ikväll';
        seeAll = { href: '/utforska/?date=today', label: 'Visa alla ikväll →' };
      } else if (kind === 'weekend') {
        rows = await fetchWeekend(12);
        title = 'Helgen';
        seeAll = { href: '/utforska/?date=weekend', label: 'Visa helgens alla →' };
      } else if (kind === 'foryou') {
        rows = await fetchForYou(12);
        const hasTaste = topCategories(1).length > 0;
        refreshForyouCopy(root, hasTaste);
        // För "För dig" används "Rensa smak" istället för "Visa alla"
        if (linkEl) {
          linkEl.href = '#';
          linkEl.dataset.epForyouClear = '';
          if (!linkEl._wired) {
            linkEl._wired = true;
            linkEl.addEventListener('click', (e) => {
              e.preventDefault();
              try { localStorage.removeItem(TASTE_KEY); } catch {}
              // Rerender genom att cleara karusellens innehåll + refetcha
              track.innerHTML = '';
              mountCarousel(root);
            });
          }
        }
        track.innerHTML = '';
        if (!rows.length) {
          const e = buildEmpty('Inga förslag än — utforska för att bygga smak.');
          track.appendChild(e);
          return;
        }
        rows.forEach((r) => track.appendChild(buildEventCard(r)));
        // Viktigt: trigga dwell-observatören på nya kort
        if (typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event('ep:cards-added'));
        }
        return;
      } else {
        // category
        rows = await fetchByCategory(kind, 12);
        const cat = (await epFetch('/categories', {
          select: 'name_sv', slug: 'eq.' + kind, limit: 1,
        }))[0];
        title = cat?.name_sv || kind;
        seeAll = {
          href: '/utforska/?category=' + encodeURIComponent(kind),
          label: 'Visa alla i ' + title + ' →',
        };
      }
      if (titleEl) titleEl.textContent = title;
      if (linkEl && seeAll) {
        linkEl.href = seeAll.href;
        linkEl.textContent = seeAll.label;
      }
      track.innerHTML = '';
      if (!rows.length) {
        const e = buildEmpty('Inga evenemang just nu.');
        e.style.width = '100%';
        track.appendChild(e);
        return;
      }
      rows.forEach((r) => track.appendChild(buildEventCard(r)));
      // Viktigt: trigga dwell-observatören på nya kort
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('ep:cards-added'));
      }
    } catch (e) {
      console.error('mountCarousel', kind, e);
      track.innerHTML = '';
      track.appendChild(buildEmpty('Kunde inte ladda — försök igen.'));
    }
  }

  /** Mount all carousels inside the document */
  function mountAllCarousels() {
    document.querySelectorAll('[data-ep-carousel]').forEach(mountCarousel);
  }

  /** Mount Utforska grid — read query params for date/category filters */
  async function mountUtforska() {
    const grid = document.querySelector('[data-ep-grid]');
    if (!grid) return;
    const params = new URLSearchParams(location.search);
    const cat = params.get('category');
    const dateFilter = params.get('date');

    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) grid.appendChild(buildSkeletonCard());

    try {
      const now = new Date();
      let start = now;
      let end;
      if (dateFilter === 'today') {
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'weekend') {
        const sat = new Date(now);
        const daysToSat = (6 - sat.getDay() + 7) % 7 || 7;
        sat.setDate(sat.getDate() + daysToSat);
        sat.setHours(0, 0, 0, 0);
        start = sat;
        end = new Date(sat);
        end.setDate(end.getDate() + 2);
      }
      const q = {
        select: 'id,title_sv,start_time,image_url,venue_full_name,venue_city',
        status: 'eq.published',
        start_time: 'gte.' + start.toISOString(),
        order: 'start_time.asc',
        limit: 60,
      };
      if (end) { q.and = '(start_time.gte.' + start.toISOString() + ',start_time.lt.' + end.toISOString() + ')'; }
      if (cat) q.category_slug = 'eq.' + cat;

      const rows = await epFetch('/events', q);
      grid.innerHTML = '';
      if (!rows.length) {
        const e = buildEmpty('Inga evenemang matchar — testa att byta filter.');
        grid.appendChild(e);
        return;
      }
      rows.forEach((r) => grid.appendChild(buildEventCard(r)));
    } catch (e) {
      console.error('mountUtforska', e);
      grid.innerHTML = '';
      grid.appendChild(buildEmpty('Kunde inte ladda — försök igen.'));
    }
  }

  /** Mount /event/?id=... detail */
  async function mountEventDetail() {
    const root = document.querySelector('[data-ep-event]');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) {
      root.innerHTML = '<p class="event-list__empty">Inget evenemang angivet.</p>';
      return;
    }
    try {
      const ev = await fetchEvent(id);
      if (!ev) {
        root.innerHTML = '<p class="event-list__empty">Hittar inte evenemanget.</p>';
        return;
      }
      renderEventDetail(root, ev);
    } catch (e) {
      console.error('mountEventDetail', e);
      root.innerHTML = '<p class="event-list__empty">Kunde inte ladda — försök igen.</p>';
    }
  }

  function renderEventDetail(root, ev) {
    const summary = ev.eventpulse_summary || ev.description_sv || ev.description_en || '';
    const dateLabel = fmtDateSv(ev.start_time) + (ev.start_time ? ' ' + fmtTime(ev.start_time) : '');
    const priceLabel = ev.is_free
      ? 'Gratis'
      : fmtPrice(ev.price_min_sek);
    const venueLabel = ev.venue_full_name || ev.venue_city || null;

    root.innerHTML = `
      <div>
        <div class="event-detail__hero">
          ${ev.image_url ? `<img src="${escapeHtml(ev.image_url)}" alt="">` : ''}
        </div>
        <p class="event-detail__eyebrow">${escapeHtml(ev.category_slug || 'Evenemang')}</p>
        <h1 class="event-detail__title">${escapeHtml(ev.title_sv || ev.title_en || 'Evenemang')}</h1>
        ${summary ? `<p class="event-detail__summary">${escapeHtml(summary)}</p>` : ''}
      </div>
      <aside>
        <dl class="event-detail__meta">
          ${dateLabel ? `<div class="event-detail__meta-row"><dt>Datum</dt><dd>${escapeHtml(dateLabel)}</dd></div>` : ''}
          ${venueLabel ? `<div class="event-detail__meta-row"><dt>Plats</dt><dd>${escapeHtml(venueLabel)}</dd></div>` : ''}
          ${ev.venue_full_address ? `<div class="event-detail__meta-row"><dt>Adress</dt><dd>${escapeHtml(ev.venue_full_address)}</dd></div>` : ''}
          ${priceLabel ? `<div class="event-detail__meta-row"><dt>Pris</dt><dd>${escapeHtml(priceLabel)}</dd></div>` : ''}
          ${ev.source ? `<div class="event-detail__meta-row"><dt>Källa</dt><dd>${escapeHtml(ev.source)}</dd></div>` : ''}
        </dl>
        ${ev.ticket_url ? `<a class="event-detail__cta" href="${escapeHtml(ev.ticket_url)}" target="_blank" rel="noopener">Köp biljetter →</a>` : ''}
      </aside>`;
  }

  /** Mount /karta page — Leaflet map + side list */
  async function mountMap() {
    const canvas = document.querySelector('.map-page__canvas');
    const listEl = document.querySelector('.map-page__list');
    if (!canvas || !listEl || typeof window.L === 'undefined') return;

    // Initialize Leaflet map. Vi använder OpenStreetMap (gratis, ingen API-nyckel)
    // och gör det dark via CSS-filter — se .leaflet-tile i styles.css.
    // Tidigare använde vi CARTO dark_all men deras policy kräver nu API-nyckel.
    const map = window.L.map(canvas, {
      zoomControl: true,
      attributionControl: true,
    }).setView([59.3293, 18.0686], 12);

    window.L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        // OSM kräver attribution + rimlig trafik. För production med mycket
        // trafik bör vi köra egen tile-server (eller stadia/stamen med key).
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ).addTo(map);

    // Fetch pins
    listEl.innerHTML = '<div class="map-page__list--empty">Hämtar events…</div>';
    let pins;
    try {
      pins = await fetchMapPins(500);
    } catch (e) {
      console.error('fetchMapPins', e);
      listEl.innerHTML = '<div class="map-page__list--empty">Kunde inte ladda events.</div>';
      return;
    }
    if (!pins.length) {
      listEl.innerHTML = '<div class="map-page__list--empty">Inga events med kända koordinater just nu.</div>';
      return;
    }

    // Build list + markers
    const markers = [];
    pins.forEach((ev) => {
      // Marker
      const m = window.L.circleMarker([ev.lat, ev.lng], {
        radius: 7,
        color: '#FFB454',
        weight: 1.5,
        fillColor: '#FFB454',
        fillOpacity: 0.85,
      }).addTo(map);
      const venueLabel = ev.venue_full_name || ev.venue_city || '';
      m.bindPopup(
        `<strong>${escapeHtml(ev.title_sv || 'Evenemang')}</strong><br>` +
          `${escapeHtml(fmtDateSv(ev.start_time))} ${escapeHtml(fmtTime(ev.start_time))}<br>` +
          `${venueLabel ? escapeHtml(venueLabel) + '<br>' : ''}` +
          `<a href="/event/?id=${encodeURIComponent(ev.id)}">Detaljer →</a>`
      );
      m.on('click', () => {
        // Highlight list item
        listEl.querySelectorAll('.map-page__item.is-active').forEach((el) =>
          el.classList.remove('is-active')
        );
        const li = listEl.querySelector(`[data-ep-pin="${CSS.escape(ev.id)}"]`);
        if (li) {
          li.classList.add('is-active');
          li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
      markers.push(m);

      // List item
      const li = document.createElement('a');
      li.className = 'map-page__item';
      li.setAttribute('data-ep-pin', ev.id);
      li.href = '#';
      li.style.cssText =
        'display:block;padding:12px 16px;border-bottom:1px solid var(--c-divider);' +
        'font-size:14px;line-height:1.4;color:var(--c-text);text-decoration:none;';
      li.innerHTML = `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:var(--c-accent);margin-bottom:4px">
          ${escapeHtml(fmtDateSv(ev.start_time))} ${escapeHtml(fmtTime(ev.start_time))}
        </div>
        <div style="font-weight:700">${escapeHtml(ev.title_sv || 'Evenemang')}</div>
        ${venueLabel ? `<div style="font-size:12px;color:var(--c-text-muted);margin-top:2px">${escapeHtml(venueLabel)}</div>` : ''}`;
      li.addEventListener('click', (e) => {
        e.preventDefault();
        map.setView([ev.lat, ev.lng], 14, { animate: true });
        m.openPopup();
        listEl.querySelectorAll('.map-page__item.is-active').forEach((el) =>
          el.classList.remove('is-active')
        );
        li.classList.add('is-active');
      });
      listEl.appendChild(li);
    });

    // Fit bounds — begränsad till Stockholm-området så vi inte zoomar ut för
    // hela Sverige bara för att några events ligger i Umeå/Malmö.
    // Om alla pinnar är inom 50km av Stockholm centrum, anpassa vyn.
    // Annars behåll default Stockholm-vinstans och låt pins sticka ut.
    try {
      const stockholmCenter = window.L.latLng(59.3293, 18.0686);
      const allNearStockholm = pins.every((p) => {
        const ll = window.L.latLng(p.lat, p.lng);
        return ll.distanceTo(stockholmCenter) <= 50_000; // 50 km
      });
      if (allNearStockholm) {
        const bounds = window.L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
      // annars: Stockholm-default-vy, pins utanför området syns i utkanten
    } catch (e) {
      // ignore — keep default Stockholm center
    }
  }

  /** Tiny HTML escape for popup / detail rendering */
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    mountAllCarousels();
    mountUtforska();
    mountEventDetail();
    mountMap();
    mountDwellTracker();   // mirror app: 1s card_hold + 3s list_view via IntersectionObserver
  });

  // ── Dwell tracker (mirrors 06-UI/App.js CARD_HOLD_MS + LIST_VIEW_MIN_MS) ──
  // Tre dwell-källor, samma som appen:
  //   - card_hold:  mousedown 1s utan släpp → dwell  (metadata.source='card_hold')
  //   - list_view:  ≥65% synlig i 3s via IntersectionObserver → dwell  (source='list_view')
  //   - details_view: tid på /event/…-sidan → dwell  (source='details_view')
  // Lagras i localStorage. När web → /agent/feedback wire:as (BACKLOG Fas C)
  // skickas samma shape som appens `recordEventInteraction`.
  const LIST_VIEW_MIN_MS = 3000;
  const CARD_HOLD_MS = 1000;
  let dwellObserver = null;
  const dwellRecordedThisVisit = new Set(); // dedupe: 1 list_view dwell per event per page-load

  function extractEventIdFromCard(card) {
    if (!card) return null;
    const href = card.getAttribute('href') || '';
    const m = href.match(/[?&]id=([^&]+)/);
    return m ? m[1] : null;
  }
  function categorySlugFromCard(card) {
    // category finns inte på kortet i nuläget — vi plockar från data-cat om satt
    return card.dataset.cat || null;
  }

  function mountDwellTracker() {
    // ── card_hold: 1s mousedown utan mouseup → dwell
    document.addEventListener('mousedown', (e) => {
      const card = e.target.closest('.event-card');
      if (!card) return;
      const eventId = extractEventIdFromCard(card);
      if (!eventId) return;
      const start = Date.now();
      const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        const held = Date.now() - start;
        if (held >= CARD_HOLD_MS) {
          recordEventSignal(eventId, categorySlugFromCard(card), 'dwell', 'card_hold', held);
        }
      };
      document.addEventListener('mouseup', onUp, { once: true });
    });

    // ── click: registrera också
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.event-card');
      if (!card) return;
      const eventId = extractEventIdFromCard(card);
      if (eventId) recordEventSignal(eventId, categorySlugFromCard(card), 'click');
    });

    // ── list_view: IntersectionObserver 65% synlig i 3s
    if (!('IntersectionObserver' in window)) return;
    dwellObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target;
        const eventId = extractEventIdFromCard(card);
        if (!eventId) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          // ≥50% synlig — starta 3s dwell-timer (lite mildare än appens 65%
          // för att kompensera att webbläsarens IntersectionObserver-trösklar
          // varierar; proportionellt samma signalstyrka)
          if (!card._dwellTimer) {
            card._dwellTimer = setTimeout(() => {
              if (dwellRecordedThisVisit.has(eventId)) return;
              dwellRecordedThisVisit.add(eventId);
              recordEventSignal(eventId, categorySlugFromCard(card), 'dwell', 'list_view', LIST_VIEW_MIN_MS);
            }, LIST_VIEW_MIN_MS);
          }
        } else if (card._dwellTimer) {
          clearTimeout(card._dwellTimer);
          card._dwellTimer = null;
        }
      }
    }, { threshold: [0, 0.5, 1] });

    // Lägg till alla .event-card i observatorn
    function observeCards(root = document) {
      root.querySelectorAll('.event-card').forEach((c) => {
        if (!c._observed) {
          dwellObserver.observe(c);
          c._observed = true;
        }
      });
    }
    observeCards();

    // MutationObserver: när nya karuseller mountas → observera nya kort
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.classList?.contains('event-card')) {
            dwellObserver.observe(n);
            n._observed = true;
          } else if (n.querySelectorAll) {
            observeCards(n);
          }
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Också lyssna på 'ep:cards-added' från mountCarousel (för For dig
    // som körs separat och kan binda nya events)
    window.addEventListener('ep:cards-added', () => observeCards());

    // ── details_view: dwell_ms vid unload av /event/…-sidan
    if (location.pathname.startsWith('/event')) {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      const start = Date.now();
      const record = () => {
        const ms = Date.now() - start;
        if (ms >= 500 && id) {
          recordEventSignal(id, null, 'dwell', 'details_view', ms);
        }
      };
      window.addEventListener('beforeunload', record);
      window.addEventListener('pagehide', record);
    }
  }

  // Expose for direct testing
  window.EventPulseWeb = {
    epFetch,
    fetchTonight,
    fetchWeekend,
    fetchByCategory,
    fetchMapPins,
    fetchEvent,
    buildEventCard,
  };
})();