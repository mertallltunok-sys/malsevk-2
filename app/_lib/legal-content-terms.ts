import type { LegalDocumentSection } from "./legal-documents";

/**
 * Kullanım Koşulları'nın gerçek hukuki metni — TEK kaynak burasıdır (bkz.
 * legal-documents.ts'deki sürüm/tarih kaydı). Bileşen kodu (legal-document-
 * content.tsx, sayfa/modal) bu diziyi olduğu gibi render eder, kendi metnini
 * ASLA üretmez. Sürüm değiştiğinde yalnızca bu dosya güncellenir ve
 * legal-documents.ts'deki `version`/`lastUpdatedDate` artırılır.
 *
 * "[...]" ile işaretli alanlar (ticari unvan, adres, MERSİS/Vergi No, KEP)
 * Platform işletmecisinin kesinleşmiş kurumsal bilgileriyle doldurulmalıdır
 * — bu bilgiler kod tabanında bulunmadığı için burada yer tutucu olarak
 * bırakılmıştır. Yayına almadan önce Türkiye'de yetkili bir avukat
 * tarafından son kontrolden geçirilmesi önerilir.
 */
export const TERMS_OF_SERVICE_SECTIONS: LegalDocumentSection[] = [
  {
    heading: "1. Taraflar ve Tanımlar",
    paragraphs: [
      "İşbu Kullanım Koşulları (“Koşullar”), MALSEVK.COM alan adı üzerinden erişilen elektronik platformun (“Platform”) işletmecisi [Şirket Unvanı] (“Platform İşletmecisi”, “MALSEVK”) ile Platform'a üye olarak erişen ve Platform'u kullanan tüm gerçek ve tüzel kişiler (“Kullanıcı”) arasındaki hukuki ilişkiyi düzenler.",
      "İşbu Koşullar kapsamında geçen tanımlar aşağıdaki anlamları taşır:",
    ],
    list: [
      "Hizmet Alan: lojistik, liman, depolama, elleçleme ve ilgili alanlarda hizmet ihtiyacı bulunan ve bu ihtiyacını Platform üzerinden ilan olarak yayınlayan Kullanıcı.",
      "Hizmet Veren: söz konusu hizmetleri sunma yetkinliğine sahip olduğunu beyan eden ve Hizmet Alan'ın ilanlarına teklif veren Kullanıcı.",
      "İlan: Hizmet Alan'ın Platform üzerinden yayınladığı, ihtiyaç duyduğu hizmetin niteliğini, konumunu ve süresini içeren kayıt.",
      "Teklif: Hizmet Veren'in bir İlan'a karşılık sunduğu ticari öneri.",
      "İçerik: Kullanıcılar tarafından Platform'a yüklenen her türlü metin, fotoğraf, ilan bilgisi, teklif ve mesaj.",
    ],
  },
  {
    heading: "2. Konu ve Kapsam",
    paragraphs: [
      "İşbu Koşullar, Platform'un kullanım şartlarını, Kullanıcıların hak ve yükümlülüklerini, Platform'un sunduğu hizmetlerin niteliğini ve tarafların sorumluluk sınırlarını düzenler.",
      "Platform'a üye olan, Platform'u herhangi bir şekilde kullanan veya Platform üzerinden İlan/Teklif oluşturan her Kullanıcı, işbu Koşulları okuduğunu, anladığını ve tamamını kabul ettiğini beyan eder. Koşulları kabul etmeyen kişiler Platform'u kullanmamalıdır.",
    ],
  },
  {
    heading: "3. Platformun Niteliği ve Aracılık Konumu",
    paragraphs: [
      "MALSEVK, Hizmet Alan ile Hizmet Veren'i elektronik ortamda bir araya getiren bir ARACI HİZMET SAĞLAYICI / DİJİTAL PAZARYERİ niteliğindedir. Platform, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun kapsamında aracı hizmet sağlayıcı sıfatıyla faaliyet gösterir.",
      "MALSEVK, Kullanıcılar arasında kurulan hizmet ilişkisinin tarafı DEĞİLDİR; İlan ve Teklif süreçleri sonucunda Hizmet Alan ile Hizmet Veren arasında doğrudan bir hizmet/eser ilişkisi kurulur. MALSEVK, bu ilişkinin ifasını, hizmetin fiilen görülüp görülmediğini, hizmetin niteliğini/kalitesini veya bedelinin ödenip ödenmediğini garanti etmez ve bunları taahhüt etmez.",
      "Platform üzerinde yer alan İlan ve Teklifler, Kullanıcıların kendi beyanlarına dayanır. MALSEVK, Kullanıcılar tarafından paylaşılan bilgilerin doğruluğunu araştırma yükümlülüğü altında değildir; ancak makul şüphe halinde bilgi/belge talep etme ve gerekli gördüğü içerikleri kaldırma hakkını saklı tutar.",
      "Platform şu an için ödeme/tahsilat aracılığı yapmamaktadır; hizmet bedelinin belirlenmesi, tahsili ve buna ilişkin her türlü mali/hukuki sorumluluk tamamen Hizmet Alan ile Hizmet Veren arasındadır.",
    ],
  },
  {
    heading: "4. Üyelik, Hesap Oluşturma ve Güvenlik",
    paragraphs: [
      "Platform'a üye olabilmek için gerçek kişilerin fiil ehliyetine sahip olması, tüzel kişiler adına işlem yapan kişilerin ise temsile yetkili olması gerekir.",
      "Kullanıcı, kayıt sırasında verdiği bilgilerin (ad-soyad, iletişim bilgileri, firma bilgileri, il/ilçe vb.) doğru, güncel ve eksiksiz olduğunu taahhüt eder. Yanlış, yanıltıcı veya başkasına ait bilgilerle oluşturulan hesaplar MALSEVK tarafından askıya alınabilir veya kapatılabilir.",
      "Hesap bilgilerinin (kullanıcı adı/e-posta ve şifre) gizliliğinin korunması Kullanıcının sorumluluğundadır. Hesap üzerinden gerçekleştirilen tüm işlemler, aksi ispat edilmedikçe hesap sahibi tarafından yapılmış sayılır. Hesabın yetkisiz kullanıldığından şüphelenilmesi halinde Kullanıcı bu durumu derhal MALSEVK'e bildirmekle yükümlüdür.",
      "Bir Kullanıcı Platform üzerinde yalnızca bir aktif hesap oluşturabilir; birden fazla hesap üzerinden Platform'un işleyişini (ör. teklif/derecelendirme mekanizmalarını) manipüle etmeye yönelik girişimler işbu Koşulların ihlali sayılır.",
    ],
  },
  {
    heading: "5. Hizmet Alan'ın Yükümlülükleri",
    paragraphs: [
      "Hizmet Alan, yayınladığı İlan'da yer alan hizmet ihtiyacının, konumun, tarih aralığının ve varsa özel şartların doğru ve güncel olmasını sağlamakla yükümlüdür.",
      "Hizmet Alan, kendisine ulaşan Teklifleri değerlendirme, kabul etme veya reddetme konusunda serbesttir; ancak bir Teklifi kabul ettikten sonra iş süreci içindeki (kabul, işe başlama, tamamlama onayı, itiraz gibi) adımları iyi niyet kuralları çerçevesinde ve makul sürede yürütmekle yükümlüdür.",
      "Hizmet Alan, Hizmet Veren ile kurulan ticari ilişkinin (bedel, ödeme koşulları, teslim/tamamlanma kriterleri dahil) esaslı unsurlarını doğrudan Hizmet Veren ile netleştirmekten sorumludur; MALSEVK bu müzakereye taraf değildir.",
    ],
  },
  {
    heading: "6. Hizmet Veren'in Yükümlülükleri",
    paragraphs: [
      "Hizmet Veren, sunduğunu beyan ettiği hizmeti mevzuata, mesleki standartlara ve iş güvenliği kurallarına uygun şekilde ifa edebilecek yetkinlik, ekipman ve (varsa gerekli) izin/belgelere sahip olduğunu beyan ve taahhüt eder.",
      "Hizmet Veren'in verdiği Teklif, bağlayıcı bir ticari öneridir; Teklifin kabul edilmesi halinde Hizmet Veren, üstlendiği işi Teklifinde belirttiği koşullarda ifa etmekle yükümlüdür.",
      "Hizmet Veren, üstlendiği işi tamamladığında bunu Platform üzerinden bildirir; Hizmet Alan'ın onayı veya itirazı sürecine ilişkin adımları iyi niyetle ve doğru bilgiyle yürütmekle yükümlüdür.",
      "Hizmet Veren, üçüncü kişilere (alt yüklenici, personel vb.) verdirdiği işlerden, kendi personeli/alt yüklenicileriymiş gibi, doğrudan sorumludur; bu kişilerin fiillerinden MALSEVK sorumlu tutulamaz.",
    ],
  },
  {
    heading: "7. İlan, Teklif ve Anlaşma Süreci",
    paragraphs: [
      "Bir İlan'a birden fazla Hizmet Veren teklif verebilir. Bir Teklifin kabul edilmesiyle birlikte, aksi Platform işleyiş kurallarında (ör. çekilme, anlaşmanın sağlanamaması) öngörülmedikçe, o İlan için nihai bir hizmet ilişkisi kurulmuş sayılır.",
      "Kabul edilen bir Teklifin ardından işe başlanması, işin tamamlanması, tamamlanmanın onaylanması veya itiraz edilmesi süreçleri Platform arayüzü üzerinden yürütülür; bu adımların iş bu Koşullar ve Platform'un yayınladığı kullanım kılavuzları çerçevesinde yürütülmesi her iki tarafın da sorumluluğundadır.",
      "MALSEVK, taraflar arasında çıkabilecek uyuşmazlıklarda hakemlik yapma, tarafları temsil etme veya bağlayıcı karar verme yükümlülüğü altında değildir; Platform yalnızca sürecin şeffaf ve izlenebilir şekilde yürütülmesi için teknik altyapı sunar.",
    ],
  },
  {
    heading: "8. Ücretlendirme ve Ödemeler",
    paragraphs: [
      "Platform'a üye olmak ve Platform'un temel işlevlerini (ilan yayınlama, teklif verme, mesajlaşma/iletişim bilgisi paylaşımı) kullanmak, işbu Koşulların yürürlük tarihi itibarıyla ücretsizdir.",
      "MALSEVK, ileride Platform üzerinde sunacağı ek/öne çıkarılmış hizmetler için ücretli paketler veya komisyon esaslı bir ücretlendirme modeli sunma hakkını saklı tutar. Böyle bir değişiklik, yürürlüğe girmeden makul bir süre önce Kullanıcılara Platform üzerinden veya kayıtlı iletişim bilgileri aracılığıyla duyurulur ve işbu Koşulların ilgili maddesi güncellenerek yeni bir sürüm yayınlanır.",
      "Hizmet Alan ile Hizmet Veren arasında kararlaştırılan hizmet bedelinin ödenmesi, ödeme şekli ve zamanlaması tamamen taraflar arasındaki anlaşmaya tabidir; MALSEVK bu ödeme ilişkisine aracılık etmemekte ve bu konudaki uyuşmazlıklardan sorumlu tutulamamaktadır.",
    ],
  },
  {
    heading: "9. Fikri Mülkiyet Hakları",
    paragraphs: [
      "Platform'un adı, logosu, arayüz tasarımı, yazılımı ve bunlara ilişkin tüm fikri ve sınai mülkiyet hakları MALSEVK'e veya lisans verenlerine aittir; 5846 sayılı Fikir ve Sanat Eserleri Kanunu ile diğer ilgili mevzuat kapsamında korunmaktadır.",
      "Kullanıcı, Platform'a yüklediği İçerik (ilan metni/fotoğrafları, firma profili bilgileri vb.) üzerindeki haklarını saklı tutar; ancak bu İçeriğin Platform'un işleyişi amacıyla (ör. ilanın ilgili Hizmet Veren'lere gösterilmesi) MALSEVK tarafından barındırılması, işlenmesi ve görüntülenmesi için MALSEVK'e münhasır olmayan, dünya çapında, ücretsiz bir kullanım izni verir.",
      "Kullanıcı, yüklediği İçeriğin üçüncü kişilerin fikri mülkiyet haklarını ihlal etmediğini beyan ve taahhüt eder. Bu beyanın aksinin ortaya çıkması halinde doğacak her türlü sorumluluk münhasıran ilgili Kullanıcıya aittir.",
    ],
  },
  {
    heading: "10. Sorumluluğun Sınırlandırılması",
    paragraphs: [
      "MALSEVK, Platform'un kesintisiz, hatasız veya belirli bir amaca uygun olacağını garanti etmez; Platform “olduğu gibi” ve “mevcut olduğu şekliyle” sunulmaktadır.",
      "MALSEVK; Hizmet Veren'in sunduğu hizmetin kalitesinden, süresinden, mevzuata uygunluğundan, iş güvenliğinden veya Hizmet Alan'ın ödeme yükümlülüklerini yerine getirmesinden kaynaklanan hiçbir zarardan sorumlu tutulamaz. Kullanıcılar arasındaki uyuşmazlıklar öncelikle taraflar arasında, gerekirse yetkili adli/idari mercilerde çözülür.",
      "MALSEVK'in işbu Koşullardan doğan sorumluluğu, yürürlükteki mevzuatın izin verdiği azami ölçüde, yalnızca MALSEVK'in kendi kusurundan doğrudan kaynaklanan ve öngörülebilir zararlarla sınırlıdır; dolaylı zararlar, kâr kaybı, veri kaybı veya itibar kaybı bu sınırlamaya dahildir.",
      "İşbu madde, MALSEVK'in kasıt veya ağır kusurundan doğan sorumluluğunu ya da Türk Borçlar Kanunu'nun emredici hükümleri uyarınca sınırlandırılamayacak sorumluluk hallerini ortadan kaldırmaz.",
    ],
  },
  {
    heading: "11. Kullanıcı İçeriği ve Yasak Kullanımlar",
    paragraphs: [
      "Kullanıcı, Platform'u yürürlükteki mevzuata, genel ahlaka ve işbu Koşullara uygun şekilde kullanacağını kabul eder.",
      "Aşağıdaki davranışlar açıkça yasaktır:",
    ],
    list: [
      "Yanıltıcı, yanlış veya gerçeğe aykırı ilan/teklif/profil bilgisi paylaşmak.",
      "Platform'un teknik altyapısına zarar verecek, aşırı yük bindirecek veya güvenliğini tehdit edecek girişimlerde bulunmak.",
      "Başka bir Kullanıcının kişisel verilerini rızası dışında toplamak, ifşa etmek veya kötüye kullanmak.",
      "Platform üzerinde elde edilen iletişim bilgilerini, ilgili hizmet ilişkisi dışında ticari amaçlarla (istenmeyen pazarlama vb.) kullanmak.",
      "Platform'un ücretlendirme, derecelendirme veya teklif mekanizmalarını manipüle etmeye yönelik sahte hesap/işlem oluşturmak.",
    ],
  },
  {
    heading: "12. Hesabın Askıya Alınması ve Feshi",
    paragraphs: [
      "MALSEVK, işbu Koşulların ihlal edildiğine dair makul şüphe duyması halinde, önceden bildirimde bulunarak veya bulunmaksızın, ilgili hesabı geçici olarak askıya alma veya kalıcı olarak kapatma hakkını saklı tutar.",
      "Kullanıcı, dilediği zaman hesabını kapatma talebinde bulunabilir; ancak devam eden bir hizmet ilişkisi (kabul edilmiş, işe başlanmış veya tamamlanma sürecindeki bir Teklif) varsa, bu ilişkiden doğan yükümlülükler hesabın kapatılmasından etkilenmez.",
      "Hesabın feshi, taraflar arasında fesih tarihinden önce doğmuş hak ve yükümlülükleri ortadan kaldırmaz.",
    ],
  },
  {
    heading: "13. Gizlilik ve Kişisel Verilerin Korunması",
    paragraphs: [
      "Kullanıcıların kişisel verilerinin işlenmesine ilişkin esaslar, işbu Koşulların ayrılmaz bir parçası niteliğindeki Gizlilik Politikası ve KVKK Aydınlatma Metni'nde düzenlenmiştir. Kullanıcı, Platform'u kullanarak bu belgelerde açıklanan işleme faaliyetlerini kabul etmiş sayılır.",
    ],
  },
  {
    heading: "14. Mücbir Sebep",
    paragraphs: [
      "Doğal afet, salgın hastalık, savaş, terör eylemi, siber saldırı, altyapı sağlayıcılarından kaynaklanan kesintiler, mevzuat değişikliği veya benzeri, tarafların makul kontrolü dışındaki ve önceden öngörülemeyen haller mücbir sebep sayılır. Mücbir sebebin devamı süresince taraflar edimlerini ifa edememekten sorumlu tutulamaz.",
    ],
  },
  {
    heading: "15. Değişiklik ve Güncellemeler",
    paragraphs: [
      "MALSEVK, işbu Koşulları, mevzuat değişiklikleri, Platform'un işleyişindeki güncellemeler veya iş ihtiyaçları doğrultusunda revize etme hakkını saklı tutar.",
      "Güncellenmiş sürüm, Platform üzerinde yayınlandığı andan itibaren yürürlüğe girer; esaslı değişikliklerde Kullanıcılardan yeniden onay talep edilebilir. Her sürümün numarası ve yürürlük tarihi işbu belgenin başında belirtilir.",
    ],
  },
  {
    heading: "16. Uyuşmazlıkların Çözümü ve Yetkili Mahkeme",
    paragraphs: [
      "İşbu Koşullardan doğan uyuşmazlıklarda Türkiye Cumhuriyeti kanunları uygulanır. Taraflar, uyuşmazlığın öncelikle iyi niyetle ve müzakere yoluyla çözülmesi için gayret gösterir.",
      "Çözülemeyen uyuşmazlıklarda Kocaeli (Merkez) Mahkemeleri ve İcra Daireleri yetkilidir; tüketici sıfatı taşıyan Kullanıcılar bakımından 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un emredici yetki hükümleri saklıdır.",
    ],
  },
  {
    heading: "17. Yürürlük ve Kabul",
    paragraphs: [
      "İşbu Kullanım Koşulları, Kullanıcının kayıt sırasında ilgili onay kutusunu işaretlemesi veya Platform'u kullanmaya devam etmesiyle birlikte, yukarıda belirtilen sürüm ve yürürlük tarihi itibarıyla taraflar arasında geçerli hale gelir.",
    ],
  },
];
