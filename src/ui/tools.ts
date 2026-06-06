import type { ToolId } from "../state/store";

export interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: string;
}

export const TOOL_DEFS: ToolDef[] = [
  { id: "select", label: "Selection", shortcut: "V", icon: "V" },
  { id: "node", label: "Direct Select", shortcut: "A", icon: "A" },
  { id: "rect", label: "Rectangle", shortcut: "M", icon: "[]" },
  { id: "ellipse", label: "Ellipse", shortcut: "L", icon: "O" },
  { id: "pen", label: "Pen", shortcut: "P", icon: "P" },
  { id: "text", label: "Type", shortcut: "T", icon: "T" },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: "I" },
  { id: "measure", label: "Measure", shortcut: "K", icon: "K" },
  { id: "hand", label: "Hand", shortcut: "H", icon: "H" },
];
