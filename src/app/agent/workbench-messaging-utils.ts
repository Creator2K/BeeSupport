export function extractClipboardFiles(
  list: DataTransferItemList | null | undefined,
): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (item && item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}