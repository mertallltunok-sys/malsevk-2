-- =============================================================================
-- MALSEVK — Faz 2 TASLAK 0004: admin role management + abonelik/kota RPC'leri
-- =============================================================================
-- STATUS: FAZ 2 TASLAK — OTOMATİK ÇALIŞTIRILMAZ.
--
-- Faz-ayrımından önceki tasarımın 0021_rpc_admin_and_subscription_functions.sql'i
-- İLE AYNIDIR — TEK FARK: close_job_as_admin/delete_job_as_admin/
-- suspend_user/reinstate_user Faz 1'e taşındı (is_admin()'e uyarlanmış hâlde
-- — bkz. supabase/migrations/0016). Bu dosyada yalnız admin_user_roles/
-- subscription tablolarına GERÇEKTEN bağımlı olan fonksiyonlar kaldı.
--
-- GÜVENLİK DÜZELTMESİ (önceki denetim C.4, Yüksek): revoke_admin_role() artık
-- sistemin son admin_roles.manage sahibini iptal etmeyi REDDEDER (MLK89).
-- GÜVENLİK DÜZELTMESİ (önceki denetim C.5, Orta): revoke_admin_role() artık
-- yalnız GERÇEKTEN bir satır etkilendiyse log_audit_event() çağırır (GET
-- DIAGNOSTICS ile satır sayısı kontrolü) — önceki tasarım hiçbir satır
-- etkilenmese bile "iptal edildi" diye yanlış bir audit kaydı yazıyordu.
-- =============================================================================

create or replace function public.grant_admin_role(p_user_id uuid, p_role_code text)
returns public.admin_user_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_grant public.admin_user_roles;
begin
  if not public.has_admin_permission('admin_roles.manage') then
    raise exception 'MLK80: admin_roles.manage permission required' using errcode = 'MLK80';
  end if;
  select id into v_role_id from public.admin_roles where code = p_role_code;
  if v_role_id is null then
    raise exception 'MLK81: unknown admin role code %', p_role_code using errcode = 'MLK81';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'MLK76: user not found' using errcode = 'MLK76';
  end if;

  insert into public.admin_user_roles (user_id, role_id, granted_by)
  values (p_user_id, v_role_id, auth.uid())
  returning * into v_grant;

  perform public.log_audit_event('grant_admin_role', 'admin_user_roles', v_grant.id,
    null, jsonb_build_object('user_id', p_user_id, 'role_code', p_role_code));

  return v_grant;
end;
$$;

