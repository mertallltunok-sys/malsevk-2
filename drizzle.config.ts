import { defineConfig } from "drizzle-kit";

/**
 * Adım 1A: yalnızca yapılandırma iskeleti. `./db/schema.ts` henüz mevcut
 * değil (Adım 1B'de eklenecek) ve `drizzle-kit generate`/`push` bu adımda
 * ÇALIŞTIRILMADI — hiçbir migration üretilmedi, hiçbir tablo oluşturulmadı.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
