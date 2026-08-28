/**
 * ical.ts — RFC-5545 VCALENDAR generator for EventPulse events.
 *
 * T0058 / Phase 1 retention: calendar export for saved events.
 *
 * Produces a minimal, standards-compliant iCalendar document with one VEVENT.
 * No external library needed — plain string template.
 *
 * Reference: https://datatracker.ietf.org/doc/html/rfc5545#section-3.6.1
 */

import type { CalendarEvent } from './get_event_for_calendar';

/**
 * Fold long lines (RFC-5545 §3.1 — lines longer than 75 octets must be folded).
 */
function fold(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;
  const chunks: string[] = [];
  let i = MAX;
  chunks.push(line.slice(0, MAX));
  while (i < line.length) {
    chunks.push(' ' + line.slice(i, i + MAX - 1));
    i += MAX - 1;
  }
  return chunks.join('\r\n');
}

/**
 * Escape special characters in text values per RFC-5545 §3.3.11.
 * Characters that must be escaped: backslash, newline, carriage return, comma, semicolon.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/&/g, '\\&')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Format a JS Date as UTC (ZTIMESTAMP format: YYYYMMDDTHHmmssZ).
 */
function toUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Format a JS Date as a local datetime for iCalendar.
 * Returns a DATETIME string: YYYYMMDDTHHmmss (Europe/Stockholm).
 */
function toLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}${mo}${day}T${h}${mi}${s}`;
}

/**
 * Generate an RFC-5545 VCALENDAR string for a single event.
 *
 * Duration: 2 hours if end_time is missing.
 * Location: venue_name, city
 * URL: ticket_url (if present)
 * Description: "Källa: {source}" if source is known.
 *
 * The entire document is UTF-8 encoded.
 */
export function generateIcs(event: CalendarEvent, durationHours = 2): string {
  const now = toUtc(new Date());
  const start = new Date(event.start_time);
  const end = event.end_time ? new Date(event.end_time) : new Date(start.getTime() + durationHours * 3600 * 1000);

  const dtStart = toLocal(start);
  const dtEnd = toLocal(end);
  const uid = `${event.id}@eventpulse`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventPulse//Calendar Export//SE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    fold(`UID:${uid}`),
    fold(`DTSTAMP:${now}`),
    fold(`DTSTART;TZID=Europe/Stockholm:${dtStart}`),
    fold(`DTEND;TZID=Europe/Stockholm:${dtEnd}`),
    fold(`SUMMARY:${escapeText(event.title)}`),
  ];

  if (event.venue_name) {
    const location = event.city
      ? `${event.venue_name}, ${event.city}`
      : event.venue_name;
    lines.push(fold(`LOCATION:${escapeText(location)}`));
  }

  if (event.ticket_url) {
    lines.push(fold(`URL:${event.ticket_url}`));
  }

  if (event.source && event.ticket_url) {
    lines.push(fold(`DESCRIPTION:${escapeText(`Källa: ${event.source}`)}`));
  }

  lines.push(
    'END:VEVENT',
    'END:VCALENDAR',
  );

  return lines.join('\r\n');
}
