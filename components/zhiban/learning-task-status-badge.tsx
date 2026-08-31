import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function LearningTaskStatusBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <Badge className="shrink-0 gap-1 border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      已完成
    </Badge>
  ) : (
    <Badge className="shrink-0 gap-1 border border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
      <AlertCircle className="size-3.5" aria-hidden="true" />
      未完成
    </Badge>
  );
}
