import { useCallback, useEffect, useRef, useState } from "react";
import type { PositionData, Rect } from "@/types";
import { usePdfStore } from "@/stores/pdf-store";

interface TextSelection {
  text: string;
  positionData: PositionData;
  pageNumber: number;
}

interface PopoverPosition {
  x: number;
  y: number;
}

export function useTextSelection() {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null);
  const zoom = usePdfStore((s) => s.zoom);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setPopoverPosition(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // Dismiss popover when clicking outside of it
  useEffect(() => {
    if (!selection) return;

    const handleMouseDown = (e: MouseEvent) => {
      // If clicking inside the popover, don't dismiss
      if (popoverRef.current?.contains(e.target as Node)) return;
      // Small delay to let the new selection form if user is re-selecting
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setSelection(null);
          setPopoverPosition(null);
        }
      }, 10);
    };

    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [selection]);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Capture the target before the synthetic event is recycled
      const target = e.target as HTMLElement;

      // Small delay to let the browser finalize selection
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          return;
        }

        const text = sel.toString().trim();
        if (!text) return;

        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        // Find the parent page element and extract the page number
        const pageEl = target.closest("[data-page-number]");
        if (!pageEl) return;

        const pageNumber = parseInt(
          pageEl.getAttribute("data-page-number") ?? "1",
          10,
        );

        const pageRect = pageEl.getBoundingClientRect();

        // Convert browser rects to page-relative coordinates (normalized to zoom=1)
        // Use the zoom from the store (more reliable than CSS-based detection)
        const currentZoom = zoom;

        const normalizedRects: Rect[] = Array.from(rects).map((r) => ({
          x: (r.left - pageRect.left) / currentZoom,
          y: (r.top - pageRect.top) / currentZoom,
          width: r.width / currentZoom,
          height: r.height / currentZoom,
        }));

        const positionData: PositionData = {
          rects: normalizedRects,
          page_width: pageEl.clientWidth / currentZoom,
          page_height: pageEl.clientHeight / currentZoom,
          selected_text: text,
          start_offset: null,
          end_offset: null,
        };

        // Position the popover above the last rect
        const lastRect = rects[rects.length - 1];
        setPopoverPosition({
          x: lastRect.left + lastRect.width / 2,
          y: lastRect.top - 10,
        });

        setSelection({ text, positionData, pageNumber });
      }, 10);
    },
    [zoom],
  );

  return {
    selection,
    popoverPosition,
    popoverRef,
    clearSelection,
    handleMouseUp,
  };
}
