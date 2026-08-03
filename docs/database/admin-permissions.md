# MALSEVK — Admin Permission Model

**Faz 1 (bugün, `supabase/migrations/`): TEK katman, `is_admin()`.** Faz 2 (`docs/database/future-migrations/phase2/`): ince taneli `has_admin_permission(code)` katmanı + 4 tablo. Bu ayrım, bir önceki teknik denetim raporunun "gelişmiş admin RBAC ilk göç için erken" bulgusunun doğrudan sonucudur.

## Faz 1: minimum admin modeli

Faz 1'in TEK admin kapısı `is_admin()`'dir (`profiles.role = 'admin'` — `supabase/migrations/0012_rls_helpers.sql`), kaynak uygulamanın bugünkü, tek düz admin rolü kontrolünün (`users.ts#DEV_ACCOUNTS`, `provider-document-reviews.ts`) birebir aynısı. Bu kapı üzerinden Faz 1'de mevcut olan yetenekler (görev bölüm 3'ün "İlk fazda gerekli minimum admin ihtiyacı" listesiyle eşleşir):

| İhtiyaç | Uygulama |
|---|---|
| Admin kullanıcıyı tanımlayabilmek | `profiles.role = 'admin'` (yalnız doğrudan DB erişimiyle atanır — Faz 1'de bunu değiştiren hiçbir client-callable RPC yok) |
| Kullanıcıları görüntülemek | `admin_user_list` view (`0017_views.sql`) |
| Kullanıcı hesabını askıya almak | `suspend_user()`/`reinstate_user()` (`0016_rpc_document_notification_and_admin_functions.sql`) |
| İlanları görüntülemek ve gerektiğinde kapatmak | `admin_job_list` view + `close_job_as_admin()` (`0016`) |
| Teklifleri incelemek | `admin_offer_list` view (`0017`) |
| Hizmet Veren belgelerini incelemek | `admin_document_queue` view + `review_provider_document()` (kaynaktan DEĞİŞMEDEN, zaten `is_admin()`) |
| Faaliyet raporlarını incelemek | AYNI `admin_document_queue`/`provider_documents` — `document_type='genel'` filtresiyle (ayrı bir tablo YOK) |
| Şikâyet/itiraz kayıtlarını incelemek | `admin_dispute_queue` view (`0017`) |
| Audit log görüntülemek | `audit_logs_select_admins_only` policy (`0013_rls_policies.sql`), `admin_audit_log_search()` (`0017`) |
| Son admin'in kaybolmasını engellemek | `prevent_last_admin_loss()` tetikleyicisi (`0012`, profiles.role/deleted_at) + `suspend_user()`'ın kendi son-AKTİF-admin kontrolü (`0016`) |

**Neden bu yeterli**: Faz 1'de `profiles.role`/`account_status`/`onboarding_completed`'i değiştirebilen HİÇBİR client-callable RPC yoktur (kolon grant'ı bunu zaten engelliyor — `0003_profiles_and_provider_catalog.sql`) ve `suspend_user`/`reinstate_user` DIŞINDA hiçbir RPC bir hesabın admin durumunu değiştirmez. Bu yüzden Faz 1'in "son admin korunmalı" gereksinimi, JWT'ye/oturuma değil, doğrudan DB-yazımına karşı bir savunma-derinliği tetikleyicisidir — normal işleyişte hiç tetiklenmez, yalnızca kazara bir doğrudan-DB hatasına karşı bir güvenlik ağıdır.

`account_status='suspended'`'ın FİİLEN neyi engellediği (create_job? create_offer? giriş?) bir önceki teknik denetim raporunun Açık Karar'ı olarak kalır — Faz 1 yalnızca bayrağı ve RPC'yi taşır, uygulamayı ÇÖZMEZ (bkz. [schema-reference.md](schema-reference.md) Açık Karar #6).

## Faz 2: iki katmanlı model

**Layer 1 — `is_admin()`, Faz 1'den değişmeden.** `review_provider_document` gibi kaynak uygulamada zaten var olan yetenek bu katmanda kalır — Faz 2'nin devreye alınması Faz 1'in HİÇBİR davranışını bozmaz.

**Layer 2 — `has_admin_permission(code)`, yeni ve eklemeli.** Çağıranın aktif bir `admin_user_roles` grant'ı taşıyıp taşımadığını, o rolün adlandırılmış `admin_permissions.code`'u taşıyıp taşımadığını kontrol eder. Bu tasarımın YENİ tanıttığı her yetenek (`grant_admin_role`'un kendisi, ince taneli `admin_dashboard_summary`, ...) buna göre kapılıdır.

### İzin kataloğu (Faz 2, `phase2/0001_admin_rbac.sql`'de seed edilmiş)

`users.view`, `users.suspend`, `users.verify`, `jobs.view`, `jobs.close`, `jobs.delete`, `offers.view`, `documents.view`, `documents.review`, `disputes.view`, `disputes.resolve`, `payments.view`, `payments.refund`, `payouts.view`, `reports.view`, `settings.manage`, `audit_logs.view`, `admin_roles.manage`.

### Başlangıç rolleri

| Rol | Türkçe adı | Başlangıç izinleri |
|---|---|---|
| `super_admin` | Süper Admin | Kataloğun tamamı |
| `document_officer` | Evrak Yetkilisi | `documents.view`, `documents.review` |
| `finance_officer` | Finans Yetkilisi | `payments.view`, `payments.refund`, `payouts.view`, `reports.view` |
| `support_officer` | Destek Yetkilisi | `users.view`, `jobs.view`, `offers.view`, `disputes.view`, `disputes.resolve` |
| `operations_officer` | Operasyon Yetkilisi | `jobs.view`, `jobs.close`, `jobs.delete`, `offers.view`, `reports.view` |

### Bootstrap: ilk süper admin

`grant_admin_role()` (`phase2/0004_...sql`) çağıranın zaten `admin_roles.manage` taşımasını gerektirir — ilk grant için imkansızdır. İlk `super_admin`, doğrudan DB erişimiyle, YALNIZCA BİR KEZ oluşturulmalıdır — bkz. `phase2/0001_admin_rbac.sql`'in kendi runbook'u.

### Son admin koruması (Faz 2)

**GÜVENLİK DÜZELTMESİ (önceki denetim C.4, Yüksek)**: `revoke_admin_role()` (`phase2/0004_...sql`) artık sistemin son `admin_roles.manage` sahibinin (özellikle son `super_admin`'in) iptal edilmesini REDDEDER (`MLK89`) — önceki tasarımda bu koruma YOKTU, bir admin sistemin TEK admin-rol-yöneticisini (hatta kendini) iptal edip admin-rol-yönetimini kalıcı olarak kilitleyebiliyordu.

**GÜVENLİK DÜZELTMESİ (önceki denetim C.5, Orta)**: `revoke_admin_role()` artık yalnız gerçekten bir satır etkilendiyse `log_audit_event()` çağırır — önceki tasarım hiçbir satır etkilenmese bile "iptal edildi" diye sahte bir audit kaydı yazıyordu.

### Devreye alma

Bkz. `docs/database/future-migrations/MANIFEST.md`'nin "Faz 2" bölümü — tam dosya sırası, Faz 1'in `get_active_job_limit()`/admin view'larının nasıl güncelleneceği dahil.

## Açık Kararlar

1. **`update_role_permissions()` RPC'si** (mevcut bir rolün izin setini seed sonrası düzenleme) inşa edilmedi — beş başlangıç rolü yalnız doğrudan SQL ile ayarlanabilir.
2. **Beş başlangıcın ötesinde tamamen yeni özel roller oluşturma** için de özel bir RPC yok.
3. **`suspend_user()`'ın `account_status` bayrağının fiilen bir eylemi engelleyip engellemediği** — Faz 1'de de Faz 2'de de çözülmedi, bkz. [schema-reference.md](schema-reference.md) Açık Karar #6.
