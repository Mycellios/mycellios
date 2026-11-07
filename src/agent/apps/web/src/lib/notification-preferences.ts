const eventName = "mycellios:notification-preferences";
const key = (scope: string) => `mycellios:notifications:v1:${scope}`;
export function notificationSnapshot(scope: string): string {
  try {
    return localStorage.getItem(key(scope)) ?? "";
  } catch {
    return "";
  }
}
export function notificationPreferences(scope: string) {
  try {
    const value = JSON.parse(notificationSnapshot(scope) || "null");
    return { enabled: value?.enabled !== false, preview: value?.preview !== false, sound: value?.sound !== false };
  } catch {
    return { enabled: true, preview: true, sound: true };
  }
}
export function saveNotificationPreferences(
  scope: string,
  value: { enabled: boolean; preview: boolean; sound?: boolean },
) {
  localStorage.setItem(key(scope), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(eventName, { detail: scope }));
}
export function subscribeNotifications(scope: string, listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === key(scope)) listener();
  };
  const local = (event: Event) => {
    if ((event as CustomEvent).detail === scope) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(eventName, local);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(eventName, local);
  };
}
