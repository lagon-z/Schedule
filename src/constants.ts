export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export type DayName = (typeof DAY_NAMES)[number]

export const DAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const TIME_AXIS_WIDTH = 44
export const DAY_HEADER_HEIGHT = 48
export const SNAP_INTERVAL_MINUTES = 30
export const MIN_SHIFT_MINUTES = 30
export const MAX_SHIFTS_PER_AGENT_PER_DAY = 3

export const PRESET_MEMBER_COLORS = [
  '#7C3AED',
  '#9CA3AF',
  '#16A34A',
  '#06B6D4',
  '#DC2626',
  '#EA580C',
  '#DB2777',
  '#EC4899',
  '#2563EB',
  '#D97706',
  '#14B8A6',
  '#84CC16',
  '#EAB308',
  '#F97316',
  '#EF4444',
  '#6366F1',
  '#0EA5E9',
  '#22C55E',
  '#A855F7',
  '#F43F5E',
] as const

export interface DefaultAgentSeed {
  id: string
  name: string
  color: string
}

export const DEFAULT_AGENTS: DefaultAgentSeed[] = [
  { id: 'tommy', name: 'Tommy', color: '#7C3AED' },
  { id: 'nick', name: 'Nick', color: '#9CA3AF' },
  { id: 'evans', name: 'Evans', color: '#16A34A' },
  { id: 'lina', name: 'Lina', color: '#06B6D4' },
  { id: 'barney', name: 'Barney', color: '#DC2626' },
  { id: 'maya', name: 'Maya', color: '#EA580C' },
  { id: 'gwen', name: 'Gwen', color: '#DB2777' },
  { id: 'tanie', name: 'Tanie', color: '#EC4899' },
  { id: 'mandy', name: 'Mandy', color: '#2563EB' },
  { id: 'mina', name: 'Mina', color: '#D97706' },
]
