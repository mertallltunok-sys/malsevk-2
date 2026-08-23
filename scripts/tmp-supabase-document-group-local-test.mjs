// LOCAL Docker Supabase only — validates migration 0044 (provider document
// authorization groups): a SINGLE "depo-hizmetleri-belgesi" document
// approval must authorize all 12 storage sub-categories; a SINGLE
// "operator-is-makinesi-belgesi" approval must authorize all 8 equipment/
// operator sub-categories; job categories outside those two groups must
// remain unaffected; duplicate-pending protection must hold.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const URL = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "TestSifre2026!";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + String(detail).slice(0, 200) : ""));
}
function psql(sql) {
  return execSync(`docker exec supabase_db_malsevk-2 psql -U postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const client = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const STORAGE_CATEGORIES = ["ellecleme", "genel-depolama", "acik-saha-depolama", "kapali-depolama", "antrepo-gumruklu", "gecici-depolama", "konteyner-depolama", "dokme-yuk-depolama", "proje-yuku-depolama", "soguk-hava-depolama", "kimyasal-depolama", "tehlikeli-madde-depolama"];
const EQUIPMENT_CATEGORIES = ["forklift", "reach-stacker", "vinc", "manlift", "forklift-operatoru", "reach-stacker-operatoru", "vinc-operatoru", "manlift-operatoru"];

const stamp = Date.now();
let adminId, providerAId, providerBId;

try {
  const { data: adata, error: aerr } = await admin.auth.admin.createUser({ email: `grptest-admin-${stamp}@example.com`, password: PASSWORD, email_confirm: true });
  if (aerr) throw aerr;
  adminId = adata.user.id;
  const { data: padata, error: paerr } = await admin.auth.admin.createUser({ email: `grptest-provA-${stamp}@example.com`, password: PASSWORD, email_confirm: true });
  if (paerr) throw paerr;
  providerAId = padata.user.id;
  const { data: pbdata, error: pberr } = await admin.auth.admin.createUser({ email: `grptest-provB-${stamp}@example.com`, password: PASSWORD, email_confirm: true });
  if (pberr) throw pberr;
  providerBId = pbdata.user.id;
  record("3 test hesabı oluşturuldu", true);

  psql(`update public.profiles set role='admin', full_name='Group Test Admin', onboarding_completed=true where id = '${adminId}';`);

  const adminClient = client();
  await adminClient.auth.signInWithPassword({ email: `grptest-admin-${stamp}@example.com`, password: PASSWORD });
  const providerAClient = client();
  await providerAClient.auth.signInWithPassword({ email: `grptest-provA-${stamp}@example.com`, password: PASSWORD });
  const providerBClient = client();
  await providerBClient.auth.signInWithPassword({ email: `grptest-provB-${stamp}@example.com`, password: PASSWORD });

  await providerAClient.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Provider A", p_phone: "+905321110011", p_company_name: "Provider A Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "İzmit" });
  await providerBClient.rpc("complete_registration", { p_role: "hizmet-veren", p_full_name: "Provider B", p_phone: "+905321110012", p_company_name: "Provider B Co", p_company_type: "limited-sirket", p_province: "Kocaeli", p_district: "Gebze" });

  // ===== TEST A: Depo Hizmetleri group document =====
  {
    const { data, error } = await providerAClient.rpc("create_provider_document", {
      p_document_type: "depo-hizmetleri-belgesi", p_storage_path: `${providerAId}/depo-belgesi.pdf`,
      p_original_file_name: "depo-belgesi.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 12345,
    });
    record("A1) Provider A: depo-hizmetleri-belgesi create_provider_document PASSES (service_category_id=NULL, ML124 tetiklenmiyor)", !error && !!data?.id, error?.message);
    var depoDocId = data?.id;
  }
  {
    // Duplicate pending protection
    const { error } = await providerAClient.rpc("create_provider_document", {
      p_document_type: "depo-hizmetleri-belgesi", p_storage_path: `${providerAId}/depo-belgesi-2.pdf`,
      p_original_file_name: "depo-belgesi-2.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 111,
    });
    record("A2) Aynı grup belgesi PENDING iken ikinci kez yüklenemiyor (duplicate koruması)", !!error && /duplicate key|unique/i.test(error.message), error?.message);
  }
  {
    const { error } = await adminClient.rpc("review_provider_document", { p_document_id: depoDocId, p_status: "approved" });
    record("A3) Admin depo-hizmetleri-belgesi'ni onaylıyor", !error, error?.message);
  }
  {
    const rows = psql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerAId}' and revoked_at is null order by service_category_id;`);
    const authorized = rows.split("\n").map((s) => s.trim()).filter(Boolean);
    const allPresent = STORAGE_CATEGORIES.every((c) => authorized.includes(c));
    const noExtra = authorized.every((c) => STORAGE_CATEGORIES.includes(c));
    record("A4) TEK belge onayı SONRASI Provider A'nın TÜM 12 depo kategorisi authorize edildi (fazlası/eksiği yok)", allPresent && noExtra, `authorized=${authorized.join(",")}`);
  }
  {
    const canForklift = await psql(`select public.provider_can_view_category('${providerAId}', 'forklift');`);
    const canStorage = await psql(`select public.provider_can_view_category('${providerAId}', 'kapali-depolama');`);
    record("A5) Provider A forklift ilanlarını GÖREMİYOR ama kapali-depolama ilanlarını GÖREBİLİYOR (gruplar birbirine karışmadı)", canForklift.trim() === "f" && canStorage.trim() === "t", `forklift=${canForklift} storage=${canStorage}`);
  }

  // ===== TEST B: Operatör/İş Makinesi group document =====
  {
    const { data, error } = await providerBClient.rpc("create_provider_document", {
      p_document_type: "operator-is-makinesi-belgesi", p_storage_path: `${providerBId}/operator-belgesi.pdf`,
      p_original_file_name: "operator-belgesi.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 12345,
    });
    record("B1) Provider B: operator-is-makinesi-belgesi create_provider_document PASSES", !error && !!data?.id, error?.message);
    var operatorDocId = data?.id;
  }
  {
    const { error } = await adminClient.rpc("review_provider_document", { p_document_id: operatorDocId, p_status: "approved" });
    record("B2) Admin operator-is-makinesi-belgesi'ni onaylıyor", !error, error?.message);
  }
  {
    const rows = psql(`select service_category_id from public.provider_service_authorizations where provider_id = '${providerBId}' and revoked_at is null order by service_category_id;`);
    const authorized = rows.split("\n").map((s) => s.trim()).filter(Boolean);
    const allPresent = EQUIPMENT_CATEGORIES.every((c) => authorized.includes(c));
    const noExtra = authorized.every((c) => EQUIPMENT_CATEGORIES.includes(c));
    record("B3) TEK belge onayı SONRASI Provider B'nin TÜM 8 operatör/iş makinesi kategorisi authorize edildi", allPresent && noExtra, `authorized=${authorized.join(",")}`);
  }
  {
    const canDepo = await psql(`select public.provider_can_view_category('${providerBId}', 'kapali-depolama');`);
    const canLashing = await psql(`select public.provider_can_view_category('${providerBId}', 'lashing-unlashing');`);
    const canForklift = await psql(`select public.provider_can_view_category('${providerBId}', 'forklift');`);
    record("B4) Provider B depo/lashing GÖREMİYOR, forklift GÖREBİLİYOR", canDepo.trim() === "f" && canLashing.trim() === "f" && canForklift.trim() === "t", `depo=${canDepo} lashing=${canLashing} forklift=${canForklift}`);
  }

  // ===== Legacy compatibility: old-style leaf document still works unaffected =====
  {
    await providerAClient.rpc("set_provider_service_categories", { p_category_ids: [...STORAGE_CATEGORIES, "nakliye"] });
    const { data, error } = await providerAClient.rpc("create_provider_document", {
      p_document_type: "genel", p_storage_path: `${providerAId}/nakliye-belgesi.pdf`,
      p_original_file_name: "nakliye-belgesi.pdf", p_mime_type: "application/pdf", p_extension: "pdf", p_size_bytes: 999,
      p_service_category_id: "nakliye",
    });
    record("L1) Eski usul TEK-kategori 'genel' belge (Nakliye) hâlâ çalışıyor (bozulmadı)", !error && !!data?.id, error?.message);
    if (data?.id) {
      const { error: reviewErr } = await adminClient.rpc("review_provider_document", { p_document_id: data.id, p_status: "approved" });
      record("L2) Admin bu eski usul belgeyi onaylıyor, hata yok", !reviewErr, reviewErr?.message);
      const nakliyeAuth = await psql(`select public.provider_can_view_category('${providerAId}', 'nakliye');`);
      record("L3) Onay sonrası Provider A nakliye ilanlarını da görebiliyor (grup mantığı eski akışı bozmadı)", nakliyeAuth.trim() === "t", nakliyeAuth);
    }
  }

} catch (e) {
  record("BEKLENMEYEN İSTİSNA", false, e?.message || String(e));
} finally {
  try { if (adminId) await admin.auth.admin.deleteUser(adminId); } catch {}
  try {
    if (providerAId) {
      psql(`delete from public.provider_service_authorizations where provider_id = '${providerAId}'; delete from public.provider_documents where provider_id = '${providerAId}'; delete from public.provider_services where provider_id = '${providerAId}';`);
      await admin.auth.admin.deleteUser(providerAId);
    }
  } catch {}
  try {
    if (providerBId) {
      psql(`delete from public.provider_service_authorizations where provider_id = '${providerBId}'; delete from public.provider_documents where provider_id = '${providerBId}'; delete from public.provider_services where provider_id = '${providerBId}';`);
      await admin.auth.admin.deleteUser(providerBId);
    }
  } catch {}
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== ${passCount}/${results.length} PASS ===`);
if (passCount !== results.length) process.exit(1);
