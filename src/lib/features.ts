// Feature flags — gated by environment variable and per-user profile flags.

const FLAGS: Record<string, boolean> = JSON.parse(process.env.FEATURE_FLAGS || '{}');

export function isEnabled(feature: string): boolean {
  return FLAGS[feature] === true;
}

export function isEnabledForUser(feature: string, userFlags?: Record<string, boolean>): boolean {
  return FLAGS[feature] === true || userFlags?.[feature] === true;
}
