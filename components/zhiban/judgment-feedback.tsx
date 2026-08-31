'use client';

import { CheckCircle2, CircleDot, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type JudgmentResultState = boolean | undefined;

export function judgmentOptionClass({
  selected,
  result,
}: {
  selected: boolean;
  result?: JudgmentResultState;
}) {
  return cn(
    'justify-start bg-white text-left transition-colors',
    selected && result === undefined &&
      'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-200 hover:bg-blue-50',
    selected && result === true &&
      'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-200 hover:bg-emerald-50',
    selected && result === false &&
      'border-orange-600 bg-orange-50 text-orange-950 ring-2 ring-orange-200 hover:bg-orange-50',
  );
}

export function JudgmentOptionIndicator({
  selected,
  result,
}: {
  selected: boolean;
  result?: JudgmentResultState;
}) {
  if (!selected) return null;
  if (result === true)
    return <CheckCircle2 className="ml-auto size-4 shrink-0 text-emerald-700" aria-hidden="true" />;
  if (result === false)
    return <XCircle className="ml-auto size-4 shrink-0 text-orange-700" aria-hidden="true" />;
  return <CircleDot className="ml-auto size-4 shrink-0 text-blue-700" aria-hidden="true" />;
}

export function JudgmentFeedback({
  isCorrect,
  message,
  pendingLabel = '已选择，等待验证',
}: {
  isCorrect?: JudgmentResultState;
  message?: string;
  pendingLabel?: string;
}) {
  if (!message && isCorrect === undefined) return null;

  const pending = isCorrect === undefined;
  const Icon = pending ? CircleDot : isCorrect ? CheckCircle2 : XCircle;
  const title = pending ? pendingLabel : isCorrect ? '回答正确' : '回答错误';

  return (
    <div
      className={cn(
        'mt-3 rounded-lg border p-3 text-sm',
        pending && 'border-blue-200 bg-blue-50 text-blue-950',
        isCorrect === true && 'border-emerald-200 bg-emerald-50 text-emerald-950',
        isCorrect === false && 'border-orange-200 bg-orange-50 text-orange-950',
      )}
      role="status"
      aria-live="polite"
      data-testid="judgment-feedback"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      {message && <p className="mt-1 leading-6">{message}</p>}
    </div>
  );
}
