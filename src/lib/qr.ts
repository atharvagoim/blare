import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR as a data URL, black on white, no quiet zone (as drawn in the design). */
export function useQr(value: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: 488, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return src;
}
