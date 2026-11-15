/** Proof-of-visit geometry. Pure. */

/** A check-in within this many metres of the property counts as on site. */
export const CHECKIN_RADIUS_M = 300;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * On site = within the radius, allowing for the device's reported accuracy
 * (capped, so a 5 km "accuracy" can't make anywhere count).
 */
export function isOnSite(distanceM: number, accuracyM: number | null): boolean {
  return distanceM <= CHECKIN_RADIUS_M + Math.min(accuracyM ?? 0, 150);
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
