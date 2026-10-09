/**
 * The background to show: the admin's default photo when it is on and still
 * exists, otherwise the day's own background (which may be null).
 *
 * @param {{enabled: boolean, imageUrl: string|null}|null} defaultPhoto  from getDefaultBackground()
 * @param {object|null} dayBackground  the latest per-day row
 */
export function resolveBackground(defaultPhoto, dayBackground) {
  return defaultPhoto?.enabled && defaultPhoto.imageUrl ? defaultPhoto : dayBackground ?? null
}
