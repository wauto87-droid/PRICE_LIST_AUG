export type InstallEnvironment = {
  development: boolean;
  installed: boolean;
  ios: boolean;
  secure: boolean;
  promptAvailable: boolean;
};
export type InstallState =
  "installed" | "ready" | "ios" | "development" | "insecure" | "browser";
export function installState(env: InstallEnvironment): InstallState {
  if (env.installed) return "installed";
  if (env.development) return "development";
  if (!env.secure) return "insecure";
  if (env.ios) return "ios";
  if (env.promptAvailable) return "ready";
  return "browser";
}
