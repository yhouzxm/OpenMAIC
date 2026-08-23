import type { TrainingContext, TrainingDiagnosis, TrainingDiagnosisFlag, TrainingDiagnosisStage } from './types';

export function diagnoseTrainingState(context: TrainingContext): TrainingDiagnosis {
  const { evidence, behavior, state } = context;
  let stage: TrainingDiagnosisStage = 'OBSERVATION';
  if (evidence.repairCompleted || state.currentPhase === 'verification' || evidence.verificationPassed) stage = 'VERIFICATION';
  else if (state.currentPhase === 'repair' || behavior.diagnosisAttempts.includes('S2_OUTPUT_ABNORMAL')) stage = 'REPAIR';
  else if (evidence.powerMeasured && evidence.outputMeasured) stage = 'DIAGNOSIS';
  else if (evidence.powerMeasured || evidence.outputMeasured || behavior.inspectedComponents.length > 0) stage = 'MEASUREMENT';
  else if (behavior.actions.some((item) => item.action === 'OPEN_PLC_MONITOR')) stage = 'SIGNAL_INSPECTION';

  const flags: TrainingDiagnosisFlag[] = [];
  const hasEvidence = behavior.actions.some((item) => item.action === 'OPEN_PLC_MONITOR') || evidence.powerMeasured || evidence.outputMeasured;
  if (!hasEvidence) flags.push('NO_EVIDENCE');
  else if (!(behavior.actions.some((item) => item.action === 'OPEN_PLC_MONITOR') && evidence.powerMeasured && evidence.outputMeasured)) flags.push('INSUFFICIENT_EVIDENCE');
  if (behavior.wrongActions.some((item) => item === 'WRONG_DIAGNOSIS')) flags.push('WRONG_DIRECTION');
  if (behavior.wrongActions.length >= 2) flags.push('REPEATED_WRONG_ACTION');
  if (evidence.powerMeasured && evidence.outputMeasured && !evidence.diagnosisSubmitted) flags.push('READY_TO_DIAGNOSE');
  if (behavior.diagnosisAttempts.includes('S2_OUTPUT_ABNORMAL') && !evidence.repairCompleted) flags.push('READY_TO_REPAIR');
  if (evidence.repairCompleted && !evidence.verificationPassed) flags.push('READY_TO_VERIFY');
  return { stage, flags };
}

export function determineHintLevel(context: TrainingContext): 1 | 2 | 3 {
  const diagnosis = diagnoseTrainingState(context);
  if (diagnosis.flags.includes('REPEATED_WRONG_ACTION') || context.behavior.hintsUsed >= 2) return 3;
  if (
    diagnosis.stage !== 'OBSERVATION' ||
    diagnosis.flags.includes('WRONG_DIRECTION') ||
    context.behavior.hintsUsed >= 1
  ) return 2;
  return 1;
}
