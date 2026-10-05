import QRCode from 'qrcode';
export const websiteQrOptions = {
  errorCorrectionLevel: 'M' as const,
  margin: 4,
  color: { dark: '#000000ff', light: '#ffffffff' },
};
export async function websiteQr(url: string, type: 'png' | 'svg') {
  const canonical = new URL('/', url).href;
  if (type === 'svg') return QRCode.toString(canonical, { ...websiteQrOptions, type: 'svg' });
  return QRCode.toBuffer(canonical, { ...websiteQrOptions, type: 'png', scale: 30 });
}
