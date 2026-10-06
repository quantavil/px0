export interface ImageAttachment {
  id: string; // e.g. "fig-1"
  name: string; // e.g. "Quarterly Chart"
  dataUrl: string; // e.g. "data:image/webp;base64,..."
  byteSize: number; // approximate binary size in bytes
}

const FIG_DEF_REGEX =
  /^\s*\[(fig-\d+)\]:\s*(data:image\/(?:png|jpe?g|webp|gif|avif)[^\s]+)\s*$/gim;

export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseAttachments(rawMd: string): {
  cleanContent: string;
  attachments: ImageAttachment[];
} {
  const matches = Array.from(rawMd.matchAll(FIG_DEF_REGEX));
  if (!matches.length) {
    return { cleanContent: rawMd, attachments: [] };
  }

  const attachments: ImageAttachment[] = [];
  const foundIds = new Set<string>();

  for (const match of matches) {
    const id = match[1];
    const dataUrl = match[2];
    if (foundIds.has(id)) continue;
    foundIds.add(id);

    const altRegex = new RegExp(`!\\[([^\\]]*)\\]\\[${id}\\]`, "i");
    const altMatch = rawMd.match(altRegex);
    const altText = altMatch?.[1]?.trim();
    const name = altText || id;

    attachments.push({
      id,
      name,
      dataUrl,
      byteSize: estimateDataUrlBytes(dataUrl),
    });
  }

  const cleanContent = rawMd.replace(FIG_DEF_REGEX, "").trimEnd();

  return { cleanContent, attachments };
}

export function formatMarkdownWithAttachments(
  cleanContent: string,
  attachments: ImageAttachment[],
): string {
  if (!attachments.length) return cleanContent;
  const defs = attachments
    .map((att) => `[${att.id}]: ${att.dataUrl}`)
    .join("\n");
  const base = cleanContent.trimEnd();
  return base ? `${base}\n\n${defs}\n` : `${defs}\n`;
}

export function getNextFigId(
  existingAttachments: ImageAttachment[],
  markdownContent = "",
): string {
  let highest = 0;
  for (const att of existingAttachments) {
    const num = parseInt(att.id.replace("fig-", ""), 10);
    if (!Number.isNaN(num) && num > highest) highest = num;
  }
  const matches = markdownContent.matchAll(/\[fig-(\d+)\]/g);
  for (const match of matches) {
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num) && num > highest) highest = num;
  }
  return `fig-${highest + 1}`;
}
