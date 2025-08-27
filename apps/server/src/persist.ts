import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TranscriptMessage } from './bland/transcript'
import type { Node } from './models'

export type CallRecord = {
  callId: string
  status?: string | null
  answered_by?: string | null
  price?: number | null
  startedAt?: string | null
  endedAt?: string | null
  concatenatedTranscript?: string | null
  transcript: TranscriptMessage[]
  planSummary?: string
  planNextPath?: string[]
  terminalType?:
    | 'none'
    | 'operator'
    | 'voicemail'
    | 'dead_end'
    | 'info_provided'
}

export type Snapshot = {
  takenAt: string
  root: Node
}

export type PersistedSession = {
  phone: string
  createdAt: string
  updatedAt: string
  maxCalls?: number
  minCalls?: number
  calls: CallRecord[]
  snapshots: Snapshot[]
  lastRoot?: Node
  totalCost?: number
}

const DATA_DIR = path.resolve(process.cwd(), 'data')

export function formatPhoneForFilename(phone: string): string {
  const digits = (phone.match(/\d+/g) || []).join('')
  if (digits.length === 11 && digits.startsWith('1')) {
    const a = digits.slice(1, 4)
    const b = digits.slice(4, 7)
    const c = digits.slice(7, 11)
    return `1-${a}-${b}-${c}`
  }
  if (digits.length === 10) {
    const a = digits.slice(0, 3)
    const b = digits.slice(3, 6)
    const c = digits.slice(6, 10)
    return `1-${a}-${b}-${c}`
  }
  return digits
}

export function sessionPathForPhone(phone: string): string {
  const name = `${formatPhoneForFilename(phone)}.json`
  return path.join(DATA_DIR, name)
}

export async function loadSession(
  phone: string
): Promise<PersistedSession | undefined> {
  try {
    const file = sessionPathForPhone(phone)
    const content = await fs.readFile(file, 'utf8')
    const json = JSON.parse(content) as PersistedSession
    return json
  } catch {
    return undefined
  }
}

export async function saveSession(
  phone: string,
  session: PersistedSession
): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const file = sessionPathForPhone(phone)
  const payload = JSON.stringify(session, null, 2)
  await fs.writeFile(file, payload, 'utf8')
}

/**
 * Ensures there is a persisted session file for the given phone.
 * If one does not exist, create a minimal scaffold so GET endpoints don't 404 immediately.
 */
export async function ensureSessionScaffold(
  phone: string,
  options?: { maxCalls?: number; minCalls?: number }
): Promise<PersistedSession> {
  const existing = await loadSession(phone)
  if (existing) return existing
  const scaffold = createEmptySession(phone, options)
  await saveSession(phone, scaffold)
  return scaffold
}

export function createEmptySession(
  phone: string,
  options?: { maxCalls?: number; minCalls?: number }
): PersistedSession {
  const now = new Date().toISOString()
  return {
    phone,
    createdAt: now,
    updatedAt: now,
    maxCalls: options?.maxCalls,
    minCalls: options?.minCalls,
    calls: [],
    snapshots: [],
    totalCost: 0,
  }
}

export function appendCall(
  session: PersistedSession,
  record: CallRecord
): PersistedSession {
  const price =
    typeof record.price === 'number' && Number.isFinite(record.price)
      ? record.price
      : 0
  const prevTotal =
    typeof session.totalCost === 'number' && Number.isFinite(session.totalCost)
      ? session.totalCost
      : (session.calls || []).reduce((sum, c) => {
          const p =
            typeof c.price === 'number' && Number.isFinite(c.price)
              ? c.price
              : 0
          return sum + p
        }, 0)
  const newTotal = prevTotal + price
  const next: PersistedSession = {
    ...session,
    calls: [...session.calls, record],
    updatedAt: new Date().toISOString(),
    totalCost: Number.isFinite(newTotal) ? newTotal : prevTotal,
  }
  return next
}

export function addSnapshot(
  session: PersistedSession,
  root: Node
): PersistedSession {
  const snap: Snapshot = { takenAt: new Date().toISOString(), root }
  const next: PersistedSession = {
    ...session,
    lastRoot: root,
    snapshots: [...session.snapshots, snap],
    updatedAt: new Date().toISOString(),
  }
  return next
}
