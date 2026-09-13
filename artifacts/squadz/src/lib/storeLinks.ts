export const IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/squadz-friend-group-planner/id6789990515";

const configuredAndroidUrl = import.meta.env.VITE_ANDROID_APP_URL?.trim();

export const ANDROID_PLAY_STORE_URL =
  configuredAndroidUrl && /^https:\/\/play\.google\.com\/store\/apps\//.test(configuredAndroidUrl)
    ? configuredAndroidUrl
    : null;