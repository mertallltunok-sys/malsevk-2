import { Mail, Phone, User } from "lucide-react";
import type { ContactInfo } from "../_lib/contact-access";

/**
 * `contact.phone`/`contact.email` `null` olabilir — karşı tarafın "İletişim
 * Bilgisi Görünürlüğü" tercihinde bu alanı kapatmış olması demektir (bkz.
 * contact-access.ts#applyContactVisibility). `name` bu tercihe hiç tabi
 * değildir, her zaman gösterilir. Her iki alan da `null` ise boş satır/
 * "undefined" göstermek yerine tek, kurumsal bir açıklama satırına düşülür.
 */
export function ContactInfoBlock({ contact }: { contact: ContactInfo }) {
  const hasPhone = contact.phone !== null;
  const hasEmail = contact.email !== null;

  if (!hasPhone && !hasEmail) {
    return (
      <div className="mt-4 rounded-md border border-border bg-background p-4">
        <p className="text-sm font-bold tracking-heading leading-tight text-foreground">İletişim Bilgileri</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-4 w-4 shrink-0" aria-hidden="true" />
          {contact.name}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Kullanıcı iletişim bilgilerini paylaşmamayı tercih etti.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-success/30 bg-success-soft p-4">
      <p className="text-sm font-bold tracking-heading leading-tight text-foreground">İletişim Bilgileri</p>
      <dl className="mt-3 flex flex-col gap-2 text-sm text-foreground">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <dt className="sr-only">Yetkili</dt>
          <dd>{contact.name}</dd>
        </div>
        {hasPhone && (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <dt className="sr-only">Telefon</dt>
            <dd>
              <a
                href={`tel:${contact.phone}`}
                className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
              >
                {contact.phone}
              </a>
            </dd>
          </div>
        )}
        {hasEmail && (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <dt className="sr-only">E-posta</dt>
            <dd>
              <a
                href={`mailto:${contact.email}`}
                className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
              >
                {contact.email}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
