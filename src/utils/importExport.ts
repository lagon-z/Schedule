import {
  addDays,
  differenceInCalendarDays,
  formatISO,
  getISOWeek,
  startOfWeek,
} from 'date-fns'

import { DAY_NAMES, type DayName } from '../constants'
import type {
  Agent,
  ExportScheduleEntry,
  ImportedScheduleData,
  ScheduleExportPayload,
  ShiftBlock,
} from '../types'
import {
  createEntityId,
  findOverlappingShift,
  normalizeHexColor,
  normalizeMemberName,
  rangesOverlap,
} from './schedule'
import {
  dayNameFromDate,
  formatDateKey,
  parseDateKey,
} from './date'
import {
  formatClock,
  isValidTimeString,
  parseTimeToMinutes,
} from './time'

const MAX_IMPORT_BYTES = 2_000_000
const MAX_IMPORT_AGENTS = 400
const MAX_IMPORT_SCHEDULE_ENTRIES = 10_000

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const validateRequiredFields = (
  payload: Record<string, unknown>,
): string[] => {
  const missingFields: string[] = []

  if (!('meta' in payload)) {
    missingFields.push('meta')
  }

  if (!('agents' in payload)) {
    missingFields.push('agents')
  }

  if (!('schedule' in payload)) {
    missingFields.push('schedule')
  }

  return missingFields
}

const scheduleSort = (left: ShiftBlock, right: ShiftBlock): number => {
  if (left.dayIndex !== right.dayIndex) {
    return left.dayIndex - right.dayIndex
  }

  if (left.agentId !== right.agentId) {
    return left.agentId.localeCompare(right.agentId)
  }

  return left.start - right.start
}

const buildScheduleEntries = (
  shifts: ShiftBlock[],
  weekStartDate: Date,
): ExportScheduleEntry[] => {
  const grouped = new Map<string, { agentId: string; dayIndex: number; shifts: ShiftBlock[] }>()

  for (const shift of shifts) {
    const key = `${shift.agentId}-${shift.dayIndex}`

    if (!grouped.has(key)) {
      grouped.set(key, {
        agentId: shift.agentId,
        dayIndex: shift.dayIndex,
        shifts: [],
      })
    }

    grouped.get(key)?.shifts.push(shift)
  }

  const entries = Array.from(grouped.values())
    .sort((left, right) => {
      if (left.dayIndex !== right.dayIndex) {
        return left.dayIndex - right.dayIndex
      }

      return left.agentId.localeCompare(right.agentId)
    })
    .map<ExportScheduleEntry>((entry) => {
      const date = addDays(weekStartDate, entry.dayIndex)

      return {
        agentId: entry.agentId,
        day: DAY_NAMES[entry.dayIndex],
        date: formatDateKey(date),
        shifts: entry.shifts
          .sort((left, right) => left.start - right.start)
          .map((shift) => ({
            start: formatClock(shift.start),
            end: formatClock(shift.end),
          })),
      }
    })

  return entries
}

export const buildScheduleExportPayload = (params: {
  agents: Agent[]
  shifts: ShiftBlock[]
  weekStart: string
}): ScheduleExportPayload => {
  const weekStartDate = parseDateKey(params.weekStart) ?? startOfWeek(new Date(), { weekStartsOn: 1 })
  const normalizedWeekStart = startOfWeek(weekStartDate, { weekStartsOn: 1 })
  const weekEndDate = addDays(normalizedWeekStart, 6)

  const sortedShifts = [...params.shifts].sort(scheduleSort)

  return {
    meta: {
      weekNumber: getISOWeek(normalizedWeekStart),
      weekStart: formatDateKey(normalizedWeekStart),
      weekEnd: formatDateKey(weekEndDate),
      exportedAt: formatISO(new Date()),
    },
    agents: params.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
    })),
    schedule: buildScheduleEntries(sortedShifts, normalizedWeekStart),
  }
}

