#!/usr/bin/env python3
"""
Browser Fetch Tool - Fetches page HTML via headless browser (Playwright).
Used as fallback when curl/axios fails for blocked sites.

Usage: python3 browser-fetch.py <url> [--timeout 15] [--selector <css-selector>]

Output: JSON with {success, html, finalUrl, error, pageTitle}
"""

import sys
import json
import asyncio
from pathlib import Path

# Add project tools to path
project_root = Path(__file__).parent.parent.parent / 'tools'
sys.path.insert(0, str(project_root))

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print(json.dumps({
        'success': False,
        'error': 'playwright not installed. Run: pip install playwright && playwright install chromium'
    }))
    sys.exit(1)


def fetch_via_browser(url: str, timeout: int = 15, selector: str = 'body') -> dict:
    """Fetch a URL using headless browser, return HTML."""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                ]
            )
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1280, 'height': 720},
            )
            page = context.new_page()
            page.set_default_timeout(timeout * 1000)
            
            # Set extra HTTP headers
            page.set_extra_http_headers({
                'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            })
            
            try:
                response = page.goto(url, wait_until='domcontentloaded', timeout=timeout * 1000)
                final_url = page.url
                page_title = page.title()
                
                # Wait a bit for JS-rendered content
                page.wait_for_timeout(2000)
                
                # Get HTML
                html = page.content()
                
                return {
                    'success': True,
                    'html': html,
                    'finalUrl': final_url,
                    'pageTitle': page_title,
                    'httpStatus': response.status if response else 200,
                }
            except Exception as e:
                return {
                    'success': False,
                    'error': str(e),
                    'finalUrl': page.url,
                    'pageTitle': page.title() if page else '',
                }
            finally:
                browser.close()
    except Exception as e:
        return {
            'success': False,
            'error': f'playwright error: {e}',
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: browser-fetch.py <url> [--timeout N]'}))
        sys.exit(1)
    
    url = sys.argv[1]
    timeout = 15
    
    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == '--timeout' and i < len(sys.argv) - 1:
            timeout = int(sys.argv[i])
    
    result = fetch_via_browser(url, timeout)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()