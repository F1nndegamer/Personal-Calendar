import { addDays, startOfWeek } from './lib';
import type { CalendarEvent } from './types';

const at = (day: Date, hours: number, minutes = 0): Date => {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/** Realistic mock events anchored to the current week. */
export function createMockEvents(today = new Date()): CalendarEvent[] {
  const monday = startOfWeek(today);
  const d = (offset: number) => addDays(monday, offset);

  return [
    // Monday
    {
      id: 'm-1',
      title: 'Wiskunde B',
      category: 'School',
      description: 'Hoofdstuk 7 — integratietechnieken. Huiswerk: opgaven 12–18.',
      start: at(d(0), 9, 0).toISOString(),
      end: at(d(0), 10, 30).toISOString(),
      color: 'blue',
    },
    {
      id: 'm-2',
      title: 'Engels',
      category: 'School',
      start: at(d(0), 10, 45).toISOString(),
      end: at(d(0), 11, 30).toISOString(),
      color: 'purple',
    },
    {
      id: 'm-3',
      title: 'Gym',
      description: 'Basketbal — vergeet sportkleding niet.',
      category: 'School',
      start: at(d(0), 13, 30).toISOString(),
      end: at(d(0), 14, 45).toISOString(),
      color: 'green',
    },
    {
      id: 'm-4',
      title: 'Side project werken',
      category: 'Persoonlijk',
      start: at(d(0), 19, 30).toISOString(),
      end: at(d(0), 21, 30).toISOString(),
      color: 'cyan',
    },

    // Tuesday
    {
      id: 't-1',
      title: 'Natuurkunde toets',
      category: 'School',
      description: 'Electriciteit & magnetisme.',
      start: at(d(1), 8, 30).toISOString(),
      end: at(d(1), 10, 0).toISOString(),
      color: 'red',
    },
    {
      id: 't-2',
      title: 'Nederlands',
      category: 'School',
      start: at(d(1), 10, 15).toISOString(),
      end: at(d(1), 11, 0).toISOString(),
      color: 'amber',
    },
    {
      id: 't-3',
      title: 'Scheikunde',
      category: 'School',
      start: at(d(1), 11, 15).toISOString(),
      end: at(d(1), 12, 0).toISOString(),
      color: 'blue',
    },
    {
      id: 't-4',
      title: 'Workout',
      category: 'Persoonlijk',
      start: at(d(1), 17, 0).toISOString(),
      end: at(d(1), 18, 15).toISOString(),
      color: 'green',
    },

    // Wednesday
    {
      id: 'w-1',
      title: 'Aardrijkskunde',
      category: 'School',
      start: at(d(2), 9, 0).toISOString(),
      end: at(d(2), 10, 0).toISOString(),
      color: 'cyan',
    },
    {
      id: 'w-2',
      title: 'Wiskunde A',
      category: 'School',
      start: at(d(2), 10, 15).toISOString(),
      end: at(d(2), 11, 45).toISOString(),
      color: 'blue',
    },
    {
      id: 'w-3',
      title: 'Lunch met Finn',
      category: 'Sociaal',
      start: at(d(2), 12, 30).toISOString(),
      end: at(d(2), 13, 30).toISOString(),
      color: 'amber',
    },
    {
      id: 'w-4',
      title: 'Huiswerk inhalen',
      category: 'School',
      description: 'Nederlands leesverslag afmaken.',
      start: at(d(2), 15, 0).toISOString(),
      end: at(d(2), 16, 45).toISOString(),
      color: 'purple',
    },
    // deliberately overlapping evening block
    {
      id: 'w-5',
      title: 'Series kijken',
      category: 'Persoonlijk',
      start: at(d(2), 20, 0).toISOString(),
      end: at(d(2), 21, 30).toISOString(),
      color: 'green',
    },
    {
      id: 'w-6',
      title: 'Backup Raspberry Pi',
      category: 'Persoonlijk',
      start: at(d(2), 20, 30).toISOString(),
      end: at(d(2), 21, 45).toISOString(),
      color: 'red',
    },

    // Thursday
    {
      id: 'th-1',
      title: 'Economie',
      category: 'School',
      start: at(d(3), 9, 0).toISOString(),
      end: at(d(3), 10, 30).toISOString(),
      color: 'amber',
    },
    {
      id: 'th-2',
      title: 'Geschiedenis',
      category: 'School',
      start: at(d(3), 10, 45).toISOString(),
      end: at(d(3), 11, 30).toISOString(),
      color: 'purple',
    },
    {
      id: 'th-3',
      title: 'Bibliotheek studeren',
      category: 'School',
      start: at(d(3), 14, 0).toISOString(),
      end: at(d(3), 16, 30).toISOString(),
      color: 'cyan',
    },

    // Friday
    {
      id: 'f-1',
      title: 'Informatica',
      category: 'School',
      description: 'TypeScript-project deadline.',
      start: at(d(4), 9, 30).toISOString(),
      end: at(d(4), 11, 0).toISOString(),
      color: 'green',
    },
    {
      id: 'f-2',
      title: 'Wiskunde B',
      category: 'School',
      start: at(d(4), 11, 15).toISOString(),
      end: at(d(4), 12, 0).toISOString(),
      color: 'blue',
    },
    {
      id: 'f-3',
      title: 'Weekend plannen',
      category: 'Persoonlijk',
      start: at(d(4), 16, 0).toISOString(),
      end: at(d(4), 17, 0).toISOString(),
      color: 'amber',
    },

    // Saturday
    {
      id: 'sa-1',
      title: 'Uitslapen',
      category: 'Persoonlijk',
      start: at(d(5), 10, 30).toISOString(),
      end: at(d(5), 12, 0).toISOString(),
      color: 'cyan',
    },
    {
      id: 'sa-2',
      title: 'Voetbal',
      category: 'Sociaal',
      start: at(d(5), 14, 30).toISOString(),
      end: at(d(5), 16, 30).toISOString(),
      color: 'green',
    },
    {
      id: 'sa-3',
      title: 'Films met vrienden',
      category: 'Sociaal',
      start: at(d(5), 20, 0).toISOString(),
      end: at(d(5), 22, 30).toISOString(),
      color: 'red',
    },

    // Sunday
    {
      id: 'su-1',
      title: 'Week voorbereiden',
      category: 'Persoonlijk',
      description: 'Agenda doornemen en taken prioriteren.',
      start: at(d(6), 15, 0).toISOString(),
      end: at(d(6), 16, 30).toISOString(),
      color: 'purple',
    },
    {
      id: 'su-2',
      title: 'Lezen',
      category: 'Persoonlijk',
      start: at(d(6), 19, 0).toISOString(),
      end: at(d(6), 20, 30).toISOString(),
      color: 'amber',
    },
  ];
}
