import { validateRules, type CompletionRule } from '../progress/rules';
import { academicId, academicRevision, requireAcademic } from '../academic/model';
import { learningText } from '../learning/model';
export interface CurriculumUnit {
  id: string;
  title: string;
  kind: 'LECTURE' | 'ACTIVITY' | 'MATERIAL';
  target: string;
  progress?: CompletionRule;
}
export interface CurriculumChapter {
  id: string;
  title: string;
  units: CurriculumUnit[];
}
export type CurriculumCommand =
  | { type: 'SAVE_OUTLINE'; revision: string; chapters: CurriculumChapter[] }
  | { type: 'PUBLISH_OUTLINE'; revision: string };
export function curriculumCommand(input: unknown): CurriculumCommand {
  requireAcademic(!!input && typeof input === 'object' && !Array.isArray(input));
  const v = input as Record<string, unknown>;
  requireAcademic(v.type === 'SAVE_OUTLINE' || v.type === 'PUBLISH_OUTLINE');
  requireAcademic(
    Object.keys(v).sort().join(',') ===
      (v.type === 'SAVE_OUTLINE' ? 'chapters,revision,type' : 'revision,type'),
  );
  academicRevision(v.revision);
  if (v.type === 'PUBLISH_OUTLINE') return v as CurriculumCommand;
  requireAcademic(Array.isArray(v.chapters) && v.chapters.length <= 50);
  const ids = new Set<string>();
  let total = 0;
  const unique = (id: unknown) => {
    requireAcademic(
      typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    );
    const value = id as string;
    requireAcademic(!ids.has(value));
    ids.add(value);
  };
  for (const chapter of v.chapters) {
    requireAcademic(!!chapter && typeof chapter === 'object' && !Array.isArray(chapter));
    requireAcademic(Object.keys(chapter).sort().join(',') === 'id,title,units');
    unique(chapter.id);
    learningText(chapter.title, 120);
    requireAcademic(Array.isArray(chapter.units));
    total += chapter.units.length;
    requireAcademic(total <= 200);
    for (const unit of chapter.units) {
      requireAcademic(!!unit && typeof unit === 'object' && !Array.isArray(unit));
      requireAcademic(
        Object.keys(unit).sort().join(',') ===
          (unit.progress === undefined ? 'id,kind,target,title' : 'id,kind,progress,target,title'),
      );
      unique(unit.id);
      learningText(unit.title, 120);
      academicId(unit.target);
      requireAcademic(['LECTURE', 'ACTIVITY', 'MATERIAL'].includes(unit.kind));
    }
  }
  validateRules((v.chapters as CurriculumChapter[]).flatMap((c) => c.units));
  return v as CurriculumCommand;
}
