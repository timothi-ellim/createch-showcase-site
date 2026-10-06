export interface EventTime {
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
}

/** Resolve a wall-clock time in its named zone, including DST. Reject gaps. */
export function zonedInstant(date: string, time: string, zone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error('INVALID_EVENT_TIME');
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target)) throw new Error('INVALID_EVENT_TIME');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wall = (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
  };
  let result = target;
  for (let i = 0; i < 4; i++) result += target - Date.parse(wall(result));
  if (wall(result) !== `${date}T${time}:00Z`)
    throw new Error('INVALID_EVENT_TIME');
  // A repeated wall time requires an explicit scheduling decision.
  if (
    wall(result - 3600000) === wall(result) ||
    wall(result + 3600000) === wall(result)
  )
    throw new Error('AMBIGUOUS_EVENT_TIME');
  return result;
}

export function eventInstants(event: EventTime) {
  const start = zonedInstant(event.date, event.startTime, event.timeZone);
  const end = zonedInstant(event.date, event.endTime, event.timeZone);
  if (end <= start) throw new Error('INVALID_EVENT_TIME');
  return { start, end };
}

export function reminderSchedule(event: EventTime) {
  return [7, 1].map((days) => {
    const dateBefore = (offset: number) =>
      new Date(Date.parse(`${event.date}T12:00:00Z`) - offset * 86400000)
        .toISOString()
        .slice(0, 10);
    return {
      kind: days === 7 ? 'week' : 'day',
      at: new Date(
        zonedInstant(dateBefore(days + 1), event.startTime, event.timeZone),
      ).toISOString(),
      until: new Date(
        zonedInstant(dateBefore(days), '23:00', event.timeZone),
      ).toISOString(),
    };
  });
}

export function reminderWindowLabel(
  window: { at: string; until: string },
  zone: string,
) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
  });
  return `${format.format(new Date(window.at))}–${format.format(new Date(window.until))}`;
}

export function countdown(start: number, end: number, now = Date.now()) {
  if (now >= end)
    return { state: 'ended' as const, days: 0, hours: 0, minutes: 0 };
  if (now >= start)
    return { state: 'today' as const, days: 0, hours: 0, minutes: 0 };
  const minutes = Math.ceil((start - now) / 60000);
  return {
    state: 'before' as const,
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
  };
}

export const reminderDateLabel = (at: string, zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));

export const eventDateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