const parseAgentList = (
  rawAgents: unknown,
): { ok: true; agents: Agent[] } | { ok: false; error: string } => {
  if (!Array.isArray(rawAgents)) {
    return {
      ok: false,
      error: '❌ Missing required fields: agents',
    }
  }

  if (rawAgents.length > MAX_IMPORT_AGENTS) {
    return {
      ok: false,
      error: `❌ Too many agents in import file (max ${MAX_IMPORT_AGENTS}).`,
    }
  }

  const agents: Agent[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  for (const rawAgent of rawAgents) {
    if (!isPlainRecord(rawAgent)) {
      return {
        ok: false,
        error: '❌ Invalid file format. Please use a valid schedule JSON export.',
      }
    }

    const id =
      typeof rawAgent.id === 'string' ? rawAgent.id.trim().toLowerCase() : ''
    const name =
      typeof rawAgent.name === 'string' ? normalizeMemberName(rawAgent.name) : ''
    const color =
      typeof rawAgent.color === 'string' ? normalizeHexColor(rawAgent.color) : ''

    if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) {
      return {
        ok: false,
        error: `❌ Invalid agent id: "${String(rawAgent.id ?? '')}"`,
      }
    }

    if (!name || name.length > 20) {
      return {
        ok: false,
        error: `❌ Invalid agent name for id "${id}".`,
      }
    }

    if (!color) {
      return {
        ok: false,
        error: `❌ Invalid color for agent "${name}".`,
      }
    }

    if (seenIds.has(id)) {
      return {
        ok: false,
        error: `❌ Duplicate agent id detected: "${id}".`,
      }
    }

    const normalizedName = name.toLowerCase()

    if (seenNames.has(normalizedName)) {
      return {
        ok: false,
        error: `❌ Duplicate agent name detected: "${name}".`,
      }
    }

    seenIds.add(id)
    seenNames.add(normalizedName)

    agents.push({ id, name, color })
  }

  return {
    ok: true,
    agents,
  }
}

const parseWeekMeta = (
  rawMeta: unknown,
): { ok: true; weekStart: Date; weekEnd: Date; weekNumber: number } | { ok: false; error: string } => {
  if (!isPlainRecord(rawMeta)) {
    return {
      ok: false,
      error: '❌ Missing required fields: meta',
    }
  }

  const rawWeekStart =
    typeof rawMeta.weekStart === 'string' ? rawMeta.weekStart.trim() : ''

  if (!rawWeekStart) {
    return {
      ok: false,
      error: '❌ Missing required fields: meta.weekStart',
    }
  }

  const parsedWeekStart = parseDateKey(rawWeekStart)

  if (!parsedWeekStart) {
    return {
      ok: false,
      error: '❌ Invalid meta.weekStart date format.',
    }
  }

  const normalizedWeekStart = startOfWeek(parsedWeekStart, { weekStartsOn: 1 })
  const computedWeekEnd = addDays(normalizedWeekStart, 6)

  const rawWeekEnd =
    typeof rawMeta.weekEnd === 'string' ? rawMeta.weekEnd.trim() : ''

  if (rawWeekEnd) {
    const parsedWeekEnd = parseDateKey(rawWeekEnd)
    if (!parsedWeekEnd) {
      return {
        ok: false,
        error: '❌ Invalid meta.weekEnd date format.',
      }
    }
  }

  const weekNumber =
    typeof rawMeta.weekNumber === 'number' && Number.isFinite(rawMeta.weekNumber)
      ? Math.max(1, Math.trunc(rawMeta.weekNumber))
      : getISOWeek(normalizedWeekStart)

  return {
    ok: true,
    weekStart: normalizedWeekStart,
    weekEnd: computedWeekEnd,
    weekNumber,
  }
}

