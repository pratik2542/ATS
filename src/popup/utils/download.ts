import { jsPDF } from 'jspdf';

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadBlob = (filename: string, blob: Blob) => {
  triggerDownload(blob, filename);
};

export const downloadTxt = (filename: string, text: string) => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, filename);
};

// "Word" download via HTML .doc (opens in Word/Google Docs)
export const downloadDoc = (filename: string, title: string, text: string) => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 12px 0; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.4; }
</style>
</head>
<body>
<h1>${title}</h1>
<pre>${escaped}</pre>
</body>
</html>`;

  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  triggerDownload(blob, filename);
};

export const downloadPdf = async (filename: string, title: string, text: string) => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const maxWidth = pageWidth - margin * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, margin, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  const lines = doc.splitTextToSize(text, maxWidth);
  let y = 72;
  const lineHeight = 14;
  const pageHeight = doc.internal.pageSize.getHeight();

  for (const line of lines) {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  doc.save(filename);
};