create or replace function public.revoke_admin_role(p_user_id uuid, p_role_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_updated integer;
begin
  if not public.has_admin_permission('admin_roles.manage') then
    raise exception 'MLK80: admin_roles.manage permission required' using errcode = 'MLK80';
  end if;
  select id into v_role_id from public.admin_roles where code = p_role_code;
  if v_role_id is null then
    raise exception 'MLK81: unknown admin role code %', p_role_code using errcode = 'MLK81';
  end if;

  -- GÜVENLİK DÜZELTMESİ (C.4): son admin_roles.manage sahibinin iptalini
  -- engelle — aksi halde admin-rol-yönetimi kalıcı olarak kilitlenir
  -- (yalnızca ilk bootstrap'takiyle aynı manuel DB erişimiyle kurtarılabilir).
  if p_role_code = 'super_admin' or exists (
    select 1 from public.admin_role_permissions
    where role_id = v_role_id and permission_code = 'admin_roles.manage'
  ) then
    if not exists (
      select 1 from public.admin_user_roles aur
      join public.admin_role_permissions arp on arp.role_id = aur.role_id
      where arp.permission_code = 'admin_roles.manage'
        and aur.revoked_at is null
        and not (aur.user_id = p_user_id and aur.role_id = v_role_id)
    ) then
      raise exception 'MLK89: cannot revoke the last admin_roles.manage holder' using errcode = 'MLK89';
    end if;
  end if;

  update public.admin_user_roles
    set revoked_at = now(), revoked_by = auth.uid()
    where user_id = p_user_id and role_id = v_role_id and revoked_at is null;
  get diagnostics v_updated = row_count;

  -- GÜVENLİK DÜZELTMESİ (C.5): yalnız gerçekten bir satır etkilendiyse
  -- audit log yaz.
  if v_updated > 0 then
    perform public.log_audit_event('revoke_admin_role', 'admin_user_roles', null,
      jsonb_build_object('user_id', p_user_id, 'role_code', p_role_code), null);
  end if;
end;
$$;

revoke all on function public.grant_admin_role(uuid, text) from public, anon;
revoke all on function public.revoke_admin_role(uuid, text) from public, anon;
grant execute on function public.grant_admin_role(uuid, text) to authenticated;
grant execute on function public.revoke_admin_role(uuid, text) to authenticated;

create or replace function public.verify_provider(p_user_id uuid)
returns public.provider_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_profiles;
begin
  if not public.has_admin_permission('users.verify') then
    raise exception 'MLK83: users.verify permission required' using errcode = 'MLK83';
  end if;
  update public.provider_profiles set verification_status = 'verified' where user_id = p_user_id returning * into v_row;
  if v_row is null then
    raise exception 'MLK76: provider profile not found' using errcode = 'MLK76';
  end if;
  perform public.log_audit_event('verify_provider', 'provider_profiles', p_user_id, null, jsonb_build_object('verification_status', 'verified'));
  return v_row;
end;
$$;

revoke all on function public.verify_provider(uuid) from public, anon;
grant execute on function public.verify_provider(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Subscription & quota management
-- -----------------------------------------------------------------------------
create or replace function public.assign_subscription_plan(p_user_id uuid, p_plan_code text)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_existing public.user_subscriptions;
  v_new public.user_subscriptions;
begin
  if not public.has_admin_permission('settings.manage') then
    raise exception 'MLK86: settings.manage permission required' using errcode = 'MLK86';
  end if;
  select id into v_plan_id from public.subscription_plans where code = p_plan_code and is_active = true;
  if v_plan_id is null then
    raise exception 'MLK87: unknown or inactive plan code %', p_plan_code using errcode = 'MLK87';
  end if;

  select * into v_existing from public.user_subscriptions where user_id = p_user_id and status in ('trialing', 'active');
  if v_existing is not null then
    update public.user_subscriptions set status = 'canceled', cancelled_at = now() where id = v_existing.id;
    insert into public.subscription_status_history (subscription_id, previous_status, new_status, changed_by, reason)
      values (v_existing.id, v_existing.status, 'canceled', auth.uid(), 'replaced_by_admin_assignment');
  end if;

  insert into public.user_subscriptions (user_id, plan_id, status, current_period_start)
  values (p_user_id, v_plan_id, 'active', now())
  returning * into v_new;
  insert into public.subscription_status_history (subscription_id, previous_status, new_status, changed_by)
    values (v_new.id, null, 'active', auth.uid());

  perform public.log_audit_event('assign_subscription_plan', 'user_subscriptions', v_new.id, null, jsonb_build_object('user_id', p_user_id, 'plan_code', p_plan_code));
  return v_new;
end;
$$;

create or replace function public.cancel_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select user_id, status into v_owner, v_status from public.user_subscriptions where id = p_subscription_id;
  if v_owner is null then
    raise exception 'MLK76: subscription not found' using errcode = 'MLK76';
  end if;
  if v_owner <> auth.uid() and not public.has_admin_permission('settings.manage') then
    raise exception 'MLK56: not authorized to cancel this subscription' using errcode = 'MLK56';
  end if;

  update public.user_subscriptions set status = 'canceled', cancelled_at = now() where id = p_subscription_id;
  insert into public.subscription_status_history (subscription_id, previous_status, new_status, changed_by)
    values (p_subscription_id, v_status, 'canceled', auth.uid());

  if auth.uid() <> v_owner then
    perform public.log_audit_event('cancel_subscription', 'user_subscriptions', p_subscription_id, jsonb_build_object('status', v_status), jsonb_build_object('status', 'canceled'));
  end if;
end;
$$;

create or replace function public.grant_user_limit_override(
  p_user_id uuid, p_limit_key text, p_limit_value bigint, p_valid_until timestamptz, p_reason text
)
returns public.user_limit_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_limit_overrides;
begin
  if not public.has_admin_permission('settings.manage') then
    raise exception 'MLK86: settings.manage permission required' using errcode = 'MLK86';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'MLK88: a reason is required for a quota override' using errcode = 'MLK88';
  end if;

  insert into public.user_limit_overrides (user_id, limit_key, limit_value, valid_until, granted_by, reason)
  values (p_user_id, p_limit_key, p_limit_value, p_valid_until, auth.uid(), trim(p_reason))
  returning * into v_row;

  perform public.log_audit_event('grant_user_limit_override', 'user_limit_overrides', v_row.id, null,
    jsonb_build_object('user_id', p_user_id, 'limit_key', p_limit_key, 'limit_value', p_limit_value, 'valid_until', p_valid_until));
  return v_row;
end;
$$;

create or replace function public.update_subscription_plan_limit(p_plan_code text, p_limit_key text, p_limit_value bigint)
returns public.subscription_plan_limits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_row public.subscription_plan_limits;
  v_old_value bigint;
begin
  if not public.has_admin_permission('settings.manage') then
    raise exception 'MLK86: settings.manage permission required' using errcode = 'MLK86';
  end if;
  select id into v_plan_id from public.subscription_plans where code = p_plan_code;
  if v_plan_id is null then
    raise exception 'MLK87: unknown plan code %', p_plan_code using errcode = 'MLK87';
  end if;

  select limit_value into v_old_value from public.subscription_plan_limits where plan_id = v_plan_id and limit_key = p_limit_key;

  insert into public.subscription_plan_limits (plan_id, limit_key, limit_value)
  values (v_plan_id, p_limit_key, p_limit_value)
  on conflict (plan_id, limit_key) do update set limit_value = excluded.limit_value
  returning * into v_row;

  perform public.log_audit_event('update_subscription_plan_limit', 'subscription_plan_limits', v_row.id,
    jsonb_build_object('limit_value', v_old_value), jsonb_build_object('limit_value', p_limit_value, 'plan_code', p_plan_code, 'limit_key', p_limit_key));
  return v_row;
end;
$$;

revoke all on function public.assign_subscription_plan(uuid, text) from public, anon;
revoke all on function public.cancel_subscription(uuid) from public, anon;
revoke all on function public.grant_user_limit_override(uuid, text, bigint, timestamptz, text) from public, anon;
revoke all on function public.update_subscription_plan_limit(text, text, bigint) from public, anon;
grant execute on function public.assign_subscription_plan(uuid, text) to authenticated;
grant execute on function public.cancel_subscription(uuid) to authenticated;
grant execute on function public.grant_user_limit_override(uuid, text, bigint, timestamptz, text) to authenticated;
grant execute on function public.update_subscription_plan_limit(text, text, bigint) to authenticated;
