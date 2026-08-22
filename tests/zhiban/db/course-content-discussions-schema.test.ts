import { describe, expect, it } from 'vitest';
import { courseContentDiscussionsMigration } from '@/lib/zhiban/db/migrations/036-course-content-discussions';

describe('course content and discussions schema', () => {
  it('defines versioned content, resources and moderated discussions', () => {
    const sql = courseContentDiscussionsMigration.up.join('\n');
    expect(sql).toContain('course_activity_contents');
    expect(sql).toContain('course_resources_v2');
    expect(sql).toContain('course_activity_resources');
    expect(sql).toContain('discussion_topics');
    expect(sql).toContain('discussion_posts');
    expect(sql).toContain('discussion_moderation');
    expect(sql).toContain('ai_index_enabled');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });
});
