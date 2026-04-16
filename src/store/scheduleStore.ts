import { addWeeks } from 'date-fns'
import { create } from 'zustand'

import {
  DEFAULT_AGENTS,
  MAX_SHIFTS_PER_AGENT_PER_DAY,
  MIN_SHIFT_MINUTES,
  SNAP_INTERVAL_MINUTES,
} from '../constants'
import { createSeedShifts } from '../data/seedWeek'
import type {
  Agent,
  ImportedScheduleData,
  ShiftBlock,
  StoreActionResult,
} from '../types'
import {
  formatDateKey,
  getCurrentWeekStart,
  parseDateKey,
} from '../utils/date'
import {
  buildUniqueAgentId,
  createEntityId,
  normalizeHexColor,
  normalizeMemberName,
  sanitizeShiftTimes,
  validateShiftBlock,
} from '../utils/schedule'
import {
  clamp,
  MINUTES_IN_DAY,
  snapToInterval,
} from '../utils/time'

interface ImportedViewState {
  weekNumber: number
  weekStart: string
  weekEnd: string
}

interface ShiftPayload {
  agentId: string
  dayIndex: number
  start: number
  end: number
}

interface ScheduleStore {
  agents: Agent[]
  shifts: ShiftBlock[]
  hiddenAgentIds: string[]
  weekStart: string
  currentWeekStart: string
  importedView: ImportedViewState | null
  importError: string | null
  uiError: string | null
  setImportError: (error: string | null) => void
  setUiError: (error: string | null) => void
  toggleAgentVisibility: (agentId: string) => void
  addAgent: (name: string, color: string) => StoreActionResult
  updateAgent: (agentId: string, name: string, color: string) => StoreActionResult
  deleteAgent: (agentId: string) => StoreActionResult
  addShift: (payload: ShiftPayload) => StoreActionResult
  moveShift: (shiftId: string, payload: Omit<ShiftPayload, 'agentId'>) => StoreActionResult
  resizeShift: (shiftId: string, end: number) => StoreActionResult
  deleteShift: (shiftId: string) => void
  deleteAgentDayShifts: (agentId: string, dayIndex: number) => StoreActionResult
  removeShiftSegment: (shiftId: string, start: number, end: number) => StoreActionResult
  shiftWeek: (offset: number) => void
  goToCurrentWeek: () => void
  loadImportedData: (data: ImportedScheduleData) => StoreActionResult
}

const initialWeekStart = formatDateKey(getCurrentWeekStart())

const initialAgents: Agent[] = DEFAULT_AGENTS.map((agent) => ({
  id: agent.id,
  name: agent.name,
  color: agent.color,
}))

const initialShifts = createSeedShifts()

const validateMemberInput = (
  agents: Agent[],
  name: string,
  color: string,
  currentAgentId?: string,
): { ok: true; name: string; color: string } | { ok: false; error: string } => {
  const normalizedName = normalizeMemberName(name)

  if (!normalizedName) {
    return {
      ok: false,
      error: 'Member name is required.',
    }
  }

  if (normalizedName.length > 20) {
    return {
      ok: false,
      error: 'Member name must be 20 characters or fewer.',
    }
  }

  const duplicateName = agents.some(
    (agent) =>
      agent.id !== currentAgentId &&
      agent.name.toLowerCase() === normalizedName.toLowerCase(),
  )

  if (duplicateName) {
    return {
      ok: false,
      error: 'Duplicate names are not allowed.',
    }
  }

  const normalizedColor = normalizeHexColor(color)

  if (!normalizedColor) {
    return {
      ok: false,
      error: 'Please provide a valid HEX color.',
    }
  }

  return {
    ok: true,
    name: normalizedName,
    color: normalizedColor,
  }
}

