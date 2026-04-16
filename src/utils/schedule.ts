import {
  MAX_SHIFTS_PER_AGENT_PER_DAY,
  MIN_SHIFT_MINUTES,
  SNAP_INTERVAL_MINUTES,
} from '../constants'
import type { Agent, ShiftBlock } from '../types'
import { MINUTES_IN_DAY, clamp, formatClock, snapToInterval } from './time'

const HEX_COLOR_PATTERN = /^#([0-9A-Fa-f]{6})$/

let fallbackIdCounter = 0

export const createEntityId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  fallbackIdCounter += 1
  return `${prefix}-${Date.now()}-${fallbackIdCounter}`
}

export const normalizeMemberName = (value: string): string =>
  value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()

export const slugifyName = (value: string): string => {
  const base = normalizeMemberName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base || `member-${Date.now()}`
}

export const buildUniqueAgentId = (name: string, existingIds: Set<string>): string => {
  const base = slugifyName(name)

  if (!existingIds.has(base)) {
    return base
  }

  let suffix = 2
  let nextId = `${base}-${suffix}`

  while (existingIds.has(nextId)) {
    suffix += 1
    nextId = `${base}-${suffix}`
  }

  return nextId
}

export const isValidHexColor = (value: string): boolean => HEX_COLOR_PATTERN.test(value)

export const normalizeHexColor = (value: string): string => {
  const normalized = value.trim()
  const prefixed = normalized.startsWith('#') ? normalized : `#${normalized}`

  if (!isValidHexColor(prefixed)) {
    return ''
  }

  return prefixed.toUpperCase()
}

export const rangesOverlap = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean => startA < endB && endA > startB

export const findOverlappingShift = (
  shifts: ShiftBlock[],
  params: {
    agentId: string
    dayIndex: number
    start: number
    end: number
    excludeId?: string
  },
): ShiftBlock | null => {
  const candidate = shifts.find(
    (shift) =>
      shift.agentId === params.agentId &&
      shift.dayIndex === params.dayIndex &&
      shift.id !== params.excludeId &&
      rangesOverlap(shift.start, shift.end, params.start, params.end),
  )

  return candidate ?? null
}

export const countAgentDayShifts = (
  shifts: ShiftBlock[],
  agentId: string,
  dayIndex: number,
  excludeId?: string,
): number =>
  shifts.filter(
    (shift) =>
      shift.agentId === agentId && shift.dayIndex === dayIndex && shift.id !== excludeId,
  ).length

export const sortShifts = (shifts: ShiftBlock[]): ShiftBlock[] =>
  [...shifts].sort((left, right) => left.start - right.start)

export const sanitizeShiftTimes = (start: number, end: number): { start: number; end: number } => {
  const snappedStart = snapToInterval(start, SNAP_INTERVAL_MINUTES)
  const snappedEnd = snapToInterval(end, SNAP_INTERVAL_MINUTES)

  const safeStart = clamp(snappedStart, 0, MINUTES_IN_DAY - MIN_SHIFT_MINUTES)
  const safeEnd = clamp(snappedEnd, MIN_SHIFT_MINUTES, MINUTES_IN_DAY)

  return {
    start: safeStart,
    end: safeEnd,
  }
}

export const validateShiftBlock = (
  shifts: ShiftBlock[],
  payload: {
    agentId: string
    dayIndex: number
    start: number
    end: number
    excludeId?: string
  },
): { ok: true } | { ok: false; error: string } => {
  if (payload.dayIndex < 0 || payload.dayIndex > 6) {
    return { ok: false, error: 'Day index is out of range.' }
  }

  if (payload.start < 0 || payload.end > MINUTES_IN_DAY) {
    return { ok: false, error: 'Shift must be within the 24-hour day.' }
  }

  if (payload.end - payload.start < MIN_SHIFT_MINUTES) {
    return { ok: false, error: 'Shift must be at least 30 minutes.' }
  }

  const existingCount = countAgentDayShifts(
    shifts,
    payload.agentId,
    payload.dayIndex,
    payload.excludeId,
  )

  if (existingCount >= MAX_SHIFTS_PER_AGENT_PER_DAY) {
    return {
      ok: false,
      error: `Maximum ${MAX_SHIFTS_PER_AGENT_PER_DAY} shifts per agent per day.`,
    }
  }

  const overlap = findOverlappingShift(shifts, payload)

  if (overlap) {
    return {
      ok: false,
      error: `⚠️ Overlaps with existing shift ${formatClock(overlap.start)}–${formatClock(overlap.end)}`,
    }
  }

  return { ok: true }
}

export const buildAgentShiftOrderMap = (
  shifts: ShiftBlock[],
): Map<string, { index: number; total: number }> => {
  const byAgentDay = new Map<string, ShiftBlock[]>()

  for (const shift of shifts) {
    const key = `${shift.agentId}-${shift.dayIndex}`
    if (!byAgentDay.has(key)) {
      byAgentDay.set(key, [])
    }

    byAgentDay.get(key)?.push(shift)
  }

  const lookup = new Map<string, { index: number; total: number }>()

  byAgentDay.forEach((entries) => {
    const sorted = sortShifts(entries)
    sorted.forEach((shift, index) => {
      lookup.set(shift.id, {
        index: index + 1,
        total: sorted.length,
      })
    })
  })

  return lookup
}

export const buildAgentLookup = (agents: Agent[]): Map<string, Agent> =>
  new Map(agents.map((agent) => [agent.id, agent]))
