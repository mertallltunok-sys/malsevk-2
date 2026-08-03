import type { Job, JobStatus } from "./types";

export const SERVICE_CATEGORIES = [
  "Lashing",
  "Yükleme / Boşaltma Gözetimi",
  "Konteyner Dolum",
  "Konteyner Boşaltım",
  "Forklift Operatörü",
  "Vinç Operatörü",
  "Reach Stacker Operatörü",
  "Depolama",
] as const;

const jobs: Job[] = [
  {
    id: "ilan-001",
    title: "Konteyner Sahasında Lashing Operasyonu",
    category: "Lashing",
    province: "İzmir",
    district: "Aliağa",
    workLocationType: "Liman Sahası",
    workDate: "2026-08-05",
    description:
      "İhracat yüklerinin konteyner içinde sevkiyat öncesi güvenli şekilde sabitlenmesi için deneyimli lashing ekibi aranıyor.",
    operationDetails:
      "Çalışma liman gümrüklü sahasında yapılacaktır. Kişisel koruyucu ekipman (baret, çelik burun ayakkabı, yelek) zorunludur. Saha girişi için önceden bildirilecek kimlik bilgileri gereklidir.",
    status: "yayinda",
    requesterId: null,
    photos: [],
  },
  {
    id: "ilan-002",
    title: "Fabrika Sahasında Forklift Operatörü İhtiyacı",
    category: "Forklift Operatörü",
    province: "Kocaeli",
    district: "Gebze",
    workLocationType: "Fabrika",
    workDate: "2026-08-10",
    description:
      "Üretim tesisinde palet taşıma ve sevkiyat alanı düzenlemesi için sertifikalı forklift operatörü desteği isteniyor.",
    operationDetails:
      "Geçerli forklift operatör belgesi zorunludur. Vardiya saatleri fabrika ile birlikte planlanacaktır. Ekipman tesis tarafından sağlanmaktadır.",
    status: "yayinda",
    requesterId: null,
    photos: [],
  },
  {
    id: "ilan-003",
    title: "Depo Sahası Vinç Operatörü Desteği",
    category: "Vinç Operatörü",
    province: "İstanbul",
    district: "Tuzla",
    workLocationType: "Depo",
    workDate: "2026-08-15",
    description:
      "Ağır yük indirme ve istifleme operasyonu için deneyimli vinç operatörü aranmaktadır.",
    operationDetails:
      "Operasyon kapalı depo sahasında gerçekleştirilecektir. Yükler ağır sac ve makine parçalarından oluşmaktadır. İş güvenliği eğitim sertifikası talep edilmektedir.",
    status: "yayinda",
    requesterId: null,
    photos: [],
  },
  {
    id: "ilan-004",
    title: "Konteyner Dolum ve Gözetim Hizmeti",
    category: "Konteyner Dolum",
    province: "Mersin",
    district: "Akdeniz",
    workLocationType: "Gümrüklü Saha",
    workDate: "2026-07-28",
    description:
      "İhraç ürünlerinin konteynere düzenli yerleştirilmesi ve dolum sürecinin gözetimi tamamlanmıştır.",
    operationDetails:
      "Operasyon tamamlanmış olup ilan arşivlenmiştir. Yeni teklif kabul edilmemektedir.",
    status: "tamamlandi",
    requesterId: null,
    photos: [],
  },
  {
    id: "ilan-005",
    title: "Rulo Sac Depolama Hizmeti Talebi",
    category: "Depolama",
    province: "Kocaeli",
    district: "Körfez",
    workLocationType: "Kapalı Depo",
    workDate: "2026-08-20",
    description:
      "Rulo sac ürünlerin kısa süreli kapalı depo koşullarında saklanması için uygun alan ve ekipmana sahip hizmet vereni aranıyor.",
    operationDetails:
      "Depolama süresi tahmini 30 gündür. Nem kontrolü yapılan kapalı alan gereklidir. Yükleme/boşaltma için forklift erişimi olmalıdır.",
    status: "yayinda",
    requesterId: null,
    photos: [],
  },
  {
    id: "ilan-006",
    title: "Reach Stacker Operatörü ile Konteyner Elleçleme",
    category: "Reach Stacker Operatörü",
    province: "İzmir",
    district: "Çiğli",
    workLocationType: "Serbest Bölge",
    workDate: "2026-08-01",
    description:
      "Serbest bölge sahasında konteyner istifleme ve elleçleme operasyonu için ilan iptal edilmiştir.",
    operationDetails: "İlan sahibi tarafından iptal edilmiştir. Yeni teklif alınmamaktadır.",
    status: "iptal",
    requesterId: null,
    photos: [],
  },
];

export function getJobs(): Job[] {
  return jobs;
}

export function getJobById(id: string): Job | null {
  return jobs.find((job) => job.id === id) ?? null;
}

export function isJobOpenForOffers(status: JobStatus): boolean {
  return status === "yayinda";
}

export function getJobStatusLabel(status: JobStatus): string {
  switch (status) {
    case "yayinda":
      return "Yayında";
    case "tamamlandi":
      return "Tamamlandı";
    case "iptal":
      return "İptal Edildi";
  }
}

export function getJobStatusTone(status: JobStatus): "success" | "neutral" | "danger" {
  switch (status) {
    case "yayinda":
      return "success";
    case "tamamlandi":
      return "neutral";
    case "iptal":
      return "danger";
  }
}

