-- =============================================================================
-- MALSEVK — migration 0043: profiles(id) foreign key delete-lifecycle audit
-- =============================================================================
-- KOK NEDEN (0042'nin M bolumunde bulundu ve gercek bir hatayla yeniden
-- uretildi): public.profiles(id)'e referans veren 32 foreign key'in
-- NEREDEYSE HICBIRINDE (yalniz provider_profiles.user_id / provider_services.
-- provider_id haric) bir ON DELETE davranisi tanimli degildi (Postgres
-- varsayilani: NO ACTION, pratikte RESTRICT gibi calisiyor) -- gercek
-- islemler yapmis (ilan/teklif/audit-log satiri olusturmus) HERHANGI bir
-- hesap auth.users'tan dogrudan silinmeye calisildiginda 23503 foreign key
-- violation ile REDDEDILIYORDU. Bu, onceki denetim raporunun tarif ettigi
-- "5 hesap AuthRetryableFetchError nedeniyle silinemedi" bulgusunun ayni kok
-- nedeniydi (GoTrue Admin API'si icerde ayni 23503'u aliyor, istemci SDK'si
-- bunu genel bir ag hatasi gibi siniflandirip yeniden deniyor).
--
-- KORLEMESINE COZUM UYGULANMADI: butun 32 FK'ye ON DELETE CASCADE eklemek
-- gorev talimatinda ACIKCA yasaklandi, cunku bu bir "hizmet-alan hesabini
-- sil -> onun butun ilanlarini VE o ilanlara teklif vermis saglayicilarin
-- teklif/degerlendirme gecmisini de sessizce yok et" davranisina yol acardi
-- -- tam olarak onlenmesi istenen "baska kullanicinin verisinin yanlislikla
-- silinmesi" senaryosu. Bunun yerine her FK KENDI is anlamina gore tek tek
-- siniflandirildi (bkz. asagidaki uc grup) -- hicbir toplu/mekanik kural
-- uygulanmadi.
--
-- UC GRUP:
--
--   (1) DEGISMEDI (RESTRICT/mevcut NO ACTION davranisi KORUNDU) -- gercek
--       ICERIK SAHIPLIGI + bir KARSI TARAFIN (counterparty) payi olan
--       NOT NULL kolonlar: jobs.requester_id, operations.requester_id,
--       offers.provider_id, ratings.provider_id/rater_id, provider_documents.
--       provider_id, provider_badges.provider_id, provider_service_
--       authorizations.provider_id, provider_document_reviews.provider_id
--       (provider_documents'in kendisi zaten engellendigi icin pratikte hic
--       tetiklenmez, ama TUTARLILIK icin ayni sinifta birakildi), job_photos.
--       uploaded_by (NOT NULL, ama bugunku akista uploaded_by HER ZAMAN
--       jobs.requester_id ile ayni kisi -- jobs.requester_id zaten engelledigi
--       icin bu kisitin kendisi pratikte hic BASIMSIZ tetiklenmez, NOT NULL'u
--       gereksiz yere gevsetmemek icin DOKUNULMADI). Bu tabloların HERHANGI
--       birinde gercek bir satiri olan bir hesap, bu migration'dan SONRA DA
--       dogrudan silinemeyecek -- bu KASITLI: gercek is/denetim kaydini
--       sessizce yok etmek yerine, admin/operasyonun bilinçli bir karar
--       vermesini zorluyor (bkz. asagidaki "temizlik" notu).
--
--   (2) ON DELETE SET NULL -- "kim yapti" turu ATIF/DENETIM kolonlari; kaydin
--       KENDISI (bildirim, audit_logs satiri, teklif durum gecmisi, belge
--       inceleme kaydi, ilan moderasyon kaydi, KVKK/yasal onay kaydi, iletisim
--       mesaji) bagimsiz bir is anlamina sahip ve HERHANGI bir karsi tarafin
--       DOGRUDAN cikari icin degil -- yalniz KIMIN yaptigi bilgisi kaybolur,
--       kaydin kendisi hayatta kalir ("gerekli audit gecmisinin gereksiz
--       kaybolmamasi" gereksinimi budur): audit_logs.actor_id, contact_
--       messages.user_id/reviewed_by_admin_id, facility_candidate_raw_
--       entries.submitted_by, facility_candidates.reviewed_by, job_activity_
--       events.actor_id, jobs.moderation_reviewed_by, legal_consents.user_id
--       (zaten uygulama kodunun kendisi userId:null'i "anonim kabul" olarak
--       modelliyor -- bkz. legal-consent.ts -- bu SET NULL, mevcut tasarimin
--       zaten ongordugu bir durumu DB seviyesine tasiyor, yeni bir kavram
--       icat etmiyor), notifications.actor_id, offer_status_history.
--       changed_by, offers.completion_requested_by, provider_badges.
--       granted_by/revoked_by, provider_document_reviews.admin_id, provider_
--       documents.reviewed_by, provider_service_authorizations.authorized_by/
--       revoked_by.
--
--       UC kolon (provider_badges.granted_by, provider_document_reviews.
--       admin_id, provider_service_authorizations.authorized_by) bugun NOT
--       NULL -- SET NULL'un gercekten calismasi icin ONCE nullable'a
--       gevsetildi (asagida). Bu, GUVENLI VE GERIYE DONUK UYUMLU bir
--       degisiklik: hicbir mevcut satiri BOZMAZ, hicbir INSERT'in davranisini
--       DEGISTIRMEZ (normal akiste bu alanlar zaten hep gercek bir deger
--       tasir) -- yalniz bir admin hesabi SONRADAN sert-silindiginde yeni,
--       gecerli bir durumu (NULL) mumkun kilar.
--
--   (3) ON DELETE CASCADE -- kaydin TEK VE YEGANE is anlami o KULLANICIYA
--       ait olmak; hicbir karsi tarafin/denetimin PAYI yok: notifications.
--       recipient_id (bir bildirim SADECE alicisi icin var olur -- alici
--       gittiyse bildirimin kimseye anlami kalmaz), recently_viewed_jobs.
--       user_id (salt kisisel goz atma gecmisi), provider_document_consents.
--       provider_id (saglayicinin KENDI belgesi icin kendi beyani -- zaten
--       provider_documents.provider_id engellendigi icin pratikte provider_
--       documents'tan once hic tetiklenmez, ama kendi basina dogru siniflama
--       budur).
--
-- TEMIZLIK NOTU (grup 1 icin): bu migration'dan SONRA bile gercek jobs/
-- operations/offers/ratings/provider_documents/provider_badges/provider_
-- service_authorizations satiri olan bir hesap dogrudan silinemez -- bu
-- KASITLI. Boyle bir hesabi (gercekten silinmesi gereken bir test/dev hesabi
-- ise) temizlemenin GUVENLI yolu hala ayni: bagimli satirlari elle, dogru
-- sirada silmek (bkz. scripts/tmp-supabase-suspend-enforcement-dev-test.mjs
-- ve ilgili cleanup script'lerinin kullandigi sira) -- bu migration o
-- listeyi KISALTIYOR (artik yalniz grup-1 tablolari icin gerekli), grup 2/3
-- icin GEREKSIZ hale getiriyor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grup 2 icin on kosul: 3 NOT NULL kolonu nullable'a gevset (SET NULL'un
-- gercekten calismasi icin sart -- aksi halde delete anda "null value
-- violates not-null constraint" ile patlar, tipki 0042'de auth.users.
-- confirmed_at generated-column hatasinda gorulen turden bir calisma-zamani
-- surprizine yol acardi).
-- -----------------------------------------------------------------------------
alter table public.provider_badges alter column granted_by drop not null;
alter table public.provider_document_reviews alter column admin_id drop not null;
alter table public.provider_service_authorizations alter column authorized_by drop not null;

-- -----------------------------------------------------------------------------
-- Grup 2 — ON DELETE SET NULL (17 kolon)
-- -----------------------------------------------------------------------------
alter table public.audit_logs drop constraint audit_logs_actor_id_fkey;
alter table public.audit_logs add constraint audit_logs_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.contact_messages drop constraint contact_messages_user_id_fkey;
alter table public.contact_messages add constraint contact_messages_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

alter table public.contact_messages drop constraint contact_messages_reviewed_by_admin_id_fkey;
alter table public.contact_messages add constraint contact_messages_reviewed_by_admin_id_fkey
  foreign key (reviewed_by_admin_id) references public.profiles(id) on delete set null;

alter table public.facility_candidate_raw_entries drop constraint facility_candidate_raw_entries_submitted_by_fkey;
alter table public.facility_candidate_raw_entries add constraint facility_candidate_raw_entries_submitted_by_fkey
  foreign key (submitted_by) references public.profiles(id) on delete set null;

alter table public.facility_candidates drop constraint facility_candidates_reviewed_by_fkey;
alter table public.facility_candidates add constraint facility_candidates_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;

alter table public.job_activity_events drop constraint job_activity_events_actor_id_fkey;
alter table public.job_activity_events add constraint job_activity_events_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.jobs drop constraint jobs_moderation_reviewed_by_fkey;
alter table public.jobs add constraint jobs_moderation_reviewed_by_fkey
  foreign key (moderation_reviewed_by) references public.profiles(id) on delete set null;

alter table public.legal_consents drop constraint legal_consents_user_id_fkey;
alter table public.legal_consents add constraint legal_consents_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

alter table public.notifications drop constraint notifications_actor_id_fkey;
alter table public.notifications add constraint notifications_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.offer_status_history drop constraint offer_status_history_changed_by_fkey;
alter table public.offer_status_history add constraint offer_status_history_changed_by_fkey
  foreign key (changed_by) references public.profiles(id) on delete set null;

alter table public.offers drop constraint offers_completion_requested_by_fkey;
alter table public.offers add constraint offers_completion_requested_by_fkey
  foreign key (completion_requested_by) references public.profiles(id) on delete set null;

alter table public.provider_badges drop constraint provider_badges_granted_by_fkey;
alter table public.provider_badges add constraint provider_badges_granted_by_fkey
  foreign key (granted_by) references public.profiles(id) on delete set null;

alter table public.provider_badges drop constraint provider_badges_revoked_by_fkey;
alter table public.provider_badges add constraint provider_badges_revoked_by_fkey
  foreign key (revoked_by) references public.profiles(id) on delete set null;

alter table public.provider_document_reviews drop constraint provider_document_reviews_admin_id_fkey;
alter table public.provider_document_reviews add constraint provider_document_reviews_admin_id_fkey
  foreign key (admin_id) references public.profiles(id) on delete set null;

alter table public.provider_documents drop constraint provider_documents_reviewed_by_fkey;
alter table public.provider_documents add constraint provider_documents_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;

alter table public.provider_service_authorizations drop constraint provider_service_authorizations_authorized_by_fkey;
alter table public.provider_service_authorizations add constraint provider_service_authorizations_authorized_by_fkey
  foreign key (authorized_by) references public.profiles(id) on delete set null;

alter table public.provider_service_authorizations drop constraint provider_service_authorizations_revoked_by_fkey;
alter table public.provider_service_authorizations add constraint provider_service_authorizations_revoked_by_fkey
  foreign key (revoked_by) references public.profiles(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Grup 3 — ON DELETE CASCADE (3 kolon)
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_recipient_id_fkey;
alter table public.notifications add constraint notifications_recipient_id_fkey
  foreign key (recipient_id) references public.profiles(id) on delete cascade;

alter table public.recently_viewed_jobs drop constraint recently_viewed_jobs_user_id_fkey;
alter table public.recently_viewed_jobs add constraint recently_viewed_jobs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.provider_document_consents drop constraint provider_document_consents_provider_id_fkey;
alter table public.provider_document_consents add constraint provider_document_consents_provider_id_fkey
  foreign key (provider_id) references public.profiles(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- Grup 1 — DEGISMEDI (belgeleme amacli, hicbir DDL yok): jobs.requester_id,
-- operations.requester_id, offers.provider_id, ratings.provider_id,
-- ratings.rater_id, provider_documents.provider_id, provider_badges.
-- provider_id, provider_service_authorizations.provider_id, provider_
-- document_reviews.provider_id, job_photos.uploaded_by. provider_profiles.
-- user_id ve provider_services.provider_id zaten CASCADE idi (0003/0002),
-- dokunulmadi.
-- -----------------------------------------------------------------------------
