import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';

export async function ensureLearningEventPartitions(pool: ZhibanDatabasePool, monthsAhead = 12) {
  if (!Number.isInteger(monthsAhead) || monthsAhead < 1 || monthsAhead > 36)
    throw new Error('monthsAhead must be between 1 and 36');
  await pool.query(
    `DO $$ DECLARE start_month date;part_start date;part_end date;part_name text;offset_month int;BEGIN
      start_month=date_trunc('month',now())::date;
      FOR offset_month IN 0..${monthsAhead} LOOP
        part_start=(start_month+(offset_month||' months')::interval)::date;part_end=(part_start+interval '1 month')::date;part_name='learning_events_'||to_char(part_start,'YYYY_MM');
        IF to_regclass('zhiban.'||part_name) IS NULL THEN EXECUTE format('CREATE TABLE zhiban.%I PARTITION OF zhiban.learning_events FOR VALUES FROM (%L) TO (%L)',part_name,part_start,part_end);END IF;
      END LOOP;END $$`,
  );
  return { monthsAhead };
}