export function formatJobDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * `workDate`/`workEndDate` çiftinin TEK ortak gösterim biçimi — bitiş tarihi
 * yoksa (bu alandan önce oluşturulmuş eski bir ilan) ya da başlangıçla AYNI
 * güne denk geliyorsa yalnızca tek tarih gösterilir (gereksiz tekrar
 * yapılmaz); farklıysa "başlangıç - bitiş" aralığı olarak gösterilir. İki
 * tarih de ham "YYYY-MM-DD" (`<input type="date">`) biçiminde saklandığı
 * için karşılaştırma doğrudan metin eşitliğiyle yapılır — saat dilimi
 * dönüşümü riski yoktur.
 */
export function formatJobDateRange(workDate: string, workEndDate?: string): string {
  if (!workEndDate || workEndDate === workDate) return formatJobDate(workDate);
  return `${formatJobDate(workDate)} - ${formatJobDate(workEndDate)}`;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayTime(dateStr: string): number {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * İki "YYYY-MM-DD" tarihi arasındaki gün sayısını, İKİ UCU DA DAHİL ederek
 * hesaplar (ör. 03.08.2026 - 11.08.2026 = 9 gün) — job-listing-filters.ts'in
 * "saat bilgisini sıfırla, sabit bir gün-milisaniyesine böl, Math.round ile
 * yuvarla" idiomuyla AYNI temel (bkz. o dosyadaki startOfDay), yalnızca +1
 * ile bir tarih FARKI değil, uçların ikisini de sayan bir SÜRE üretir —
 * Depolama Süresi ("kaç gün depolanacak") için kullanılır (bkz.
 * job-detail-content.tsx), ama tarihe bağlı genel bir yardımcı olduğu için
 * depolamaya özel bir isim taşımaz. Geçersiz/eksik bir tarih varsa (ör.
 * `workEndDate` hiç yoksa, parse edilemiyorsa, ya da bitiş başlangıçtan
 * önceyse) yanlış bir sayı UYDURMAK yerine `null` döner — çağıran taraf bu
 * durumda süreyi hiç göstermemelidir.
 */
export function getInclusiveDayCount(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null;
  const startTime = startOfDayTime(startDate);
  const endTime = startOfDayTime(endDate);
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return null;
  return Math.round((endTime - startTime) / ONE_DAY_MS) + 1;
}

/**
 * "YYYY-MM-DD" (`<input type="date">`) metnini YEREL gece yarısına çeviren
 * yardımcı — `new Date("YYYY-MM-DD")` yerine BİLEREK kullanılır: o biçim
 * ECMAScript'te UTC gece yarısı olarak ayrıştırılır, negatif UTC ofsetli
 * (ör. ABD) bir kullanıcı için günün ilerleyen saatlerinde YEREL takvimde
 * bir gün GERİYE kayabilir (bkz. isJobDateInPast/getTodayLocalDateString'in
 * aynı kaygısı). Yıl/ay/gün bileşenlerini elle ayrıştırıp `new Date(y, m-1, d)`
 * (yerel zaman kurucusu) ile oluşturmak bu kaymayı tamamen ortadan kaldırır.
 * Ayrıştırılamayan bir girdi için `null` döner (yanlış bir tarih uydurmaz).
 */
function parseLocalDateOnly(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (!match) return null;
  const [, yearStr, monthStr, dayStr] = match;
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Kullanıcının YEREL takvim gününü "YYYY-MM-DD" biçiminde döner —
 * `<input type="date">` alanlarının `min` değeri için kullanılır.
 * `new Date().toISOString().slice(0, 10)` İLE KARIŞTIRILMAMALI: o çağrı
 * yerel saati ÖNCE UTC'ye çevirir, bu yüzden negatif UTC ofsetli bir
 * kullanıcı için günün ilerleyen saatlerinde YARININ tarihini döndürebilir
 * (bkz. parseLocalDateOnly'nin aynı kaygısı) — bu fonksiyon `getFullYear`/
 * `getMonth`/`getDate` ile doğrudan yerel bileşenleri okuyarak bu hatayı
 * önler.
 */
export function getTodayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Çalışma tarihi bugünden (yerel takvim günü) önceyse true döner —
 * hem bilgilendirme notları (ör. job-requests-panel.tsx'in "süresi geçmiş"
 * ipucu) hem de artık gerçek bir gönderim engeli olarak (bkz.
 * job-form-validation.ts#validateWorkDateRange, job-store.ts#republishJob)
 * kullanılır. Karşılaştırma gün bazındadır (saat bilgisi yok sayılır) ve
 * TAMAMEN yerel takvime göredir — bkz. parseLocalDateOnly'nin dokümanı.
 * Ayrıştırılamayan bir girdi için `false` döner (güvenli yön: belirsiz bir
 * tarihi asla "geçmiş" sayıp bir işlemi yanlışlıkla engellemez).
 */
export function isJobDateInPast(workDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jobDate = parseLocalDateOnly(workDate);
  if (!jobDate) return false;
  jobDate.setHours(0, 0, 0, 0);
  return jobDate.getTime() < today.getTime();
}

/** Gelen Teklifler ilan seçim kartlarında, aynı hizmet türündeki farklı ilanları ayırt etmek için kullanılan kısa "GG.AA" biçimi (bkz. incoming-offers-panel.tsx) — formatJobDate'in tam/uzun biçiminin AKSİNE kart genişliğine taşmadan sığar. */
export function formatShortJobDate(isoDate: string): string {
  const date = parseLocalDateOnly(isoDate) ?? new Date(isoDate);
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}