const sortShiftsByDayAndTime = (shifts: ShiftBlock[]): ShiftBlock[] =>
  [...shifts].sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) {
      return left.dayIndex - right.dayIndex
    }

    if (left.agentId !== right.agentId) {
      return left.agentId.localeCompare(right.agentId)
    }

    return left.start - right.start
  })

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  agents: initialAgents,
  shifts: initialShifts,
  hiddenAgentIds: [],
  weekStart: initialWeekStart,
  currentWeekStart: initialWeekStart,
  importedView: null,
  importError: null,
  uiError: null,

  setImportError: (error) => {
    set({ importError: error })
  },

  setUiError: (error) => {
    set({ uiError: error })
  },

  toggleAgentVisibility: (agentId) => {
    set((state) => ({
      hiddenAgentIds: state.hiddenAgentIds.includes(agentId)
        ? state.hiddenAgentIds.filter((entry) => entry !== agentId)
        : [...state.hiddenAgentIds, agentId],
    }))
  },

  addAgent: (name, color) => {
    const state = get()

    const validated = validateMemberInput(state.agents, name, color)

    if (!validated.ok) {
      return validated
    }

    const nextId = buildUniqueAgentId(
      validated.name,
      new Set(state.agents.map((agent) => agent.id)),
    )

    const newAgent: Agent = {
      id: nextId,
      name: validated.name,
      color: validated.color,
    }

    set((previous) => ({
      agents: [...previous.agents, newAgent],
    }))

    return { ok: true }
  },

  updateAgent: (agentId, name, color) => {
    const state = get()
    const target = state.agents.find((agent) => agent.id === agentId)

    if (!target) {
      return {
        ok: false,
        error: 'Member not found.',
      }
    }

    const validated = validateMemberInput(state.agents, name, color, agentId)

    if (!validated.ok) {
      return validated
    }

    set((previous) => ({
      agents: previous.agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              name: validated.name,
              color: validated.color,
            }
          : agent,
      ),
    }))

    return {
      ok: true,
    }
  },

  deleteAgent: (agentId) => {
    const state = get()

    if (state.agents.length <= 1) {
      return {
        ok: false,
        error: 'At least one team member must remain.',
      }
    }

    const exists = state.agents.some((agent) => agent.id === agentId)

    if (!exists) {
      return {
        ok: false,
        error: 'Member not found.',
      }
    }

    set((previous) => ({
      agents: previous.agents.filter((agent) => agent.id !== agentId),
      shifts: previous.shifts.filter((shift) => shift.agentId !== agentId),
      hiddenAgentIds: previous.hiddenAgentIds.filter((entry) => entry !== agentId),
    }))

    return {
      ok: true,
    }
  },

  addShift: ({ agentId, dayIndex, start, end }) => {
    const state = get()

    if (!state.agents.some((agent) => agent.id === agentId)) {
      return {
        ok: false,
        error: 'Agent not found for this shift.',
      }
    }

    const snapped = sanitizeShiftTimes(start, end)

    const normalizedStart = clamp(
      snapToInterval(snapped.start, SNAP_INTERVAL_MINUTES),
      0,
      MINUTES_IN_DAY - MIN_SHIFT_MINUTES,
    )

    const normalizedEnd = clamp(
      snapToInterval(snapped.end, SNAP_INTERVAL_MINUTES),
      MIN_SHIFT_MINUTES,
      MINUTES_IN_DAY,
    )

    const validation = validateShiftBlock(state.shifts, {
      agentId,
      dayIndex,
      start: normalizedStart,
      end: normalizedEnd,
    })

    if (!validation.ok) {
      return validation
    }

    const nextShift: ShiftBlock = {
      id: createEntityId('shift'),
      agentId,
      dayIndex,
      start: normalizedStart,
      end: normalizedEnd,
    }

    set((previous) => ({
      shifts: sortShiftsByDayAndTime([...previous.shifts, nextShift]),
    }))

    return {
      ok: true,
    }
  },

  moveShift: (shiftId, payload) => {
    const state = get()
    const target = state.shifts.find((shift) => shift.id === shiftId)

    if (!target) {
      return {
        ok: false,
        error: 'Shift no longer exists.',
      }
    }

    const normalizedStart = clamp(
      snapToInterval(payload.start, SNAP_INTERVAL_MINUTES),
      0,
      MINUTES_IN_DAY - MIN_SHIFT_MINUTES,
    )

    const normalizedEnd = clamp(
      snapToInterval(payload.end, SNAP_INTERVAL_MINUTES),
      MIN_SHIFT_MINUTES,
      MINUTES_IN_DAY,
    )

    const validation = validateShiftBlock(state.shifts, {
      agentId: target.agentId,
      dayIndex: payload.dayIndex,
      start: normalizedStart,
      end: normalizedEnd,
      excludeId: shiftId,
    })

    if (!validation.ok) {
      return validation
    }

    set((previous) => ({
      shifts: sortShiftsByDayAndTime(
        previous.shifts.map((shift) =>
          shift.id === shiftId
            ? {
                ...shift,
                dayIndex: payload.dayIndex,
                start: normalizedStart,
                end: normalizedEnd,
              }
            : shift,
        ),
      ),
    }))

    return {
      ok: true,
    }
  },

  resizeShift: (shiftId, end) => {
    const state = get()
    const target = state.shifts.find((shift) => shift.id === shiftId)

    if (!target) {
      return {
        ok: false,
        error: 'Shift no longer exists.',
      }
    }

    const normalizedEnd = clamp(
      snapToInterval(end, SNAP_INTERVAL_MINUTES),
      target.start + MIN_SHIFT_MINUTES,
      MINUTES_IN_DAY,
    )

    const validation = validateShiftBlock(state.shifts, {
      agentId: target.agentId,
      dayIndex: target.dayIndex,
      start: target.start,
      end: normalizedEnd,
      excludeId: shiftId,
    })

    if (!validation.ok) {
      return validation
    }

    set((previous) => ({
      shifts: sortShiftsByDayAndTime(
        previous.shifts.map((shift) =>
          shift.id === shiftId
            ? {
                ...shift,
                end: normalizedEnd,
              }
            : shift,
        ),
      ),
    }))

    return {
      ok: true,
    }
  },

  deleteShift: (shiftId) => {
    set((state) => ({
      shifts: state.shifts.filter((shift) => shift.id !== shiftId),
    }))
  },

  deleteAgentDayShifts: (agentId, dayIndex) => {
    const state = get()
    const hasAgent = state.agents.some((agent) => agent.id === agentId)

    if (!hasAgent) {
      return {
        ok: false,
        error: 'Member not found.',
      }
    }

    const hasShiftsInDay = state.shifts.some(
      (shift) => shift.agentId === agentId && shift.dayIndex === dayIndex,
    )

    if (!hasShiftsInDay) {
      return {
        ok: false,
        error: 'No shifts found for this member/day.',
      }
    }

    set((previous) => ({
      shifts: previous.shifts.filter(
        (shift) => !(shift.agentId === agentId && shift.dayIndex === dayIndex),
      ),
    }))

    return {
      ok: true,
    }
  },

  removeShiftSegment: (shiftId, start, end) => {
    const state = get()
    const target = state.shifts.find((shift) => shift.id === shiftId)

    if (!target) {
      return {
        ok: false,
        error: 'Shift no longer exists.',
      }
    }

    const snappedStart = clamp(
      snapToInterval(start, SNAP_INTERVAL_MINUTES),
      target.start,
      target.end - MIN_SHIFT_MINUTES,
    )
    const snappedEnd = clamp(
      snapToInterval(end, SNAP_INTERVAL_MINUTES),
      target.start + MIN_SHIFT_MINUTES,
      target.end,
    )

    if (snappedEnd <= snappedStart) {
      return {
        ok: false,
        error: 'Remove range must have at least 30 minutes.',
      }
    }

    if (snappedStart <= target.start && snappedEnd >= target.end) {
      set((previous) => ({
        shifts: previous.shifts.filter((shift) => shift.id !== shiftId),
      }))

      return {
        ok: true,
      }
    }

    const remainingSameDay = state.shifts.filter(
      (shift) =>
        shift.id !== shiftId &&
        shift.agentId === target.agentId &&
        shift.dayIndex === target.dayIndex,
    )

    if (snappedStart <= target.start) {
      const nextStart = snappedEnd
      if (target.end - nextStart < MIN_SHIFT_MINUTES) {
        return {
          ok: false,
          error: 'Remaining shift must be at least 30 minutes.',
        }
      }

      set((previous) => ({
        shifts: sortShiftsByDayAndTime(
          previous.shifts.map((shift) =>
            shift.id === shiftId
              ? {
                  ...shift,
                  start: nextStart,
                }
              : shift,
          ),
        ),
      }))

      return {
        ok: true,
      }
    }

    if (snappedEnd >= target.end) {
      const nextEnd = snappedStart
      if (nextEnd - target.start < MIN_SHIFT_MINUTES) {
        return {
          ok: false,
          error: 'Remaining shift must be at least 30 minutes.',
        }
      }

      set((previous) => ({
        shifts: sortShiftsByDayAndTime(
          previous.shifts.map((shift) =>
            shift.id === shiftId
              ? {
                  ...shift,
                  end: nextEnd,
                }
              : shift,
          ),
        ),
      }))

      return {
        ok: true,
      }
    }

    const leftDuration = snappedStart - target.start
    const rightDuration = target.end - snappedEnd

    if (leftDuration < MIN_SHIFT_MINUTES || rightDuration < MIN_SHIFT_MINUTES) {
      return {
        ok: false,
        error: 'Both remaining parts must be at least 30 minutes.',
      }
    }

    if (remainingSameDay.length + 2 > MAX_SHIFTS_PER_AGENT_PER_DAY) {
      return {
        ok: false,
        error: `Split result exceeds ${MAX_SHIFTS_PER_AGENT_PER_DAY} shifts/day for this member.`,
      }
    }

    const rightShift: ShiftBlock = {
      id: createEntityId('shift'),
      agentId: target.agentId,
      dayIndex: target.dayIndex,
      start: snappedEnd,
      end: target.end,
    }

    set((previous) => ({
      shifts: sortShiftsByDayAndTime(
        [
          ...previous.shifts
            .filter((shift) => shift.id !== shiftId),
          {
            ...target,
            end: snappedStart,
          },
          rightShift,
        ],
      ),
    }))

    return {
      ok: true,
    }
  },

  shiftWeek: (offset) => {
    const state = get()
    const parsedWeekStart = parseDateKey(state.weekStart)

    if (!parsedWeekStart) {
      return
    }

    const nextWeek = addWeeks(parsedWeekStart, offset)

    set({
      weekStart: formatDateKey(nextWeek),
      importedView: null,
      importError: null,
    })
  },

  goToCurrentWeek: () => {
    const state = get()

    set({
      weekStart: state.currentWeekStart,
      importedView: null,
      importError: null,
    })
  },

  loadImportedData: (data) => {
    if (data.agents.length === 0) {
      return {
        ok: false,
        error: 'Imported file must include at least one agent.',
      }
    }

    const state = get()
    const mergedAgents = [...state.agents]

    for (const importedAgent of data.agents) {
      const existingIndex = mergedAgents.findIndex(
        (agent) => agent.id === importedAgent.id,
      )

      const duplicateName = mergedAgents.find(
        (agent) =>
          agent.id !== importedAgent.id &&
          agent.name.toLowerCase() === importedAgent.name.toLowerCase(),
      )

      if (duplicateName) {
        return {
          ok: false,
          error: `Duplicate member name conflict while importing: ${importedAgent.name}`,
        }
      }

      if (existingIndex >= 0) {
        mergedAgents[existingIndex] = {
          ...importedAgent,
        }
      } else {
        mergedAgents.push({
          ...importedAgent,
        })
      }
    }

    const mergedAgentIdSet = new Set(mergedAgents.map((agent) => agent.id))
    const importedShifts = data.shifts.filter((shift) =>
      mergedAgentIdSet.has(shift.agentId),
    )

    set({
      agents: mergedAgents,
      shifts: sortShiftsByDayAndTime(importedShifts),
      weekStart: data.weekStart,
      importedView: {
        weekNumber: data.weekNumber,
        weekStart: data.weekStart,
        weekEnd: data.weekEnd,
      },
      importError: null,
      hiddenAgentIds: state.hiddenAgentIds.filter((id) => mergedAgentIdSet.has(id)),
    })

    return {
      ok: true,
    }
  },
}))
