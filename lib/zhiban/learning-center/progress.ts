import { KNOWLEDGE_STATIONS } from './registry';
import type {
  LearningCenterProgress,
  LearningEvent,
  KnowledgePointProgress,
  StationId,
  StationProgress,
} from './types';

export function emptyLearningCenterProgress(
  courseId: string,
  persistenceAvailable = true,
): LearningCenterProgress {
  const knowledgePoints: Record<string, KnowledgePointProgress> = {};
  for (const station of KNOWLEDGE_STATIONS)
    for (const id of station.knowledgePointIds)
      knowledgePoints[id] = {
        knowledgePointId: id,
        completed: false,
        attempts: 0,
        lastEventAt: null,
        correct: null,
      };
  const stations = Object.fromEntries(
    KNOWLEDGE_STATIONS.map((station) => [
      station.id,
      {
        stationId: station.id,
        status: 'not_started',
        progressPercent: 0,
        completedKnowledgePoints: 0,
        totalKnowledgePoints: station.knowledgePointIds.length,
        lastEventAt: null,
      },
    ]),
  ) as Record<StationId, StationProgress>;
  return { courseId, stations, knowledgePoints, eventCount: 0, persistenceAvailable };
}

export function deriveLearningCenterProgress(
  courseId: string,
  events: LearningEvent[],
  persistenceAvailable = true,
): LearningCenterProgress {
  const progress = emptyLearningCenterProgress(courseId, persistenceAvailable);
  progress.eventCount = events.length;
  const explicitlyCompletedStations = new Set<StationId>();
  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (event.eventType === 'COMPLETE_STATION') explicitlyCompletedStations.add(event.stationId);
    const point = event.knowledgePointId
      ? progress.knowledgePoints[event.knowledgePointId]
      : undefined;
    if (point) {
      point.attempts = Math.max(point.attempts, event.attempt ?? 1);
      point.lastEventAt = event.timestamp;
      if (typeof event.isCorrect === 'boolean') point.correct = event.isCorrect;
      if (
        event.eventType === 'COMPLETE_KNOWLEDGE_POINT' ||
        (event.eventType === 'SUBMIT_MICRO_EXERCISE' && event.isCorrect)
      )
        point.completed = true;
    }
  }
  for (const station of KNOWLEDGE_STATIONS) {
    const points = station.knowledgePointIds
      .map((id) => progress.knowledgePoints[id])
      .filter(Boolean);
    const completed = points.filter((point) => point.completed).length;
    const lastEventAt =
      points
        .map((point) => point.lastEventAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    const stationProgress = progress.stations[station.id];
    stationProgress.completedKnowledgePoints = completed;
    stationProgress.progressPercent = points.length
      ? Math.round((completed / points.length) * 100)
      : 0;
    stationProgress.lastEventAt = lastEventAt;
    stationProgress.status = explicitlyCompletedStations.has(station.id)
      ? 'completed'
      : completed === points.length && points.length > 0
        ? 'completed'
        : lastEventAt
          ? 'in_progress'
          : 'not_started';
    if (explicitlyCompletedStations.has(station.id)) stationProgress.progressPercent = 100;
    if (station.id === 'station-01-system' && stationProgress.status === 'completed')
      stationProgress.status = 'completed';
  }
  return progress;
}
