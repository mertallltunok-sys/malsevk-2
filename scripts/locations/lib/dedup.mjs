import { haversineDistanceMeters } from "./geo.mjs";
import { extractDomain, normalizeName, normalizePhone } from "./normalize.mjs";

const EXACT_NAME_MERGE_RADIUS_METERS = 600;
const SIMILAR_NAME_MERGE_RADIUS_METERS = 150;

function nameSimilarity(a, b) {
  if (a === b) return 1;
  const wordsA = new Set(a.split(" ").filter(Boolean));
  const wordsB = new Set(b.split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Aynı fiziksel tesisi temsil eden adayları gruplar. Aynı şirkete ait
 * ayrı fiziksel terminaller (uzak koordinat) kasıtlı olarak BİRLEŞTİRİLMEZ
 * — şüphe halinde ayrı kayıt tutmak, yanlışlıkla birleştirmekten daha
 * güvenlidir.
 */
export function groupDuplicateCandidates(candidates) {
  const withMeta = candidates.map((candidate) => ({
    candidate,
    normalizedName: normalizeName(candidate.name),
    domain: extractDomain(candidate.website),
    phoneKey: normalizePhone(candidate.phone),
  }));

  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < withMeta.length; i++) {
    if (assigned.has(i)) continue;
    const group = [withMeta[i]];
    assigned.add(i);

    for (let j = i + 1; j < withMeta.length; j++) {
      if (assigned.has(j)) continue;
      const a = withMeta[i];
      const b = withMeta[j];

      const distance = haversineDistanceMeters(
        { lat: a.candidate.lat, lon: a.candidate.lon },
        { lat: b.candidate.lat, lon: b.candidate.lon },
      );

      const sameDomain = a.domain && b.domain && a.domain === b.domain;
      const samePhone = a.phoneKey && b.phoneKey && a.phoneKey === b.phoneKey;
      const exactName = a.normalizedName === b.normalizedName;
      const similarName = nameSimilarity(a.normalizedName, b.normalizedName) >= 0.6;

      const isDuplicate =
        (exactName && distance <= EXACT_NAME_MERGE_RADIUS_METERS) ||
        (similarName && distance <= SIMILAR_NAME_MERGE_RADIUS_METERS) ||
        ((sameDomain || samePhone) && distance <= EXACT_NAME_MERGE_RADIUS_METERS);

      if (isDuplicate) {
        group.push(b);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}
