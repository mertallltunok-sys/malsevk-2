import { formatLegalDate, getLegalDocumentMeta, type LegalDocumentId } from "../_lib/legal-documents";

/**
 * Bir hukuki metnin (Gizlilik Politikası/Kullanım Koşulları/KVKK Aydınlatma
 * Metni) TEK ortak render'ı — büyük başlık, sürüm/yürürlük/güncelleme tarihi
 * satırı ve tam metin. Hem `legal-document-modal.tsx` (footer'dan/kayıt
 * formundan açılan modal) hem de `app/gizlilik-politikasi` vb. bağımsız
 * sayfalar bu bileşeni kullanır — metin/başlık/tarih İKİ yerde ayrı ayrı
 * yazılmaz, tek kaynak `legal-documents.ts`/`legal-content-*.ts`dir.
 */
export function LegalDocumentContent({
  documentId,
  titleId,
}: {
  documentId: LegalDocumentId;
  /** Modal'da `aria-labelledby` için; bağımsız sayfada verilmezse başlık yalnızca görsel `<h1>` olarak render edilir. */
  titleId?: string;
}) {
  const meta = getLegalDocumentMeta(documentId);

  return (
    <div>
      <h1 id={titleId} className="text-2xl font-bold tracking-heading leading-tight text-foreground sm:text-3xl">
        {meta.title}
      </h1>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-background px-4 py-3 text-sm sm:grid-cols-3">
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Sürüm</dt>
          <dd className="font-semibold text-foreground">{meta.version}</dd>
        </div>
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Yürürlük Tarihi</dt>
          <dd className="font-semibold text-foreground">{formatLegalDate(meta.effectiveDate)}</dd>
        </div>
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
          <dt className="font-medium text-muted-foreground">Son Güncelleme</dt>
          <dd className="font-semibold text-foreground">{formatLegalDate(meta.lastUpdatedDate)}</dd>
        </div>
      </dl>

      <hr className="my-6 border-border" />

      <div className="flex flex-col gap-6">
        {meta.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-base font-bold tracking-heading leading-tight text-foreground">{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {section.list && (
              <ul className="ml-1 flex list-disc flex-col gap-1.5 pl-4">
                {section.list.map((item, index) => (
                  <li key={index} className="text-sm leading-relaxed text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
