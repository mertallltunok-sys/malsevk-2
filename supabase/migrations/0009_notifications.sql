-- =============================================================================
-- MALSEVK — Faz 1 migration 0009: notifications, recently_viewed_jobs
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- KARAR (görev bölüm 6 — notification_states değerlendirmesi): Önceki
-- tasarımın AYRI `notification_states` tablosu (user_id, notification_id,
-- read_at, dismissed_at) BİRLEŞTİRİLDİ — `read_at`/`dismissed_at` doğrudan
-- `notifications` üzerinde iki nullable kolon olarak tutuluyor (Yaklaşım A).
--
-- Gerekçe: `notifications.recipient_id` NOT NULL ve HER ZAMAN tekildir — bu
-- şemada da, mevcut uygulamada da (notifications.ts#getNotificationsForSession
-- her bildirimi TEK bir kullanıcı için türetir; notification-reads.ts /
-- notification-dismissals.ts bugün zaten iki AYRI, kullanıcı bazlı
-- localStorage anahtarıdır, yani "alıcı başına durum" kavramı zaten
-- gerçek/doğrulanmış bugünkü mimaridir, spekülatif bir gelecek değil) HİÇBİR
-- doğrulanmış çoklu-alıcı bildirim ihtiyacı yoktur. Önceki tasarımın ayrı
-- tablo gerekçesi ("gelecekte çoklu-alıcı olursa doğru kalır") görevin kendi
-- "doğrulanmamış gelecek için tasarlama" ilkesiyle çelişiyordu — bu migration
-- bunu düzeltir: bir join, bir tablo ve bir RLS policy'si daha az, hiçbir
-- gerçek yetenek kaybı olmadan (recipient_id zaten singular olduğu için
-- "her okuma/kapatma kendi alıcısına aittir" garantisi WHERE recipient_id =
-- auth.uid() ile birebir aynı şekilde korunur).
--
-- Eğer ileride gerçek bir çoklu-alıcı ihtiyacı doğarsa (bugün doğrulanmamış),
-- bu, ayrı bir migration'da notification_states'i GERİ EKLEMEK ve
-- read_at/dismissed_at'i oradan yeniden okumaya geçmek kadar basittir —
-- bugünkü veri hiçbir şekilde kaybolmaz (tek satırlık read_at/dismissed_at
-- bir join tablosuna 1:1 taşınabilir).
--
-- `recently_viewed_jobs` KORUNDU: kaynak kodda hâlâ aktif bir yazma yolu var
-- — bkz. app/_components/provider-job-listing.tsx#handleJobClick ->
-- recordJobViewed(session.id, jobId), her ilan tıklamasında çağrılıyor
-- (CLAUDE.md'nin kendi notu: "keep tracking, drop the display" — görsel
-- şerit kaldırılmış ama kayıt tutma bilerek sürdürülüyor). Bu, "belki
-- ileride gerekir" değil, BUGÜN gerçekleşen bir yazma — görev bölüm 9'un
-- "aktif uygulama akışında hâlâ kullanım varsa... koru" kuralına göre Faz
-- 1'de kalır.
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id),
  actor_id uuid references public.profiles (id),

  type text not null check (type in (
    'yeni_teklif', 'teklif_kabul_edildi', 'teklif_reddedildi', 'is_basladi',
    'anlasma_saglanamadi', 'baska_hizmet_verenle_anlasildi', 'ilan_yeniden_yayinda',
    'tamamlanma_onayi_bekleniyor', 'is_tamamlandi', 'tamamlanma_onaylandi',
    'tamamlanma_itiraz_edildi', 'itiraz_kaydedildi', 'is_iptal_edildi',
    'teklif_geri_cekildi', 'hizmet_kalemi_kaldirildi', 'ilan_kapatildi',
    'ilan_yayin_suresi_doldu', 'belge_onaylandi', 'belge_reddedildi', 'belge_revizyon_istendi'
  )),
  -- All 20 values verified against notifications.ts#NotificationType exactly
  -- (Turkish values kept).

  job_id uuid references public.jobs (id),
  offer_id uuid references public.offers (id),
  operation_id uuid references public.operations (id),

  title text,
  message text not null,
  metadata jsonb,

  -- Idempotency key: 'type:offer_id' or 'type:job_id' depending on the
  -- notification's anchor, mirroring the source app's own deterministic
  -- string ids.
  event_key text not null,

  -- Yaklaşım A (bkz. dosya başlığı) — recipient_id zaten NOT NULL/singular
  -- olduğu için ayrı bir notification_states tablosu yerine doğrudan burada.
  read_at timestamptz,
  dismissed_at timestamptz,

  created_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz,

  constraint notifications_one_per_recipient_event unique (recipient_id, event_key)
);

comment on table public.notifications is
  'Persisted notifications (mimari değişiklik — kaynak uygulama bunları her okumada canlı türetir, bkz. docs/database/architecture.md §3). event_key + unique kısıt, create_notification()''u (0016) çağıran her RPC''nin ON CONFLICT DO NOTHING ile idempotent olmasını sağlar. read_at/dismissed_at doğrudan bu satırda (bkz. dosya başlığındaki notification_states birleştirme kararı).';
comment on column public.notifications.actor_id is
  'SAFE to store (just a UUID) — leak risk yalnızca bunu profiles.company_name/full_name''e ham şekilde JOIN eden bir okuma yolunda oluşur. get_offer_provider_display() (0016) kimlik-açığa-çıkarma zamanlamasını doğru uygulayan TEK okuma yoludur.';

-- No trigger for updated_at: notifications are write-once except read_at/
-- dismissed_at (below) and deleted_at (retention sweep, 0018).

revoke all on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;
-- INSERT exclusively via create_notification() (0016); read_at/dismissed_at
-- UPDATE exclusively via mark_notification_read()/dismiss_notification()
-- (0016) — no direct client grant on those columns either, matching every
-- other "state transition via RPC only" table in this schema.

-- -----------------------------------------------------------------------------
-- recently_viewed_jobs
-- -----------------------------------------------------------------------------
create table if not exists public.recently_viewed_jobs (
  user_id uuid not null references public.profiles (id),
  job_id uuid not null references public.jobs (id),
  viewed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

comment on table public.recently_viewed_jobs is
  'PRIMARY KEY (user_id, job_id) makes re-viewing an already-viewed job a plain UPSERT, matching recently-viewed-jobs.ts#recordJobViewed''s "remove if present, re-add at front" behaviour via ORDER BY viewed_at DESC at read time. Verified ACTIVE write path: app/_components/provider-job-listing.tsx#handleJobClick calls recordJobViewed on every job click, even though the source app''s own display strip was removed (2026-07-26) — "keep tracking, drop the display" per CLAUDE.md. Kept in Faz 1 on that evidence, not as speculative future scope.';

revoke all on public.recently_viewed_jobs from authenticated, anon;
grant select on public.recently_viewed_jobs to authenticated;
-- INSERT/UPDATE via record_job_viewed() RPC (0016); restricted to
-- user_id = auth.uid(), never another user's row.
