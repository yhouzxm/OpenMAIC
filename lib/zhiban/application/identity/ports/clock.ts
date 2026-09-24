import type { Instant } from '@/lib/zhiban/domain/identity';

export interface ClockPort {
  now(): Instant;
}
