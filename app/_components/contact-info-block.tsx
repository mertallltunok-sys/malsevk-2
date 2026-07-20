import { Mail, Phone, User } from "lucide-react";
import type { ContactInfo } from "../_lib/contact-access";

export function ContactInfoBlock({ contact }: { contact: ContactInfo }) {
  return (
    <div className="mt-4 rounded-md border border-success/30 bg-success-soft p-4">
      <p className="text-sm font-semibold text-foreground">İletişim Bilgileri</p>
      <dl className="mt-3 flex flex-col gap-2 text-sm text-foreground">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <dt className="sr-only">Yetkili</dt>
          <dd>{contact.name}</dd>
        </div>
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
      </dl>
    </div>
  );
}
