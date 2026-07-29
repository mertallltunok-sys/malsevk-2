import type { LegalDocumentSection } from "./legal-documents";

/**
 * KVKK Aydınlatma Metni'nin gerçek hukuki metni — TEK kaynak burasıdır (bkz.
 * legal-documents.ts'deki sürüm/tarih kaydı). 6698 sayılı Kanun'un 10.
 * maddesinin öngördüğü zorunlu aydınlatma formatını izler; Gizlilik
 * Politikası'ndan (legal-content-privacy.ts) KASITLI olarak ayrı bir
 * belgedir — bkz. o dosyanın başındaki not.
 */
export const KVKK_SECTIONS: LegalDocumentSection[] = [
  {
    heading: "1. Veri Sorumlusunun Kimliği",
    paragraphs: [
      "6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (“KVKK”) 10. maddesi uyarınca, MALSEVK.COM (“Platform”) üzerinden işlenen kişisel verileriniz bakımından veri sorumlusu sıfatını taşıyan [Şirket Unvanı] (“MALSEVK”, adres: [Şirket Adresi], MERSİS No: [MERSİS Numarası], KEP adresi: [KEP Adresi]) tarafından aşağıdaki hususlarda aydınlatılmaktasınız.",
    ],
  },
  {
    heading: "2. İşlenen Kişisel Veri Kategorileri",
    paragraphs: [
      "Platform'a üye olmanız ve Platform'u kullanmanız kapsamında aşağıdaki kişisel veri kategorileriniz işlenmektedir:",
    ],
    list: [
      "Kimlik: ad, soyad.",
      "İletişim: e-posta adresi, telefon numarası.",
      "Mesleki Deneyim/Müşteri İşlem: firma unvanı ve türü, faaliyet gösterilen il/ilçe, hizmet kategorisi/uzmanlık bilgisi, ilan ve teklif geçmişi, değerlendirme puanı ve yorumları.",
      "Görsel/İşitsel Kayıtlar: ilan kapsamında yüklenen fotoğraflar, varsa firma logosu.",
      "İşlem Güvenliği: şifrelenmiş kimlik doğrulama verisi, IP adresi, cihaz/tarayıcı bilgisi, erişim zaman damgası.",
      "Lokasyon: hizmetin görüleceği il/ilçe/bölge düzeyinde konum bilgisi.",
    ],
  },
  {
    heading: "3. Kişisel Verilerin İşlenme Amaçları",
    paragraphs: [
      "Kişisel verileriniz; Platform üyeliğinizin kurulması ve yürütülmesi, ilan/teklif eşleştirme sürecinin işletilmesi, kabul edilen bir teklif sonrasında tarafların birbiriyle iletişime geçebilmesinin sağlanması, Platform'un ve hesabınızın güvenliğinin temini, talep ve şikâyetlerinizin yönetilmesi, yasal yükümlülüklerin yerine getirilmesi ile Platform hizmetlerinin geliştirilmesi ve istatistiksel değerlendirme amaçlarıyla işlenmektedir.",
    ],
  },
  {
    heading: "4. Kişisel Verilerin Toplanma Yöntemi ve Hukuki Sebebi",
    paragraphs: [
      "Kişisel verileriniz, Platform'a üye olurken ve Platform'u kullanırken doldurduğunuz formlar, yüklediğiniz içerikler ve Platform ile etkileşiminiz yoluyla elektronik ortamda doğrudan sizden; site erişim güvenliğine ilişkin teknik veriler ise Platform altyapısı tarafından otomatik olarak toplanmaktadır.",
      "Kişisel verileriniz, KVKK'nın 5. maddesinin ikinci fıkrasında yer alan “bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olma”, “veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olma”, “bir hakkın tesisi, kullanılması veya korunması için veri işlemenin zorunlu olması” ve “ilgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaati için veri işlenmesinin zorunlu olması” hukuki sebeplerine dayanılarak işlenmektedir. Bu sebeplerin yeterli olmadığı istisnai işleme faaliyetleri için ayrıca açık rızanız alınır.",
    ],
  },
  {
    heading: "5. Kişisel Verilerin Aktarılabileceği Alıcı Grupları",
    paragraphs: [
      "Kişisel verileriniz; kabul edilen bir teklif kapsamında yalnızca ilgili karşı tarafa (sınırlı iletişim bilgisi ile), Platform'un teknik altyapı/barındırma hizmeti aldığı tedarikçilere, yetkili kamu kurum ve kuruluşlarına (yasal talep hâlinde) ve hukuki uyuşmazlık süreçlerinde danışmanlık alınan taraflara, KVKK'nın 8. ve 9. maddelerinde öngörülen şartlarla sınırlı olmak üzere aktarılabilir.",
    ],
  },
  {
    heading: "6. İlgili Kişinin (Veri Sahibinin) Hakları",
    paragraphs: [
      "KVKK'nın 11. maddesi uyarınca veri sorumlusuna başvurarak aşağıdaki haklara sahipsiniz:",
    ],
    list: [
      "Kişisel verinizin işlenip işlenmediğini öğrenme.",
      "İşlenmişse buna ilişkin bilgi talep etme.",
      "İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme.",
      "Yurt içinde/yurt dışında aktarıldığı üçüncü kişileri bilme.",
      "Eksik/yanlış işlenmişse düzeltilmesini isteme.",
      "Silinmesini veya yok edilmesini isteme.",
      "Düzeltme/silme/yok etme işlemlerinin verinin aktarıldığı üçüncü kişilere bildirilmesini isteme.",
      "Münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonuç doğmasına itiraz etme.",
      "Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme.",
    ],
  },
  {
    heading: "7. Başvuru Usulü",
    paragraphs: [
      "Bu haklarınıza ilişkin taleplerinizi, kimliğinizi tevsik edici belgelerle birlikte [Başvuru E-posta Adresi] adresine kayıtlı e-posta adresinizden veya KVKK'nın 13. maddesi ile Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'de öngörülen diğer yöntemlerle iletebilirsiniz. Başvurunuz, niteliğine göre en geç 30 (otuz) gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet doğurması hâlinde Kişisel Verileri Koruma Kurulu tarafından belirlenen tarifedeki ücret talep edilebilir.",
    ],
  },
  {
    heading: "8. Aydınlatma Metninde Değişiklik",
    paragraphs: [
      "İşbu Aydınlatma Metni, mevzuat değişiklikleri veya Platform'un veri işleme faaliyetlerindeki güncellemeler doğrultusunda revize edilebilir. Güncel sürüm ve yürürlük tarihi işbu belgenin başında belirtilir.",
    ],
  },
];
