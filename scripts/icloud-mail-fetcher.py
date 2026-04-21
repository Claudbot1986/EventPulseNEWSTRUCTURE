#!/usr/bin/env python3
"""
iCloud Mail Fetcher
Hämtar mail från iCloud IMAP och sparar innehåll och bilagor till en målmapp.
Användning: python3 icloud-mail-fetcher.py [--user USER] [--password PASS] [--folder FOLDER] [--output PATH] [--days N]
"""

import imaplib
import email
from email.header import decode_header
import os
import sys
import json
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_OUTPUT = "/Users/claudgashi/Desktop/MyVault/TomorGashi/00-Inbox/"
DEFAULT_DAYS = 1  # Hämta bara mail från senaste dygnet

def decode_str(s):
    """Decode email header string."""
    if s is None:
        return ""
    decoded_parts = decode_header(s)
    result = []
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(encoding or 'utf-8', errors='replace'))
            except:
                result.append(part.decode('utf-8', errors='replace'))
        else:
            result.append(part)
    return ''.join(result)

def sanitize_filename(name):
    """Make filename safe."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    if len(name) > 200:
        name = name[:200]
    return name.strip() or "attachment"

def save_attachment(part, output_dir, msg_date):
    """Save single attachment to output dir."""
    filename = decode_str(part.get_filename())
    if not filename:
        return None
    
    filename = sanitize_filename(filename)
    # Add date prefix to avoid overwrites
    date_prefix = msg_date.strftime("%Y%m%d")
    filepath = os.path.join(output_dir, f"{date_prefix}_{filename}")
    
    # Handle duplicates
    base, ext = os.path.splitext(filepath)
    counter = 1
    while os.path.exists(filepath):
        filepath = f"{base}_{counter}{ext}"
        counter += 1
    
    data = part.get_payload(decode=True)
    if data:
        with open(filepath, 'wb') as f:
            f.write(data)
        return filepath
    return None

def get_body(msg):
    """Extract plain text body from email."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                try:
                    charset = part.get_content_charset() or 'utf-8'
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
                    break
                except:
                    pass
    else:
        try:
            charset = msg.get_content_charset() or 'utf-8'
            body = msg.get_payload(decode=True).decode(charset, errors='replace')
        except:
            pass
    return body

def process_mailFetcher_credentials():
    """Load credentials from config file."""
    config_path = os.path.expanduser("~/.eventpulse/icloud-mail-config.json")
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            return json.load(f)
    return {}

def save_credentials(user, password):
    """Save credentials for future runs."""
    config_dir = os.path.expanduser("~/.eventpulse")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "icloud-mail-config.json")
    with open(config_path, 'w') as f:
        json.dump({"user": user, "password": password}, f)
    os.chmod(config_path, 0o600)

