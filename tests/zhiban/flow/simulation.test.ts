import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  executeSimulation,
  simulationModels,
  SIMULATION_SOURCE,
} from '../../../lib/zhiban/domain/flow/simulation';
import { flowCommand, labSpec } from '../../../lib/zhiban/domain/flow/model';
const source = '1'.repeat(64);
test('DC ideal circuit computes independent textbook values and records input/source changes', () => {
  const a = executeSimulation('DC_OHM_V1', { voltage: 12, resistance: 6 }, source);
  assert.deepEqual(a.values, { current: 2, power: 24 });
  assert.equal(a.source, SIMULATION_SOURCE);
  assert.deepEqual(executeSimulation('DC_OHM_V1', { resistance: 6, voltage: 12 }, source), a);
  const b = executeSimulation('DC_OHM_V1', { voltage: 18, resistance: 6 }, source);
  assert.deepEqual(b.values, { current: 3, power: 54 });
  assert.notEqual(a.inputSha256, b.inputSha256);
  assert.notEqual(a.outputSha256, b.outputSha256);
  assert.notEqual(
    executeSimulation('DC_OHM_V1', { voltage: 12, resistance: 6 }, '2'.repeat(64)).outputSha256,
    a.outputSha256,
  );
});
test('RC uses microfarads, zero initial charge, half-charge time and bounded long-time limit', () => {
  const input = { voltage: 12, resistance: 1000, capacitance: 1000, time: 0 };
  assert.deepEqual(executeSimulation('RC_CHARGE_V1', input, source).values, {
    capacitor_voltage: 0,
    current: 0.012,
    time_constant: 1,
  });
  const half = executeSimulation('RC_CHARGE_V1', { ...input, time: Math.log(2) }, source).values;
  assert.equal(half.capacitor_voltage, 6);
  assert.equal(half.current, 0.006);
  assert.equal(half.time_constant, 1);
  const late = executeSimulation('RC_CHARGE_V1', { ...input, time: 3600 }, source).values;
  assert.equal(late.capacitor_voltage, 12);
  assert.equal(late.current, 0);
});
test('arbitrary code, unexpected results, missing inputs, zero resistance and out-of-model definitions are rejected', () => {
  for (const value of [
    { voltage: 12, resistance: 0 },
    { voltage: 241, resistance: 6 },
    { voltage: 12, resistance: 6, result: 2 },
    { voltage: 12, resistance: Infinity },
    { voltage: '12', resistance: 6 },
  ])
    assert.throws(() => executeSimulation('DC_OHM_V1', value, source));
  const m = simulationModels[0],
    spec = {
      instructions: '理想模型',
      parameters: m.parameters,
      measurements: m.measurements,
      conclusionPrompt: '解释模型限制',
      execution: { source: SIMULATION_SOURCE, model: m.id },
    };
  assert.equal(labSpec(spec).execution?.model, m.id);
  assert.throws(() =>
    labSpec({ ...spec, execution: { ...spec.execution, formula: 'eval(input)' } }),
  );
  assert.throws(() =>
    labSpec({ ...spec, parameters: m.parameters.map((f) => ({ ...f, max: f.max + 1 })) }),
  );
  assert.throws(() =>
    flowCommand({
      type: 'RUN_SIMULATION',
      id: 'bad',
      revision: '1',
      attemptRevision: '1',
      parameters: { voltage: 12, resistance: 6 },
      conclusion: '',
      result: { current: 2 },
    }),
  );
});
