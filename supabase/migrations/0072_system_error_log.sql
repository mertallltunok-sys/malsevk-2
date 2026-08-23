-- SİSTEM SAĞLIĞI (Yönetim Paneli yeniden tasarımı, görev bölüm 11-15)
--
-- Uygulamanın herhangi bir yerinde (istemci/sunucu) oluşan GERÇEK yazılımsal
-- hataları toplayan, aynı kaynak+hata kodu+akış üzerinden gruplayan, ve
-- yalnızca admin'e görünen tek bir tablo. İkinci bir "bildirim" veya "audit"
-- sistemi DEĞİL — durum değişiklikleri (İnceleniyor/Çözüldü) mevcut
-- `log_audit_event()`/`audit_logs` (0010/0012) üzerinden İşlem Geçmişi'ne de
-- akar, ayrı bir audit tablosu İCAT EDİLMEZ.
--
-- Güvenlik sınırı, mevcut `is_admin()`/`assert_active_user()` (0012/0042)
-- ile AYNI desen: RLS yalnızca admin'e SELECT verir, tabloya `authenticated`/
-- `anon`'a HİÇBİR doğrudan grant yok — tüm yazma yalnızca aşağıdaki iki
-- SECURITY DEFINER RPC üzerinden olur (bkz. `audit_logs`'ın 0010'daki AYNI
-- "no direct grants, RPC-only write" yorumu).

create table if not exists public.system_error_logs (
  id uuid primary key default gen_random_uuid(),

  -- Gruplama anahtarı: aynı kaynak+hata kodu+route+akış+mesaj öneki ->
  -- aynı satır, occurrence_count artar (bkz. report_system_error). TAM
  -- benzersiz (partial değil) — "Çözülen aynı hata yeniden ortaya çıkarsa
  -- mevcut kayıt kontrollü biçimde yeniden açılabilsin" gereksinimi, yeni
  -- bir satır değil, aynı satırın status='yeni'ye dönmesiyle karşılanır.
  fingerprint text not null unique,

  severity text not null check (severity in ('critical', 'high', 'warning', 'info')),
  status text not null default 'yeni' check (status in ('yeni', 'inceleniyor', 'cozuldu')),

  error_code text,
  message text not null,
  source text not null check (source in ('client', 'server')),
  route text,
  affected_screen text,
  -- İSTEMCİDEN gelmez — report_system_error() çağıranın kendi profiles.role
  -- değerini auth.uid() üzerinden okur (görev gereksinimi: rol/ciddiyet
  -- sahteciliği engellenmeli).
  affected_role text,
  affected_action text,
  environment text not null default 'development',

  source_file text,
  function_name text,
  line_number integer,
  request_id text,
  stack_excerpt text,

  probable_cause text,
  confidence text check (confidence in ('yuksek', 'orta', 'dusuk')),
  evidence jsonb,
  related_files jsonb,

  reported_by uuid references public.profiles (id) on delete set null,
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.system_error_logs is
  'Sistem Sağlığı modülünün tek veri kaynağı — gerçek istemci/sunucu hatalarının gruplanmış kaydı. Yalnızca admin okuyabilir (RLS), yalnızca report_system_error/update_system_error_status RPC''leri yazabilir.';

comment on column public.system_error_logs.severity is
  'Sunucu tarafında report_system_error() içinde SINIFLANDIRILIR, istemciden asla doğrudan kabul edilmez.';

drop trigger if exists trg_system_error_logs_set_updated_at on public.system_error_logs;
create trigger trg_system_error_logs_set_updated_at
  before update on public.system_error_logs
  for each row execute function public.set_updated_at();

create index if not exists system_error_logs_status_severity_idx
  on public.system_error_logs (status, severity);
create index if not exists system_error_logs_last_seen_idx
  on public.system_error_logs (last_seen_at desc);

alter table public.system_error_logs enable row level security;

drop policy if exists system_error_logs_select_admin on public.system_error_logs;
create policy system_error_logs_select_admin
  on public.system_error_logs
  for select
  using (public.is_admin());

-- `provider_documents`/`provider_storage_risk_authorizations` (0007/0068) ile
-- AYNI desen: RLS'in satırları filtreleyebilmesi için `authenticated`e temel
-- bir SELECT grant'i GEREKİR (yoksa RLS'e hiç gelinmeden "permission denied"
-- alınır) — filtreleme işini yukarıdaki policy yapar. INSERT/UPDATE/DELETE
-- hiçbir role verilmez, tüm yazma yalnızca SECURITY DEFINER RPC'ler
-- üzerindendir.
revoke all on public.system_error_logs from public, anon, authenticated;
grant select on public.system_error_logs to authenticated;

