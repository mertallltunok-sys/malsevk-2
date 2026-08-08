import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * ADMIN PANELİ FAZ 3 — "Sistem Beslemesi" (Tesis Onay Merkezi, bkz. supabase/
 * migrations/0029_facility_candidates.sql). Bu modül TEK bir şeyi yapar: bir
 * ilan oluşturma/güncelleme akışında kullanıcının `locationMode: "custom"`
 * ile serbestçe yazdığı bir tesis adını, ana (localStorage) yazma BAŞARILI
 * olduktan SONRA, en-iyi-çaba (fire-and-forget) olarak Supabase'e bildirir —
 * admin panelinin `/admin/sistem-beslemesi` ekranı bu adayları toplar.
 *
 * KASITLI OLARAK sessiz: bu çağrı asla throw etmez, asla bir Promise reddiyle
 * çağıranı bekletmez/engellemez, hiçbir UI durumu (remoteSyncWarning vb.)
 * tetiklemez — job-store.ts#createJob/createJobsForOperation/updateJob'ın
 * kendisi hâlâ SADECE localStorage'a yazıyor (bkz. CLAUDE.md "Supabase Auth
 * migration"), bu yalnızca arka planda çalışan bir telemetri/keşif
 * sinyalidir; başarısız olması gerçek ilan oluşturmayı hiçbir şekilde
 * etkilememelidir. `void` ile çağrılması yeterlidir, `await` gerekmez.
 */
export function submitFacilityCandidateBestEffort(rawText: string, province: string, district: string, source: string): void {
  const trimmed = rawText.trim();
  if (!trimmed || !province) return;
  try {
    const supabase = createSupabaseBrowserClient();
    void supabase
      .rpc("submit_facility_candidate_entry", {
        p_raw_text: trimmed,
        p_province: province,
        p_district: district || null,
        p_source: source,
      })
      .then(
        () => {
          // Sonuç kasıtlı olarak yok sayılır — bkz. dosya başlığı.
        },
        () => {
          // Ağ/oturum hatası dahil her şey sessizce yutulur.
        },
      );
  } catch {
    // createSupabaseBrowserClient senkron olarak fırlatırsa bile (ör. env
    // eksikse) ilan oluşturma akışı asla bundan etkilenmemeli.
  }
}
