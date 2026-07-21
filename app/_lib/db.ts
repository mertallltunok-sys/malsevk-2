import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

/**
 * Yalnızca sunucu tarafında (Route Handler, Server Component, Server Action)
 * kullanılmalıdır. DATABASE_URL, NEXT_PUBLIC_ önekine sahip olmadığı için
 * istemci bundle'ına dahil edilmez — bu dosyayı "use client" bir bileşenden
 * import etmeyin.
 *
 * Bağlantı, ilk çağrıya kadar kurulmaz (lazy): DATABASE_URL tanımlı değilse
 * modül import edilirken değil, `getDatabase()` gerçekten çağrıldığında hata
 * fırlatılır — böylece çağıran taraf (ör. /api/health) bunu try/catch ile
 * yakalayıp kontrollü bir hata yanıtı dönebilir.
 */

let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDatabase(): ReturnType<typeof drizzle> {
  if (cachedDb) return cachedDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL ortam değişkeni tanımlı değil. Neon veritabanı bağlantı dizesini yerel geliştirmede .env.local dosyasına, Vercel'de ise proje ortam değişkenlerine eklemelisiniz.",
    );
  }

  const sql = neon(connectionString);
  cachedDb = drizzle(sql);
  return cachedDb;
}
