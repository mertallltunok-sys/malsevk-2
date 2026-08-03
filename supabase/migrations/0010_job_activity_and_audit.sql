-- =============================================================================
-- MALSEVK — Faz 1 migration 0010: job_activity_events (sadeleştirilmiş), audit_logs
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- KARAR (görev bölüm 7 — job_activity_events değerlendirmesi): Önceki
-- tasarımın `job_activity_events` tablosu 13 olay tipi taşıyordu; bunlardan
-- 7 tanesi (offer_received, offer_accepted, offer_rejected, work_started,
-- completion_requested, completion_disputed, work_completed) TEKLİF durum
-- değişikliklerine karşılık geliyordu ve HER TEKLİF geçişinde `offer_status_
-- history`ye (0005) de AYRICA yazılıyordu — aynı olayın iki fiziksel tabloya
-- iki ayrı INSERT'i (biri exception yutuyor — append_job_activity_event,
-- diğeri yutmuyor — offers.ts RPC'lerinin doğrudan INSERT'i), sessizce
-- birbirinden sapma riski taşıyan gerçek bir tekrar.
--
-- Bu migration bunu SADELEŞTİRİR (görevin sunduğu "Yalnız ilan olayları için
-- sadeleştir" seçeneği): `job_activity_events` yalnızca teklife bağlı
-- OLMAYAN 5 olay tipini tutar (job_created, job_updated, job_closed,
-- job_expired, job_republished) — bunların hiçbirinin offer_status_history
-- ile bir karşılığı yoktur, dolayısıyla gerçek, tekil bir denetim/tarihçe
-- değeri taşırlar. `offer_id` kolonu ve `offer_parties_only` visibility
-- değeri KALDIRILDI (hiçbir Faz 1 olay tipi bunu kullanmıyor). Bir teklif
-- zaman çizelgesi ileride gerçekten ayrı bir kullanıcı arayüzü olarak
-- istenirse, offer_status_history + küçük bir "etiket" fonksiyonundan
-- (get_job_closure_notification_message'a benzer, bkz. 0014) bir VIEW olarak
-- üretilebilir — fiziksel bir ikinci yazma gerektirmeden.
--
-- audit_logs değişmedi (önceki tasarımın 0011_job_activity_and_audit.sql'i
-- ile aynı) — Faz 1'in "Gerekli audit kaydı" ihtiyacının doğrudan karşılığı.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- job_activity_events — user-facing job timeline, yalnız ilan-seviyeli olaylar
-- -----------------------------------------------------------------------------
create table if not exists public.job_activity_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  operation_id uuid references public.operations (id),
  actor_id uuid references public.profiles (id),

  event_type text not null check (event_type in (
    'job_created', 'job_updated', 'job_closed', 'job_expired', 'job_republished'
  )),
  title text not null,
  description text,
  metadata jsonb,

  -- Yalnız iki katman kaldı (offer_parties_only kaldırıldı — bkz. dosya
  -- başlığı): public = ilanı zaten görebilen herkes (job_created,
  -- job_republished, job_expired); requester_only = yalnız ilan sahibi
  -- (job_updated, job_closed).
  visibility text not null default 'requester_only'
    check (visibility in ('public', 'requester_only')),

  created_at timestamptz not null default now()
);

comment on table public.job_activity_events is
  'User-facing job timeline (job-detail page), YALNIZ ilan-seviyeli olaylar — teklif/offer olayları KASITLI OLARAK burada değil (bkz. dosya başlığı, tekrar önleme). NOT audit_logs: her satır ilan sahibine doğrudan gösterilmeye güvenli olmalı.';
comment on column public.job_activity_events.visibility is
  'public = ilanı görebilen herkes; requester_only = yalnız ilan sahibi. offer_parties_only KALDIRILDI çünkü Faz 1''de hiçbir olay tipi teklif tarafı gizliliği gerektirmiyor (teklif olayları offer_status_history''de).';

revoke all on public.job_activity_events from authenticated, anon;
grant select on public.job_activity_events to authenticated;
-- INSERT via append_job_activity_event() (0016) — job_created/job_updated/
-- job_closed/job_republished (create_job/update_job/close_job/republish_job,
-- 0014) ve job_expired (sweep_expired_job_listings, 0018) tarafından
-- çağrılır. Bir zaman-çizelgesi yazma hatası birincil işlemi asla
-- engellemez (append_job_activity_event kendi exception'ını yutar).

-- -----------------------------------------------------------------------------
-- audit_logs — system/admin denial-of-trust log
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  request_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only, admin-only-readable (Faz 1: is_admin() — bkz. 0013_rls_policies.sql; Faz 2 has_admin_permission(''audit_logs.view'') ile daha ince taneli hale getirilebilir, bkz. docs/database/future-migrations/MANIFEST.md). Populated exclusively via log_audit_event() (0012_rls_helpers.sql).';

revoke all on public.audit_logs from authenticated, anon, service_role;
-- Even service_role has no blanket grant here beyond what SECURITY DEFINER
-- functions need — log_audit_event() is the sole INSERT path. True
-- append-only: no UPDATE/DELETE grant to ANY role.
