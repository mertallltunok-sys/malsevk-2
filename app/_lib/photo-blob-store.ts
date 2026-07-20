"use client";

/**
 * İlan fotoğraflarının asıl (işlenmiş) dosya içeriği burada, IndexedDB'de
 * tutulur — localStorage'ın ~5-10MB kota sınırı 10 adede kadar, her biri
 * 10MB'a kadar olabilen fotoğrafları barındıramaz. `job-store.ts`'teki Job
 * kaydı yalnızca bu depodaki blob'a işaret eden bir `storageKey` tutar.
 */

const DB_NAME = "malsevk-photo-blobs";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB bu ortamda kullanılamıyor."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB açılamadı."));
  });
}

export async function putPhotoBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Fotoğraf kaydedilemedi."));
  });
  db.close();
}

export async function getPhotoBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Fotoğraf okunamadı."));
  });
  db.close();
  return result;
}

export async function deletePhotoBlob(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Fotoğraf silinemedi."));
  });
  db.close();
}

export async function deletePhotoBlobs(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deletePhotoBlob(key)));
}
