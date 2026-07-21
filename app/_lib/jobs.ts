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
 * Yalnızca bilgilendirme amaçlı: çalışma tarihi bugünden önceyse true
 * döner. Hiçbir işlemi engellemez, hiçbir alanı değiştirmez — yalnızca
 * arayüzde küçük bir öneri notu göstermek için kullanılır. Karşılaştırma
 * gün bazındadır (saat bilgisi yok sayılır).
 */
export function isJobDateInPast(workDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jobDate = new Date(workDate);
  jobDate.setHours(0, 0, 0, 0);
  return jobDate.getTime() < today.getTime();
}
