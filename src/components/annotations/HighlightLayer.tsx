import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "@/types";
import { HIGHLIGHT_COLORS } from "@/types";
import { useAnnotationStore } from "@/stores/annotation-store";
import { StickyNoteOverlay } from "./StickyNoteOverlay";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface HighlightLayerProps {
  zoom: number;
  annotations: Annotation[];
}

export const HighlightLayer = memo(function HighlightLayer({
  zoom,
  annotations,
}: HighlightLayerProps) {
  const selectedAnnotationId = useAnnotationStore(
    (s) => s.selectedAnnotationId,
  );
  const selectAnnotation = useAnnotationStore((s) => s.selectAnnotation);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const updateAnnotation = useAnnotationStore((s) => s.updateAnnotation);
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(
    null,
  );
  const [isActionPopoverHovered, setIsActionPopoverHovered] = useState(false);
  const hoverClearTimeoutRef = useRef<number | null>(null);

  const cancelHoverClear = () => {
    if (hoverClearTimeoutRef.current !== null) {
      window.clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }
  };

  const scheduleHoverClear = () => {
    cancelHoverClear();
    hoverClearTimeoutRef.current = window.setTimeout(() => {
      setHoveredHighlightId(null);
    }, 140);
  };

  useEffect(
    () => () => {
      cancelHoverClear();
    },
    [],
  );

  const { highlights, notes, selectedHighlight } = useMemo(
    () => ({
      highlights: annotations.filter(
        (a) => a.type === "highlight" && a.position_data,
      ),
      notes: annotations.filter(
        (a) => a.type === "note" && a.position_data,
      ),
      selectedHighlight: annotations.find(
        (a) =>
          a.id === selectedAnnotationId &&
          a.type === "highlight" &&
          !!a.position_data,
      ),
    }),
    [annotations, selectedAnnotationId],
  );

  if (highlights.length === 0 && notes.length === 0) return null;
  const showActionPopover =
    !!selectedHighlight &&
    (hoveredHighlightId === selectedHighlight.id || isActionPopoverHovered);

  return (
    <div className="pointer-events-none absolute inset-0">
      {highlights.map((annotation) =>
        annotation.position_data!.rects.map((rect, i) => (
          <div
            key={`${annotation.id}-${i}`}
            className={cn(
              "pointer-events-auto absolute z-20 cursor-pointer rounded-sm opacity-40 transition-opacity hover:opacity-60",
              selectedAnnotationId === annotation.id &&
                "ring-2 ring-primary opacity-60",
            )}
            style={{
              left: rect.x * zoom,
              top: rect.y * zoom,
              width: rect.width * zoom,
              height: rect.height * zoom,
              backgroundColor: annotation.color ?? "#fef08a",
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              selectAnnotation(annotation.id);
            }}
            onMouseEnter={() => {
              cancelHoverClear();
              setHoveredHighlightId(annotation.id);
            }}
            onMouseLeave={() => {
              if (selectedAnnotationId === annotation.id) {
                scheduleHoverClear();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            title={
              annotation.content ??
              annotation.position_data?.selected_text ??
              undefined
            }
          />
        )),
      )}

      {showActionPopover && selectedHighlight?.position_data?.rects[0] && (
        <div
          className="pointer-events-auto absolute z-30 rounded-md border bg-background px-2 py-1.5 shadow-md"
          style={{
            left:
              (selectedHighlight.position_data.rects[0].x +
                selectedHighlight.position_data.rects[0].width / 2) *
              zoom,
            top: selectedHighlight.position_data.rects[0].y * zoom - 8,
            transform: "translate(-50%, -100%)",
          }}
          onMouseEnter={() => {
            cancelHoverClear();
            setIsActionPopoverHovered(true);
          }}
          onMouseLeave={() => {
            setIsActionPopoverHovered(false);
            scheduleHoverClear();
          }}
        >
          <div className="mb-1 flex items-center gap-1">
            {HIGHLIGHT_COLORS.map((color) => {
              const isSelected = selectedHighlight.color === color.value;
              return (
                <button
                  key={color.name}
                  type="button"
                  className={cn(
                    "h-5 w-5 rounded-full border border-border transition-transform hover:scale-110",
                    isSelected && "ring-2 ring-primary ring-offset-1",
                  )}
                  style={{ backgroundColor: color.value }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void updateAnnotation({
                      id: selectedHighlight.id,
                      color: color.value,
                    });
                  }}
                  title={`Set highlight color: ${color.name}`}
                />
              );
            })}
          </div>
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1 rounded border px-2 py-1 text-xs transition-colors hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              void deleteAnnotation(selectedHighlight.id);
            }}
            title="Remove highlight"
          >
            <Trash2 size={12} />
            Unhighlight
          </button>
        </div>
      )}

      {/* Sticky note overlays */}
      {notes.map((annotation) => (
        <StickyNoteOverlay
          key={`note-${annotation.id}`}
          annotation={annotation}
          zoom={zoom}
        />
      ))}
    </div>
  );
});
