export const MINUTES_IN_DAY = 24 * 60

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/

export const isValidTimeString = (value: string): boolean => TIME_PATTERN.test(value)

export const parseTimeToMinutes = (timeValue: string): number => {
  if (!isValidTimeString(timeValue)) {
    throw new Error(`Invalid time value: ${timeValue}`)
  }

  if (timeValue === '24:00') {
    return MINUTES_IN_DAY
  }

  const [rawHour, rawMinute] = timeValue.split(':')
  const hours = Number(rawHour)
  const minutes = Number(rawMinute)

  return hours * 60 + minutes
}

export const formatClock = (minutes: number): string => {
  if (minutes === MINUTES_IN_DAY) {
    return '24:00'
  }

  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
  const hours = Math.floor(normalized / 60)
  const remainder = normalized % 60

  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export const snapToInterval = (minutes: number, interval: number): number =>
  Math.round(minutes / interval) * interval

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (remainder === 0) {
    return `${hours}h`
  }

  return `${hours}h ${remainder}m`
}
