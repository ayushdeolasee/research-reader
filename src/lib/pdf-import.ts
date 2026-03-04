export interface PdfImportDecision {
  shouldOpen: boolean;
  replacePdf: boolean;
}

export function getPdfImportDecision(path: string): PdfImportDecision {
  if (!path.toLowerCase().endsWith(".pdf")) {
    return { shouldOpen: true, replacePdf: true };
  }

  const replacePdf = window.confirm(
    "Replace this PDF with a .rr file and open it?\n\nChoose Cancel to keep the PDF and create a .rr copy instead.",
  );
  if (replacePdf) {
    return { shouldOpen: true, replacePdf: true };
  }

  const keepOriginalPdf = window.confirm(
    "Keep the original PDF and create a .rr copy before opening?",
  );
  if (keepOriginalPdf) {
    return { shouldOpen: true, replacePdf: false };
  }

  return { shouldOpen: false, replacePdf: true };
}
