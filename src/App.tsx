import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { addDays } from 'date-fns'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  DAY_HEADER_HEIGHT,
  DAY_NAMES,
  DAY_SHORT_NAMES,
  MAX_SHIFTS_PER_AGENT_PER_DAY,
  MIN_SHIFT_MINUTES,
  PRESET_MEMBER_COLORS,
  SNAP_INTERVAL_MINUTES,
  TIME_AXIS_WIDTH,
} from './constants'
import { useScheduleStore } from './store/scheduleStore'
import type { Agent, ShiftBlock } from './types'
import {
  buildScheduleExportPayload,
  parseScheduleImport,
} from './utils/importExport'
import {
  buildAgentLookup,
  buildAgentShiftOrderMap,
  findOverlappingShift,
  normalizeHexColor,
  normalizeMemberName,
  validateShiftBlock,
} from './utils/schedule'
import {
  buildWeekDates,
  formatDateDisplayLong,
  formatDayHeaderDate,
  getWeekPresentation,
  isTodayAtDayIndex,
  parseDateKey,
} from './utils/date'
import {
  MINUTES_IN_DAY,
  clamp,
  formatClock,
  formatDuration,
  parseTimeToMinutes,
  snapToInterval,
} from './utils/time'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const TIME_OPTIONS = Array.from({ length: 49 }, (_, index) => formatClock(index * 30))

type DayLaneInfo = {
  laneByAgentId: Map<string, number>
  laneCount: number
}

type DragDraft = {
  shiftId: string
  dayIndex: number
  start: number
  end: number
}

type ResizeDraft = {
  shiftId: string
  end: number
}

type ShiftCardProps = {
  shift: ShiftBlock
  agent: Agent
  style: CSSProperties
  isDragging: boolean
  tooltip: string
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>, shift: ShiftBlock) => void
  onDeleteShift: (shift: ShiftBlock) => void
  onCutShift: (shift: ShiftBlock) => void
}

const getLaneStyles = (laneIndex: number, laneCount: number): Pick<CSSProperties, 'left' | 'width'> => {
  const laneWidth = 100 / laneCount

  return {
    left: `calc(${laneIndex * laneWidth}% + 2px)`,
    width: `calc(${laneWidth}% - 4px)`,
  }
}

const ShiftCard = ({
  shift,
  agent,
  style,
  isDragging,
  tooltip,
  onResizeStart,
  onDeleteShift,
  onCutShift,
}: ShiftCardProps): JSX.Element => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: shift.id,
  })

  const dragStyle: CSSProperties = transform
    ? { transform: CSS.Translate.toString(transform) }
    : {}

  const blockHeight = typeof style.height === 'number' ? style.height : 0

  const showOnlyShortName = blockHeight < 20
  const showOnlyName = blockHeight < 32
  const displayName = showOnlyShortName ? agent.name.slice(0, 3) : agent.name
  const showActions = blockHeight >= 22

  return (
    <article
      ref={setNodeRef}
      title={tooltip}
      style={{
        ...style,
        ...dragStyle,
        backgroundColor: agent.color,
        fontSize: 'clamp(8px, 0.9vw, 11px)',
      }}
      className={`group absolute z-20 flex cursor-grab select-none flex-col overflow-hidden rounded-md px-1.5 py-1 text-left text-white shadow-lg shadow-black/30 ring-1 ring-black/35 transition ${
        isDragging ? 'opacity-30' : 'opacity-100'
      }`}
      {...attributes}
      {...listeners}
    >
      <p className="truncate font-semibold leading-tight">{displayName}</p>
      {!showOnlyName ? (
        <p className="truncate text-[0.9em] leading-tight text-white/90">
          {formatClock(shift.start)}-{formatClock(shift.end)}
        </p>
      ) : null}
      {showActions ? (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onCutShift(shift)
            }}
            className="rounded bg-black/40 px-1 text-[9px] font-bold text-white hover:bg-black/60"
            aria-label={`Remove part of shift for ${agent.name}`}
            title="Remove part of this shift"
          >
            ✂
          </button>
          <button
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onDeleteShift(shift)
            }}
            className="rounded bg-black/40 px-1 text-[9px] font-bold text-white hover:bg-rose-700/90"
            aria-label={`Delete shift for ${agent.name}`}
            title="Delete this shift"
          >
            ×
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={(event) => {
          event.stopPropagation()
          onResizeStart(event, shift)
        }}
        className="absolute inset-x-1 bottom-0 h-1.5 cursor-row-resize rounded bg-black/20 opacity-0 transition group-hover:opacity-100"
        aria-label={`Resize shift for ${agent.name}`}
      />
    </article>
  )
}

