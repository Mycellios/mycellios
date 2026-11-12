import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { captureApiRequestContext, currentApiBase, rpc } from "./api";
import { currentSessionGeneration } from "./session";

const CONSENT_KEY = "mycellios.notifications.allowed";
const registering = new Map<string, Promise<void>>();
/** Boot and resume never prompt; settings actions explicitly opt into permission. */
export function registerPushToken({ requestPermission = false } = {}): Promise<void> {
  const key = `${currentApiBase()}:${currentSessionGeneration()}:${requestPermission}`;
  const active = registering.get(key);
  if (active) return active;
  const operation = register(requestPermission).finally(() => { registering.delete(key); });
  registering.set(key, operation);
  return operation;
}
async function register(requestPermission: boolean) {
  try {
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      if (requestPermission) throw new Error("Push notifications are not configured in this mobile build.");
      return;
    }
    const context = await captureApiRequestContext();
    const current = () => context.sessionGeneration === currentSessionGeneration() && context.apiBase === currentApiBase();
    // Android 13 needs the channel before permission/token registration. Keep the id stable.
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", {
      name: "Mycellios", importance: Notifications.AndroidImportance.DEFAULT,
    });
    let allowed = false;
    if (requestPermission) {
      allowed = (await Notifications.requestPermissionsAsync()).granted;
      if (!current()) return;
      if (!allowed) throw new Error("Allow notifications in your system settings, then try again.");
      await SecureStore.setItemAsync(CONSENT_KEY, "1");
    } else if (Platform.OS === "ios") {
      // getPermissionsAsync can stall Expo's shared native queue after restart.
      // A saved opt-in allows token refresh without querying or prompting for permission.
      allowed = await SecureStore.getItemAsync(CONSENT_KEY) === "1";
    } else allowed = (await Notifications.getPermissionsAsync()).granted;
    if (!allowed || !current()) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token || !current()) return;
    await rpc("notifications/registerPush", { token }, { requestContext: context });
  } catch (error) {
    // Automatic refresh stays non-blocking; explicit failures stay visible in settings.
    if (requestPermission) throw error;
  }
}

export async function unregisterPushToken() {
  await rpc("notifications/unregisterPush").catch(() => undefined);
}
