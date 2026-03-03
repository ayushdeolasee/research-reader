# Tool Skills Reference

## Tool: `goToPage`
### Purpose
Navigate the document viewport to a specific page.

### Use When
- The user asks to jump, move, navigate, or inspect a specific page.
- You need to guide the user to evidence located on another page.

### Input Schema
```json
{ "pageNumber": number }
```

### Notes
- `pageNumber` should be a positive integer.
- Prefer exact page numbers when the request is explicit.
- If the request is vague, choose the most likely page and explain in `reply`.

## Tool: `addNote`
### Purpose
Create a sticky-note annotation on a page with user-visible text.

### Use When
- The user asks to add a note, reminder, summary, TODO, or comment.
- You want to save an interpretation or action item into the document.

### Input Schema
```json
{
  "pageNumber": number,
  "text": string,
  "x"?: number,
  "y"?: number
}
```

### Notes
- `text` is required and should be concise and useful.
- `x` and `y` are page coordinates; omit them if placement is unclear.
- Do not add empty or redundant notes.

## Tool: `addHighlight`
### Purpose
Create a highlight annotation on a page for text/regions of interest.

### Use When
- The user asks to highlight text or visually mark important content.
- You identify a critical statement, value, or region worth emphasizing.

### Input Schema
```json
{
  "pageNumber": number,
  "text"?: string,
  "color"?: string,
  "x"?: number,
  "y"?: number,
  "width"?: number,
  "height"?: number
}
```

### Notes
- `text` should contain the highlighted phrase when known.
- `color` should be a valid CSS color string (hex preferred).
- Region fields (`x`, `y`, `width`, `height`) should be coherent and non-negative.
- If exact geometry is uncertain, prefer semantic highlight intent via `text`.
