import type { CalendarEvent } from '../calendar/types';
import {
  externalKey,
  type DateRange,
  type ExternalFetchResult,
  type ExternalScheduleEvent,
  type ScheduleProvider,
} from './types';

/**
 * MOCK Magister schedule provider.
 *
 * Returns a realistic Dutch school timetable for the requested range without
 * any network access. The real Magister provider will later implement the
 * same `ScheduleProvider` interface with authentication + API calls; nothing
 * else in the app will need to change.
 */

const COLOR_BY_SUBJECT: Record<string, ExternalScheduleEvent['color']> = {
  'Nederlands': 'amber',
  'Wiskunde B': 'blue',
  'Wiskunde A': 'blue',
  'Engels': 'purple',
  'Natuurkunde': 'cyan',
  'Scheikunde': 'blue',
  'Geschiedenis': 'purple',
  'Aardrijkskunde': 'cyan',
  'Economie': 'amber',
  'Gym': 'green',
  'Informatica': 'green',
};

/** Mock lessons anchored to the Monday of `range.from`'s week. */
function buildMockWeek(range: DateRange): ExternalScheduleEvent[] {
  const monday = new Date(range.from);
  monday.setHours(0, 0, 0, 0);
  const day = (monday.getDay() + 6) % 7; // Monday = 0
  monday.setDate(monday.getDate() - day);

  const at = (weekDay: number, hours: number, minutes = 0): Date => {
    const d = new Date(monday);
    d.setDate(d.getDate() + weekDay);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  interface LessonSpec {
    id: string;
    subject: string;
    teacher: string;
    room: string;
    weekDay: number;
    startHour: number;
    startMin: number;
    endHour: number;
    endMin: number;
  }

  const lessons: LessonSpec[] = [
    { id: 'les-1001', subject: 'Nederlands', teacher: 'mevr. De Vries', room: 'B102', weekDay: 0, startHour: 8, startMin: 30, endHour: 9, endMin: 15 },
    { id: 'les-1002', subject: 'Wiskunde B', teacher: 'dhr. Jansen', room: 'A204', weekDay: 0, startHour: 9, startMin: 30, endHour: 10, endMin: 15 },
    { id: 'les-1003', subject: 'Engels', teacher: 'mevr. Bakker', room: 'C008', weekDay: 0, startHour: 10, startMin: 45, endHour: 11, endMin: 30 },
    { id: 'les-1004', subject: 'Gym', teacher: 'dhr. Smit', room: 'Sporthal', weekDay: 0, startHour: 13, startMin: 30, endHour: 14, endMin: 15 },

    { id: 'les-2001', subject: 'Natuurkunde', teacher: 'dhr. Mulder', room: 'D301', weekDay: 1, startHour: 8, startMin: 30, endHour: 9, endMin: 15 },
    { id: 'les-2002', subject: 'Scheikunde', teacher: 'mevr. Hofs', room: 'D205', weekDay: 1, startHour: 9, startMin: 30, endHour: 10, endMin: 15 },
    { id: 'les-2003', subject: 'Wiskunde A', teacher: 'dhr. Jansen', room: 'A204', weekDay: 1, startHour: 10, startMin: 45, endHour: 11, endMin: 30 },

    { id: 'les-3001', subject: 'Aardrijkskunde', teacher: 'dhr. Bos', room: 'B210', weekDay: 2, startHour: 9, startMin: 0, endHour: 9, endMin: 45 },
    { id: 'les-3002', subject: 'Geschiedenis', teacher: 'mevr. Visser', room: 'B014', weekDay: 2, startHour: 11, startMin: 0, endHour: 11, endMin: 45 },
    { id: 'les-3003', subject: 'Informatica', teacher: 'dhr. Peeters', room: 'E112', weekDay: 2, startHour: 13, startMin: 0, endHour: 14, endMin: 30 },

    { id: 'les-4001', subject: 'Economie', teacher: 'dhr. De Groot', room: 'C201', weekDay: 3, startHour: 9, startMin: 0, endHour: 9, endMin: 45 },
    { id: 'les-4002', subject: 'Engels', teacher: 'mevr. Bakker', room: 'C008', weekDay: 3, startHour: 10, startMin: 0, endHour: 10, endMin: 45 },

    { id: 'les-5001', subject: 'Wiskunde B', teacher: 'dhr. Jansen', room: 'A204', weekDay: 4, startHour: 9, startMin: 30, endHour: 10, endMin: 15 },
    { id: 'les-5002', subject: 'Nederlands', teacher: 'mevr. De Vries', room: 'B102', weekDay: 4, startHour: 10, startMin: 30, endHour: 11, endMin: 15 },
    { id: 'les-5003', subject: 'Gym', teacher: 'dhr. Smit', room: 'Sporthal', weekDay: 4, startHour: 12, startMin: 0, endHour: 12, endMin: 45 },
  ];

  return lessons.map((l) => {
    const start = at(l.weekDay, l.startHour, l.startMin);
    const end = at(l.weekDay, l.endHour, l.endMin);
    return {
      externalId: l.id,
      subject: l.subject,
      teacher: l.teacher,
      room: l.room,
      start: start.toISOString(),
      end: end.toISOString(),
      category: 'School',
      color: COLOR_BY_SUBJECT[l.subject] ?? 'blue',
    };
  });
}

/**
 * Mock implementation of `ScheduleProvider` for Magister.
 * No network requests are made and no Magister endpoints are assumed —
 * those come later, behind this same interface.
 */
export const mockMagisterProvider: ScheduleProvider = {
  id: 'magister',
  displayName: 'Magister (mock)',

  async fetchSchedule(range: DateRange): Promise<ExternalFetchResult> {
    // Simulate async latency so the eventual real provider behaves the same.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      providerId: mockMagisterProvider.id,
      fetchedAt: new Date().toISOString(),
      events: buildMockWeek(range),
    };
  },
};

/** Shared normalization: external schedule event → app `CalendarEvent`. */
export function normalizeExternalEvent(
  external: ExternalScheduleEvent,
  providerId: string,
  fetchedAt: string,
): CalendarEvent {
  const details = [external.teacher, external.room ? `Lokaal ${external.room}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return {
    id: `ext-${externalKey(providerId, external.externalId)}`,
    title: external.subject,
    description: details || external.description,
    start: external.start,
    end: external.end,
    color: external.color ?? 'blue',
    category: external.category ?? 'School',
    source: 'external',
    externalId: externalKey(providerId, external.externalId),
    lastSyncedAt: fetchedAt,
  };
}
