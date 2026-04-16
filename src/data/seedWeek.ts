import type { ShiftBlock } from '../types'
import { createEntityId } from '../utils/schedule'
import { parseTimeToMinutes } from '../utils/time'

type SeedShift = {
  agentId: string
  dayIndex: number
  start: string
  end: string
}

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4]
const MANDY_WEEKDAY_INDEXES = [0, 2, 4]

export const createSeedShifts = (): ShiftBlock[] => {
  const entries: SeedShift[] = []

  for (const dayIndex of WEEKDAY_INDEXES) {
    entries.push(
      { agentId: 'nick', dayIndex, start: '00:00', end: '02:00' },
      { agentId: 'mina', dayIndex, start: '00:00', end: '02:00' },
      { agentId: 'tanie', dayIndex, start: '03:00', end: '07:00' },
      { agentId: 'maya', dayIndex, start: '05:00', end: '09:00' },
      { agentId: 'tommy', dayIndex, start: '09:00', end: '18:00' },
      { agentId: 'lina', dayIndex, start: '09:00', end: '18:00' },
      { agentId: 'barney', dayIndex, start: '09:00', end: '18:00' },
      { agentId: 'evans', dayIndex, start: '09:00', end: '18:00' },
      { agentId: 'tanie', dayIndex, start: '18:00', end: '22:00' },
      { agentId: 'gwen', dayIndex, start: '19:00', end: '23:00' },
      { agentId: 'nick', dayIndex, start: '22:00', end: '24:00' },
      { agentId: 'mina', dayIndex, start: '22:00', end: '24:00' },
    )

    if (MANDY_WEEKDAY_INDEXES.includes(dayIndex)) {
      entries.push({ agentId: 'mandy', dayIndex, start: '00:00', end: '04:00' })
    }
  }

  entries.push(
    { agentId: 'mina', dayIndex: 5, start: '00:00', end: '03:00' },
    { agentId: 'mandy', dayIndex: 5, start: '00:00', end: '04:00' },
    { agentId: 'tanie', dayIndex: 5, start: '05:00', end: '07:00' },
    { agentId: 'maya', dayIndex: 5, start: '05:00', end: '08:00' },
    { agentId: 'tommy', dayIndex: 5, start: '09:00', end: '15:00' },
    { agentId: 'lina', dayIndex: 5, start: '09:00', end: '12:30' },
    { agentId: 'barney', dayIndex: 5, start: '09:00', end: '12:30' },
    { agentId: 'evans', dayIndex: 5, start: '09:00', end: '12:30' },
    { agentId: 'barney', dayIndex: 5, start: '15:00', end: '18:00' },
    { agentId: 'evans', dayIndex: 5, start: '18:00', end: '22:00' },
    { agentId: 'mina', dayIndex: 5, start: '22:00', end: '24:00' },
  )

  entries.push(
    { agentId: 'mina', dayIndex: 6, start: '00:00', end: '02:00' },
    { agentId: 'mandy', dayIndex: 6, start: '02:00', end: '06:00' },
    { agentId: 'lina', dayIndex: 6, start: '06:00', end: '10:00' },
    { agentId: 'gwen', dayIndex: 6, start: '10:00', end: '12:00' },
    { agentId: 'tommy', dayIndex: 6, start: '12:00', end: '17:00' },
    { agentId: 'barney', dayIndex: 6, start: '17:00', end: '22:00' },
    { agentId: 'nick', dayIndex: 6, start: '22:00', end: '24:00' },
  )

  return entries.map((entry) => ({
    id: createEntityId('shift'),
    agentId: entry.agentId,
    dayIndex: entry.dayIndex,
    start: parseTimeToMinutes(entry.start),
    end: parseTimeToMinutes(entry.end),
  }))
}
