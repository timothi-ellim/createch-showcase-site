// Browser-safe, event-local time rules. Database RPCs enforce the same boundaries.
export interface PresenceEvent {
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  presenceSlotMinutes?: number;
}
export interface PresenceWindow {
  start: string;
  end: string;
}
export type AttendanceMode =
  'whole_event' | 'selected_slots' | 'not_attending' | 'unsure';
export interface PresenceSelection {
  mode: AttendanceMode;
  slots: number[];
}
export function minutes(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('INVALID_PRESENCE');
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export function clockTime(value: number): string {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
export function eventSlots(event: PresenceEvent): PresenceWindow[] {
  const start = minutes(event.startTime),
    end = minutes(event.endTime),
    step = event.presenceSlotMinutes ?? 30;
  if (
    event.timeZone !== 'Europe/London' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
    !Number.isInteger(step) ||
    step < 15 ||
    step > 60 ||
    start >= end ||
    (end - start) % step
  )
    throw new Error('INVALID_PRESENCE_EVENT');
  return Array.from({ length: (end - start) / step }, (_, i) => ({
    start: clockTime(start + i * step),
    end: clockTime(start + (i + 1) * step),
  }));
}
export function scheduleIdentity(event: PresenceEvent): string {
  eventSlots(event);
  return [
    event.date,
    event.startTime,
    event.endTime,
    event.timeZone,
    event.presenceSlotMinutes ?? 30,
  ].join('|');
}
export function selectionWindows(
  event: PresenceEvent,
  selection: PresenceSelection,
  complete = true,
): PresenceWindow[] {
  const slots = eventSlots(event);
  if (
    !['whole_event', 'selected_slots', 'not_attending', 'unsure'].includes(
      selection.mode,
    ) ||
    !Array.isArray(selection.slots) ||
    selection.slots.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= slots.length,
    ) ||
    new Set(selection.slots).size !== selection.slots.length ||
    (selection.mode !== 'selected_slots' && selection.slots.length) ||
    (complete && selection.mode === 'selected_slots' && !selection.slots.length)
  )
    throw new Error('INVALID_PRESENCE');
  if (selection.mode === 'whole_event')
    return [{ start: event.startTime, end: event.endTime }];
  if (selection.mode !== 'selected_slots') return [];
  const result: PresenceWindow[] = [];
  for (const index of [...selection.slots].sort((a, b) => a - b)) {
    const slot = slots[index],
      last = result.at(-1);
    if (last?.end === slot.start) last.end = slot.end;
    else result.push({ ...slot });
  }
  return result;
}
export function validateWindows(
  event: PresenceEvent,
  windows: PresenceWindow[],
): void {
  const slots = eventSlots(event),
    starts = new Set(slots.map((s) => s.start)),
    ends = new Set(slots.map((s) => s.end));
  if (!Array.isArray(windows) || windows.length > slots.length)
    throw new Error('INVALID_PRESENCE');
  let previous = '';
  for (const window of windows) {
    if (
      Object.keys(window).sort().join(',') !== 'end,start' ||
      !starts.has(window.start) ||
      !ends.has(window.end) ||
      window.start >= window.end ||
      (previous && previous >= window.start)
    )
      throw new Error('INVALID_PRESENCE');
    previous = window.end;
  }
}
export const hoursLabel = (windows: PresenceWindow[]) =>
  windows.map((w) => `${w.start}–${w.end}`).join(', ');
export const modeLabel = (mode?: string | null) =>
  ({
    whole_event: 'Whole showcase',
    selected_slots: 'Selected times',
    not_attending: 'Not attending in person',
    unsure: 'Not sure yet',
  })[mode ?? ''] ?? 'No response';

export interface PresenceDecision {
  id: number;
  version: number;
  revisionId: string;
  digest: string;
  decision: 'approved' | 'removed' | 'changes_requested';
  windows: PresenceWindow[];
  feedback: string;
  reason: string;
  reviewedAt: string;
  scheduleKey: string;
}
export interface PresenceRevision {
  id: string;
  draftVersion: number;
  eventVersion: number;
  scheduleKey: string;
  selection: PresenceSelection;
  windows: PresenceWindow[];
  digest: string;
  submittedAt: string;
  decision: PresenceDecision | null;
}
export interface PresenceRecord {
  projectId: string;
  title: string;
  maker: string;
  withdrawn: boolean;
  event: PresenceEvent & { dateLabel: string };
  eventVersion: number;
  scheduleKey: string;
  decisionVersion: number;
  draft: {
    version: number;
    eventVersion: number;
    scheduleKey: string;
    selection: PresenceSelection;
    updatedAt: string;
  } | null;
  latest: PresenceRevision | null;
  approved: PresenceDecision | null;
  live: {
    windows: PresenceWindow[];
    decisionId: number | null;
    release: number;
  } | null;
}
