-- =============================================================================
-- MALSEVK — Faz 2 TASLAK 0002: has_admin_permission() — Layer 2 admin kapısı
-- =============================================================================
-- STATUS: FAZ 2 TASLAK — OTOMATİK ÇALIŞTIRILMAZ.
--
-- Faz 1'in supabase/migrations/0012_rls_helpers.sql'i yalnız is_admin()
-- (Layer 1) tanımlar. Bu fonksiyon Layer 2'dir — admin_user_roles/admin_
-- role_permissions'a (0001_admin_rbac.sql, bu klasör) bağımlı olduğu için
-- Faz 1'de YOKTUR. Devreye alma adımları için ../MANIFEST.md'ye bakın.
-- =============================================================================

create or replace function public.has_admin_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_user_roles aur
    join public.admin_role_permissions arp on arp.role_id = aur.role_id
    where aur.user_id = auth.uid()
      and aur.revoked_at is null
      and arp.permission_code = p_code
  );
$$;

comment on function public.has_admin_permission(text) is
  'Layer 2 (fine-grained) admin gate. Her çağrıda admin_user_roles/admin_role_permissions''tan CANLI okunur — asla bir JWT claim''inde önbelleklenmez, böylece iptal edilen bir yetki bir sonraki istekte hemen geçerli olur, oturum sonlandırma gerekmez.';
