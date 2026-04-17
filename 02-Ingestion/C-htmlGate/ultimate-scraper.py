#!/usr/bin/env python3
"""
Ultimate Event Scraper — EventPulse C-htmlGate Companion Tool
Boil the ocean: scrape events from ANY Swedish event page, no AI needed.

Usage:
  python3 ultimate-scraper.py <source_id> <url> [--timeout 15] [--verbose]
  python3 ultimate-scraper.py --batch <file.jsonl> [--parallel 3]

Output: JSON events to stdout, metadata to stderr
"""
import sys
import os
import re
import json
import ssl
import urllib.request
import urllib.error
import urllib.parse
import datetime
import time
import argparse
from html.parser import HTMLParser
from collections import defaultdict

# ─── Configuration ────────────────────────────────────────────────────────────
SWEDISH_MONTHS = {
    'januari': 1, 'februari': 2, 'mars': 3, 'april': 4,
    'maj': 5, 'juni': 6, 'juli': 7, 'augusti': 8,
    'september': 9, 'oktober': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'okt': 10, 'nov': 11, 'dec': 12
}

SWEDISH_MONTH_RE = '|'.join(SWEDISH_MONTHS.keys())

# Swedish event path patterns to try
SWEDISH_PATTERNS = [
    '/evenemang', '/evenemang/', '/event', '/events', '/events/',
    '/kalender', '/kalender/', '/kalendarium', '/kalendarium/',
    '/program', '/program/', '/schema', '/schema/',
    '/biljetter', '/biljetter/', '/konserter', '/konserter/',
    '/kultur', '/kultur/', '/scen', '/scen/',
    '/nyheter', '/nyheter/', '/aktuellt', '/aktuellt/',
    '/forestallningar', '/forestallningar/',
    '/visningar', '/visningar/', '/utstallningar', '/utstallningar/',
    '/aktiviteter', '/aktiviteter/', '/matcher',
]

# Event-related keywords for link detection
EVENT_LINK_KEYWORDS = [
    'evenemang', 'event', 'events', 'kalender', 'kalendarium',
    'program', 'schema', 'biljett', 'biljetter', 'konsert',
    'forestallning', 'forestallningar', 'visning', 'visningar',
    'utstallning', 'utstallningar', 'aktivitet', 'aktiviteter',
    'match', 'matcher', 'spel', 'spelschema', 'tickes', 'tickets',
    'book', 'booka', 'boka', 'anmalan', 'anmälan',
]

# Page quality signals
HIGH_VALUE_TAGS = ['article', 'main', '[role="main"]', '[role="content"]']
LOW_VALUE_TAGS = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript']

# ─── HTML Fetcher ────────────────────────────────────────────────────────────
class FetchResult:
    def __init__(self, html='', url='', success=False, error='', status_code=0, final_url=''):
        self.html = html
        self.url = url
        self.success = success
        self.error = error
        self.status_code = status_code
        self.final_url = final_url

def fetch_url(url, timeout=15, user_agent=None):
    """Fetch a URL with proper headers, SSL, and redirect following."""
    if user_agent is None:
        user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    
    headers = {
        'User-Agent': user_agent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    # Create SSL context that handles bad certificates
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx),
            urllib.request.HTTPRedirectHandler()
        )
        response = opener.open(req, timeout=timeout)
        final_url = response.geturl()
        status = response.status
        content = response.read()
        
        # Decode, try utf-8 first, then fallback
        try:
            html = content.decode('utf-8')
        except:
            try:
                html = content.decode('latin-1')
            except:
                html = content.decode('utf-8', errors='replace')
        
        return FetchResult(html=html, url=url, success=True, status_code=status, final_url=final_url)
    
    except urllib.error.HTTPError as e:
        return FetchResult(url=url, success=False, error=f'HTTP {e.code}', status_code=e.code)
    except urllib.error.URLError as e:
        return FetchResult(url=url, success=False, error=f'URL error: {e.reason}')
    except Exception as e:
        return FetchResult(url=url, success=False, error=f'Error: {str(e)}')


