import { NextResponse } from "next/server";
import { getSupabaseEnv } from "../../_lib/supabase/env";

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Veritabanı bağlantısının canlı olup olmadığını doğrulayan basit uç nokta.
 *
 * Önceki sürüm hiç bağlanılmayan/hiç yapılandırılmayan bir Neon/`DATABASE_URL`
 * iskeletini kontrol ediyordu (bkz. `_lib/db.ts`) — bu değişken tanımsız
 * olduğu için sonuç her zaman `503` idi, gerçek Production sağlığından
 * bağımsız olarak. Uygulamanın gerçek mimarisi Vercel + Supabase olduğundan,
 * kontrol artık `service_categories` (herkese açık, RLS altında anon
 * anahtarla okunabilen, PII içermeyen bir referans tablosu) üzerinde tek
 * satırlık bir PostgREST okuması yapıyor — bu, ağ + PostgREST + Postgres
 * bağlantısının tamamının gerçekten ayakta olduğunu doğrular. Yalnızca
 * zaten istemci bundle'ına dahil olan, gizli olmayan `NEXT_PUBLIC_SUPABASE_*`
 * değerlerini kullanır (`getSupabaseEnv` — bkz. o dosyanın dokümantasyonu);
 * `service_role`/secret anahtar veya yeni bir `DATABASE_URL` asla eklenmez.
 * Hata durumunda bağlantı dizesi/host/sürücü hatasının detayı yanıtta ASLA
 * gösterilmez — yalnızca sunucu konsoluna loglanır. `AbortController` ile
 * sınırlı süreli (5sn) — Supabase erişilemez durumdaysa bu uç nokta
 * süresiz asılı kalmaz.
 */
export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const { url, anonKey } = getSupabaseEnv();
    const response = await fetch(`${url}/rest/v1/service_categories?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Supabase REST yanıtı başarısız: ${response.status}`);
    }
    return NextResponse.json({ status: "ok", database: "connected" }, { status: 200 });
  } catch (error) {
    console.error("[api/health] Veritabanı bağlantısı başarısız:", error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timeoutId);
  }
}
