import { addDays, startOfDay } from '../calendar/lib';
import type { Task } from './types';

const at = (day: Date, hours: number, minutes = 0): Date => {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/** Realistic mock tasks anchored to the current week. */
export function createMockTasks(today = new Date()): Task[] {
  const d = (offset: number) => addDays(startOfDay(today), offset);

  return [
    {
      id: 'task-1',
      title: 'Nederlands leesverslag',
      description: 'Hoofdstuk 4–6 samenvatten en analyseren.',
      completed: false,
      priority: 'high',
      category: 'School',
      color: 'amber',
      dueDate: at(d(0), 17, 0).toISOString(),
      estimatedMinutes: 90,
      subtasks: [
        { id: 'st-1', title: 'Hoofdstuk 4 samenvatten', completed: true },
        { id: 'st-2', title: 'Hoofdstuk 5 samenvatten', completed: true },
        { id: 'st-3', title: 'Conclusie schrijven', completed: false },
      ],
    },
    {
      id: 'task-2',
      title: 'Wiskunde opgaven 12–18',
      completed: false,
      priority: 'medium',
      category: 'School',
      color: 'blue',
      dueDate: at(d(1), 20, 0).toISOString(),
      estimatedMinutes: 45,
      subtasks: [],
    },
    {
      id: 'task-3',
      title: 'Backup Raspberry Pi instellen',
      description: 'Automatische nightly rsync naar externe schijf.',
      completed: false,
      priority: 'low',
      category: 'Persoonlijk',
      color: 'cyan',
      estimatedMinutes: 60,
      subtasks: [
        { id: 'st-4', title: 'Cronjob schrijven', completed: false },
        { id: 'st-5', title: 'Restore testen', completed: false },
      ],
    },
    {
      id: 'task-4',
      title: 'Boodschappen doen',
      completed: false,
      priority: 'medium',
      category: 'Persoonlijk',
      color: 'green',
      dueDate: at(d(2), 18, 0).toISOString(),
      subtasks: [],
    },
    {
      id: 'task-5',
      title: 'PWA manifest toevoegen',
      description: 'Icons, theme-color en offline fallback.',
      completed: false,
      priority: 'high',
      category: 'Project',
      color: 'purple',
      estimatedMinutes: 120,
      subtasks: [
        { id: 'st-6', title: 'Manifest schrijven', completed: true },
        { id: 'st-7', title: 'Icons genereren', completed: false },
        { id: 'st-8', title: 'Service worker', completed: false },
      ],
    },
    {
      id: 'task-5b',
      title: 'Sportkleding wassen',
      completed: true,
      priority: 'low',
      category: 'Persoonlijk',
      color: 'green',
      subtasks: [],
    },
  ];
}
