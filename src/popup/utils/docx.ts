import PizZip from 'pizzip';

export type DocxParseResult = {
  paragraphs: string[];
  text: string;
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const getDocXml = (zip: PizZip): string => {
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Invalid DOCX: missing word/document.xml');
  return file.asText();
};

const parseXml = (xml: string): Document => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  // Detect XML parse errors.
  const errs = doc.getElementsByTagName('parsererror');
  if (errs && errs.length > 0) {
    throw new Error('Failed to parse DOCX XML');
  }
  return doc;
};

const serializeXml = (doc: Document): string => {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
};

export const extractTextFromDocxArrayBuffer = async (arrayBuffer: ArrayBuffer): Promise<DocxParseResult> => {
  const zip = new PizZip(arrayBuffer);
  const xml = getDocXml(zip);
  const doc = parseXml(xml);

  // Paragraphs are w:p; text nodes are w:t. The tagName includes the prefix (w:).
  const paragraphs: string[] = [];
  const pNodes = Array.from(doc.getElementsByTagName('w:p'));

  for (const p of pNodes) {
    const tNodes = Array.from(p.getElementsByTagName('w:t'));
    const pText = tNodes.map((t) => t.textContent || '').join('');
    paragraphs.push(pText);
  }

  const text = paragraphs.join('\n');
  return { paragraphs, text };
};

export const extractParagraphsFromDocxBase64 = async (base64: string): Promise<string[]> => {
  const bytes = base64ToUint8Array(base64);
  const zip = new PizZip(bytes);
  const xml = getDocXml(zip);
  const doc = parseXml(xml);

  const paragraphs: string[] = [];
  const pNodes = Array.from(doc.getElementsByTagName('w:p'));
  for (const p of pNodes) {
    const tNodes = Array.from(p.getElementsByTagName('w:t'));
    const pText = tNodes.map((t) => t.textContent || '').join('');
    paragraphs.push(pText);
  }
  return paragraphs;
};

const distributeAcrossNodes = (text: string, nodes: Element[]): void => {
  if (nodes.length === 0) return;
  const originalLens = nodes.map((n) => (n.textContent || '').length);
  const totalOriginal = originalLens.reduce((a, b) => a + b, 0);

  // If there was no original text, put everything in first node.
  if (totalOriginal === 0) {
    nodes[0].textContent = text;
    for (let i = 1; i < nodes.length; i++) nodes[i].textContent = '';
    return;
  }

  let offset = 0;
  for (let i = 0; i < nodes.length; i++) {
    const take = i === nodes.length - 1 ? text.length - offset : Math.min(originalLens[i], text.length - offset);
    const part = take > 0 ? text.slice(offset, offset + take) : '';
    nodes[i].textContent = part;
    offset += Math.max(0, take);
    if (offset >= text.length) {
      // Clear remaining nodes.
      for (let j = i + 1; j < nodes.length; j++) nodes[j].textContent = '';
      break;
    }
  }
};

export const patchDocxWithParagraphs = async (
  originalDocxBase64: string,
  updatedParagraphs: string[]
): Promise<{ blob: Blob; base64: string }> => {
  const bytes = base64ToUint8Array(originalDocxBase64);
  const zip = new PizZip(bytes);
  const xml = getDocXml(zip);
  const doc = parseXml(xml);

  const pNodes = Array.from(doc.getElementsByTagName('w:p'));
  const count = pNodes.length;

  // Normalize paragraph count (pad/truncate) to preserve layout.
  const normalized = (updatedParagraphs || []).slice(0, count);
  while (normalized.length < count) normalized.push('');

  for (let i = 0; i < count; i++) {
    const p = pNodes[i];
    const tNodes = Array.from(p.getElementsByTagName('w:t'));
    // If a paragraph has no w:t, we skip it (likely a purely structural paragraph).
    if (tNodes.length === 0) continue;
    distributeAcrossNodes(String(normalized[i] ?? ''), tNodes);
  }

  zip.file('word/document.xml', serializeXml(doc));

  const out = zip.generate({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }) as unknown as Uint8Array<ArrayBuffer>;

  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  return { blob, base64: uint8ArrayToBase64(out) };
};

export const isDocxFile = (file: File): boolean => {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.docx')) return true;
  // Some browsers may not set the correct mime type.
  const type = (file.type || '').toLowerCase();
  return type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
};
