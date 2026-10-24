/** Existing Classroom facts only; no Native Runtime session or completion authority. */
export type PresentationTask = {
  id: string;
  kind: string;
  target_id: string;
  publicationId: string | null;
  state: string;
  available: boolean;
  entered: boolean;
  current_page: number;
  page_count: number;
  presentation_revision: string;
};
export type PresentationView = {
  mode: 'TEACHER' | 'STUDENT';
  courseId?: string;
  sessions: {
    id: string;
    state: string;
    revision: string;
    flow?: { state: string } | null;
    tasks: PresentationTask[];
  }[];
};
export function classroomPresentation(
  view: PresentationView,
  classroom: string,
  resource: string,
  publication: string,
  count: number,
) {
  const session = view.sessions.find((s) => s.id === classroom);
  const task = session?.tasks.find(
    (t) =>
      t.kind === 'LECTURE' &&
      t.state === 'ACTIVE' &&
      t.target_id === resource &&
      t.publicationId === publication,
  );
  if (
    !session ||
    session.state !== 'PUBLISHED' ||
    (session.flow && session.flow.state !== 'RUNNING') ||
    !task ||
    !task.available ||
    !['TEACHER', 'STUDENT'].includes(view.mode) ||
    (view.mode === 'STUDENT' && !task.entered) ||
    !Number.isInteger(task.current_page) ||
    task.current_page < 1 ||
    task.current_page > count ||
    task.page_count !== count
  )
    return null;
  return { session, task, teacher: view.mode === 'TEACHER' };
}