# ─── HTML Parser ─────────────────────────────────────────────────────────────
class EventHTMLParser(HTMLParser):
    """Extract event data from HTML using structural analysis."""
    
    def __init__(self):
        super().__init__()
        self.events = []
        self.current_event = None
        self.tag_stack = []
        self.text_buffer = ''
        self.in_script = False
        self.in_style = False
        self.in_nav = False
        self.in_header = False
        self.in_footer = False
        
        # Event signals
        self.current_href = ''
        self.current_text = ''
        self.current_date = ''
        self.current_time = ''
        self.current_location = ''
        self.current_price = ''
        self.current_title = ''
        self.current_img = ''
        
        # Page-level data
        self.all_links = {}  # href -> (text, context)
        self.all_dates = []
        self.all_headings = []
        self.json_ld_data = []
        self.anchor_stack = []
        
        # Scanning mode (pass 1 vs pass 2)
        self._pass = 1
        
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        if tag in ('script', 'style'):
            if tag == 'script':
                self.in_script = True
                # Check for JSON-LD
                if 'type' in attrs_dict and attrs_dict['type'] == 'application/ld+json':
                    pass  # Will be handled in handle_data
            elif tag == 'style':
                self.in_style = True
            return
        
        if tag == 'a':
            href = attrs_dict.get('href', '')
            self.anchor_stack.append({'href': href, 'text': ''})
        
        if tag in ('time',):
            for k, v in attrs:
                if k == 'datetime':
                    self.all_dates.append({'type': 'time_tag', 'value': v})
        
        if tag in ('h1', 'h2', 'h3', 'h4'):
            pass  # heading text collected in handle_data
        
        if tag == 'img':
            src = attrs_dict.get('src', '') or attrs_dict.get('data-src', '')
            alt = attrs_dict.get('alt', '')
            # Store first image as potential event image
            if src and not self.current_img:
                self.current_img = src
    
    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            if tag == 'script':
                self.in_script = False
            elif tag == 'style':
                self.in_style = False
            return
        
        if tag == 'a' and self.anchor_stack:
            anchor = self.anchor_stack.pop()
            href = anchor['href']
            text = anchor['text'].strip()
            if href and text:
                self.all_links[href] = {'text': text, 'context': self._get_context()}
        
        # When closing a major block, try to extract event
        if tag in ('article', 'div', 'li', 'section'):
            self._try_extract_event()
    
    def handle_data(self, data):
        if self.in_script or self.in_style:
            return
        
        text = data.strip()
        if not text:
            return
        
        # Track text in current anchor
        if self.anchor_stack:
            self.anchor_stack[-1]['text'] += ' ' + text
        
        # Accumulate heading text
        self.text_buffer += ' ' + text
        
        # Track dates in text
        self._scan_dates(text)
        
        # Check for price
        price_match = re.search(r'(?:pris|price|SEK|kr)\s*:?\s*(\d+[\s\d]*)|(\d+)\s*(?:kr|sek)', text, re.I)
        if price_match:
            self.current_price = text
    
    def _get_context(self):
        """Get surrounding context tags."""
        return ''
    
    def _scan_dates(self, text):
        """Scan for date patterns in text."""
        # ISO date
        iso = re.findall(r'\d{4}-\d{2}-\d{2}', text)
        for d in iso:
            self.all_dates.append({'type': 'iso', 'value': d})
        
        # Swedish date: 15 januari 2024 or 15 jan 2024
        swe = re.findall(rf'\d{{1,2}}\s+({SWEDISH_MONTH_RE})\s+\d{{4}}', text, re.I)
        for d in swe:
            self.all_dates.append({'type': 'swedish', 'value': d})
        
        # Short Swedish: 15/1 2024
        short = re.findall(r'\d{1,2}/\d{1,2}\s+\d{4}', text)
        for d in short:
            self.all_dates.append({'type': 'short_swe', 'value': d})
        
        # Day + date: "måndag 15 januari"
        day_date = re.findall(r'(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\s+\d{1,2}\s+' + SWEDISH_MONTH_RE, text, re.I)
        for d in day_date:
            self.all_dates.append({'type': 'day_swe', 'value': d})
    
    def _try_extract_event(self):
        """Try to extract an event from accumulated data."""
        # Reset for next potential event
        pass
    
    def done(self):
        """Return all collected data."""
        return {
            'links': self.all_links,
            'dates': self.all_dates,
            'text': self.text_buffer[:5000],  # First 5000 chars
            'json_ld': self.json_ld_data,
        }


