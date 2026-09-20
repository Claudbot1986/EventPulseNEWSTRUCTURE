/**
 * Din helg (2026-09-20): the upcoming Friday–Sunday as a set of local
 * YYYY-MM-DD strings. On Fri/Sat/Sun "the weekend" IS this weekend (today
 * included); Mon–Thu it means the coming one. The v1 Din helg section is a
 * client-side filter over /agent/recommended — no server route (per plan).
 *
 * Lives in its own module so vitest can pin the day-edge semantics
 * (see weekendDates.test.ts).
 */

function localIso(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function upcomingWeekendIsoSet(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = base.getDay(); // 0=Sun, 1=Mon … 5=Fri, 6=Sat
  const friOffset = day === 5 ? 0 : day === 6 ? -1 : day === 0 ? -2 : 5 - day;
  const fri = new Date(base);
  fri.setDate(base.getDate() + friOffset);
  const sat = new Date(fri);
  sat.setDate(fri.getDate() + 1);
  const sun = new Date(fri);
  sun.setDate(fri.getDate() + 2);
  return new Set([localIso(fri), localIso(sat), localIso(sun)]);
}
