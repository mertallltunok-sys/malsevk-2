# MALSEVK — Subscription & Usage Quota Model

**Faz 2'ye ertelendi** (`docs/database/future-migrations/phase2/0003_subscriptions_and_quotas.sql`) — kaynak uygulamada hiçbir karşılığı yok, hiçbir fiyatlandırma/paket kararı verilmedi. Bir önceki teknik denetim raporunun "abonelik için beş ayrı tablo ilk göç için erken" bulgusunun doğrudan sonucu.

## Faz 1: sabit, merkezi, abonelikten bağımsız helper

Faz 1 (`supabase/migrations/0012_rls_helpers.sql`), bugünkü doğrulanmış TEK gerçek kısıtı — `provider-capacity.ts#MAX_ACTIVE_JOBS = 5` — `get_active_job_limit()` adlı, sabit `5` döndüren TEK bir fonksiyonda tutar:

```sql
create or replace function public.get_active_job_limit()
returns integer language sql immutable
as $$ select 5; $$;
```

`has_reached_active_job_limit()` bunu çağırır; `create_offer()`/`accept_offer()` (`0015_rpc_offer_functions.sql`) bu fonksiyonu çağırır — hiçbiri sayıyı kendi içinde tekrarlamaz (magic number dağıtmama kuralı). **Faz 1'de günlük teklif kotası YOKTUR** — doğrulanmış bugünkü davranış (kaynak kodda hiçbir günlük sayaç kontrolü yok) budur; bir sayı icat etmek (5, 10, ör.) mevcut davranışı SESSİZCE değiştirmek olurdu.

## Faz 2 devreye alındığında: köprü

TEK yapılması gereken adım, `get_active_job_limit()`'i `CREATE OR REPLACE` ile aşağıdaki gibi güncellemektir:

```sql
create or replace function public.get_active_job_limit()
returns integer language sql stable security definer set search_path = public
as $$ select get_effective_limit(auth.uid(), 'max_active_jobs')::integer; $$;
```

**Hiçbir çağıran RPC değişmez** — `has_reached_active_job_limit()`, `create_offer()`, `accept_offer()` hepsi aynı kalır. Ayrıca `create_offer()`'a günlük teklif kotası kontrolü (Faz 1'de kasıtlı olarak yok) geri eklenmelidir — bkz. `docs/database/future-migrations/MANIFEST.md`.

## Faz 2 tabloları

`subscription_plans`, `subscription_plan_limits`, `user_subscriptions`, `subscription_status_history`, `user_limit_overrides` — beş tablo, tamamı gerçek ve işlevsel (taslak, ama iskelet değil).

### İnşa edilmeyen tablolar (ve neden)

| Değerlendirilen | Neden inşa edilmedi |
|---|---|
| `usage_counters` / `usage_events` | Canlı `COUNT(*)` daha basit, sapamaz |
| `usage_adjustments` | Ancak bakımlı bir sayaçla anlamlı — böyle bir sayaç yok |
| `plan_features` | `subscription_plan_limits` zaten boolean bayrakları `limit_value 0/1` ile kapsıyor |
| `promotional_entitlements` | Promosyon planı zaten `is_public=false` + `trial_ends_at` |

## `free` planı davranışı-koruyan varsayılandır

`daily_offer_limit = NULL` (sınırsız — bugün böyle bir sınır yok), `max_active_jobs = 5` (doğrulanmış). Faz 2 devreye alındığında bile, `free` planı üzerinde olan (yani `user_subscriptions`'da satırı olmayan) her kullanıcı için **sıfır uygulama-davranışı değişir** — bu, bir admin `update_subscription_plan_limit('free', 'daily_offer_limit', 5)` gibi açık bir eylem çağırana kadar böyledir.

## Zaman dilimi kararı: Europe/Istanbul

Faz 2'nin `create_offer()` günlük kota kontrolü (geri eklendiğinde) Europe/Istanbul gün sınırını kullanmalıdır — Türkiye 2016'dan beri sabit UTC+3 (DST yok), bu da sınır hesabını belirsizlikten arındırır:

```sql
v_day_start := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
v_day_end := v_day_start + interval '1 day';
```

## Eşzamanlılık: kota çift-harcamasını önleme

`create_offer()` zaten (Faz 1'de de) `pg_advisory_xact_lock(hashtext(provider_id || ':create_offer'))` alıyor — Faz 2'nin günlük kota sayımı bu KİLİDİN İÇİNE eklenecek, ayrı bir kilit gerekmiyor.

## Açık Kararlar

1. **Geri çekme/reddedilmede günlük kota iadesi** — Faz 2 tasarımı HAYIR diyor (muhafazakâr varsayılan): gün içindeki TÜM teklifler, sonraki durumları ne olursa olsun sayılır.
2. **Belge-onayına-bağlı farklılaştırılmış kotalar** — otomatik bir bağlantı YOK; `user_limit_overrides` ile elle mümkün.
3. **Promosyon/deneme self-servis kod kullanımı** — inşa edilmedi; `trial_ends_at` + admin-atamalı non-public planlar yalnız admin-başlatmalı promosyonları kapsar.
