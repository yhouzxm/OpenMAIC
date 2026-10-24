/** Fixed, bounded server calculations. These are simulations, never physical measurements. */
import { createHash } from 'node:crypto';
import { requireAcademic } from '../academic/model';
import { canonical, exact } from '../quiz/model';
import type { LabField, LabSpec } from './model';
export type SimulationModel = 'DC_OHM_V1' | 'RC_CHARGE_V1';
export const SIMULATION_SOURCE = 'SERVER_CALCULATED_SIMULATION' as const;
const field = (
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  initial: number,
): LabField => ({ key, label, unit, min, max, initial });
export const simulationModels = [
  {
    id: 'DC_OHM_V1' as const,
    title: '直流欧姆定律',
    formula: '理想线性电阻；I=U/R；P=U×I；不含温升、容差与仪表误差。',
    parameters: [
      field('voltage', '电源电压', 'V', 0, 240, 12),
      field('resistance', '电阻', 'Ω', 1, 1000000, 6),
    ],
    measurements: [
      field('current', '电流', 'A', 0, 240, 0),
      field('power', '功率', 'W', 0, 57600, 0),
    ],
  },
  {
    id: 'RC_CHARGE_V1' as const,
    title: 'RC 充电',
    formula:
      '初始电容电压为零的理想串联RC；τ=R×C；Vc=U×(1−exp(−t/τ))；I=U/R×exp(−t/τ)；电容输入单位μF。',
    parameters: [
      field('voltage', '电源电压', 'V', 0, 240, 12),
      field('resistance', '电阻', 'Ω', 1, 1000000, 1000),
      field('capacitance', '电容', 'μF', 1, 1000000, 1000),
      field('time', '经过时间', 's', 0, 3600, 1),
    ],
    measurements: [
      field('capacitor_voltage', '电容电压', 'V', 0, 240, 0),
      field('current', '电流', 'A', 0, 240, 0),
      field('time_constant', '时间常数', 's', 0.000001, 1000000, 1),
    ],
  },
];
export function simulationModel(id: unknown) {
  const model = simulationModels.find((m) => m.id === id);
  requireAcademic(model, 'INVALID_INPUT');
  return model;
}
export function validateSimulationSpec(spec: LabSpec) {
  if (!spec.execution) return;
  exact(spec.execution, ['source', 'model']);
  requireAcademic(spec.execution.source === SIMULATION_SOURCE);
  const model = simulationModel(spec.execution.model);
  // Field definitions are the versioned model contract, not teacher-supplied executable formulas.
  requireAcademic(
    canonical(spec.parameters) === canonical(model.parameters) &&
      canonical(spec.measurements) === canonical(model.measurements),
  );
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function executeSimulation(
  modelId: SimulationModel,
  input: unknown,
  executorSourceSha256: string,
) {
  const model = simulationModel(modelId);
  requireAcademic(/^[a-f0-9]{64}$/.test(executorSourceSha256));
  exact(
    input,
    model.parameters.map((f) => f.key),
  );
  const parameters: Record<string, number> = {};
  for (const f of model.parameters) {
    const n = input[f.key];
    requireAcademic(typeof n === 'number' && Number.isFinite(n) && n >= f.min && n <= f.max);
    parameters[f.key] = n;
  }
  const { voltage: u, resistance: r } = parameters;
  let values: Record<string, number>;
  if (modelId === 'DC_OHM_V1') values = { current: u / r, power: (u * u) / r };
  else {
    const tau = (r * parameters.capacitance) / 1000000,
      decay = Math.exp(-parameters.time / tau);
    values = {
      capacitor_voltage: u * -Math.expm1(-parameters.time / tau),
      current: (u / r) * decay,
      time_constant: tau,
    };
  }
  for (const [k, n] of Object.entries(values)) {
    requireAcademic(Number.isFinite(n));
    values[k] = Number(n.toPrecision(12));
  }
  const definition = {
    ...model,
    precision: '12_SIGNIFICANT_DECIMAL_DIGITS',
    source: SIMULATION_SOURCE,
  };
  const artifact = {
    source: SIMULATION_SOURCE,
    modelId,
    modelSha256: digest(definition),
    executorSourceSha256,
    parameters,
    values,
  };
  return { ...artifact, inputSha256: digest(parameters), outputSha256: digest(artifact) };
}
