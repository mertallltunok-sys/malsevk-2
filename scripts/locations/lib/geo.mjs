// Saf JS coğrafi yardımcı fonksiyonlar. Yeni paket gerektirmez.

const EARTH_RADIUS_METERS = 6371000;

export function haversineDistanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Ray-casting algoritması. polygon: [{lat, lon}, ...] kapalı halka. */
export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** rings: bir bölgeye ait birden fazla ayrık dış halka olabilir (ör. ada). */
export function pointInAnyRing(point, rings) {
  return rings.some((ring) => pointInRing(point, ring));
}

function pointToSegmentDistanceMeters(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Noktayı, sorgu noktası merkezli düzlemsel (equirectangular) bir yaklaşımla
 * yerel metre koordinatına çevirir. Birkaç kilometrelik mesafeler için
 * yeterince doğrudur; kıyı/rıhtım noktalarının idari sınır poligonuna
 * uzaklığını ölçmek için kullanılır.
 */
function toLocalMeters(point, origin) {
  const latRad = (origin.lat * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(latRad);
  return {
    x: (point.lon - origin.lon) * metersPerDegLon,
    y: (point.lat - origin.lat) * metersPerDegLat,
  };
}

/** Noktadan bir halkanın en yakın kenarına metre cinsinden mesafe. */
export function distanceToRingMeters(point, ring) {
  const origin = point;
  const p0 = { x: 0, y: 0 };
  let minDistance = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = toLocalMeters(ring[j], origin);
    const b = toLocalMeters(ring[i], origin);
    const distance = pointToSegmentDistanceMeters(p0, a, b);
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
}

/** Noktadan, bir bölgeye ait halkaların en yakınına metre cinsinden mesafe. */
export function distanceToAnyRingMeters(point, rings) {
  let minDistance = Infinity;
  for (const ring of rings) {
    const distance = distanceToRingMeters(point, ring);
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
}

/**
 * OSM "outer" role'lü, uçtan uca birleşmemiş yol segmentlerini kapalı
 * halkalara diker. segments: [[{lat,lon}, ...], ...]
 */
export function stitchSegmentsIntoRings(segments) {
  const remaining = segments.map((segment) => segment.slice());
  const rings = [];
  const EPSILON = 1e-7;

  const samePoint = (a, b) => Math.abs(a.lat - b.lat) < EPSILON && Math.abs(a.lon - b.lon) < EPSILON;

  while (remaining.length > 0) {
    let chain = remaining.shift();
    let extended = true;
    while (extended && !samePoint(chain[0], chain[chain.length - 1])) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const chainEnd = chain[chain.length - 1];
        if (samePoint(candidate[0], chainEnd)) {
          chain = chain.concat(candidate.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (samePoint(candidate[candidate.length - 1], chainEnd)) {
          chain = chain.concat(candidate.slice(0, -1).reverse());
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    rings.push(chain);
  }

  return rings.filter((ring) => ring.length >= 4);
}
