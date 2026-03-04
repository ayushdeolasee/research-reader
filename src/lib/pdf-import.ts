export function confirmPdfImport(path: string): boolean {
  if (!path.toLowerCase().endsWith(".pdf")) {
    return true;
  }

  return window.confirm(
    "Convert this PDF to a .rr file and replace the original PDF?",
  );
}
