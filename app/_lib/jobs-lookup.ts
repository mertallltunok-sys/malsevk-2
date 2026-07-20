import { findUserCreatedJobById } from "./job-store";
import { getJobById as getSeedJobById } from "./jobs";
import type { Job } from "./types";

/**
 * İlanlar iki kaynaktan gelir (sabit örnek ilanlar + kullanıcı tarafından
 * oluşturulanlar). Tek, paylaşılan arama noktası — offers.ts ve
 * contact-access.ts gibi birden fazla modül aynı mantığı tekrarlamaz.
 */
export function findJobById(id: string): Job | null {
  return findUserCreatedJobById(id) ?? getSeedJobById(id);
}
