/**
 * Supabase Auth için gerekli, yalnızca tarayıcıya güvenle taşınabilen iki
 * ortam değişkeninin TEK okuma noktası — `browser-client.ts`, `server-client.ts`
 * ve `middleware-client.ts` üçü de bu fonksiyonu çağırır, hiçbiri
 * `process.env.NEXT_PUBLIC_SUPABASE_*`'i kendi başına okumaz. `NEXT_PUBLIC_`
 * öneki bilerek kullanılır: bu değerler zaten istemci bundle'ına dahil edilmesi
 * GEREKEN, gizli olmayan değerlerdir (proje URL'si + "publishable"/anon
 * anahtarı) — `service_role`/secret anahtar burada ASLA okunmaz/yazılmaz.
 *
 * `site-access.ts#isValidSiteAccessToken`in ortam değişkeni eksikse
 * fail-closed davranmasıyla AYNI ilke: eksikse sessizce `undefined` ile devam
 * ETMEZ, hemen anlaşılır bir hata fırlatır — aksi halde Supabase istemcisi
 * `undefined` URL/anahtarla sessizce oluşturulup çok daha kafa karıştırıcı bir
 * ağ hatası olarak çok sonra ortaya çıkardı.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase Auth yapılandırılmamış: NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local içinde tanımlı olmalıdır.",
    );
  }
  return { url, anonKey };
}
