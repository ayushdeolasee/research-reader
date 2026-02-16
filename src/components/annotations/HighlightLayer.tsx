import { memo, useMemo } from "react";
import type { Annotation } from "@/types";
import { useAnnotationStore } from "@/stores/annotation-store";
import { StickyNoteOverlay } from "./StickyNoteOverlay";
import { cn } from "@/lib/utils";

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

  const { highlights, notes } = useMemo(
    () => ({
      highlights: annotations.filter(
        (a) => a.type === "highlight" && a.position_data,
      ),
      notes: annotations.filter(
        (a) => a.type === "note" && a.position_data,
      ),
    }),
    [annotations],
  );

  if (highlights.length === 0 && notes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {highlights.map((annotation) =>
        annotation.position_data!.rects.map((rect, i) => (
          <div
            key={`${annotation.id}-${i}`}
            className={cn(
              "pointer-events-auto absolute cursor-pointer rounded-sm opacity-40 transition-opacity hover:opacity-60",
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
            onClick={(e) => {
              e.stopPropagation();
              selectAnnotation(
                selectedAnnotationId === annotation.id
                  ? null
                  : annotation.id,
              );
            }}
            title={
              annotation.content ??
              annotation.position_data?.selected_text ??
              undefined
            }
          />
        )),
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
