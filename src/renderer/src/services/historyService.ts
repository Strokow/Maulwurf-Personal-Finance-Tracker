import { HistoryEntry, AppData } from '../types'

const MAX_HISTORY = 10

export function pushHistory(
  current: HistoryEntry[],
  action: string,
  before: Partial<AppData>,
  after: Partial<AppData>
): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    snapshotBefore: before,
    snapshotAfter: after,
  }
  return [entry, ...current].slice(0, MAX_HISTORY)
}
