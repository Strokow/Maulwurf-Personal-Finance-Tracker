// Шина in-app уведомлений (Фаза 8) — по образцу errorToastBus. Home прогоняет
// notificationEngine и эмитит готовые AppNotification; NotificationToastContainer
// подписан и рендерит тосты слева внизу.
import type { AppNotification } from './notificationEngine'

type Listener = (notification: AppNotification) => void

const listeners = new Set<Listener>()

export function onNotificationToast(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitNotificationToast(notification: AppNotification): void {
  for (const fn of listeners) fn(notification)
}
