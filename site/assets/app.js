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

  /** Mount a carousel section into <section data-ep-carousel="tonight|weekend|music|..."> */
  async function mountCarousel(root) {
    const kind = root.dataset.epCarousel; // 'tonight' | 'weekend' | '<catSlug>'
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

    // Initialize Leaflet map (dark tiles from CARTO)
    const map = window.L.map(canvas, {
      zoomControl: true,
      attributionControl: true,
    }).setView([59.3293, 18.0686], 12);

    window.L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
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

    // Fit bounds
    try {
      const bounds = window.L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
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
  });

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