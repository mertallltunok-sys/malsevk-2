import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase } from "../../_lib/db";

/**
 * Veritabanı bağlantısının canlı olup olmadığını doğrulayan basit uç nokta.
 * Yalnızca `SELECT 1` çalıştırır; herhangi bir kullanıcı/oturum verisi
 * okumaz. Hata durumunda bağlantı dizesi veya sürücü hatasının detayı
 * yanıtta ASLA gösterilmez — yalnızca sunucu konsoluna loglanır.
 */
export async function GET() {
  try {
    const db = getDatabase();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", database: "connected" }, { status: 200 });
  } catch (error) {
    console.error("[api/health] Veritabanı bağlantısı başarısız:", error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
