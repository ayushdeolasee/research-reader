export function confirmPdfImport(path: string): boolean {
  if (!path.toLowerCase().endsWith(".pdf")) {
    return true;
  }

  return window.confirm(
    "Import this PDF into a new .rr file next to the original PDF?",
  );
}
