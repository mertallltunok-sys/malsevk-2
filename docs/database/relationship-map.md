# MALSEVK — Relationship Map (Faz 1)

Bu doküman yalnız Faz 1'i (`supabase/migrations/`) kapsar. Faz 2 (`admin_user_roles`→`admin_roles`→..., `user_subscriptions`→`subscription_plans`→...) ve Faz 3 (`payment_*`) ilişkileri `docs/database/future-migrations/` altındaki kendi dosyalarında belgelenir — bu grafikten bilerek çıkarılmıştır çünkü Faz 1'in HİÇBİR tablosu onlara bağımlı değildir.

## FK grafiği (bağımlılık sırası — aynı zamanda migration dosya sırası)

```
auth.users (Supabase-managed)
  └── profiles (1:1, id shared)
        ├── provider_profiles (1:1, via user_id)
        ├── provider_services (1:N)  ──> service_categories (N:1)
        ├── operations (1:N, requester_id)
        │     └── jobs (1:N, operation_id — NULLABLE, most jobs are standalone)
        ├── jobs (1:N, requester_id)  ──> service_categories (N:1, category_id)
        │     ├── job_photos (1:N)
        │     ├── jobs (self, republished_from_job_id / republished_to_job_id — 1:1 each direction)
        │     ├── job_activity_events (1:N — YALNIZ ilan-seviyeli olaylar, offer_id YOK)
        │     └── offers (1:N)
        │           ├── offer_status_history (1:N)
        │           └── ratings (1:1, via offer_id unique)
        ├── ratings (1:N, rater_id)
        ├── provider_documents (1:N, provider_id)
        │     └── provider_document_reviews (1:N)
        ├── provider_document_consents (1:N)
        ├── legal_consents (1:N, user_id nullable)
        ├── notifications (1:N, recipient_id — read_at/dismissed_at AYNI SATIRDA, ayrı tablo YOK)
        ├── recently_viewed_jobs (1:N)
        ├── audit_logs (N:1 actor_id, nullable)
        └── contact_messages (1:N, user_id NULLABLE — misafir gönderimi; N:1 reviewed_by_admin_id, nullable) [0021, yerel dry-run'da eklendi]
```

## Kardinalite notları

| İlişki | Kardinalite | İlk bakışta göründüğü gibi olmamasının nedeni |
|---|---|---|
| `offers.job_id, provider_id` → geçmiş | **zaman içinde 1-çoğa**, 1-1 değil | Kaynak uygulama, 3 günlük cooldown'dan (withdrawn/rejected/agreement_failed) sonra AYNI `(job, provider)` çifti için birden fazla tarihsel `Offer` satırına izin verir. `UNIQUE(job_id, provider_id)` bu yüzden reddedildi — bkz. `offers_one_blocking_per_job_provider` partial unique index (0005). |
| `offers.job_id` → **settled** teklif | **her zaman en fazla 1** (herhangi bir sağlayıcı için) | GÜVENLİK: `offers_one_settled_per_job` partial unique index (0005) — bir önceki teknik denetimin B.1 KRİTİK bulgusunun düzeltmesi; iki farklı sağlayıcının aynı ilandaki tekliflerinin eşzamanlı kabulünü DB seviyesinde engeller. |
| `jobs.operation_id` → `operations.id` | **çoktan-bire, nullable** | Çoğu ilanda `operation_id = NULL` (bağımsız). Kaynakta bu paylaşılan anahtarın ötesinde hiçbir "operation" kavramı yok — `operations` yeni altyapıdır (0004). `operations.total_service_count` diye STORED bir kolon YOK — bkz. altta. |
| `jobs.republished_from_job_id` / `republished_to_job_id` | **her yönde 1-1**, iki partial unique index ile zorlanır | Bkz. 0004'ün kendi notu — RPC katmanı tamamen bypass edilirse DB seviyesinde kanıtlanamayan artık bir döngü riski. |
| `ratings.offer_id` | **kesinlikle 1-1** | `UNIQUE(offer_id)` (0006) |
| `job_activity_events.job_id` | **1-çoğa, `offer_id` YOK** | Sadeleştirme: teklif olayları artık `offer_status_history`'de, `job_activity_events`'te DEĞİL — bkz. 0010'un başlık notu ("tekrar önleme") |
| `notifications.recipient_id` (+ `read_at`/`dismissed_at`) | **1 satır = 1 alıcının tam durumu** | `notification_states` AYRI TABLOSU KALDIRILDI — `recipient_id` zaten her zaman tekil, ayrı bir join tablosu doğrulanmamış bir çoklu-alıcı senaryosu içindi |
| `job_photos.storage_path` / `provider_documents.storage_path` / `provider_profiles.logo_path` | **çok DB satırı, tip başına bir paylaşılan Storage bucket namespace'i** | Bkz. [storage-plan.md](storage-plan.md) |

## Plain FK/CHECK yerine tetikleyicilerle uygulanan cross-table kurallar

| Kural | Tetikleyici | Migration |
|---|---|---|
| `jobs.requester_id` bir `hizmet-alan` profiline ait olmalı | `ensure_job_requester_is_hizmet_alan` | 0004 |
| `jobs.operation_id`, doluysa, AYNI requester'a ait bir operasyona ait olmalı | `ensure_job_operation_requester_matches` | 0004 |
| `operations.closed_at`/`completed_at`, her (soft-delete edilmemiş) üye ilan bağımsız olarak resolved olduğunda damgalanır | `recompute_operation_terminal_state` (jobs tetikleyicisinden çağrılır — artık `deleted_at` değişimini de dinler) | 0004 |
| `offers.provider_id` bir `hizmet-veren` profiline ait olmalı, ve ilanın kendi `requester_id`'sine eşit olamaz | `ensure_offer_provider_is_hizmet_veren` | 0005 |
| `ratings` bir `completed` teklife referans vermeli, `job_id`/`provider_id` o teklifle eşleşmeli, `rater_id` ilanın requester'ı olmalı | `ensure_rating_matches_completed_offer` | 0006 |
| Sistemde en az bir `role='admin'` hesabı her zaman kalmalı | `prevent_last_admin_loss` | 0012 |

## Kasıtlı olarak foreign key OLMAYAN ilişkiler

- **`notifications.actor_id`** `profiles.id`'ye referans verir ama nullable'dır ve "yalnızca görüntüleme için bir UUID, RLS için bir join hedefi değil" olarak ele alınır — bkz. 0009'un kendi yorumu.

## Faz 2 / Faz 3 grafiği (bu dokümanın kapsamı dışında)

```
profiles ── admin_user_roles (1:N) ──> admin_roles (N:1) ──> admin_role_permissions (N:1) ──> admin_permissions (N:1)
profiles ── user_subscriptions (1:N) ──> subscription_plans (N:1) ──> subscription_plan_limits (1:N)
                                    └──> subscription_status_history (1:N)
profiles ── user_limit_overrides (1:N)
profiles ── payment_customers (1:N)
profiles ── payment_transactions (1:N) ──> payment_attempts (1:N), payment_refunds (1:N via transaction)
                                     └──> invoices (1:N, opsiyonel subscription_id/offer_id/job_id)
payment_webhook_events (profiles'a FK YOK — sağlayıcı-taraflı olay)
outbox_events (hiçbir şeye FK YOK — kasıtlı olarak gevşek)
```

Tam ayrıntı için `docs/database/future-migrations/phase2/` ve `phase3/`'e bakın.
