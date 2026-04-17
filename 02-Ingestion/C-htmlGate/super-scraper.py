#!/usr/bin/env python3
"""
Ultimate Event Scraper v2 — BOIL THE OCEAN
Handles ALL Swedish event sources: direct HTML, JSON-LD, JS-embedded data, API endpoints.
No AI needed. Pure scraping.

Usage:
  python3 super-scraper.py <source_id> <url> [--timeout 15]
  python3 super-scraper.py --batch <file.jsonl> [--parallel 5]
"""
import sys, os, re, json, ssl, urllib.request, urllib.error, datetime, time, argparse, concurrent.futures
from html.parser import HTMLParser
from urllib.parse import urlparse, urljoin

# ─── Config ───────────────────────────────────────────────────────────────────
SWEDISH_MONTHS = 'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec'
EVENT_KEYWORDS = ['evenemang','event','kalender','konsert','biljett','forestallning','visning','aktivitet','matcher','schema']

def fetch_html(url, timeout=15):
    """Fetch HTML with proper headers."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
    }
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers=headers)
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
        resp = opener.open(req, timeout=timeout)
        html = resp.read()
        try: html = html.decode('utf-8')
        except: html = html.decode('latin-1', errors='replace')
        return html, resp.geturl(), None
    except Exception as e:
        return '', url, str(e)

def extract_json_from_js(html):
    """Extract JSON event data from JavaScript variables in HTML.
    
    Swedish municipal sites (Lund, Västerås, etc.) embed ALL events in a large
    <script> block as a plain JSON array - NOT window.__INITIAL_STATE__.
    This is Type B data: structured JSON without a separate Network API call.
    """
    events = []
    
    # METHOD 1: Large script blocks with "events":[ pattern (MOST COMMON for Swedish sites)
    script_blocks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL | re.I)
    for block in script_blocks:
        if '"events":' not in block or len(block) < 50000:
            continue
        
        # Find "events":[
        idx = block.find('"events":[')
        if idx < 0:
            continue
        
        # Find the opening bracket
        arr_start = block.find('[', idx)
        if arr_start < 0:
            continue
        
        # Match the closing bracket
        depth = 0
        arr_end = -1
        for k in range(arr_start, len(block)):
            c = block[k]
            if c == '[': depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    arr_end = k
                    break
        
        if arr_end < 0:
            continue
        
        arr_str = block[arr_start:arr_end+1]
        
        # Fix common JS trailing comma issues before JSON parsing
        cleaned = re.sub(r',(\s*[}\]])', r'\1', arr_str)
        try:
            data = json.loads(cleaned)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        evt = normalize_cruncho_event(item)
                        if evt: events.append(evt)
        except json.JSONDecodeError:
            # Last resort: try splitting by event objects
            try:
                # Events have {"hipTixUrl": or {"id": prefix
                parts = re.split(r'\}\s*,\s*\{', arr_str)
                for p in parts:
                    if '"name"' in p or '"title"' in p:
                        try:
                            if not p.startswith('{'): p = '{' + p
                            if not p.endswith('}'): p = p + '}'
                            item = json.loads(p)
                            evt = normalize_cruncho_event(item)
                            if evt: events.append(evt)
                        except: pass
            except: pass
    
    # METHOD 2: window.__INITIAL_STATE__ = JSON.parse("...") - LESS COMMON
    matches = re.findall(r'window\.__INITIAL_STATE__\s*=\s*JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"', html, re.DOTALL)
    for m in matches:
        try:
            s = m.replace('\\"', '"').replace('\\n', '\n').replace('\\/', '/')
            data = json.loads(s)
            evts = extract_events_from_state(data)
            events.extend(evts)
        except: pass
    
    # METHOD 3: __INITIAL_STATE__ = {...} directly
    matches = re.findall(r'__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;', html, re.DOTALL)
    for m in matches:
        try:
            data = json.loads(m)
            evts = extract_events_from_state(data)
            events.extend(evts)
        except: pass
    
    # METHOD 4: eventsData = [...], eventList = [...], etc.
    for var in ['eventsData', 'eventList', 'event_data', 'EVENT_DATA', 'window.events']:
        matches = re.findall(var + r'\s*=\s*(\[.*?\])\s*;', html, re.DOTALL)
        for m in matches:
            try:
                data = json.loads(m)
                if isinstance(data, list):
                    for item in data:
                        evt = normalize_cruncho_event(item)
                        if evt: events.append(evt)
            except: pass
    
    return events

def extract_events_from_state(data):
    """Extract events from __INITIAL_STATE__ data structure."""
    events = []
    if isinstance(data, dict):
        # Direct events key
        if 'events' in data and isinstance(data['events'], list):
            for item in data['events']:
                evt = normalize_cruncho_event(item)
                if evt: events.append(evt)
        # Nested in 'initialState' or similar
        for key in ['initialState', 'initial_state', 'state', 'data', 'pageData', 'content']:
            if key in data:
                sub = data[key]
                if isinstance(sub, dict):
                    evts = extract_events_from_state(sub)
                    events.extend(evts)
                elif isinstance(sub, list):
                    for item in sub:
                        evt = normalize_cruncho_event(item)
                        if evt: events.append(evt)
    elif isinstance(data, list):
        for item in data:
            evt = normalize_cruncho_event(item)
            if evt: events.append(evt)
    return events

def normalize_cruncho_event(item):
    """Normalize a Cruncho/event data object to standard format."""
    if not isinstance(item, dict): return None
    
    # Get name - try multiple paths (Cruncho uses translations.originalName)
    name = ''
    translations = item.get('translations', {})
    if isinstance(translations, dict):
        name = translations.get('originalName', '') or translations.get('name', '')
    if not name:
        name = item.get('name', '') or item.get('title', '')
    if not name: return None
    
    # Get dates - Cruncho uses startDate at top level AND dates[].startDate
    start_date = item.get('startDate', '')
    end_date = item.get('endDate', '')
    
    # Also check dates array for recurring events
    dates = item.get('dates', [])
    if isinstance(dates, list) and dates and not start_date:
        first = dates[0]
        if isinstance(first, dict):
            start_date = first.get('startDate', '')
            end_date = first.get('endDate', '')
    
    # Clean ISO date
    if start_date and 'T' in start_date:
        start_date = start_date.split('T')[0]
    
    # Get venue/location
    venue = item.get('venue', '') or item.get('location', '')
    if isinstance(venue, dict): venue = venue.get('name', str(venue))
    
    # Get city
    city = item.get('city', '')
    
    # Get address
    address = item.get('address', '')
    if isinstance(address, dict): address = address.get('streetAddress', '') or str(address)
    
    # Full location
    location = venue or city or address or ''
    if city and venue and city not in str(venue): location = f"{venue}, {city}"
    elif address and venue and address not in str(venue): location = f"{venue}, {address}"
    
    # Get URL from postOptions or item.url
    event_url = item.get('url', '') or item.get('website', '')
    if not event_url:
        post_options = item.get('postOptions', [])
        if isinstance(post_options, list) and post_options:
            event_url = post_options[0].get('label', '')
    if not event_url and 'id' in item:
        event_url = f"https://example.com/event?id={item['id']}"
    
    # Get description - Cruncho uses translations.originalDescription
    desc = ''
    if isinstance(translations, dict):
        desc = translations.get('originalDescription', '')
    if not desc:
        desc = item.get('description', '')
    if isinstance(desc, str):
        desc = re.sub(r'<[^>]+>', '', desc)[:500]
    
    # Get price
    price = item.get('price', '')
    is_free = item.get('isFree', False)
    if is_free: price = 'Free'
    
    # Get image - Cruncho uses photos[0].url
    img = ''
    photos = item.get('photos', [])
    if isinstance(photos, list) and photos:
        img = photos[0].get('url', '')
    if not img:
        img = item.get('image', '') or item.get('photo', '')
        if isinstance(img, dict): img = img.get('url', '')
    
    # Get categories
    cats = item.get('categories', [])
    if isinstance(cats, list): cats = ', '.join(str(c) for c in cats if c)
    else: cats = str(cats) if cats else ''
    
    # Status
    status = item.get('status', 'posted')
    
    return {
        'title': str(name)[:200],
        'url': str(event_url)[:500],
        'startDate': str(start_date)[:20],
        'endDate': str(end_date)[:20],
        'location': str(location)[:200],
        'description': str(desc)[:500],
        'price': str(price) if price else '',
        'image': str(img)[:500],
        'categories': str(cats),
        'status': str(status),
    }

def extract_json_ld(html):
    """Extract events from JSON-LD script blocks."""
    events = []
    pattern = r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
    for match in re.findall(pattern, html, re.DOTALL | re.I):
        try:
            data = json.loads(match)
            evts = parse_jsonld_recursive(data)
            events.extend(evts)
        except: pass
    return events

def parse_jsonld_recursive(data):
    events = []
    if isinstance(data, list):
        for item in data: events.extend(parse_jsonld_recursive(item))
    elif isinstance(data, dict):
        t = data.get('@type', '')
        if t in ('Event', 'MusicEvent', 'TheaterEvent', 'SportsEvent', 'CulturalEvent', 'SocialEvent', 'Festival'):
            evt = normalize_jsonld_event(data)
            if evt: events.append(evt)
        if '@graph' in data:
            for item in data['@graph']: events.extend(parse_jsonld_recursive(item))
    return events

def normalize_jsonld_event(data):
    name = data.get('name', '')
    if not name: return None
    url = data.get('url', '')
    desc = data.get('description', '')
    start = data.get('startDate', '') or data.get('doorTime', '')
    end = data.get('endDate', '')
    loc = data.get('location', '')
    if isinstance(loc, dict): loc = loc.get('name', str(loc))
    img = data.get('image', '')
    if isinstance(img, list): img = img[0] if img else ''
    offer = data.get('offers', {})
    if isinstance(offer, dict): price = offer.get('price', '')
    else: price = ''
    return {'title': name, 'url': url, 'startDate': start, 'endDate': end,
            'location': str(loc), 'description': str(desc)[:300], 'price': str(price)}

def extract_html_events(html, base_url):
    """Extract events from HTML structure (event cards/lists)."""
    events = []
    
    # Find all links with event keywords
    links = re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.I)
    
    for href, content in links:
        href_lower = href.lower()
        content_clean = re.sub(r'<[^>]+>', ' ', content)
        content_clean = re.sub(r'\s+', ' ', content_clean).strip()
        
        if not any(kw in href_lower or kw in content_clean.lower() for kw in EVENT_KEYWORDS): continue
        if len(content_clean) < 5: continue
        if href.startswith('#') or 'javascript:' in href: continue
        
        # Extract date from link content
        date = ''
        for pat in [r'\d{4}-\d{2}-\d{2}', rf'\d{{1,2}}\s+(?:{SWEDISH_MONTHS})\s+\d{{4}}', r'\d{1,2}/\d{1,2}\s+\d{4}']:
            m = re.search(pat, content_clean, re.I)
            if m: date = m.group(0); break
        
        # Make URL absolute
        if not href.startswith('http'):
            href = urljoin(base_url, href)
        
        events.append({
            'title': content_clean[:200],
            'url': href,
            'startDate': date,
            'endDate': '',
            'location': '',
            'description': '',
            'price': '',
            'image': '',
            'categories': '',
            'status': '',
        })
    
    return events

def try_subpages(base_url, timeout=15):
    """Try Swedish event subpage patterns."""
    base = urlparse(base_url)
    base_clean = f'{base.scheme}://{base.netloc}'
    
    patterns = [
        '/evenemang', '/evenemang/', '/evenemangskalender',
        '/kalender', '/kalender/', '/kalendarium',
        '/program', '/program/', '/events', '/events/',
        '/kultur', '/kultur/', '/scen',
    ]
    
    results = []
    for pat in patterns:
        url = base_clean + pat
        html, final_url, err = fetch_html(url, timeout)
        if err: continue
        
        # Score the page
        score = 0
        if 'application/ld+json' in html: score += 30
        if '__INITIAL_STATE__' in html: score += 50
        if 'startDate' in html: score += 20
        dates_found = len(re.findall(r'\d{4}-\d{2}-\d{2}', html))
        score += min(dates_found, 20)
        links_found = len(re.findall(r'evenemang|kalender|konsert|event', html, re.I))
        score += min(links_found, 10)
        
        results.append((score, url, html, final_url))
    
    results.sort(key=lambda x: x[0], reverse=True)
    return results

def scrape_source(source_id, url, timeout=15):
    """Scrape a single source - returns (events, page_type, extra_info)."""
    events = []
    page_type = 'unknown'
    extra = {}
    
    # Step 1: Try main URL
    html, final_url, err = fetch_html(url, timeout)
    
    if err:
        # Step 2: Try subpages
        subpage_results = try_subpages(url, timeout)
        if subpage_results:
            score, best_url, html, final_url = subpage_results[0]
            if score > 0:
                extra['subpage'] = best_url
                extra['subpage_score'] = score
    
    if not html:
        return [], 'failed', {'error': err}
    
    # Count event keywords in HTML
    event_kw_count = sum(1 for _ in re.finditer(r'evenemang|kalender|konsert|event|forestallning', html, re.I))
    extra['event_kw_count'] = event_kw_count
    
    # METHOD 1: JSON from JavaScript (MOST VALUABLE)
    js_events = extract_json_from_js(html)
    if js_events:
        events.extend(js_events)
        page_type = 'B'  # Structured data (JS-embedded)
        extra['js_json_extracted'] = len(js_events)
    
    # METHOD 2: JSON-LD
    jsonld_events = extract_json_ld(html)
    if jsonld_events:
        events.extend(jsonld_events)
        if page_type == 'unknown': page_type = 'B'
        extra['jsonld_extracted'] = len(jsonld_events)
    
    # METHOD 3: HTML event links (only if we found actual event pages)
    if len(events) == 0 and event_kw_count > 5:
        html_events = extract_html_events(html, final_url)
        if html_events:
            events.extend(html_events)
            page_type = 'html'
    
    # Deduplicate
    seen = set()
    unique = []
    for e in events:
        key = e.get('url', '') + '|' + e.get('title', '')
        if key not in seen:
            seen.add(key)
            unique.append(e)
    events = unique
    
    return events, page_type, extra

def run_batch(sources_file, parallel=5, timeout=15):
    """Run on a JSONL file of sources."""
    results = []
    with open(sources_file) as f:
        sources = [json.loads(line) for line in f if line.strip()]
    
    def process_one(s):
        sid = s.get('sourceId', s.get('id', 'unknown'))
        url = s.get('url', s.get('sourceUrl', ''))
        if not url: return None
        events, ptype, extra = scrape_source(sid, url, timeout)
        return {
            'sourceId': sid,
            'url': url,
            'success': len(events) > 0,
            'eventCount': len(events),
            'events': events,
            'pageType': ptype,
            'extra': extra,
        }
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as ex:
        futures = [ex.submit(process_one, s) for s in sources]
        for f in concurrent.futures.as_completed(futures):
            try:
                r = f.result()
                if r:
                    results.append(r)
                    print(json.dumps(r, ensure_ascii=False))
            except Exception as e:
                print(f"ERROR: {e}", file=sys.stderr)
    
    return results

# ─── CLI ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('source_id', nargs='?', help='Source ID')
    ap.add_argument('url', nargs='?', help='URL to scrape')
    ap.add_argument('--batch', '-b', help='JSONL batch file')
    ap.add_argument('--timeout', '-t', type=int, default=15)
    ap.add_argument('--parallel', '-p', type=int, default=5)
    args = ap.parse_args()
    
    if args.batch:
        run_batch(args.batch, parallel=args.parallel, timeout=args.timeout)
    elif args.source_id and args.url:
        events, ptype, extra = scrape_source(args.source_id, args.url, args.timeout)
        result = {'sourceId': args.source_id, 'url': args.url, 'success': len(events)>0,
                  'eventCount': len(events), 'events': events, 'pageType': ptype, 'extra': extra}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        ap.print_help()
