export interface ActivityContentRecord {
  id: string;
  activityId: string;
  activityTitle: string;
  format: 'plain_text' | 'markdown' | 'html';
  body: string;
  version: number;
  status: 'draft' | 'published';
}

export interface CourseResourceRecord {
  id: string;
  title: string;
  description: string;
  resourceType: 'document' | 'video' | 'audio' | 'image' | 'link' | 'dataset' | 'other';
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  downloadAllowed: boolean;
  aiIndexEnabled: boolean;
  status: 'draft' | 'published' | 'archived';
  activityIds: string[];
  version: number;
  versions?: Array<{ id: string; version: number; fileName: string | null; createdAt: string }>;
}

export interface DiscussionPostRecord {
  id: string;
  parentPostId: string | null;
  authorId: string;
  authorName: string;
  content: string;
  status: 'published' | 'hidden' | 'deleted';
  aiGenerated: boolean;
  createdAt: string;
}

export interface DiscussionTopicRecord {
  id: string;
  activityId: string | null;
  title: string;
  description: string;
  status: 'draft' | 'open' | 'closed' | 'archived';
  pinned: boolean;
  graded: boolean;
  gradeItemId?: string | null;
  postCount: number;
  posts?: DiscussionPostRecord[];
}
