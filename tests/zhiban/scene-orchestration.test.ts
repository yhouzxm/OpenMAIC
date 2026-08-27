import { describe, expect, it } from 'vitest';
import {
  MECHATRONICS_PROJECT_STAGES,
  SCENE_DEFINITIONS,
  SCENE_IDS,
  canEnterScene,
  canTransitionSceneLifecycle,
  completeScene,
  createMechatronicsPblDefinition,
  detectSceneMisconception,
  enterRemediationScene,
  enterScene,
  getNextScene,
  getScene,
  getStationScenes,
  resolveSceneComponent,
} from '@/lib/zhiban/scene-orchestration';

describe('mechatronics scene registry and orchestrator', () => {
  it('registers 25 unique frozen Scene IDs', () => {
    expect(SCENE_DEFINITIONS).toHaveLength(25);
    expect(new Set(SCENE_DEFINITIONS.map((scene) => scene.id)).size).toBe(25);
    expect(SCENE_DEFINITIONS.map((scene) => scene.id)).toEqual(SCENE_IDS);
  });

  it('maps the seven stations to 4/4/4/3/4/3/3 scenes', () => {
    expect(
      [
        'station-01-system',
        'station-02-sensing',
        'station-03-control',
        'station-04-actuation',
        'station-05-diagnosis',
        'station-06-virtual-lab',
        'station-07-assessment',
      ].map((stationId) => getStationScenes(stationId).length),
    ).toEqual([4, 4, 4, 3, 4, 3, 3]);
  });

  it('contains no new core scene and preserves the capability inventory counts', () => {
    const count = (strategy: string) =>
      SCENE_DEFINITIONS.filter((scene) => scene.reuseStrategy === strategy).length;
    expect(count('REUSE_DIRECT')).toBe(5);
    expect(count('REUSE_WITH_WRAPPER')).toBe(18);
    expect(count('ENHANCE_EXISTING')).toBe(2);
    expect(count('NEW')).toBe(0);
  });

  it('resolves existing components and advances through the frozen sequence', () => {
    expect(getScene('S03-04')?.title).toBe('动态梯形图信号流');
    expect(resolveSceneComponent('S06-02')).toMatchObject({
      componentKey: 'virtual-lab-runner',
      interactiveTemplate: 'line-stop-001',
      activityId: 'mech-lab-line-stop',
      scenarioId: 'line-stop-001',
    });
    expect(getNextScene('S01-04')?.id).toBe('S02-01');
    expect(getNextScene('S07-03')).toBeNull();
  });

  it('enforces logical scene prerequisites without replacing Station access rules', () => {
    expect(canEnterScene('S01-01', { completedSceneIds: [] }).allowed).toBe(true);
    expect(canEnterScene('S02-01', { completedSceneIds: [] })).toMatchObject({
      allowed: false,
      missingPrerequisiteSceneId: 'S01-04',
    });
    expect(canEnterScene('S02-01', { completedSceneIds: ['S01-04'] }).allowed).toBe(true);
  });

  it('uses one lifecycle and emits existing Learning Event inputs', () => {
    expect(canTransitionSceneLifecycle('READY', 'ENTERED')).toBe(true);
    expect(canTransitionSceneLifecycle('ENTERED', 'MISCONCEPTION_DETECTED')).toBe(true);
    expect(canTransitionSceneLifecycle('REMEDIATION_RECOMMENDED', 'RETRYING')).toBe(true);
    expect(canTransitionSceneLifecycle('READY', 'COMPLETED')).toBe(false);
    expect(enterScene('S02-03')).toMatchObject({
      stationId: 'station-02-sensing',
      eventType: 'ENTER_SCENE',
      payload: { sceneId: 'S02-03', lifecycle: 'ENTERED' },
    });
    expect(completeScene('S02-03')).toMatchObject({
      eventType: 'COMPLETE_SCENE',
      payload: { sceneId: 'S02-03', lifecycle: 'COMPLETED' },
    });
    expect(enterRemediationScene('S02-03')).toMatchObject({
      eventType: 'REMEDIATION_SCENE_ENTERED',
      payload: { sceneId: 'S02-03', lifecycle: 'RETRYING' },
    });
    expect(detectSceneMisconception('S02-03', ['POWER_EQUALS_SENSOR_NORMAL'])).toMatchObject({
      eventType: 'SUBMIT_MICRO_EXERCISE',
      isCorrect: false,
      payload: {
        sceneId: 'S02-03',
        lifecycle: 'MISCONCEPTION_DETECTED',
        conceptErrors: ['POWER_EQUALS_SENSOR_NORMAL'],
      },
    });
  });

  it('binds existing AI modes by Station and maps the PBL shell to all scenes', () => {
    expect(getScene('S01-02')?.aiMode).toBe('knowledge_companion');
    expect(getScene('S05-02')?.aiMode).toBe('cognitive_diagnosis');
    expect(getScene('S06-02')?.aiMode).toBe('training_coach');
    expect(getScene('S07-01')?.aiMode).toBe('assessment_mentor');
    expect(MECHATRONICS_PROJECT_STAGES.flatMap((stage) => stage.sceneIds)).toEqual(SCENE_IDS);
    expect(createMechatronicsPblDefinition('course-03324')).toMatchObject({
      courseId: 'course-03324',
      title: '抢修停摆的自动生产线',
      scenarioRoleplay: true,
    });
  });
});