export const parseScheduleImport = (
  textContent: string,
): { ok: true; data: ImportedScheduleData } | { ok: false; error: string } => {
  if (textContent.length > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: '❌ File is too large. Please import a smaller JSON file.',
    }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(textContent)
  } catch {
    return {
      ok: false,
      error: '❌ Invalid file format. Please use a valid schedule JSON export.',
    }
  }

  if (!isPlainRecord(parsed)) {
    return {
      ok: false,
      error: '❌ Invalid file format. Please use a valid schedule JSON export.',
    }
  }

  const missingFields = validateRequiredFields(parsed)

  if (missingFields.length > 0) {
    return {
      ok: false,
      error: `❌ Missing required fields: ${missingFields.join(', ')}`,
    }
  }

  const metaResult = parseWeekMeta(parsed.meta)

  if (!metaResult.ok) {
    return metaResult
  }

  const agentsResult = parseAgentList(parsed.agents)

  if (!agentsResult.ok) {
    return agentsResult
  }

  if (!Array.isArray(parsed.schedule)) {
    return {
      ok: false,
      error: '❌ Missing required fields: schedule',
    }
  }

  if (parsed.schedule.length > MAX_IMPORT_SCHEDULE_ENTRIES) {
    return {
      ok: false,
      error: `❌ Too many schedule entries in import file (max ${MAX_IMPORT_SCHEDULE_ENTRIES}).`,
    }
  }

  const agentIdSet = new Set(agentsResult.agents.map((agent) => agent.id))
  const shifts: ShiftBlock[] = []

  for (const rawEntry of parsed.schedule) {
    if (!isPlainRecord(rawEntry)) {
      return {
        ok: false,
        error: '❌ Invalid file format. Please use a valid schedule JSON export.',
      }
    }

    const agentId =
      typeof rawEntry.agentId === 'string' ? rawEntry.agentId.trim().toLowerCase() : ''
    const day =
      typeof rawEntry.day === 'string' ? rawEntry.day.trim() : ''
    const dateValue =
      typeof rawEntry.date === 'string' ? rawEntry.date.trim() : ''

    if (!agentId || !agentIdSet.has(agentId)) {
      return {
        ok: false,
        error: `❌ Missing agent definition for agentId "${agentId || 'unknown'}".`,
      }
    }

    if (!DAY_NAMES.includes(day as DayName)) {
      return {
        ok: false,
        error: `❌ Invalid day value in schedule entry: "${day || 'unknown'}".`,
      }
    }

    const parsedDate = parseDateKey(dateValue)

    if (!parsedDate) {
      return {
        ok: false,
        error: `❌ Invalid date value in schedule entry: "${dateValue || 'unknown'}".`,
      }
    }

    const derivedDay = dayNameFromDate(parsedDate)

    if (derivedDay !== day) {
      return {
        ok: false,
        error: `❌ Day/date mismatch for ${agentId}: ${day} does not match ${dateValue}.`,
      }
    }

    const dayIndex = differenceInCalendarDays(parsedDate, metaResult.weekStart)

    if (dayIndex < 0 || dayIndex > 6) {
      return {
        ok: false,
        error: `❌ Date ${dateValue} is outside imported week range.`,
      }
    }

    if (!Array.isArray(rawEntry.shifts) || rawEntry.shifts.length === 0) {
      return {
        ok: false,
        error: `❌ Missing shifts for ${agentId} on ${day}.`,
      }
    }

    const existingSameAgentDay = shifts.filter(
      (shift) => shift.agentId === agentId && shift.dayIndex === dayIndex,
    )

    for (const rawShift of rawEntry.shifts) {
      if (!isPlainRecord(rawShift)) {
        return {
          ok: false,
          error: '❌ Invalid file format. Please use a valid schedule JSON export.',
        }
      }

      const startText =
        typeof rawShift.start === 'string' ? rawShift.start.trim() : ''
      const endText =
        typeof rawShift.end === 'string' ? rawShift.end.trim() : ''

      if (!isValidTimeString(startText) || !isValidTimeString(endText)) {
        return {
          ok: false,
          error: `❌ Invalid shift time format for ${agentId} on ${day}.`,
        }
      }

      const start = parseTimeToMinutes(startText)
      const end = parseTimeToMinutes(endText)

      if (start >= end) {
        return {
          ok: false,
          error: `❌ Shift start must be earlier than end for ${agentId} on ${day}.`,
        }
      }

      if (existingSameAgentDay.length >= 3) {
        return {
          ok: false,
          error: `❌ ${agentId} exceeds 3 shifts on ${day}.`,
        }
      }

      const localOverlap = existingSameAgentDay.find((item) =>
        rangesOverlap(item.start, item.end, start, end),
      )

      if (localOverlap) {
        return {
          ok: false,
          error: `❌ Overlap detected for ${agentId} on ${day}: ${formatClock(
            localOverlap.start,
          )}-${formatClock(localOverlap.end)} with ${startText}-${endText}.`,
        }
      }

      const globalOverlap = findOverlappingShift(shifts, {
        agentId,
        dayIndex,
        start,
        end,
      })

      if (globalOverlap) {
        return {
          ok: false,
          error: `❌ Overlap detected for ${agentId} on ${day}: ${formatClock(
            globalOverlap.start,
          )}-${formatClock(globalOverlap.end)} with ${startText}-${endText}.`,
        }
      }

      const nextShift: ShiftBlock = {
        id: createEntityId('shift'),
        agentId,
        dayIndex,
        start,
        end,
      }

      existingSameAgentDay.push(nextShift)
      shifts.push(nextShift)
    }
  }

  return {
    ok: true,
    data: {
      weekNumber: metaResult.weekNumber,
      weekStart: formatDateKey(metaResult.weekStart),
      weekEnd: formatDateKey(metaResult.weekEnd),
      agents: agentsResult.agents,
      shifts: shifts.sort(scheduleSort),
    },
  }
}
