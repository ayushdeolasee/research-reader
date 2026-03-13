import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export type AppUpdate = Update;
export type AppUpdateDownloadEvent = DownloadEvent;

export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  return check();
}

export async function relaunchForUpdate(): Promise<void> {
  await relaunch();
}
