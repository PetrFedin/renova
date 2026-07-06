/** Строки черновика проекта */
export type ScratchpadLineKind = 'note' | 'checklist' | 'purchase';

export type ScratchpadLine = {
  id: string;
  project_id: string;
  text: string;
  line_kind: ScratchpadLineKind;
  done: boolean;
  promoted_kind?: string | null;
  promoted_id?: string | null;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ScratchpadData = {
  lines: ScratchpadLine[];
};
