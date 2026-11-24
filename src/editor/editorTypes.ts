// Shared editor state types, kept separate from the controller/panel so both can
// import them without introducing a runtime import cycle.

export type Tool = 'brush' | 'place' | 'select';

export type BrushKind = 'river' | 'blight' | 'path' | 'clearing';
