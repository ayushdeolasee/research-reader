import { useEffect, useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { usePdfStore } from "@/stores/pdf-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { Toolbar } from "@/components/pdf/Toolbar";
import { AnnotationSidebar } from "@/components/annotations/AnnotationSidebar";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import * as commands from "@/lib/tauri-commands";
import { confirmPdfImport } from "@/lib/pdf-import";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

export default function App() {
  // Only subscribe to what drives rendering decisions
  const doc = usePdfStore((s) => s.document);
  const loadAnnotations = useAnnotationStore((s) => s.loadAnnotations);
  const clearAnnotations = useAnnotationStore((s) => s.clearAnnotations);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load annotations when document changes
  useEffect(() => {
    if (doc) {
      loadAnnotations();
    } else {
      clearAnnotations();
    }
  }, [doc, loadAnnotations, clearAnnotations]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!doc) return;
    const interval = setInterval(() => {
      commands.saveFile().catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [doc]);

  // Keyboard shortcuts — uses getState() so the callback never changes
  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && e.key === "o") {
      e.preventDefault();
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Research Reader / PDF", extensions: ["rr", "pdf"] },
        ],
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (!selectedPath || !confirmPdfImport(selectedPath)) return;
      await usePdfStore.getState().openFile(selectedPath);
    }

    if (isCtrl && e.key === "s") {
      e.preventDefault();
      commands.saveFile().catch(() => {});
    }

    if (isCtrl && e.key === "=") {
      e.preventDefault();
      usePdfStore.getState().zoomIn();
    }

    if (isCtrl && e.key === "-") {
      e.preventDefault();
      usePdfStore.getState().zoomOut();
    }

    if (isCtrl && e.key === "b") {
      e.preventDefault();
      const { document: d, currentPage } = usePdfStore.getState();
      if (d) {
        const { annotations, addBookmark, deleteAnnotation } =
          useAnnotationStore.getState();
        const existing = annotations.find(
          (a) => a.type === "bookmark" && a.page_number === currentPage,
        );
        if (existing) {
          deleteAnnotation(existing.id);
        } else {
          addBookmark(currentPage);
        }
      }
    }

    if (e.key === "Escape") {
      useAnnotationStore.getState().selectAnnotation(null);
      usePdfStore.getState().setMode("view");
    }

    // N key toggles sticky note mode (only when not typing in an input)
    if (
      e.key === "n" &&
      !isCtrl &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      const { document: d, mode, setMode } = usePdfStore.getState();
      if (d) {
        e.preventDefault();
        setMode(mode === "note" ? "view" : "note");
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!doc) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <Toolbar />
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Viewer (main area) */}
        <PdfViewer />

        {/* Sidebar toggle */}
        <button
          className="flex h-full w-6 flex-shrink-0 items-center justify-center border-l bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? (
            <PanelRightClose size={14} />
          ) : (
            <PanelRightOpen size={14} />
          )}
        </button>

        {/* Annotation sidebar */}
        {sidebarOpen && (
          <div className="w-72 flex-shrink-0 overflow-hidden border-l bg-background">
            <AnnotationSidebar />
          </div>
        )}
      </div>
    </div>
  );
}