# ─── Event Extractor ─────────────────────────────────────────────────────────
class EventExtractor:
    """Main event extraction logic."""
    
    def __init__(self, source_id, base_url, html):
        self.source_id = source_id
        self.base_url = base_url
        self.html = html
        self.events = []
        self.parser = EventHTMLParser()
        
    def extract(self):
        """Run extraction pipeline."""
        # Step 1: Try JSON-LD first
        jsonld_events = self._extract_json_ld()
        if jsonld_events:
            self.events.extend(jsonld_events)
            return self.events
        
        # Step 2: Parse HTML structurally
        self.parser.feed(self.html)
        page_data = self.parser.done()
        
        # Step 3: Try multiple extraction strategies
        microdata_events = self._extract_microdata()
        if microdata_events:
            self.events.extend(microdata_events)
        
        # Step 4: Search for event cards/lists
        list_events = self._extract_event_lists()
        if list_events:
            self.events.extend(list_events)
        
        # Step 5: Generic date+link extraction
        generic_events = self._extract_generic_events()
        if generic_events:
            self.events.extend(generic_events)
        
        # Deduplicate by URL
        seen = set()
        unique = []
        for e in self.events:
            url = e.get('url', '')
            if url and url not in seen:
                seen.add(url)
                unique.append(e)
        
        return unique
    
    def _extract_json_ld(self):
        """Extract events from JSON-LD script tags."""
        events = []
        
        # Find all JSON-LD script blocks
        pattern = r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
        matches = re.findall(pattern, self.html, re.DOTALL | re.I)
        
        for match in matches:
            try:
                data = json.loads(match)
                extracted = self._parse_json_ld_item(data)
                events.extend(extracted)
            except:
                pass
        
        return events
    
    def _parse_json_ld_item(self, data):
        """Recursively parse JSON-LD data."""
        events = []
        
        if isinstance(data, list):
            for item in data:
                events.extend(self._parse_json_ld_item(item))
            return events
        
        if not isinstance(data, dict):
            return events
        
        # Check @type
        item_type = data.get('@type', '')
        
        # Event types
        if item_type in ('Event', 'MusicEvent', 'TheaterEvent', 'SportsEvent', 
                         'CulturalEvent', 'SocialEvent', 'Festival'):
            event = self._normalize_jsonld_event(data)
            if event:
                events.append(event)
        
        # Check @graph
        if '@graph' in data:
            for item in data['@graph']:
                events.extend(self._parse_json_ld_item(item))
        
        return events
    
    def _normalize_jsonld_event(self, data):
        """Convert JSON-LD event to standard format."""
        name = data.get('name', '')
        if not name:
            return None
        
        url = data.get('url', '')
        description = data.get('description', '')
        
        # Date handling
        start_date = ''
        if 'startDate' in data:
            start_date = data['startDate']
        elif 'doorTime' in data:
            start_date = data['doorTime']
        
        end_date = data.get('endDate', '')
        
        # Location
        location = ''
        loc_data = data.get('location', {})
        if isinstance(loc_data, str):
            location = loc_data
        elif isinstance(loc_data, dict):
            location = loc_data.get('name', '')
        
        # Image
        image = ''
        img = data.get('image', '')
        if isinstance(img, list):
            image = img[0] if img else ''
        elif isinstance(img, str):
            image = img
        
        # Price
        price = ''
        offer = data.get('offers', {})
        if isinstance(offer, dict):
            price = offer.get('price', '')
        elif isinstance(offer, list) and offer:
            price = offer[0].get('price', '')
        
        # Status
        event_status = data.get('eventStatus', 'https://schema.org/EventScheduled')
        
        return {
            'sourceId': self.source_id,
            'sourceUrl': self.base_url,
            'title': name,
            'url': url,
            'description': description[:500] if description else '',
            'startDate': start_date,
            'endDate': end_date,
            'location': location,
            'image': image,
            'price': str(price) if price else '',
            'status': event_status,
            'extractedAt': datetime.datetime.now().isoformat(),
        }
    
    def _extract_microdata(self):
        """Extract events from HTML5 microdata."""
        events = []
        
        # Find all elements with itemtype containing Event
        pattern = r'<[^>]+itemtype=["\'][^"\']*["\']Event["\'][^>]*>(.*?)</[^>]+>'
        # Simpler: just search for itemscope containing Event
        event_blocks = re.findall(r'<[^>]*(?:itemscope)[^>]*(?:itemtype=["\'][^"\']*Event)[^>]*>(.*?)</[^>]+>', 
                                   self.html, re.DOTALL | re.I)
        
        for block in event_blocks:
            event = self._parse_microdata_block(block)
            if event:
                events.append(event)
        
        return events
    
    def _parse_microdata_block(self, block_html):
        """Parse a microdata event block."""
        parser = EventHTMLParser()
        parser.feed(block_html)
        data = parser.done()
        
        # Extract structured data from the block
        # Look for common patterns
        title_match = re.search(r'<[^>]*(?:itemprop=["\']name["\'])[^>]*>([^<]+)<', block_html, re.I)
        date_match = re.search(r'<[^>]*(?:itemprop=["\'][^"\']*(?:startDate|doorTime|date)["\'])[^>]*>([^<]+)<', block_html, re.I)
        url_match = re.search(r'<a[^>]*href=["\']([^"\']+)["\'][^>]*>([^<]*' + (title_match.group(1) if title_match else '') + r')', block_html, re.I)
        
        title = title_match.group(1).strip() if title_match else ''
        date = date_match.group(1).strip() if date_match else ''
        url = url_match.group(1).strip() if url_match else ''
        
        if not title:
            return None
        
        return {
            'sourceId': self.source_id,
            'sourceUrl': self.base_url,
            'title': title,
            'url': url,
            'startDate': date,
            'location': '',
            'extractedAt': datetime.datetime.now().isoformat(),
        }
    
    def _extract_event_lists(self):
        """Extract events from structured event lists/cards."""
        events = []
        
        # Common event list containers
        list_selectors = [
            r'<ul[^>]*(?:class=["\'][^"\']*(?:event|kalender|evenemang|program)[^"\']*["\'])[^>]*>(.*?)</ul>',
            r'<ol[^>]*(?:class=["\'][^"\']*(?:event|kalender|evenemang|program)[^"\']*["\'])[^>]*>(.*?)</ol>',
            r'<div[^>]*(?:class=["\'][^"\']*(?:event-card|event-item|kalender-post|evenemang-post)[^"\']*["\'])[^>]*>(.*?)</div>',
            r'<article[^>]*(?:class=["\'][^"\']*(?:event|kalender|evenemang)[^"\']*["\'])[^>]*>(.*?)</article>',
        ]
        
        for pattern in list_selectors:
            matches = re.findall(pattern, self.html, re.DOTALL | re.I)
            for match in matches:
                event = self._extract_event_from_block(match)
                if event:
                    events.append(event)
        
        return events
    
    def _extract_event_from_block(self, block_html):
        """Extract event data from a single block (card/list item)."""
        # Remove script and style blocks
        clean = re.sub(r'<script[^>]*>.*?</script>', '', block_html, flags=re.DOTALL | re.I)
        clean = re.sub(r'<style[^>]*>.*?</style>', '', clean, flags=re.DOTALL | re.I)
        
        # Get text content
        text = re.sub(r'<[^>]+>', ' ', clean)
        text = re.sub(r'\s+', ' ', text).strip()
        
        # Skip if too short
        if len(text) < 20:
            return None
        
        # Extract URL from first link
        url_match = re.search(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>', clean, re.I)
        url = url_match.group(1) if url_match else ''
        
        # Make URL absolute
        if url and not url.startswith('http'):
            if url.startswith('//'):
                url = 'https:' + url
            elif url.startswith('/'):
                base = urllib.parse.urlparse(self.base_url)
                url = f'{base.scheme}://{base.netloc}{url}'
            else:
                url = urllib.parse.urljoin(self.base_url, url)
        
        # Extract title from heading or strong text
        title = ''
        for tag in ['h1', 'h2', 'h3', 'h4']:
            match = re.search(f'<{tag}[^>]*>([^<]+)</{tag}>', clean, re.I)
            if match:
                title = match.group(1).strip()
                break
        
        if not title:
            # First substantial text
            match = re.search(r'>([A-ZÄÖÅ][^<]{10,100})<', clean)
            if match:
                title = match.group(1).strip()
        
        if not title:
            title = text[:80]
        
        # Extract date
        date = ''
        date_patterns = [
            r'\d{4}-\d{2}-\d{2}',
            rf'\d{{1,2}}\s+{SWEDISH_MONTH_RE}\s+\d{{4}}',
            r'\d{1,2}/\d{1,2}\s+\d{4}',
            r'\d{1,2}\s+\d{1,2}\s+\d{4}',
        ]
        for dp in date_patterns:
            match = re.search(dp, text, re.I)
            if match:
                date = match.group(0)
                break
        
        if not date:
            match = re.search(r'<time[^>]*datetime=["\']([^"\']+)["\']', clean, re.I)
            if match:
                date = match.group(1)
        
        return {
            'sourceId': self.source_id,
            'sourceUrl': self.base_url,
            'title': title,
            'url': url,
            'startDate': date,
            'textPreview': text[:200],
            'extractedAt': datetime.datetime.now().isoformat(),
        }
    
    def _extract_generic_events(self):
        """Generic event extraction from date+link patterns."""
        events = []
        
        parser = EventHTMLParser()
        parser.feed(self.html)
        page_data = parser.done()
        
        # Find links that look like event pages
        event_links = []
        for href, info in page_data['links'].items():
            text = info['text'].lower()
            href_lower = href.lower()
            
            for kw in EVENT_LINK_KEYWORDS:
                if kw in text or kw in href_lower:
                    event_links.append({'href': href, 'text': info['text']})
                    break
        
        # For each event link, try to fetch and extract
        # But first, check if the current page has a date list
        dates = page_data['dates']
        links = page_data['links']
        
        # Match dates with nearby links
        text = page_data['text']
        
        # Look for patterns like: "15 januari - Event Name"
        date_event_pattern = rf'(\d{{1,2}}\s+{SWEDISH_MONTH_RE})\s*[-–—:]\s*([^\n\r]{{5,100}})'
        matches = re.findall(date_event_pattern, text, re.I)
        for date_str, title in matches:
            title = title.strip()
            if len(title) > 5:
                events.append({
                    'sourceId': self.source_id,
                    'sourceUrl': self.base_url,
                    'title': title,
                    'startDate': date_str,
                    'url': '',
                    'extractedAt': datetime.datetime.now().isoformat(),
                })
        
        # ISO date patterns
        iso_pattern = r'(\d{4}-\d{2}-\d{2})\s*[-–—:]\s*([^\n\r]{{5,100}})'
        matches = re.findall(iso_pattern, text)
        for date_str, title in matches:
            title = title.strip()
            if len(title) > 5:
                events.append({
                    'sourceId': self.source_id,
                    'sourceUrl': self.base_url,
                    'title': title,
                    'startDate': date_str,
                    'url': '',
                    'extractedAt': datetime.datetime.now().isoformat(),
                })
        
        return events


# ─── URL Discovery ──────────────────────────────────────────────────────────
def discover_event_urls(source_id, base_url, html, max_urls=20):
    """Discover event URLs from a page's links and patterns."""
    discovered = []
    seen = set()
    
    parser = EventHTMLParser()
    parser.feed(html)
    page_data = parser.done()
    
    base = urllib.parse.urlparse(base_url)
    base_domain = base.netloc
    
    for href, info in page_data['links'].items():
        if len(discovered) >= max_urls:
            break
        
        text = info['text'].lower()
        href_lower = href.lower()
        
        # Skip navigation and utility links
        if any(nav in href_lower for nav in ['/nav', '/menu', '/footer', '/header', '/sitemap']):
            continue
        if any(nav in text for nav in ['logga in', 'signa in', 'sök', 'search', 'cart', 'varukorg']):
            continue
        
        # Check if link looks like an event
        is_event = False
        for kw in EVENT_LINK_KEYWORDS:
            if kw in text or kw in href_lower:
                is_event = True
                break
        
        if not is_event:
            continue
        
        # Make absolute URL
        url = href
        if url and not url.startswith('http'):
            if url.startswith('//'):
                url = 'https:' + url
            elif url.startswith('/'):
                url = f'{base.scheme}://{base.netloc}{url}'
            else:
                url = urllib.parse.urljoin(base_url, url)
        
        if url and url not in seen:
            # Verify same domain or related
            parsed = urllib.parse.urlparse(url)
            if parsed.netloc == base_domain or not parsed.netloc:
                seen.add(url)
                discovered.append({
                    'url': url,
                    'text': info['text'],
                    'sourceId': source_id,
                })
    
    return discovered


def try_subpages(source_id, base_url, timeout=15):
    """Try Swedish event path patterns to find working event pages."""
    base = urllib.parse.urlparse(base_url)
    base_url_clean = f'{base.scheme}://{base.netloc}'
    
    results = []
    
    for pattern in SWEDISH_PATTERNS:
        url = base_url_clean + pattern
        result = fetch_url(url, timeout=timeout)
        
        if result.success:
            # Check if page has event content
            parser = EventHTMLParser()
            parser.feed(result.html)
            page_data = parser.done()
            
            has_dates = len(page_data['dates']) > 0
            has_event_links = len([l for l in page_data['links'].items() 
                                   if any(kw in l[0].lower() or kw in l[1]['text'].lower() 
                                          for kw in EVENT_LINK_KEYWORDS)]) > 0
            has_content = len(page_data['text']) > 500
            
            quality = sum([has_dates, has_event_links, has_content])
            
            results.append({
                'url': url,
                'success': True,
                'quality': quality,
                'dates_count': len(page_data['dates']),
                'event_links': has_event_links,
                'has_content': has_content,
                'text_len': len(page_data['text']),
            })
    
    # Sort by quality
    results.sort(key=lambda x: x['quality'], reverse=True)
    
    return results


# ─── Main Scraper Class ──────────────────────────────────────────────────────
class UltimateScraper:
    """The ultimate event scraper for EventPulse."""
    
    def __init__(self, source_id, url, timeout=15, verbose=False):
        self.source_id = source_id
        self.url = url
        self.timeout = timeout
        self.verbose = verbose
        
        self.events = []
        self.subpages_tried = []
        self.json_ld_found = 0
        self.page_type = 'unknown'  # A, B, D, or html
        self.quality_score = 0
        
    def log(self, msg):
        if self.verbose:
            print(f'[Scraper] {msg}', file=sys.stderr)
    
    def scrape(self):
        """Run the complete scraping pipeline."""
        self.log(f'Starting scrape for {self.source_id}: {self.url}')
        
        # Step 1: Fetch main page
        main_result = fetch_url(self.url, timeout=self.timeout)
        
        if not main_result.success:
            self.log(f'Main page fetch failed: {main_result.error}')
            
            # Step 2: Try Swedish subpage patterns
            self.log('Trying Swedish event subpages...')
            subpage_results = try_subpages(self.source_id, self.url, timeout=self.timeout)
            
            if subpage_results and subpage_results[0]['quality'] > 0:
                best = subpage_results[0]
                self.log(f'Found working subpage: {best["url"]} (quality={best["quality"]})')
                self.subpages_tried = [s['url'] for s in subpage_results]
                
                # Fetch the best subpage
                result = fetch_url(best['url'], timeout=self.timeout)
                if result.success:
                    return self._process_page(result, best_subpage=True)
            
            # Step 3: Try root domain variations
            root_results = self._try_root_variations()
            if root_results:
                return root_results
            
            return self._empty_result(error=f'Could not fetch {self.url}: {main_result.error}')
        
        return self._process_page(main_result, best_subpage=False)
    
    def _process_page(self, result, best_subpage=False):
        """Process a fetched page."""
        html = result.html
        page_url = result.final_url or result.url
        
        self.log(f'Processing page: {page_url} ({len(html)} bytes)')
        
        # Check for JSON-LD
        jsonld_count = html.count('application/ld+json')
        self.json_ld_found = jsonld_count
        self.log(f'JSON-LD blocks found: {jsonld_count}')
        
        # Extract events
        extractor = EventExtractor(self.source_id, page_url, html)
        self.events = extractor.extract()
        
        self.log(f'Events extracted: {len(self.events)}')
        
        # Discover additional event URLs
        event_links = discover_event_urls(self.source_id, page_url, html)
        self.log(f'Event links discovered: {len(event_links)}')
        
        # Determine page type
        self._determine_page_type(html, jsonld_count)
        
        # Fetch individual event pages if we found links
        if len(event_links) > 0 and len(self.events) == 0:
            self.log(f'Fetching {len(event_links)} individual event pages...')
            self._fetch_event_pages(event_links[:10])  # Limit to 10
        
        # Calculate quality score
        self._calculate_quality(html, len(self.events), jsonld_count, len(event_links))
        
        return self._build_result(page_url, best_subpage)
    
    def _fetch_event_pages(self, event_links):
        """Fetch individual event pages."""
        for link_info in event_links:
            url = link_info['url']
            if not url:
                continue
            
            result = fetch_url(url, timeout=self.timeout)
            if not result.success:
                continue
            
            extractor = EventExtractor(self.source_id, url, result.html)
            events = extractor.extract()
            
            for event in events:
                # Prefer event page data over list page data
                if event.get('url'):
                    # Check for duplicates
                    if not any(e.get('url') == event['url'] for e in self.events):
                        self.events.append(event)
    
    def _determine_page_type(self, html, jsonld_count):
        """Determine if this is type A (API), B (structured), D (JS-render), or HTML."""
        html_lower = html.lower()
        
        # Type A: Has API/RSS/ICS endpoints
        if any(k in html_lower for k in ['/api/', '/feed', '/rss', '.ics', '/json']):
            if jsonld_count > 0 or 'application/ld+json' in html_lower:
                self.page_type = 'A'
                return
        
        # Type B: Has structured data (JSON-LD, microdata)
        if jsonld_count > 0 or 'itemtype' in html_lower:
            self.page_type = 'B'
            return
        
        # Type D: Very little text, likely JS-rendered
        text_len = len(html) - len(re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.I))
        text_len = len(re.sub(r'<[^>]+>', '', html))
        if text_len < 500:
            self.page_type = 'D'
            return
        
        # Default: HTML
        self.page_type = 'html'
    
    def _calculate_quality(self, html, event_count, jsonld_count, event_link_count):
        """Calculate page quality score (0-100)."""
        score = 0
        
        # Events found
        if event_count > 0:
            score += min(50, event_count * 10)
        
        # JSON-LD
        if jsonld_count > 0:
            score += min(20, jsonld_count * 5)
        
        # Event links
        if event_link_count > 0:
            score += min(20, event_link_count * 2)
        
        # Page has actual content
        text_len = len(re.sub(r'<[^>]+>', '', html))
        if text_len > 1000:
            score += 10
        
        self.quality_score = min(100, score)
    
    def _try_root_variations(self):
        """Try common root domain variations."""
        base = urllib.parse.urlparse(self.url)
        base_url_clean = f'{base.scheme}://{base.netloc}'
        
        variations = [
            f'{base_url_clean}/',
            f'{base_url_clean}/www/',
            base_url_clean.replace('www.', ''),
            base_url_clean.replace('http://', 'https://'),
        ]
        
        # Remove duplicates
        variations = list(dict.fromkeys(variations))
        
        for url in variations:
            if url == self.url:
                continue
            
            result = fetch_url(url, timeout=self.timeout)
            if result.success:
                return self._process_page(result, best_subpage=True)
        
        return None
    
    def _build_result(self, page_url, best_subpage):
        """Build final result object."""
        return {
            'sourceId': self.source_id,
            'url': page_url,
            'success': len(self.events) > 0,
            'eventCount': len(self.events),
            'events': self.events,
            'pageType': self.page_type,
            'qualityScore': self.quality_score,
            'jsonLdFound': self.json_ld_found,
            'subpagesTried': self.subpages_tried,
            'bestSubpage': page_url if best_subpage else None,
        }
    
    def _empty_result(self, error=''):
        """Build empty result."""
        return {
            'sourceId': self.source_id,
            'url': self.url,
            'success': False,
            'eventCount': 0,
            'events': [],
            'pageType': 'failed',
            'qualityScore': 0,
            'jsonLdFound': 0,
            'subpagesTried': self.subpages_tried,
            'error': error,
        }


