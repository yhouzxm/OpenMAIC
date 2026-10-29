/** Scoped fetch is supplied by native-workbench; no unscoped navigation or credentials in URLs. */
import { toast } from 'sonner';
export async function openNativeMaterialOriginal(id: string, inline: boolean) {
  const preview = inline ? window.open('about:blank', '_blank') : null;
  if (preview) preview.opener = null;
  try {
    const response = await fetch(`/api/materials/${encodeURIComponent(id)}/original`);
    if (!response.ok) throw Error('原文件暂时不可访问，请检查课程权限后重试。');
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.replace(url);
    else {
      const disposition = response.headers.get('content-disposition') ?? '';
      let name = 'material';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
      try {
        name = encoded ? decodeURIComponent(encoded) : (plain ?? name);
      } catch {
        /* safe fallback */
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = name.replace(/[\\/:\x00-\x1f\x7f]/g, '_').slice(0, 255);
      document.body.append(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (error) {
    preview?.close();
    toast.error(error instanceof Error ? error.message : '原文件下载失败，请重试。');
  }
}