def fetch_mail(user, password, output_dir, folder="INBOX", days=1):
    """Connect to iCloud IMAP and fetch emails."""
    
    print(f"Ansluter till iCloud IMAP som {user}...")
    
    try:
        mail = imaplib.IMAP4_SSL("imap.mail.me.com", 993)
        mail.login(user, password)
        mail.select(folder)
        print("Inloggning lyckades!")
    except imaplib.IMAP4.error as e:
        print(f"IMAP-fel vid inloggning: {e}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"Ansutningsfel: {e}", file=sys.stderr)
        return 0
    
    # Search for recent emails
    since_date = (datetime.now(timezone.utc).replace(hour=0, minute=0, second=0) 
                  - __import__('datetime').timedelta(days=days))
    search_criteria = f'SINCE {since_date.strftime("%d-%b-%Y")}'
    
    print(f"Söker efter mail sedan {since_date.strftime('%Y-%m-%d')}...")
    
    try:
        status, messages = mail.search(None, search_criteria)
    except imaplib.IMAP4.error as e:
        print(f"Sökningsfel: {e}", file=sys.stderr)
        mail.logout()
        return 0
    
    if status != 'OK':
        print(f"Sökning misslyckades: {status}")
        mail.logout()
        return 0
    
    ids = messages[0].split()
    print(f"Hittade {len(ids)} mail")
    
    if not ids:
        mail.logout()
        return 0
    
    os.makedirs(output_dir, exist_ok=True)
    saved_count = 0
    
    for mid in ids:
        try:
            status, msg_data = mail.fetch(mid, '(RFC822)')
            if status != 'OK':
                continue
            
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            
            subject = decode_str(msg.get('Subject', '(no subject)'))
            sender = decode_str(msg.get('From', ''))
            date_str = msg.get('Date', '')
            
            # Parse date
            try:
                msg_date = email.utils.parsedate_to_datetime(date_str)
            except:
                msg_date = datetime.now(timezone.utc)
            
            date_prefix = msg_date.strftime("%Y%m%d_%H%M%S")
            
            # Get body
            body = get_body(msg)
            
            # Save body as .txt if non-empty
            if body and body.strip():
                body_file = os.path.join(output_dir, f"{date_prefix}_body.txt")
                # Avoid overwrite
                if os.path.exists(body_file):
                    body_file = f"{body_file.rstrip('.txt')}_1.txt"
                with open(body_file, 'w', encoding='utf-8') as f:
                    f.write(f"From: {sender}\n")
                    f.write(f"Subject: {subject}\n")
                    f.write(f"Date: {date_str}\n")
                    f.write(f"\n---\n\n")
                    f.write(body)
                print(f"  Spara mail: {subject[:50]} -> {os.path.basename(body_file)}")
                saved_count += 1
            
            # Save attachments
            for part in msg.walk():
                content_disposition = part.get("Content-Disposition", "")
                if "attachment" in content_disposition:
                    filepath = save_attachment(part, output_dir, msg_date)
                    if filepath:
                        print(f"  Bilaga: {os.path.basename(filepath)}")
                        saved_count += 1
            
            # Also check for inline attachments
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    filename = part.get_filename()
                    if filename and content_type not in ('text/plain', 'text/html'):
                        filepath = save_attachment(part, output_dir, msg_date)
                        if filepath:
                            print(f"  Inline: {os.path.basename(filepath)}")
                            saved_count += 1
        
        except Exception as e:
            print(f"  Fel vid hämtning av mail {mid}: {e}")
            continue
    
    mail.logout()
    print(f"\nKlart! Sparade {saved_count} filer till {output_dir}")
    return saved_count

def main():
    parser = argparse.ArgumentParser(description="Hämta mail från iCloud till lokal mapp")
    parser.add_argument('--user', help='iCloud-e-postadress (t.ex. namn@icloud.com eller namn@me.com)')
    parser.add_argument('--password', help='App-lösenord för iCloud')
    parser.add_argument('--output', default=DEFAULT_OUTPUT, help=f'Utdatamapp (default: {DEFAULT_OUTPUT})')
    parser.add_argument('--folder', default='INBOX', help='IMAP-mapp (default: INBOX)')
    parser.add_argument('--days', type=int, default=DEFAULT_DAYS, help='Hämta mail från senaste N dygn (default: 1)')
    parser.add_argument('--save-creds', action='store_true', help='Spara inloggningsuppgifter för framtida bruk')
    
    args = parser.parse_args()
    
    # Load saved credentials if available
    saved_creds = process_mailFetcher_credentials()
    
    user = args.user or saved_creds.get('user')
    password = args.password or saved_creds.get('password')
    
    if not user or not password:
        print("Fel: Du måste ange --user och --password", file=sys.stderr)
        print("  Exempel: python3 icloud-mail-fetcher.py --user 'namn@icloud.com' --password 'xxxx-xxxx-xxxx-xxxx'")
        print("\n  ELLER spara via --save-creds nästa gång du kör.")
        print("\n  Obs: Använd ett Apple 'App-specific password', inte ditt vanliga lösenord.")
        print("  Skapa ett på: https://appleid.apple.com -> Sign In -> Security -> App-Specific Passwords")
        sys.exit(1)
    
    if args.save_creds:
        save_credentials(user, password)
        print("Uppgifter sparade.")
    
    count = fetch_mail(user, password, args.output, args.folder, args.days)
    sys.exit(0 if count > 0 else 1)

if __name__ == '__main__':
    main()