const App = (): JSX.Element => {
  const {
    agents,
    shifts,
    hiddenAgentIds,
    weekStart,
    importedView,
    importError,
    uiError,
    toggleAgentVisibility,
    setImportError,
    setUiError,
    addAgent,
    updateAgent,
    deleteAgent,
    addShift,
    moveShift,
    resizeShift,
    deleteShift,
    deleteAgentDayShifts,
    removeShiftSegment,
    shiftWeek,
    goToCurrentWeek,
    loadImportedData,
  } = useScheduleStore()

  const weekStartDate = useMemo(() => parseDateKey(weekStart) ?? new Date(), [weekStart])
  const weekDates = useMemo(() => buildWeekDates(weekStartDate), [weekStartDate])
  const weekPresentation = useMemo(() => getWeekPresentation(weekStartDate), [weekStartDate])

  const [dayWidth, setDayWidth] = useState(120)
  const [hourRowHeight, setHourRowHeight] = useState(28)

  const dayColumnsRef = useRef<HTMLDivElement>(null)
  const calendarBodyRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null)
  const dragOriginRef = useRef<{ shift: ShiftBlock; dayIndex: number } | null>(null)

  const [isResizing, setIsResizing] = useState(false)
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null)
  const resizeDraftRef = useRef<ResizeDraft | null>(null)
  const resizeOriginRef = useRef<{
    shiftId: string
    startY: number
    originalEnd: number
    minEnd: number
  } | null>(null)

  const [isTeamPanelOpen, setIsTeamPanelOpen] = useState(false)
  const [memberFormMode, setMemberFormMode] = useState<'add' | 'edit'>('add')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberName, setMemberName] = useState('')
  const [memberColor, setMemberColor] = useState<string>(PRESET_MEMBER_COLORS[0])
  const [memberError, setMemberError] = useState<string | null>(null)

  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false)
  const [shiftForm, setShiftForm] = useState({
    agentId: agents[0]?.id ?? '',
    dayIndex: 0,
    start: '09:00',
    end: '18:00',
  })
  const [shiftFormError, setShiftFormError] = useState<string | null>(null)

  const [cutShiftTarget, setCutShiftTarget] = useState<ShiftBlock | null>(null)
  const [cutRangeStart, setCutRangeStart] = useState('00:00')
  const [cutRangeEnd, setCutRangeEnd] = useState('00:30')
  const [cutRangeError, setCutRangeError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!agents.some((agent) => agent.id === shiftForm.agentId)) {
      setShiftForm((previous) => ({
        ...previous,
        agentId: agents[0]?.id ?? '',
      }))
    }
  }, [agents, shiftForm.agentId])

  useEffect(() => {
    const dayNode = dayColumnsRef.current
    const bodyNode = calendarBodyRef.current

    if (!dayNode || !bodyNode) {
      return
    }

    const updateDimensions = (): void => {
      const dayWidthRaw = dayNode.getBoundingClientRect().width / 7
      if (dayWidthRaw > 0) {
        setDayWidth(dayWidthRaw)
      }

      const rawRowHeight = bodyNode.getBoundingClientRect().height / 24
      if (rawRowHeight > 0) {
        setHourRowHeight(Math.max(28, rawRowHeight))
      }
    }

    const observer = new ResizeObserver(updateDimensions)
    observer.observe(dayNode)
    observer.observe(bodyNode)
    updateDimensions()

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const onPointerMove = (event: PointerEvent): void => {
      const origin = resizeOriginRef.current
      if (!origin) {
        return
      }

      const deltaMinutes = snapToInterval(
        ((event.clientY - origin.startY) / hourRowHeight) * 60,
        SNAP_INTERVAL_MINUTES,
      )

      const end = clamp(
        origin.originalEnd + deltaMinutes,
        origin.minEnd,
        MINUTES_IN_DAY,
      )

      const draft: ResizeDraft = {
        shiftId: origin.shiftId,
        end,
      }

      resizeDraftRef.current = draft
      setResizeDraft(draft)
    }

    const onPointerUp = (): void => {
      const origin = resizeOriginRef.current

      if (!origin) {
        return
      }

      const finalEnd =
        resizeDraftRef.current?.shiftId === origin.shiftId
          ? resizeDraftRef.current.end
          : origin.originalEnd

      const result = resizeShift(origin.shiftId, finalEnd)

      if (!result.ok && result.error) {
        setUiError(result.error)
      }

      resizeOriginRef.current = null
      resizeDraftRef.current = null
      setResizeDraft(null)
      setIsResizing(false)
    }

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [hourRowHeight, isResizing, resizeShift, setUiError])

  const hiddenLookup = useMemo(() => new Set(hiddenAgentIds), [hiddenAgentIds])
  const visibleShifts = useMemo(
    () => shifts.filter((shift) => !hiddenLookup.has(shift.agentId)),
    [hiddenLookup, shifts],
  )

  const agentLookup = useMemo(() => buildAgentLookup(agents), [agents])

  const shiftsByDay = useMemo(() => {
    const grouped = Array.from({ length: 7 }, () => [] as ShiftBlock[])

    visibleShifts.forEach((shift) => {
      if (shift.dayIndex >= 0 && shift.dayIndex <= 6) {
        grouped[shift.dayIndex].push(shift)
      }
    })

    grouped.forEach((dayShifts) => {
      dayShifts.sort((left, right) => {
        if (left.agentId !== right.agentId) {
          return left.agentId.localeCompare(right.agentId)
        }

        return left.start - right.start
      })
    })

    return grouped
  }, [visibleShifts])

  const laneInfoByDay = useMemo(() => {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const activeAgentIds = agents
        .map((agent) => agent.id)
        .filter((agentId) =>
          visibleShifts.some(
            (shift) => shift.dayIndex === dayIndex && shift.agentId === agentId,
          ),
        )

      const laneByAgentId = new Map<string, number>()

      activeAgentIds.forEach((agentId, laneIndex) => {
        laneByAgentId.set(agentId, laneIndex)
      })

      const laneInfo: DayLaneInfo = {
        laneByAgentId,
        laneCount: Math.max(1, activeAgentIds.length),
      }

      return laneInfo
    })
  }, [agents, visibleShifts])

  const shiftOrderMap = useMemo(() => buildAgentShiftOrderMap(shifts), [shifts])

  const coverageSummary = useMemo(() => {
    const uncoveredByDay = Array.from({ length: 7 }, () => [] as number[])

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const start = hour * 60
        const end = start + 60

        const hasCoverage = shifts.some(
          (shift) =>
            shift.dayIndex === dayIndex && shift.start < end && shift.end > start,
        )

        if (!hasCoverage) {
          uncoveredByDay[dayIndex].push(hour)
        }
      }
    }

    const perDay = uncoveredByDay.map((uncovered, dayIndex) => {
      const coveredHours = 24 - uncovered.length
      return {
        dayIndex,
        coveragePercent: Math.round((coveredHours / 24) * 100),
      }
    })

    const uncoveredSlots = uncoveredByDay.flatMap((hours, dayIndex) =>
      hours.map((hour) => ({
        dayIndex,
        hour,
      })),
    )

    return {
      uncoveredByDay,
      perDay,
      uncoveredSlots,
    }
  }, [shifts])

  const weeklyHoursByAgent = useMemo(() => {
    return agents.map((agent) => {
      const totalMinutes = shifts
        .filter((shift) => shift.agentId === agent.id)
        .reduce((sum, shift) => sum + (shift.end - shift.start), 0)

      return {
        ...agent,
        totalHours: totalMinutes / 60,
      }
    })
  }, [agents, shifts])

  const maxWeeklyHours = useMemo(
    () => Math.max(...weeklyHoursByAgent.map((entry) => entry.totalHours), 1),
    [weeklyHoursByAgent],
  )

  const activeShift = useMemo(
    () => visibleShifts.find((shift) => shift.id === activeDragId) ?? null,
    [activeDragId, visibleShifts],
  )

  const dragPreviewShift = useMemo(() => {
    if (!activeShift || !dragDraft) {
      return null
    }

    return {
      ...activeShift,
      dayIndex: dragDraft.dayIndex,
      start: dragDraft.start,
      end: dragDraft.end,
    }
  }, [activeShift, dragDraft])

  const overlayShift = dragPreviewShift ?? activeShift

  const clearDragState = (): void => {
    dragOriginRef.current = null
    setActiveDragId(null)
    setDragDraft(null)
  }

  const handleDragStart = (event: DragStartEvent): void => {
    if (isResizing) {
      return
    }

    const shift = visibleShifts.find((entry) => entry.id === String(event.active.id))

    if (!shift) {
      return
    }

    dragOriginRef.current = {
      shift,
      dayIndex: shift.dayIndex,
    }

    setActiveDragId(shift.id)
    setDragDraft({
      shiftId: shift.id,
      dayIndex: shift.dayIndex,
      start: shift.start,
      end: shift.end,
    })
  }

  const handleDragMove = (event: DragMoveEvent): void => {
    const origin = dragOriginRef.current

    if (!origin) {
      return
    }

    const duration = origin.shift.end - origin.shift.start

    const dayOffset = dayWidth > 0 ? Math.round(event.delta.x / dayWidth) : 0
    const dayIndex = clamp(origin.dayIndex + dayOffset, 0, 6)

    const minuteOffset = snapToInterval(
      (event.delta.y / hourRowHeight) * 60,
      SNAP_INTERVAL_MINUTES,
    )

    const start = clamp(origin.shift.start + minuteOffset, 0, MINUTES_IN_DAY - duration)

    setDragDraft({
      shiftId: origin.shift.id,
      dayIndex,
      start,
      end: start + duration,
    })
  }

  const handleDragEnd = (): void => {
    if (!dragDraft) {
      clearDragState()
      return
    }

    const result = moveShift(dragDraft.shiftId, {
      dayIndex: dragDraft.dayIndex,
      start: dragDraft.start,
      end: dragDraft.end,
    })

    if (!result.ok && result.error) {
      setUiError(result.error)
    }

    clearDragState()
  }

  const handleResizeStart = (
    event: ReactPointerEvent<HTMLButtonElement>,
    shift: ShiftBlock,
  ): void => {
    event.preventDefault()

    resizeOriginRef.current = {
      shiftId: shift.id,
      startY: event.clientY,
      originalEnd: shift.end,
      minEnd: shift.start + MIN_SHIFT_MINUTES,
    }

    const draft: ResizeDraft = {
      shiftId: shift.id,
      end: shift.end,
    }

    resizeDraftRef.current = draft
    setResizeDraft(draft)
    setIsResizing(true)
  }

  const handleDeleteShiftBlock = (shift: ShiftBlock): void => {
    const agentName = agentLookup.get(shift.agentId)?.name ?? 'this member'
    const confirmed = window.confirm(
      `Delete this shift for ${agentName} on ${DAY_NAMES[shift.dayIndex]} (${formatClock(
        shift.start,
      )}-${formatClock(shift.end)})?`,
    )

    if (!confirmed) {
      return
    }

    deleteShift(shift.id)
  }

  const openCutShiftModal = (shift: ShiftBlock): void => {
    const shiftMinutes = shift.end - shift.start
    const defaultCutEnd = shift.start + Math.min(Math.max(60, MIN_SHIFT_MINUTES), shiftMinutes)

    setCutShiftTarget(shift)
    setCutRangeStart(formatClock(shift.start))
    setCutRangeEnd(formatClock(defaultCutEnd))
    setCutRangeError(null)
  }

  const closeCutShiftModal = (): void => {
    setCutShiftTarget(null)
    setCutRangeError(null)
  }

  const handleSubmitCutShift = (): void => {
    if (!cutShiftTarget) {
      return
    }

    let start: number
    let end: number

    try {
      start = parseTimeToMinutes(cutRangeStart)
      end = parseTimeToMinutes(cutRangeEnd)
    } catch {
      setCutRangeError('Invalid time format.')
      return
    }

    if (start < cutShiftTarget.start || end > cutShiftTarget.end) {
      setCutRangeError('Remove range must stay inside the selected shift.')
      return
    }

    if (end - start < MIN_SHIFT_MINUTES) {
      setCutRangeError('Remove range must be at least 30 minutes.')
      return
    }

    const result = removeShiftSegment(cutShiftTarget.id, start, end)

    if (!result.ok) {
      setCutRangeError(result.error ?? 'Unable to remove selected range.')
      return
    }

    closeCutShiftModal()
  }

  const handleDeleteCutTargetShift = (): void => {
    if (!cutShiftTarget) {
      return
    }

    const shift = cutShiftTarget
    closeCutShiftModal()
    handleDeleteShiftBlock(shift)
  }

  const handleOpenAddShift = (): void => {
    setShiftFormError(null)
    setShiftForm((previous) => ({
      ...previous,
      agentId: agents[0]?.id ?? '',
      dayIndex: 0,
      start: '09:00',
      end: '18:00',
    }))
    setIsAddShiftOpen(true)
  }

  const existingFormShifts = useMemo(() => {
    return shifts
      .filter(
        (shift) =>
          shift.agentId === shiftForm.agentId && shift.dayIndex === shiftForm.dayIndex,
      )
      .sort((left, right) => left.start - right.start)
  }, [shiftForm.agentId, shiftForm.dayIndex, shifts])

  const cutRangeOptions = useMemo(() => {
    if (!cutShiftTarget) {
      return { startOptions: [] as string[], endOptions: [] as string[] }
    }

    const startOptions = TIME_OPTIONS.filter((timeValue) => {
      const minute = parseTimeToMinutes(timeValue)
      return minute >= cutShiftTarget.start && minute <= cutShiftTarget.end - MIN_SHIFT_MINUTES
    })

    const endOptions = TIME_OPTIONS.filter((timeValue) => {
      const minute = parseTimeToMinutes(timeValue)
      return minute >= cutShiftTarget.start + MIN_SHIFT_MINUTES && minute <= cutShiftTarget.end
    })

    return {
      startOptions,
      endOptions,
    }
  }, [cutShiftTarget])

  useEffect(() => {
    if (!cutShiftTarget) {
      return
    }

    if (!cutRangeOptions.startOptions.includes(cutRangeStart)) {
      setCutRangeStart(cutRangeOptions.startOptions[0] ?? formatClock(cutShiftTarget.start))
    }

    if (!cutRangeOptions.endOptions.includes(cutRangeEnd)) {
      setCutRangeEnd(cutRangeOptions.endOptions[0] ?? formatClock(cutShiftTarget.end))
    }
  }, [
    cutRangeEnd,
    cutRangeOptions.endOptions,
    cutRangeOptions.startOptions,
    cutRangeStart,
    cutShiftTarget,
  ])

  const formOverlapMessage = useMemo(() => {
    if (!shiftForm.agentId) {
      return null
    }

    let start: number
    let end: number

    try {
      start = parseTimeToMinutes(shiftForm.start)
      end = parseTimeToMinutes(shiftForm.end)
    } catch {
      return 'Invalid time format.'
    }

    if (end <= start) {
      return 'End time must be later than start time.'
    }

    const overlap = findOverlappingShift(shifts, {
      agentId: shiftForm.agentId,
      dayIndex: shiftForm.dayIndex,
      start,
      end,
    })

    if (overlap) {
      return `⚠️ Overlaps with existing shift ${formatClock(overlap.start)}–${formatClock(overlap.end)}`
    }

    const validation = validateShiftBlock(shifts, {
      agentId: shiftForm.agentId,
      dayIndex: shiftForm.dayIndex,
      start,
      end,
    })

    if (!validation.ok) {
      return validation.error
    }

    return null
  }, [shiftForm.agentId, shiftForm.dayIndex, shiftForm.end, shiftForm.start, shifts])

  const handleSubmitAddShift = (): void => {
    if (!shiftForm.agentId) {
      setShiftFormError('Please select a team member.')
      return
    }

    let start: number
    let end: number

    try {
      start = parseTimeToMinutes(shiftForm.start)
      end = parseTimeToMinutes(shiftForm.end)
    } catch {
      setShiftFormError('Invalid time format.')
      return
    }

    if (formOverlapMessage) {
      setShiftFormError(formOverlapMessage)
      return
    }

    const result = addShift({
      agentId: shiftForm.agentId,
      dayIndex: shiftForm.dayIndex,
      start,
      end,
    })

    if (!result.ok) {
      setShiftFormError(result.error ?? 'Unable to add shift.')
      return
    }

    setShiftFormError(null)
    setIsAddShiftOpen(false)
  }

  const handleDeleteSelectedAgentDayShifts = (): void => {
    if (!shiftForm.agentId) {
      setShiftFormError('Please select a team member.')
      return
    }

    const agent = agentLookup.get(shiftForm.agentId)
    const dayName = DAY_NAMES[shiftForm.dayIndex]
    const confirmed = window.confirm(
      `Delete all shifts for ${agent?.name ?? 'this member'} on ${dayName}?`,
    )

    if (!confirmed) {
      return
    }

    const result = deleteAgentDayShifts(shiftForm.agentId, shiftForm.dayIndex)

    if (!result.ok) {
      setShiftFormError(result.error ?? 'Unable to delete day shifts.')
      return
    }

    setShiftFormError(null)
  }

  const resetMemberForm = (): void => {
    setMemberFormMode('add')
    setEditingMemberId(null)
    setMemberName('')
    setMemberColor(PRESET_MEMBER_COLORS[0])
    setMemberError(null)
  }

  const handleEditMember = (agent: Agent): void => {
    setMemberFormMode('edit')
    setEditingMemberId(agent.id)
    setMemberName(agent.name)
    setMemberColor(agent.color)
    setMemberError(null)
  }

  const handleSubmitMember = (): void => {
    const cleanName = normalizeMemberName(memberName)
    const cleanColor = normalizeHexColor(memberColor)

    if (!cleanName) {
      setMemberError('Name is required.')
      return
    }

    if (cleanName.length > 20) {
      setMemberError('Name must be 20 characters or fewer.')
      return
    }

    if (!cleanColor) {
      setMemberError('Please enter a valid HEX color.')
      return
    }

    const result =
      memberFormMode === 'add'
        ? addAgent(cleanName, cleanColor)
        : updateAgent(editingMemberId ?? '', cleanName, cleanColor)

    if (!result.ok) {
      setMemberError(result.error ?? 'Unable to save member.')
      return
    }

    resetMemberForm()
  }

  const handleDeleteMember = (agent: Agent): void => {
    const confirmed = window.confirm(
      `Delete ${agent.name}? This will remove all their shifts.`,
    )

    if (!confirmed) {
      return
    }

    const result = deleteAgent(agent.id)

    if (!result.ok) {
      setMemberError(result.error ?? 'Unable to delete member.')
      return
    }

    if (editingMemberId === agent.id) {
      resetMemberForm()
    }
  }

  const handleExport = (): void => {
    const payload = buildScheduleExportPayload({
      agents,
      shifts,
      weekStart,
    })

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `support-team-week-${payload.meta.weekNumber}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenImport = (): void => {
    setImportError(null)
    fileInputRef.current?.click()
  }

  const handleImportFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      if (!file.name.toLowerCase().endsWith('.json')) {
        setImportError('❌ Invalid file format. Please use a valid schedule JSON export.')
        return
      }

      const content = await file.text()
      const parsed = parseScheduleImport(content)

      if (!parsed.ok) {
        setImportError(parsed.error)
        return
      }

      const result = loadImportedData(parsed.data)

      if (!result.ok) {
        setImportError(result.error ?? 'Unable to load imported schedule.')
        return
      }

      setImportError(null)
      setUiError(null)
    } catch {
      setImportError('❌ Invalid file format. Please use a valid schedule JSON export.')
    } finally {
      event.target.value = ''
    }
  }

  const timelineHeight = hourRowHeight * 24

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#0F1117] text-slate-100">
      <header className="shrink-0 border-b border-slate-800/90 bg-[#131a2a]/95 px-3 py-2 shadow-lg shadow-black/25 md:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100 md:text-xl">
              Support Team Schedule
            </h1>
            <p className="text-xs text-slate-300 md:text-sm">
              📅 Week {weekPresentation.weekNumber} — Mon {formatDateDisplayLong(weekPresentation.weekStart)} → Sun{' '}
              {formatDateDisplayLong(weekPresentation.weekEnd)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTeamPanelOpen(true)}
              className="rounded-md border border-slate-600 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700"
            >
              👤+ Manage Team
            </button>
            <button
              type="button"
              onClick={handleOpenAddShift}
              className="rounded-md border border-slate-600 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700"
            >
              + Add Shift
            </button>
            <button
              type="button"
              onClick={handleOpenImport}
              className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/25"
            >
              ⬆️ Import JSON
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/25"
            >
              ⬇️ Export JSON
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="rounded-md border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            ← Prev Week
          </button>

          <span className="rounded-md border border-slate-700/80 bg-slate-900/60 px-3 py-1 text-xs text-slate-200">
            Week {weekPresentation.weekNumber} — {formatDateDisplayLong(weekPresentation.weekStart)} →{' '}
            {formatDateDisplayLong(weekPresentation.weekEnd)}
          </span>

          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="rounded-md border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Next Week →
          </button>

          <button
            type="button"
            onClick={goToCurrentWeek}
            className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-xs text-cyan-100 hover:bg-cyan-500/25"
          >
            Today
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {agents.map((agent) => {
            const hidden = hiddenLookup.has(agent.id)

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggleAgentVisibility(agent.id)}
                title={hidden ? `Show ${agent.name}` : `Hide ${agent.name}`}
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  hidden
                    ? 'border-slate-700 bg-slate-900/70 text-slate-500'
                    : 'border-slate-600 bg-slate-800/90 text-slate-100'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: agent.color }}
                />
                <span className={hidden ? 'line-through' : ''}>{agent.name}</span>
              </button>
            )
          })}
        </div>

        {importedView ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            <span>
              📂 Viewing imported schedule — Week {importedView.weekNumber} ({importedView.weekStart} → {importedView.weekEnd})
            </span>
            <button
              type="button"
              onClick={goToCurrentWeek}
              className="rounded border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/25"
            >
              Return to Current Week
            </button>
          </div>
        ) : null}

        {importError ? (
          <p className="mt-2 text-xs text-rose-300">{importError}</p>
        ) : null}

        {uiError ? (
          <button
            type="button"
            onClick={() => setUiError(null)}
            className="mt-2 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-left text-xs text-amber-200"
          >
            {uiError} (click to dismiss)
          </button>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void handleImportFile(event)
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-2 md:px-3">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={clearDragState}
        >
          <div className="hidden min-h-0 flex-1 gap-3 md:flex">
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-[#111726]/90">
              <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex h-full min-w-[900px] flex-col">
                  <div
                    className="grid shrink-0 border-b border-slate-700/80 bg-[#1a2236]/90"
                    style={{
                      gridTemplateColumns: `${TIME_AXIS_WIDTH}px repeat(7, minmax(0, 1fr))`,
                      height: DAY_HEADER_HEIGHT,
                    }}
                  >
                    <div className="border-r border-slate-700/80 px-1 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Time
                    </div>
                    {DAY_NAMES.map((dayName, dayIndex) => {
                      const dayDate = weekDates[dayIndex]
                      const isToday = isTodayAtDayIndex(weekStartDate, dayIndex)

                      return (
                        <div
                          key={dayName}
                          className={`border-r border-slate-700/70 px-1 py-1 text-center text-[11px] last:border-r-0 md:text-xs ${
                            isToday ? 'bg-cyan-500/15 font-semibold text-cyan-200' : 'text-slate-200'
                          }`}
                        >
                          <p className={isToday ? 'font-bold' : 'font-semibold'}>{DAY_SHORT_NAMES[dayIndex]}</p>
                          <p className={isToday ? 'font-semibold text-cyan-200' : 'text-slate-300'}>
                            {formatDayHeaderDate(dayDate)}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  <div
                    ref={calendarBodyRef}
                    className="min-h-0 flex-1 overflow-hidden"
                  >
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `${TIME_AXIS_WIDTH}px repeat(7, minmax(0, 1fr))`,
                        height: timelineHeight,
                      }}
                    >
                      <div className="border-r border-slate-700/80 bg-[#131a2a]">
                        {HOURS.map((hour) => (
                          <div
                            key={`hour-label-${hour}`}
                            className="flex items-center justify-end border-t border-slate-700/70 pr-1 text-[clamp(9px,1.1vw,11px)] text-slate-400 first:border-t-0"
                            style={{ height: hourRowHeight }}
                          >
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        ))}
                      </div>

                      <div
                        ref={dayColumnsRef}
                        className="col-span-7 grid grid-cols-7"
                        style={{ height: timelineHeight }}
                      >
                        {DAY_NAMES.map((dayName, dayIndex) => {
                          const dayShifts = shiftsByDay[dayIndex]
                          const laneInfo = laneInfoByDay[dayIndex]
                          const isToday = isTodayAtDayIndex(weekStartDate, dayIndex)

                          const isDropTarget = dragDraft?.dayIndex === dayIndex
                          const previewInDay =
                            dragPreviewShift && dragPreviewShift.dayIndex === dayIndex
                              ? dragPreviewShift
                              : null

                          const previewHasLane =
                            previewInDay && laneInfo.laneByAgentId.has(previewInDay.agentId)
                          const previewLaneCount = previewInDay
                            ? previewHasLane
                              ? laneInfo.laneCount
                              : laneInfo.laneCount + 1
                            : laneInfo.laneCount
                          const previewLaneIndex =
                            previewInDay && previewHasLane
                              ? laneInfo.laneByAgentId.get(previewInDay.agentId) ?? 0
                              : laneInfo.laneCount

                          return (
                            <div
                              key={dayName}
                              className={`relative border-r border-slate-700/70 last:border-r-0 ${
                                isToday ? 'bg-cyan-500/[0.05]' : 'bg-[#0f1524]'
                              } ${isDropTarget ? 'bg-cyan-500/[0.1]' : ''}`}
                            >
                              {coverageSummary.uncoveredByDay[dayIndex].map((hour) => (
                                <div
                                  key={`${dayName}-gap-${hour}`}
                                  className="absolute inset-x-0 z-0 border-y border-rose-400/30 bg-rose-500/10"
                                  style={{
                                    top: hour * hourRowHeight,
                                    height: hourRowHeight,
                                  }}
                                  title={`⚠️ No coverage – ${dayName} ${formatClock(
                                    hour * 60,
                                  )}`}
                                />
                              ))}

                              {HOURS.map((hour) => (
                                <div
                                  key={`${dayName}-hour-line-${hour}`}
                                  className="pointer-events-none absolute inset-x-0 z-10 border-t border-slate-700/60"
                                  style={{ top: hour * hourRowHeight }}
                                />
                              ))}

                              {HOURS.map((hour) => (
                                <div
                                  key={`${dayName}-half-${hour}`}
                                  className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-slate-800"
                                  style={{ top: hour * hourRowHeight + hourRowHeight / 2 }}
                                />
                              ))}

                              {Array.from({ length: laneInfo.laneCount - 1 }, (_, dividerIndex) => (
                                <div
                                  key={`${dayName}-lane-divider-${dividerIndex}`}
                                  className="pointer-events-none absolute bottom-0 top-0 z-10 border-l border-slate-700/40"
                                  style={{
                                    left: `${((dividerIndex + 1) / laneInfo.laneCount) * 100}%`,
                                  }}
                                />
                              ))}

                              {dayShifts.map((shift) => {
                                const agent = agentLookup.get(shift.agentId)

                                if (!agent) {
                                  return null
                                }

                                const laneIndex = laneInfo.laneByAgentId.get(shift.agentId) ?? 0
                                const activeEnd =
                                  resizeDraft?.shiftId === shift.id ? resizeDraft.end : shift.end

                                const top = (shift.start / 60) * hourRowHeight + 1
                                const height = (Math.max(shift.start + 30, activeEnd) - shift.start) / 60 * hourRowHeight - 2

                                const laneStyle = getLaneStyles(laneIndex, laneInfo.laneCount)
                                const order = shiftOrderMap.get(shift.id)
                                const tooltip = `Shift ${order?.index ?? 1} of ${order?.total ?? 1} — ${agent.name} | ${dayName} | ${formatClock(
                                  shift.start,
                                )}-${formatClock(activeEnd)} | ${formatDuration(activeEnd - shift.start)}`

                                return (
                                  <ShiftCard
                                    key={shift.id}
                                    shift={{ ...shift, end: activeEnd }}
                                    agent={agent}
                                    isDragging={activeDragId === shift.id}
                                    tooltip={tooltip}
                                    onResizeStart={handleResizeStart}
                                    onDeleteShift={handleDeleteShiftBlock}
                                    onCutShift={openCutShiftModal}
                                    style={{
                                      top,
                                      height: Math.max(height, 16),
                                      ...laneStyle,
                                    }}
                                  />
                                )
                              })}

                              {previewInDay ? (
                                <div
                                  className="pointer-events-none absolute z-30 rounded border border-cyan-200/80 bg-cyan-300/20 px-1 text-[10px] text-cyan-100"
                                  style={{
                                    top: (previewInDay.start / 60) * hourRowHeight + 1,
                                    height: ((previewInDay.end - previewInDay.start) / 60) * hourRowHeight - 2,
                                    ...getLaneStyles(previewLaneIndex, previewLaneCount),
                                  }}
                                >
                                  {agentLookup.get(previewInDay.agentId)?.name ?? previewInDay.agentId}{' '}
                                  {formatClock(previewInDay.start)}-{formatClock(previewInDay.end)}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <aside className="w-[290px] shrink-0 overflow-auto rounded-xl border border-slate-700/80 bg-[#111726]/90 p-3">
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">
                  Coverage Summary
                </h2>

                <div className="mt-2 space-y-1.5">
                  {coverageSummary.perDay.map((entry) => (
                    <div
                      key={`coverage-${entry.dayIndex}`}
                      className="flex items-center justify-between rounded border border-slate-700/70 bg-slate-900/50 px-2 py-1 text-xs"
                    >
                      <span>{DAY_SHORT_NAMES[entry.dayIndex]}</span>
                      <span
                        className={
                          entry.coveragePercent === 100
                            ? 'font-semibold text-emerald-300'
                            : 'font-semibold text-amber-300'
                        }
                      >
                        {entry.coveragePercent}%
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-md border border-slate-700/70 bg-slate-950/40 p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                    Uncovered Slots
                  </p>

                  {coverageSummary.uncoveredSlots.length === 0 ? (
                    <p className="mt-1 text-xs text-emerald-300">All hours covered.</p>
                  ) : (
                    <div className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-rose-200">
                      {coverageSummary.uncoveredSlots.map((slot) => (
                        <div key={`slot-${slot.dayIndex}-${slot.hour}`}>
                          {DAY_SHORT_NAMES[slot.dayIndex]} {formatClock(slot.hour * 60)}-
                          {formatClock((slot.hour + 1) * 60)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">
                  Week Overview
                </h2>

                <div className="mt-2 space-y-2">
                  {weeklyHoursByAgent.map((agent) => {
                    const width = (agent.totalHours / maxWeeklyHours) * 100

                    return (
                      <div key={`hours-${agent.id}`}>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-200">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: agent.color }}
                            />
                            {agent.name}
                          </span>
                          <span>{agent.totalHours.toFixed(1)}h</span>
                        </div>
                        <div className="h-2 rounded bg-slate-800">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${width}%`,
                              backgroundColor: agent.color,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </aside>
          </div>

          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-700/80 bg-[#111726]/90 p-2 md:hidden">
            <div className="flex h-full snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden">
              {DAY_NAMES.map((dayName, dayIndex) => {
                const date = weekDates[dayIndex]
                const dayShifts = shifts
                  .filter((shift) => shift.dayIndex === dayIndex)
                  .sort((left, right) => left.start - right.start)

                return (
                  <article
                    key={`mobile-${dayName}`}
                    className="h-full min-w-[calc(100%-0.25rem)] snap-center overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-950/40 p-3"
                  >
                    <header className="mb-2 border-b border-slate-700/70 pb-2">
                      <p className="text-sm font-semibold text-slate-100">
                        {DAY_SHORT_NAMES[dayIndex]} {formatDayHeaderDate(date)}
                      </p>
                      <p className="text-xs text-slate-300">
                        Coverage: {coverageSummary.perDay[dayIndex].coveragePercent}%
                      </p>
                    </header>

                    <div className="space-y-2">
                      {dayShifts.length === 0 ? (
                        <p className="text-xs text-slate-400">No shifts scheduled.</p>
                      ) : (
                        dayShifts.map((shift) => {
                          const agent = agentLookup.get(shift.agentId)

                          if (!agent) {
                            return null
                          }

                          return (
                            <div
                              key={`mobile-shift-${shift.id}`}
                              className="rounded-md border border-slate-700/60 p-2 text-xs text-white"
                              style={{ backgroundColor: `${agent.color}30` }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">{agent.name}</p>
                                  <p className="text-white/90">
                                    {formatClock(shift.start)}-{formatClock(shift.end)}
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openCutShiftModal(shift)}
                                    className="rounded border border-slate-500/60 bg-slate-900/40 px-1.5 py-0.5 text-[10px] text-slate-100"
                                  >
                                    ✂
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteShiftBlock(shift)}
                                    className="rounded border border-rose-500/60 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-100"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <DragOverlay>
            {overlayShift ? (
              <div className="pointer-events-none rounded-md border border-white/25 bg-slate-100/90 px-2 py-1 text-[11px] font-semibold text-slate-900 shadow-xl">
                {agentLookup.get(overlayShift.agentId)?.name ?? overlayShift.agentId}
                <div className="text-[10px] font-medium text-slate-700">
                  {formatClock(overlayShift.start)}-{formatClock(overlayShift.end)}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {isTeamPanelOpen ? (
        <div className="absolute inset-0 z-50 flex justify-end bg-black/45">
          <aside className="h-full w-full max-w-[420px] overflow-auto border-l border-slate-700/80 bg-[#101726] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                Team Members Panel
              </h2>
              <button
                type="button"
                onClick={() => setIsTeamPanelOpen(false)}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={`member-${agent.id}`}
                  className="flex items-center justify-between rounded border border-slate-700/70 bg-slate-900/50 px-3 py-2"
                >
                  <span className="inline-flex items-center gap-2 text-sm text-slate-100">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                    {agent.name}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleEditMember(agent)}
                      className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMember(agent)}
                      className="rounded border border-rose-500/50 px-2 py-0.5 text-xs text-rose-200 hover:bg-rose-500/15"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">
                  {memberFormMode === 'add' ? 'Add New Member' : 'Edit Member'}
                </p>
                {memberFormMode === 'edit' ? (
                  <button
                    type="button"
                    onClick={resetMemberForm}
                    className="text-xs text-slate-400 underline"
                  >
                    New Member
                  </button>
                ) : null}
              </div>

              <label className="mb-1 block text-xs text-slate-300">Name</label>
              <input
                value={memberName}
                onChange={(event) => setMemberName(event.target.value)}
                maxLength={20}
                placeholder="Agent name"
                className="w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />

              <label className="mb-1 mt-2 block text-xs text-slate-300">Color</label>
              <div className="mb-2 grid grid-cols-10 gap-1">
                {PRESET_MEMBER_COLORS.map((color) => {
                  const selected = color.toUpperCase() === memberColor.toUpperCase()

                  return (
                    <button
                      key={`preset-color-${color}`}
                      type="button"
                      onClick={() => setMemberColor(color)}
                      className={`h-6 w-6 rounded border ${
                        selected ? 'border-white ring-1 ring-white/70' : 'border-slate-700'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  )
                })}
              </div>

              <input
                value={memberColor}
                onChange={(event) => setMemberColor(event.target.value)}
                placeholder="#7C3AED"
                className="w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />

              {memberError ? <p className="mt-2 text-xs text-rose-300">{memberError}</p> : null}

              <button
                type="button"
                onClick={handleSubmitMember}
                className="mt-3 w-full rounded border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/30"
              >
                Save
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {isAddShiftOpen ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 px-3">
          <div className="w-full max-w-[460px] rounded-xl border border-slate-700/80 bg-[#111726] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                Add Shift
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsAddShiftOpen(false)
                  setShiftFormError(null)
                }}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="grid gap-2">
              <label className="text-xs text-slate-300">Team Member</label>
              <select
                value={shiftForm.agentId}
                onChange={(event) =>
                  setShiftForm((previous) => ({
                    ...previous,
                    agentId: event.target.value,
                  }))
                }
                className="rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                {agents.map((agent) => (
                  <option key={`shift-agent-${agent.id}`} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>

              <label className="text-xs text-slate-300">Day</label>
              <select
                value={shiftForm.dayIndex}
                onChange={(event) =>
                  setShiftForm((previous) => ({
                    ...previous,
                    dayIndex: Number(event.target.value),
                  }))
                }
                className="rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                {DAY_NAMES.map((day, dayIndex) => (
                  <option key={`day-option-${day}`} value={dayIndex}>
                    {day} ({formatDayHeaderDate(addDays(weekStartDate, dayIndex))})
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-300">Start</label>
                  <select
                    value={shiftForm.start}
                    onChange={(event) =>
                      setShiftForm((previous) => ({
                        ...previous,
                        start: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  >
                    {TIME_OPTIONS.slice(0, -1).map((timeOption) => (
                      <option key={`start-time-${timeOption}`} value={timeOption}>
                        {timeOption}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-300">End</label>
                  <select
                    value={shiftForm.end}
                    onChange={(event) =>
                      setShiftForm((previous) => ({
                        ...previous,
                        end: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  >
                    {TIME_OPTIONS.slice(1).map((timeOption) => (
                      <option key={`end-time-${timeOption}`} value={timeOption}>
                        {timeOption}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded border border-slate-700/70 bg-slate-950/40 p-2">
              <p className="text-xs font-semibold text-slate-200">
                Existing shifts for this member/day
              </p>
              {existingFormShifts.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">No shifts yet.</p>
              ) : (
                <div className="mt-1 space-y-1 text-xs text-slate-200">
                  {existingFormShifts.map((shift, index) => (
                    <div
                      key={`existing-shift-${shift.id}`}
                      className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-900/40 px-2 py-1"
                    >
                      <span>
                        Shift {index + 1}: {formatClock(shift.start)}-{formatClock(shift.end)}
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openCutShiftModal(shift)}
                          className="rounded border border-slate-500/60 px-1.5 py-0.5 text-[10px] text-slate-100 hover:bg-slate-800"
                        >
                          Cut
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteShiftBlock(shift)}
                          className="rounded border border-rose-500/50 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/15"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {existingFormShifts.length > 0 &&
              existingFormShifts.length < MAX_SHIFTS_PER_AGENT_PER_DAY ? (
                <p className="mt-2 text-xs text-cyan-200">
                  Add another shift for this day
                </p>
              ) : null}
            </div>

            {formOverlapMessage ? (
              <p className="mt-2 text-xs text-rose-300">{formOverlapMessage}</p>
            ) : null}
            {shiftFormError ? (
              <p className="mt-2 text-xs text-rose-300">{shiftFormError}</p>
            ) : null}

            <button
              type="button"
              onClick={handleDeleteSelectedAgentDayShifts}
              disabled={existingFormShifts.length === 0}
              className="mt-3 w-full rounded border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete all shifts for this member/day
            </button>

            <button
              type="button"
              onClick={handleSubmitAddShift}
              disabled={existingFormShifts.length >= MAX_SHIFTS_PER_AGENT_PER_DAY}
              className="mt-3 w-full rounded border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Shift
            </button>
          </div>
        </div>
      ) : null}

      {cutShiftTarget ? (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 px-3">
          <div className="w-full max-w-[460px] rounded-xl border border-slate-700/80 bg-[#111726] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                Remove Part Of Shift
              </h2>
              <button
                type="button"
                onClick={closeCutShiftModal}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="rounded border border-slate-700/70 bg-slate-950/40 p-2 text-xs text-slate-200">
              <p>
                Member: <span className="font-semibold">{agentLookup.get(cutShiftTarget.agentId)?.name ?? cutShiftTarget.agentId}</span>
              </p>
              <p>
                Day: <span className="font-semibold">{DAY_NAMES[cutShiftTarget.dayIndex]}</span>
              </p>
              <p>
                Shift: <span className="font-semibold">{formatClock(cutShiftTarget.start)}-{formatClock(cutShiftTarget.end)}</span>
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-300">Remove From</label>
                <select
                  value={cutRangeStart}
                  onChange={(event) => setCutRangeStart(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
                >
                  {cutRangeOptions.startOptions.map((timeOption) => (
                    <option key={`cut-start-${timeOption}`} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-300">Remove To</label>
                <select
                  value={cutRangeEnd}
                  onChange={(event) => setCutRangeEnd(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
                >
                  {cutRangeOptions.endOptions.map((timeOption) => (
                    <option key={`cut-end-${timeOption}`} value={timeOption}>
                      {timeOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="mt-2 text-xs text-slate-300">
              This will remove the selected range and auto split the shift if needed.
            </p>

            {cutRangeError ? (
              <p className="mt-2 text-xs text-rose-300">{cutRangeError}</p>
            ) : null}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleSubmitCutShift}
                className="flex-1 rounded border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/30"
              >
                Apply Remove Range
              </button>
              <button
                type="button"
                onClick={handleDeleteCutTargetShift}
                className="rounded border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-500/25"
              >
                Delete Whole Shift
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
