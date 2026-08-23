import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('components/scene-renderers/mech-iframe-validation.tsx', 'utf8');

describe('mechanical iframe validation scene', () => {
  it('uses the existing interactive renderer and persistent iframe host', () => {
    expect(source).toContain('<InteractiveIframeHost />');
    expect(source).toContain('<InteractiveRenderer content={activeContent} sceneId={activeSceneId} />');
  });

  it('declares visualization3d box and cylinder capabilities', () => {
    expect(source).toContain("widgetType: 'visualization3d'");
    expect(source).toContain("type: 'box'");
    expect(source).toContain("type: 'cylinder'");
  });

  it('uses the widget iframe store for host-to-iframe commands', () => {
    expect(source).toContain('useWidgetIframeStore.getState().getSendMessage(activeSceneId)');
    expect(source).toContain("send('MECH_TEST_COMMAND'");
  });

  it('keeps legacy test messages isolated from the formal Virtual Lab protocol', () => {
    expect(source).toContain("'MECH_TEST_ACTION'");
    expect(source).toContain("'MECH_TEST_COMMAND_ACK'");
    expect(source).toContain('mechValidationProtocol');
  });
});
