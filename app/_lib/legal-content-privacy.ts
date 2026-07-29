import type { LegalDocumentSection } from "./legal-documents";

/**
 * Gizlilik Politikası'nın gerçek hukuki metni — TEK kaynak burasıdır (bkz.
 * legal-documents.ts'deki sürüm/tarih kaydı ve legal-content-terms.ts'nin
 * başındaki aynı mimari not). KVKK Aydınlatma Metni (legal-content-kvkk.ts)
 * ile kasıtlı olarak AYRI bir belgedir: bu politika Platform'un genel
 * gizlilik/çerez/veri güvenliği yaklaşımını geniş kapsamda anlatır; KVKK
 * Aydınlatma Metni ise 6698 sayılı Kanun'un 10. maddesinin öngördüğü dar
 * kapsamlı, zorunlu aydınlatma formatını izler. İçerik örtüşse de amaç ve
 * biçim farklı olduğundan iki ayrı metin olarak tutulur.
 */
export const PRIVACY_POLICY_SECTIONS: LegalDocumentSection[] = [
  {
    heading: "1. Amaç ve Kapsam",
    paragraphs: [
      "İşbu Gizlilik Politikası, MALSEVK.COM (“Platform”) üzerinden sunulan hizmetler kapsamında Kullanıcıların kişisel verilerinin hangi amaçlarla, hangi yöntemlerle işlendiğini, kimlerle paylaşılabileceğini ve Kullanıcıların bu kapsamdaki haklarını açıklamak amacıyla hazırlanmıştır.",
      "İşbu Politika, Platform'a üye olan Hizmet Alan ve Hizmet Veren kullanıcıları ile Platform'u üye olmadan ziyaret eden kullanıcıları kapsar. Kişisel verilerin işlenmesine ilişkin 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca yapılması zorunlu aydınlatma, ayrıca KVKK Aydınlatma Metni'nde yer almaktadır; işbu Politika ile KVKK Aydınlatma Metni birlikte değerlendirilmelidir.",
    ],
  },
  {
    heading: "2. Veri Sorumlusu",
    paragraphs: [
      "Platform üzerinden toplanan kişisel veriler bakımından veri sorumlusu, Platform'un işletmecisi [Şirket Unvanı]'dır (“MALSEVK”, adres: [Şirket Adresi], MERSİS No: [MERSİS Numarası]).",
    ],
  },
  {
    heading: "3. Toplanan Kişisel Veri Kategorileri",
    paragraphs: [
      "Platform üzerinden, hizmetin niteliğine bağlı olarak aşağıdaki kategorilerde kişisel veriler işlenebilir:",
    ],
    list: [
      "Kimlik Bilgileri: ad, soyad.",
      "İletişim Bilgileri: e-posta adresi, telefon numarası.",
      "Müşteri/Firma Bilgileri: firma unvanı, firma türü, faaliyet ili/ilçesi, sektörel uzmanlık/hizmet kategorileri.",
      "İşlem Güvenliği Bilgileri: şifrelenmiş/özetlenmiş kimlik doğrulama verisi (parola özeti), oturum bilgisi.",
      "İlan ve Teklif Bilgileri: yayınlanan ilan içeriği, teklif tutarı ve açıklaması, iş süreci durumu, tamamlanma/anlaşmazlık notları, değerlendirme (puan/yorum) bilgisi.",
      "Görsel Veriler: ilan fotoğrafları ve varsa firma logosu (kişisel veri niteliğinde bilgi barındırmaması için, yüklenen fotoğrafların konum/cihaz meta verileri Platform tarafından otomatik olarak temizlenir).",
      "Konum Bilgisi: hizmetin görüleceği il/ilçe/bölge düzeyinde konum bilgisi (hassas coğrafi konum verisi toplanmaz).",
      "İşlem Güvenliği ve Log Kayıtları: IP adresi, tarayıcı/cihaz bilgisi, erişim zaman damgası (yalnızca site erişim güvenliği ve yasal saklama yükümlülükleri kapsamında).",
    ],
  },
  {
    heading: "4. Kişisel Verilerin Toplanma Yöntemi ve Hukuki Sebebi",
    paragraphs: [
      "Kişisel veriler, Kullanıcının Platform'a üye olması, ilan/teklif oluşturması, formları doldurması veya Platform'u kullanması sırasında elektronik ortamda doğrudan Kullanıcı tarafından sağlanan bilgiler yoluyla toplanır. Site erişim güvenliğine ilişkin teknik veriler (IP, cihaz bilgisi) ise Platform altyapısı tarafından otomatik olarak kaydedilir.",
      "Kişisel veriler, KVKK'nın 5. ve 6. maddelerinde belirtilen aşağıdaki hukuki sebeplere dayanılarak işlenir: bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması (üyelik ve hizmet ilişkisinin yürütülmesi), veri sorumlusunun hukuki yükümlülüğünü yerine getirmesi (mevzuata uyum, yetkili merci taleplerinin karşılanması), bir hakkın tesisi, kullanılması veya korunması için zorunlu olması (uyuşmazlık/itiraz süreçlerinin yönetimi) ve ilgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaati (Platform güvenliğinin ve hizmet kalitesinin sağlanması). Açık rıza gerektiren işleme faaliyetleri (varsa) için ayrıca ve açıkça rıza alınır.",
    ],
  },
  {
    heading: "5. Kişisel Verilerin İşlenme Amaçları",
    paragraphs: [
      "Toplanan kişisel veriler aşağıdaki amaçlarla işlenir:",
    ],
    list: [
      "Üyelik işlemlerinin gerçekleştirilmesi ve hesap güvenliğinin sağlanması.",
      "Hizmet Alan ile Hizmet Veren arasındaki ilan/teklif eşleşme sürecinin yürütülmesi.",
      "Kabul edilen bir teklif sonrasında tarafların birbiriyle iletişime geçebilmesi amacıyla sınırlı iletişim bilgisinin karşı tarafa gösterilmesi.",
      "Platform'un işlevselliğinin, güvenliğinin ve performansının sağlanması, kötüye kullanımın önlenmesi.",
      "Kullanıcı taleplerinin/şikâyetlerinin yanıtlanması ve uyuşmazlık süreçlerinin yönetilmesi.",
      "Yasal yükümlülüklerin (ör. yetkili mercilerin bilgi talepleri) yerine getirilmesi.",
      "İstatistiksel analiz ve Platform'un geliştirilmesi (bu amaçla kullanılan veriler mümkün olduğunca toplulaştırılmış/anonimleştirilmiş şekilde işlenir).",
    ],
  },
  {
    heading: "6. Kişisel Verilerin Aktarılması",
    paragraphs: [
      "Kişisel veriler, kural olarak yalnızca Platform'un işleyişi için gerekli ölçüde ve aşağıdaki alıcı gruplarına aktarılabilir: kabul edilen bir teklif kapsamında karşı taraf (yalnızca iletişim bilgisi, ilgili teklif kabul edilene kadar gizli tutulur), Platform'un teknik altyapısını sağlayan barındırma/bulut hizmeti sağlayıcıları, yetkili kamu kurum ve kuruluşları (yasal talep halinde) ve MALSEVK'in hukuki danışmanlık aldığı taraflar (uyuşmazlık süreçlerinde, gerektiği ölçüde).",
      "Kişisel veriler, yukarıda sayılanlar dışında üçüncü kişilerle ticari amaçlarla paylaşılmaz, satılmaz veya kiralanmaz. Yurt dışına veri aktarımı yalnızca KVKK'nın 9. maddesinde öngörülen şartların (yeterli korumanın bulunduğu ülke, uygun güvence mekanizmaları vb.) sağlanması halinde ve gerekli olduğu ölçüde yapılır.",
    ],
  },
  {
    heading: "7. Veri Güvenliği Önlemleri",
    paragraphs: [
      "MALSEVK, kişisel verilerin hukuka aykırı olarak işlenmesini ve verilere hukuka aykırı erişilmesini önlemek, verilerin muhafazasını sağlamak amacıyla uygun teknik ve idari tedbirleri alır.",
      "Kullanıcı hesap şifreleri düz metin olarak değil, tek yönlü özetleme (hash) yöntemiyle saklanır; Platform bu şifreleri hiçbir şekilde okunabilir biçimde tutmaz. İlan fotoğrafları sunucu tarafında işlenirken konum/cihaz gibi meta veriler otomatik olarak temizlenir.",
      "Kullanıcı oturum ve tercih bilgilerinin önemli bir kısmı, Kullanıcının kendi cihazında (tarayıcı depolama alanında) tutulur; bu veriler MALSEVK sunucularına iletilmez ve yalnızca ilgili tarayıcı/cihaz üzerinde erişilebilir durumdadır.",
    ],
  },
  {
    heading: "8. Çerezler ve Benzer Teknolojiler",
    paragraphs: [
      "Platform, temel işlevlerin (ör. oturum durumunun hatırlanması, site erişim güvenliği) sağlanabilmesi için zorunlu/teknik nitelikte sınırlı sayıda çerez veya benzeri depolama teknolojisi kullanabilir. Bu teknik veriler pazarlama/reklam amacıyla üçüncü kişilerle paylaşılmaz.",
      "Platform, işbu Politika'nın yürürlük tarihi itibarıyla üçüncü taraf reklam/izleme çerezi kullanmamaktadır; bu konuda ileride bir değişiklik yapılması halinde işbu Politika güncellenerek Kullanıcılara duyurulur.",
    ],
  },
  {
    heading: "9. Kişisel Verilerin Saklanma Süresi",
    paragraphs: [
      "Kişisel veriler, işlenme amacının gerektirdiği süre boyunca ve ilgili mevzuatta (ör. Türk Ticaret Kanunu, vergi mevzuatı) öngörülen zamanaşımı/saklama süreleri boyunca muhafaza edilir; bu sürelerin sona ermesi halinde veriler silinir, yok edilir veya anonim hale getirilir.",
      "Hesabını kapatan bir Kullanıcının, devam eden bir hizmet ilişkisi bulunmayan verileri, yasal saklama yükümlülükleri saklı kalmak kaydıyla makul bir süre içinde silinir veya anonimleştirilir.",
    ],
  },
  {
    heading: "10. İlgili Kişinin Hakları",
    paragraphs: [
      "KVKK'nın 11. maddesi uyarınca Kullanıcı, veri sorumlusuna başvurarak aşağıdaki haklara sahiptir:",
    ],
    list: [
      "Kişisel verilerinin işlenip işlenmediğini öğrenme.",
      "Kişisel verileri işlenmişse buna ilişkin bilgi talep etme.",
      "Kişisel verilerin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme.",
      "Yurt içinde veya yurt dışında kişisel verilerin aktarıldığı üçüncü kişileri bilme.",
      "Kişisel verilerin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme.",
      "İlgili mevzuatta öngörülen şartlar çerçevesinde kişisel verilerin silinmesini veya yok edilmesini isteme.",
      "Düzeltme, silme ve yok etme işlemlerinin, kişisel verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme.",
      "İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhe bir sonucun ortaya çıkmasına itiraz etme.",
      "Kişisel verilerin kanuna aykırı olarak işlenmesi sebebiyle zarara uğraması hâlinde zararın giderilmesini talep etme.",
    ],
  },
  {
    heading: "11. Başvuru Yöntemi",
    paragraphs: [
      "Kullanıcılar, yukarıda sayılan haklarını kullanmak amacıyla taleplerini [Başvuru E-posta Adresi] adresine kayıtlı e-posta adresleri üzerinden veya KVKK'nın 13. maddesinde öngörülen diğer yöntemlerle iletebilir. Başvurular, talebin niteliğine göre en geç 30 (otuz) gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi halinde Kişisel Verileri Koruma Kurulu tarafından belirlenen tarifedeki ücret talep edilebilir.",
    ],
  },
  {
    heading: "12. Politika'da Değişiklikler",
    paragraphs: [
      "MALSEVK, işbu Gizlilik Politikası'nı mevzuat değişiklikleri veya Platform'un işleyişindeki güncellemeler doğrultusunda revize etme hakkını saklı tutar. Güncel sürüm ve yürürlük tarihi işbu belgenin başında yer alır; esaslı değişikliklerde Kullanıcılardan yeniden onay talep edilebilir.",
    ],
  },
];
