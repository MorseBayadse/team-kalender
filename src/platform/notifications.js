// ============================================================
// NOTIFICATIONS.JS – Plattformübergreifende Benachrichtigungen
// Web: Browser Notifications API / Push API
// Desktop: Electron Notification
// Mobile: Capacitor Local Notifications / Push
// ============================================================

import { getPlatform, isDesktop, isMobile } from './platform.js';

/**
 * Berechtigung für Benachrichtigungen anfordern.
 * Gibt true zurück, wenn die Berechtigung erteilt wurde.
 */
export async function requestPermission() {
  const platform = getPlatform();

  if (platform === 'desktop') {
    // Electron: Berechtigung über Main-Process
    return window.electronAPI?.requestNotificationPermission?.() ?? true;
  }

  if (isMobile()) {
    // Capacitor: LocalNotifications Plugin
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted';
    } catch (e) {
      console.warn('[Notifications] Capacitor Plugin nicht verfügbar:', e);
      return false;
    }
  }

  // Web: Browser Notification API
  if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  return false;
}

/**
 * Lokale Benachrichtigung senden.
 * Funktioniert auf allen Plattformen identisch.
 */
export async function sendLocalNotification({ title, body, data = {} }) {
  const platform = getPlatform();

  if (platform === 'desktop') {
    // Electron: über IPC an Main-Process
    window.electronAPI?.showNotification?.({ title, body, data });
    return;
  }

  if (isMobile()) {
    // Capacitor: LocalNotifications
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now(),
          title,
          body,
          extra: data,
        }],
      });
    } catch (e) {
      console.warn('[Notifications] Fehler beim Senden:', e);
    }
    return;
  }

  // Web: Browser Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, data });
  }
}

/**
 * Termin-Erinnerung planen (z.B. 15 Minuten vorher).
 */
export async function scheduleEventReminder(event, minutesBefore = 15) {
  const eventDate = new Date(`${event.date}T${event.time || '00:00'}`);
  const reminderTime = new Date(eventDate.getTime() - minutesBefore * 60 * 1000);
  const now = new Date();

  if (reminderTime <= now) return; // Termin ist bereits vorbei

  const delay = reminderTime.getTime() - now.getTime();

  // Für Mobile: Capacitor kann geplante Notifications
  if (isMobile()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          id: parseInt(event.id?.replace?.(/-/g, '').slice(0, 8), 16) || Date.now(),
          title: `Erinnerung: ${event.title}`,
          body: `In ${minutesBefore} Minuten`,
          schedule: { at: reminderTime },
          extra: { eventId: event.id },
        }],
      });
      return;
    } catch (_) {}
  }

  // Web & Desktop: setTimeout (nur solange Tab/App offen)
  setTimeout(() => {
    sendLocalNotification({
      title: `Erinnerung: ${event.title}`,
      body: `In ${minutesBefore} Minuten`,
      data: { eventId: event.id },
    });
  }, delay);
}
