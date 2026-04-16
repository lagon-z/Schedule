import type { DayName } from './constants'

export interface Agent {
  id: string
  name: string
  color: string
}

export interface ShiftBlock {
  id: string
  agentId: string
  dayIndex: number
  start: number
  end: number
}

export interface ExportShiftRange {
  start: string
  end: string
}

export interface ExportScheduleEntry {
  agentId: string
  day: DayName
  date: string
  shifts: ExportShiftRange[]
}

export interface ScheduleMeta {
  weekNumber: number
  weekStart: string
  weekEnd: string
  exportedAt: string
}

export interface ScheduleExportPayload {
  meta: ScheduleMeta
  agents: Agent[]
  schedule: ExportScheduleEntry[]
}

export interface ImportedScheduleData {
  weekNumber: number
  weekStart: string
  weekEnd: string
  agents: Agent[]
  shifts: ShiftBlock[]
}

export interface StoreActionResult {
  ok: boolean
  error?: string
}