# ─── Batch Runner ────────────────────────────────────────────────────────────
def run_batch(input_file, parallel=3, timeout=15, verbose=False):
    """Run scraper on multiple sources from a JSONL file."""
    import concurrent.futures
    
    sources = []
    with open(input_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                sources.append(json.loads(line))
    
    results = []
    
    def scrape_one(source):
        scraper = UltimateScraper(
            source['sourceId'],
            source['url'],
            timeout=timeout,
            verbose=verbose
        )
        return scraper.scrape()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as executor:
        futures = {executor.submit(scrape_one, s): s for s in sources}
        
        for future in concurrent.futures.as_completed(futures, timeout=timeout * len(sources)):
            try:
                result = future.result()
                results.append(result)
                
                # Output as JSONL
                print(json.dumps(result, ensure_ascii=False))
                
                if verbose:
                    print(f"[Batch] Processed {result['sourceId']}: {result['eventCount']} events, type={result['pageType']}", 
                          file=sys.stderr)
            except Exception as e:
                source = futures[future]
                print(f"[Batch] Error processing {source.get('sourceId', 'unknown')}: {str(e)}", file=sys.stderr)
    
    return results


# ─── CLI ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Ultimate Event Scraper for EventPulse')
    parser.add_argument('source_id', nargs='?', help='Source ID')
    parser.add_argument('url', nargs='?', help='URL to scrape')
    parser.add_argument('--batch', '-b', help='JSONL file with sources')
    parser.add_argument('--timeout', '-t', type=int, default=15, help='Timeout in seconds')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--parallel', '-p', type=int, default=3, help='Parallel workers for batch')
    
    args = parser.parse_args()
    
    if args.batch:
        run_batch(args.batch, parallel=args.parallel, timeout=args.timeout, verbose=args.verbose)
        return
    
    if not args.source_id or not args.url:
        parser.print_help()
        print('\nExamples:')
        print('  python3 ultimate-scraper.py my-source https://example.se/evenemang')
        print('  python3 ultimate-scraper.py --batch sources.jsonl --parallel 5')
        return
    
    scraper = UltimateScraper(args.source_id, args.url, timeout=args.timeout, verbose=args.verbose)
    result = scraper.scrape()
    
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
