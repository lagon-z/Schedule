import {
  addDays,
  endOfWeek,
  format,
  getISOWeek,
  isSameDay,
  isValid,
  parseISO,
  startOfWeek,
} from 'date-fns'

import { DAY_NAMES, DAY_SHORT_NAMES, type DayName } from '../constants'

export const getCurrentWeekStart = (baseDate = new Date()): Date =>
  startOfWeek(baseDate, { weekStartsOn: 1 })

export const formatDateKey = (date: Date): string => format(date, 'yyyy-MM-dd')

export const parseDateKey = (value: string): Date | null => {
  const parsed = parseISO(value)

  if (!isValid(parsed)) {
    return null
  }

  parsed.setHours(0, 0, 0, 0)
  return parsed
}

export const dayIndexFromDate = (date: Date): number => (date.getDay() + 6) % 7

export const dayNameFromDate = (date: Date): DayName => DAY_NAMES[dayIndexFromDate(date)]

export const buildWeekDates = (weekStartDate: Date): Date[] =>
  Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index))

export const formatDayHeaderDate = (date: Date): string => format(date, 'dd/MM')

export const formatDateDisplayLong = (date: Date): string => format(date, 'dd/MM/yyyy')

export const formatWeekRangeShort = (weekStartDate: Date): string => {
  const weekEndDate = addDays(weekStartDate, 6)
  return `${format(weekStartDate, 'dd/MM')} → ${format(weekEndDate, 'dd/MM')}`
}

export const getWeekPresentation = (weekStartDate: Date): {
  weekNumber: number
  weekStart: Date
  weekEnd: Date
  weekLabel: string
  weekRangeLabel: string
} => {
  const weekEndDate = endOfWeek(weekStartDate, { weekStartsOn: 1 })
  const weekNumber = getISOWeek(weekStartDate)

  return {
    weekNumber,
    weekStart: weekStartDate,
    weekEnd: weekEndDate,
    weekLabel: `Week ${weekNumber} — Mon ${formatDateDisplayLong(weekStartDate)} → Sun ${formatDateDisplayLong(
      weekEndDate,
    )}`,
    weekRangeLabel: `${formatDateDisplayLong(weekStartDate)} → ${formatDateDisplayLong(weekEndDate)}`,
  }
}

export const isTodayAtDayIndex = (weekStartDate: Date, dayIndex: number): boolean =>
  isSameDay(addDays(weekStartDate, dayIndex), new Date())

export const dayHeading = (dayIndex: number, weekStartDate: Date): string =>
  `${DAY_SHORT_NAMES[dayIndex]} ${formatDayHeaderDate(addDays(weekStartDate, dayIndex))}`
