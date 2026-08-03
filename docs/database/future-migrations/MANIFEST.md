# MALSEVK — Faz 2 / Faz 3 Taslak Migration Manifestosu

**Bu klasör `supabase/migrations/` DIŞINDADIR.** Supabase CLI (`supabase db reset` / `supabase migration up` / `supabase db push`) yalnızca `supabase/migrations/*.sql`'i tarar — bu klasördeki hiçbir dosya, hiçbir koşulda otomatik uygulanmaz. Bu, bilinçli bir yapı kararıdır: `supabase/migrations/future/` gibi bir alt klasör YERİNE bu klasör seçildi, çünkü bazı Supabase CLI sürümleri/araçları `supabase/migrations/` altındaki alt klasörleri de tarayabilir — bu tamamen ayrı, `docs/` altındaki bir konum bu riski sıfıra indirir.

Faz 1 (çekirdek pazaryeri, otomatik çalıştırılacak) dosyaları için `supabase/migrations/0001`–`0020`'ye bakın.

## Faz 2 — Gelişmiş Yönetim ve Abonelik (`phase2/`)

| Dosya | İçerik | Faz 1'e bağımlılık | Faz 1'i değiştirir mi |
|---|---|---|---|
| `0001_admin_rbac.sql` | `admin_permissions`, `admin_roles`, `admin_role_permissions`, `admin_user_roles` | `profiles` (Faz 1) | Hayır — Faz 1'in `is_admin()` katmanına dokunmaz |
| `0002_admin_permission_helper.sql` | `has_admin_permission(code)` | `0001` (bu klasör) | Hayır |
| `0003_subscriptions_and_quotas.sql` | `subscription_plans`, `subscription_plan_limits`, `user_subscriptions`, `subscription_status_history`, `user_limit_overrides`, `get_effective_limit()` | `profiles` (Faz 1) | Hayır (kendi başına) |
| `0004_rpc_admin_and_subscription_functions.sql` | `grant_admin_role`, `revoke_admin_role` (C.4/C.5 düzeltmeleriyle), `verify_provider`, `assign_subscription_plan`, `cancel_subscription`, `grant_user_limit_override`, `update_subscription_plan_limit` | `0001`-`0003` (bu klasör) | Hayır |
| `0005_views_and_rls_and_indexes.sql` | admin_*/subscription_* RLS, `admin_dashboard_summary`, Faz 1→Faz 2 view/policy geçiş şablonu (yorum satırı olarak) | `0001`-`0004` (bu klasör) | **Yalnız bu adım manuel olarak devreye alınırsa** (aşağıdaki "Devreye Alma" bölümüne bakın) |

### Devreye alma sırası (Faz 2 gerçekten istendiğinde)

1. `phase2/0001_admin_rbac.sql` → `phase2/0002_admin_permission_helper.sql` → `phase2/0003_subscriptions_and_quotas.sql` → `phase2/0004_rpc_admin_and_subscription_functions.sql` → `phase2/0005_views_and_rls_and_indexes.sql` dosyalarını, sırasıyla, `supabase/migrations/` içine **yeni, sıralı numaralarla** (ör. `0021`–`0025`) kopyalayın.
2. İlk `super_admin`'i doğrudan DB erişimiyle bootstrap edin (`0001_admin_rbac.sql`'in kendi yorumundaki SQL şablonu — bkz. `docs/database/admin-permissions.md`).
3. `supabase/migrations/0012_rls_helpers.sql`'deki `get_active_job_limit()`'i, o dosyanın kendi yorumunda verilen tek satırlık `CREATE OR REPLACE` ile `get_effective_limit(auth.uid(), 'max_active_jobs')`'i çağıracak şekilde güncelleyin — **hiçbir RPC/çağıran değişmez**.
4. `supabase/migrations/0015_rpc_offer_functions.sql`'deki `create_offer()`'a günlük teklif kotası kontrolünü geri ekleyin (Faz 1'de kasıtlı olarak yok — o dosyanın kendi başlık notuna bakın).
5. `phase2/0005_views_and_rls_and_instalments.sql`'in sonundaki yorum satırı bloğunu (Faz 1'in `is_admin()`-öz-kapılı view/policy'lerini `has_admin_permission(code)`-öz-kapılı hale getiren `ALTER POLICY`/`CREATE OR REPLACE VIEW` ifadeleri) etkinleştirin.
6. `docs/database/admin-permissions.md` ve `docs/database/subscriptions-and-quotas.md`'yi "TASARLANDI, UYGULANMADI"dan "UYGULANDI"ya güncelleyin.

**Not:** Adım 1-2 tamamlanmadan hiçbir admin hesabı işlevini kaybetmez — Faz 1'in `is_admin()` (Layer 1) her zaman çalışır durumda kalır; Faz 2 yalnızca İNCE TANELİ katmanı (Layer 2) ekler.

## Faz 3 — Ödeme ve Finans (`phase3/`)

| Dosya | İçerik | Bağımlılık |
|---|---|---|
| `0001_payment_foundations.sql` | `payment_customers`, `payment_transactions`, `payment_attempts`, `payment_refunds`, `invoices` | `profiles`, `user_subscriptions` (Faz 2), `jobs`/`offers` (Faz 1) |
| `0002_payment_webhook_events_and_outbox.sql` | `payment_webhook_events`, `outbox_events` | Bağımsız (kendi başına) |
| `0003_rls_and_views.sql` | Ödeme tabloları RLS, `admin_payment_summary` | `0001`-`0002` (bu klasör), `has_admin_permission()` (Faz 2) |

### Devreye alma ön koşulu

Bu klasörün SQL'i, **bir ödeme sağlayıcısı (iyzico/PayTR/Stripe-eşdeğeri) seçildikten ve o sağlayıcının server-side entegrasyonunu (Supabase Edge Function, `service_role` anahtarıyla) yazacak bir ekip hazır olduktan SONRA** devreye alınmalıdır — bu tablolar `service_role`-authenticated bir Edge Function tarafından yazılır, client-callable bir RPC ile değil (bkz. `0001_payment_foundations.sql`'in kendi mimari notu). Sağlayıcı seçilmeden bu dosyaları uygulamak, boş, kullanılmayan tablolar bırakmaktan başka bir işe yaramaz.

Escrow/emanet hesap mimarisi **yalnızca dokümantasyon düzeyinde kalır** — `docs/database/future-escrow-architecture.md`'ye bakın. Bu tur (Faz 1 sadeleştirmesi) hiçbir escrow SQL'i üretmedi ve üretmeyecek; bu, görevin kendi kesin kuralıdır.

## Faz 1'in "aktif değil" olduğunu nasıl doğrularsınız

Faz 1'in gerçekten Faz 2/3'e hiçbir bağımlılığı olmadığını doğrulamak için:

```bash
# supabase/migrations/ altında admin_permissions/admin_roles/admin_user_roles/
# subscription_*/payment_*/outbox_events'e referans arayın — hiçbir sonuç
# dönmemesi gerekir:
grep -rEn "admin_permissions|admin_roles|admin_role_permissions|admin_user_roles|subscription_plans|subscription_plan_limits|user_subscriptions|subscription_status_history|user_limit_overrides|payment_customers|payment_transactions|payment_attempts|payment_refunds|invoices|payment_webhook_events|outbox_events|has_admin_permission|get_effective_limit" supabase/migrations/
```

Bu komut Faz 1 dosyalarının hiçbirinde eşleşme döndürmemelidir (bkz. bu görevin "Statik Doğrulama" bölümü / nihai rapor).
