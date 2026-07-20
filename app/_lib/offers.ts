import { findJobById } from "./jobs-lookup";
import { isJobOpenForOffers } from "./jobs";
import { MAX_OFFER_AMOUNT, hasAtMostTwoDecimals } from "./money";
import type { Currency, Offer, Session } from "./types";

const OFFERS_STORAGE_KEY = "malsevk.offers.v1";

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedOffers: Offer[] = [];
let hasCached = false;

function isOffer(value: unknown): value is Offer {
  if (typeof value !== "object" || value === null) return false;
  const offer = value as Record<string, unknown>;
  return (
    typeof offer.id === "string" &&
    typeof offer.jobId === "string" &&
    typeof offer.providerId === "string" &&
    typeof offer.amount === "number" &&
    (offer.currency === "TRY" || offer.currency === "USD") &&
    typeof offer.description === "string" &&
    typeof offer.estimatedDuration === "string" &&
    (offer.status === "pending" ||
      offer.status === "accepted" ||
      offer.status === "rejected") &&
    typeof offer.createdAt === "string" &&
    typeof offer.updatedAt === "string"
  );
}

function readAllOffersSnapshot(): Offer[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(OFFERS_STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (hasCached && raw === cachedRaw) return cachedOffers;

  let parsed: Offer[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter(isOffer);
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedOffers = parsed;
  hasCached = true;
  return parsed;
}

function getServerOffersSnapshot(): Offer[] {
  return [];
}

function subscribeToOffers(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function writeAllOffers(offers: Offer[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OFFERS_STORAGE_KEY, JSON.stringify(offers));
  cachedRaw = null;
  hasCached = false;
  notify();
}

export const offersStore = {
  subscribe: subscribeToOffers,
  getSnapshot: readAllOffersSnapshot,
  getServerSnapshot: getServerOffersSnapshot,
};

export function getAllOffers(): Offer[] {
  return readAllOffersSnapshot();
}

export function getOffersByProvider(providerId: string): Offer[] {
  return readAllOffersSnapshot()
    .filter((offer) => offer.providerId === providerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOfferForJob(jobId: string, providerId: string): Offer | null {
  return (
    readAllOffersSnapshot().find(
      (offer) => offer.jobId === jobId && offer.providerId === providerId,
    ) ?? null
  );
}

export function getOfferStatusLabel(status: Offer["status"]): string {
  switch (status) {
    case "pending":
      return "Beklemede";
    case "accepted":
      return "Kabul Edildi";
    case "rejected":
      return "Reddedildi";
  }
}

export function getOfferStatusTone(
  status: Offer["status"],
): "warning" | "success" | "danger" {
  switch (status) {
    case "pending":
      return "warning";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
  }
}

export type CreateOfferInput = {
  jobId: string;
  amount: number;
  currency: Currency;
  description: string;
  estimatedDuration: string;
};

export type CreateOfferResult =
  | { ok: true; offer: Offer }
  | { ok: false; error: string };

/**
 * Teklif oluşturma iş kurallarının tamamı burada, arayüzden bağımsız
 * olarak uygulanır: rol kontrolü, ilan durumu, para birimi, fiyat ve
 * mükerrer teklif kontrolü. Arayüz yalnızca bu sonucu gösterir; kuralları
 * tekrar yazmaz. `status` alanı bilerek CreateOfferInput'ta yok — teklif
 * durumu her zaman bu fonksiyon tarafından "pending" olarak atanır.
 */
export function createOffer(
  session: Session | null,
  input: CreateOfferInput,
): CreateOfferResult {
  if (!session) {
    return { ok: false, error: "Teklif vermek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar teklif verebilir." };
  }

  const job = findJobById(input.jobId);
  if (!job) {
    return { ok: false, error: "İlan bulunamadı veya artık yayında değil." };
  }
  if (!isJobOpenForOffers(job.status)) {
    return { ok: false, error: "Bu ilan artık teklif almaya açık değil." };
  }

  if (input.currency !== "TRY" && input.currency !== "USD") {
    return { ok: false, error: "Geçersiz para birimi." };
  }

  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_OFFER_AMOUNT ||
    !hasAtMostTwoDecimals(input.amount)
  ) {
    return { ok: false, error: "Geçerli bir teklif fiyatı giriniz." };
  }

  const description = input.description.trim();
  if (description.length < 20 || description.length > 1000) {
    return { ok: false, error: "Teklif açıklaması geçersiz." };
  }

  const estimatedDuration = input.estimatedDuration.trim();
  if (estimatedDuration.length < 2 || estimatedDuration.length > 100) {
    return { ok: false, error: "Tahmini hizmet süresi geçersiz." };
  }

  const all = readAllOffersSnapshot();
  const alreadyExists = all.some(
    (offer) => offer.jobId === input.jobId && offer.providerId === session.id,
  );
  if (alreadyExists) {
    return { ok: false, error: "Bu ilana daha önce teklif verdiniz." };
  }

  const now = new Date().toISOString();
  const offer: Offer = {
    id: crypto.randomUUID(),
    jobId: input.jobId,
    providerId: session.id,
    amount: input.amount,
    currency: input.currency,
    description,
    estimatedDuration,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  writeAllOffers([...all, offer]);
  return { ok: true, offer };
}

export type UpdateOfferStatusResult =
  | { ok: true; offer: Offer }
  | { ok: false; error: string };

/**
 * Teklif kabul/ret işlemi de arayüzden bağımsız burada doğrulanır: yalnızca
 * teklifin verildiği ilanın sahibi olan Hizmet Alan işlem yapabilir, yalnızca
 * "pending" durumundaki bir teklif değiştirilebilir.
 */
export function updateOfferStatus(
  session: Session | null,
  offerId: string,
  nextStatus: "accepted" | "rejected",
): UpdateOfferStatusResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar teklif durumunu değiştirebilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "pending") {
    return { ok: false, error: "Bu teklif zaten değerlendirilmiş." };
  }

  const updated: Offer = { ...offer, status: nextStatus, updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}