-- report_system_error(): herhangi bir kimliği doğrulanmış kullanıcı
-- (admin dahil, ör. admin panelinin kendi hatası) çağırabilir — bu bir
-- admin-only RPC DEĞİL, çünkü hatalar hizmet alan/hizmet veren tarayıcısında
-- da oluşur. Sadece KENDİ tarayıcısında gördüğü gerçek bir hatayı bildirir;
-- kaydı okumak hâlâ yalnızca admin'e açıktır (RLS).
drop function if exists public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text);
create or replace function public.report_system_error(
  p_message text,
  p_source text,
  p_error_code text default null,
  p_route text default null,
  p_affected_screen text default null,
  p_affected_action text default null,
  p_source_file text default null,
  p_function_name text default null,
  p_line_number integer default null,
  p_stack_excerpt text default null,
  p_request_id text default null,
  p_evidence jsonb default null,
  p_environment text default 'development'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_severity text;
  v_fingerprint text;
  v_id uuid;
  v_status text;
  v_message text;
  v_stack text;
begin
  if auth.uid() is null then
    raise exception 'ML150: authentication required' using errcode = 'ML150';
  end if;
  if p_source not in ('client', 'server') then
    raise exception 'ML151: source must be client or server' using errcode = 'ML151';
  end if;

  -- Payload boyutu sınırlanır (görev gereksinimi — istemci büyük stack/
  -- mesaj gönderemesin diye).
  v_message := left(coalesce(nullif(trim(p_message), ''), 'Bilinmeyen hata'), 500);
  v_stack := left(p_stack_excerpt, 2000);

  select role into v_role from public.profiles where id = auth.uid();

  -- Ciddiyet sınıflandırması SUNUCU tarafındadır (görev gereksinimi:
  -- "İstemcinin kendi rolünü veya kritiklik seviyesini sahte biçimde
  -- belirlemesine izin verme"). Bilinen/beklenen yetki reddi kodları asla
  -- kritik sayılmaz (görev gereksinimi madde 11/13) — 'info' seviyesine
  -- düşer, tamamen ATILMAZ (görünürlük korunur, yalnızca ciddiyeti düşük).
  v_severity := case
    when p_error_code in (
      'ML125', 'ML126', 'ML127',                  -- assert_active_user (askıya alınmış hesap)
      'MLK60', 'MLK98',                             -- kategori/kapsam yetkisizliği, iletişim zorunluluğu
      'ML115', 'ML116', 'ML117', 'ML118'            -- admin ilan moderasyonu concurrency
    ) then 'info'
    when p_affected_action in (
      'create_offer', 'accept_offer', 'create_job', 'create_operation_with_jobs',
      'review_provider_document', 'authorize_provider_service', 'update_job_as_requester'
    ) then 'critical'
    when p_source = 'server' then 'high'
    else 'high'
  end;

  v_fingerprint := md5(
    coalesce(p_error_code, '') || '|' || p_source || '|' ||
    coalesce(p_route, '') || '|' || coalesce(p_affected_action, '') || '|' ||
    left(v_message, 120)
  );

  select id, status into v_id, v_status
  from public.system_error_logs
  where fingerprint = v_fingerprint;

  if v_id is not null then
    update public.system_error_logs
    set occurrence_count = occurrence_count + 1,
        last_seen_at = now(),
        status = case when v_status = 'cozuldu' then 'yeni' else v_status end,
        resolved_at = case when v_status = 'cozuldu' then null else resolved_at end,
        resolved_by = case when v_status = 'cozuldu' then null else resolved_by end,
        -- Yeni oluşumda evidence/route/screen güncel bilgiyle tazelenir —
        -- ilk görülme (first_seen_at) hiç değişmez.
        route = coalesce(p_route, route),
        affected_screen = coalesce(p_affected_screen, affected_screen),
        stack_excerpt = coalesce(v_stack, stack_excerpt),
        evidence = coalesce(p_evidence, evidence)
    where id = v_id;
    return v_id;
  end if;

  insert into public.system_error_logs (
    fingerprint, severity, error_code, message, source, route,
    affected_screen, affected_role, affected_action, environment,
    source_file, function_name, line_number, request_id, stack_excerpt,
    reported_by, evidence
  ) values (
    v_fingerprint, v_severity, p_error_code, v_message, p_source, p_route,
    p_affected_screen, v_role, p_affected_action, coalesce(nullif(p_environment, ''), 'development'),
    p_source_file, p_function_name, p_line_number, p_request_id, v_stack,
    auth.uid(), p_evidence
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) is
  'Herhangi bir kimliği doğrulanmış kullanıcının kendi tarayıcısında/isteğinde gördüğü GERÇEK bir hatayı bildirir. Ciddiyet sunucu tarafında sınıflandırılır, istemciden kabul edilmez. Aynı fingerprint tekrar geldiğinde occurrence_count artar, çözülmüş kayıt varsa yeniden açılır.';

revoke all on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) from public, anon;
grant execute on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) to authenticated;

-- update_system_error_status(): admin-only. Durum değişikliği AYNI ZAMANDA
-- mevcut log_audit_event() üzerinden audit_logs'a yazılır — İşlem
-- Geçmişi'nin "bir hata çözüldü olarak işaretlendi" gibi girdileri buradan
-- gelir, ikinci bir günlük tablosu yoktur.
drop function if exists public.update_system_error_status(uuid, text);
create or replace function public.update_system_error_status(
  p_error_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
begin
  if not public.is_admin() then
    raise exception 'ML152: admin role required' using errcode = 'ML152';
  end if;
  if p_status not in ('yeni', 'inceleniyor', 'cozuldu') then
    raise exception 'ML153: status must be yeni/inceleniyor/cozuldu' using errcode = 'ML153';
  end if;

  select status into v_old_status from public.system_error_logs where id = p_error_id;
  if v_old_status is null then
    raise exception 'ML154: error record not found' using errcode = 'ML154';
  end if;

  update public.system_error_logs
  set status = p_status,
      resolved_at = case when p_status = 'cozuldu' then now() else null end,
      resolved_by = case when p_status = 'cozuldu' then auth.uid() else null end
  where id = p_error_id;

  perform public.log_audit_event(
    'update_system_error_status',
    'system_error_log',
    p_error_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_status)
  );
end;
$$;

comment on function public.update_system_error_status(uuid, text) is
  'Admin-only: bir sistem hatasının durumunu (yeni/inceleniyor/cozuldu) değiştirir ve log_audit_event() ile audit_logs''a (İşlem Geçmişi) da yazar.';

revoke all on function public.update_system_error_status(uuid, text) from public, anon, authenticated;
grant execute on function public.update_system_error_status(uuid, text) to authenticated;
