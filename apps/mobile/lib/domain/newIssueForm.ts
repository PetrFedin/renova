/** QLT-007: чистая логика формы «замечание вне плана». */
export type NewIssueBody = {
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  room_id?: string;
  stage_id?: string;
};

export function validateNewIssue(title: string): string | null {
  return title.trim().length >= 3 ? null : 'Коротко опишите, что не так (минимум 3 символа).';
}

export function buildNewIssueBody(input: {
  title: string;
  description: string;
  severity: NewIssueBody['severity'];
  roomId: string | null;
  stageId: string | null;
}): NewIssueBody {
  const description = input.description.trim();
  return {
    title: input.title.trim(),
    ...(description ? { description } : {}),
    severity: input.severity,
    ...(input.roomId ? { room_id: input.roomId } : {}),
    ...(input.stageId ? { stage_id: input.stageId } : {}),
  };
}

