/**
 * Panoya kopyalama — bu depoda ilk (ve tek) implementasyon; başka hiçbir
 * bileşen `navigator.clipboard` çağırmıyor, bu yüzden burada merkezileştirip
 * her çağıranın kendi fallback'ini yeniden yazmasını önler. Clipboard API
 * desteklenmiyorsa (ör. güvensiz bağlam/eski tarayıcı) gizli bir
 * `<textarea>` + `document.execCommand("copy")` yedeği kullanılır — görev
 * gereksinimi: "Clipboard API desteklenmezse güvenli geri dönüş yöntemi
 * sağla."
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Devam et, aşağıdaki eski-tarayıcı yedeğini dene.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const succeeded = document.execCommand("copy");
    document.body.removeChild(textarea);
    return succeeded;
  } catch {
    return false;
  }
}
