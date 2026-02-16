import { useState, forwardRef } from "react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { HIGHLIGHT_COLORS } from "@/types";
import type { PositionData } from "@/types";
import { MessageSquarePlus } from "lucide-react";

interface SelectionPopoverProps {
  position: { x: number; y: number };
  selection: {
    text: string;
    positionData: PositionData;
  };
  currentPage: number;
  onClose: () => void;
}

export const SelectionPopover = forwardRef<HTMLDivElement, SelectionPopoverProps>(
  function SelectionPopover(
    { position, selection, currentPage, onClose },
    ref,
  ) {
    const { addHighlight, addNote } = useAnnotationStore();
    const [showNoteInput, setShowNoteInput] = useState(false);
    const [noteText, setNoteText] = useState("");

    const handleHighlight = async (color: string) => {
      await addHighlight({
        type: "highlight",
        page_number: currentPage,
        color,
        position_data: selection.positionData,
      });
      onClose();
    };

    const handleAddNote = async () => {
      if (!noteText.trim()) return;
      await addNote({
        type: "note",
        page_number: currentPage,
        content: noteText.trim(),
        position_data: selection.positionData,
      });
      onClose();
    };

    return (
      <div
        ref={ref}
        className="fixed z-50 flex flex-col items-center gap-1"
        style={{
          left: position.x,
          top: position.y,
          transform: "translate(-50%, -100%)",
        }}
      >
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1.5 shadow-lg">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.name}
              className="h-6 w-6 rounded-full border border-border transition-transform hover:scale-110"
              style={{ backgroundColor: color.value }}
              onClick={() => handleHighlight(color.value)}
              title={`Highlight ${color.name}`}
            />
          ))}
          <div className="mx-1 h-5 w-px bg-border" />
          <button
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShowNoteInput(!showNoteInput)}
            title="Add note"
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>

        {showNoteInput && (
          <div className="flex w-64 gap-1 rounded-lg border bg-background p-2 shadow-lg">
            <input
              type="text"
              className="flex-1 rounded border bg-muted px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder="Add a note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNote();
                if (e.key === "Escape") onClose();
              }}
              autoFocus
            />
            <button
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              onClick={handleAddNote}
            >
              Add
            </button>
          </div>
        )}
      </div>
    );
  },
);
