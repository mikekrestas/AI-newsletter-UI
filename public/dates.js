export const REPORT_TIMEZONE = 'Europe/London';
export function localDay(date = new Date(), timeZone = REPORT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = name => parts.find(item => item.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function midnight(year, month, day, timeZone) {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(guess));
    const part = name => Number(parts.find(item => item.type === name).value);
    const wallTime = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const adjustment = target - wallTime;
    guess += adjustment;
    if (!adjustment) return guess;
  }
  throw new Error('Could not determine this report date.');
}
export function dayRange(value, timeZone = REPORT_TIMEZONE) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid report date.');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) throw new Error('Choose a valid report date.');
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid report date.');
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const start = midnight(year, month, day, timeZone);
  const end = midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  return { start, end, query: `after:${Math.floor(start / 1000) - 1} before:${Math.floor(end / 1000)}` };
}
