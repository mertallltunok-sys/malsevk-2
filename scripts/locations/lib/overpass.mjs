// Overpass API için nazik, tekrar denemeli, oran sınırlı istemci.
// Ücretsiz ortak servisi korumak için: tek seferde tek istek, hata durumunda
// bekleyip yeniden dener, açık User-Agent ve iletişim bilgisi gönderir.

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "MALSEVK-locations-pilot/1.0 (+https://malsevk.com; contact: mertaltunokk@gmail.com)";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOverpassQuery(query) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "User-Agent": USER_AGENT,
        },
        body: query,
      });

      if (response.status === 429 || response.status === 504) {
        lastError = new Error(`Overpass gecici olarak mesgul (HTTP ${response.status})`);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Overpass hata dondu: HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError ?? new Error("Overpass istegi bilinmeyen nedenle basarisiz oldu");
}
