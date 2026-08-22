'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, ExternalLink, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  ActivityContentRecord,
  CourseResourceRecord,
  DiscussionTopicRecord,
} from '@/lib/zhiban/content';

type Data = {
  contents: ActivityContentRecord[];
  resources: CourseResourceRecord[];
  topics: DiscussionTopicRecord[];
};
export function StudentCourseContent({
  courseId,
  sections = ['contents', 'resources', 'discussions'],
}: {
  courseId: string;
  sections?: Array<'contents' | 'resources' | 'discussions'>;
}) {
  const [data, setData] = useState<Data>({ contents: [], resources: [], topics: [] });
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/content`),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '课程内容加载失败');
    setData(body);
  }, [courseId]);
  useEffect(() => {
    void fetch(`/api/zhiban/student/courses/${courseId}/content`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '课程内容加载失败');
        setData(body);
      })
      .catch((error) => toast.error(error.message));
  }, [courseId]);
  const action = async (payload: Record<string, unknown>, message: string) => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/content`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '操作失败');
    toast.success(message);
    await load();
  };
  return (
    <div className="space-y-5">
      {sections.includes('contents') && <section className="border bg-white p-5">
        <h2 className="text-lg font-semibold">章节学习内容</h2>
        <div className="mt-4 space-y-3">
          {data.contents.map((content) => (
            <article
              id={`content-${content.activityId}`}
              key={content.id}
              className="scroll-mt-20 rounded border p-4"
            >
              <div className="mb-3 flex justify-between">
                <h3 className="font-semibold">{content.activityTitle}</h3>
                <Badge variant="outline">v{content.version}</Badge>
              </div>
              {content.format === 'markdown' ? (
                <div className="text-sm leading-7 text-slate-700">
                  <Streamdown>{content.body}</Streamdown>
                </div>
              ) : content.format === 'html' ? (
                <div
                  className="text-sm leading-7 text-slate-700"
                  dangerouslySetInnerHTML={{ __html: content.body }}
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {content.body}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  void action(
                    { action: 'complete_content', activityId: content.activityId },
                    '该内容已标记完成',
                  ).catch((error) => toast.error(error.message))
                }
              >
                完成本节学习
              </Button>
            </article>
          ))}
          {!data.contents.length && (
            <p className="text-sm text-slate-400">暂无已发布的章节内容。</p>
          )}
        </div>
      </section>}
      {sections.includes('resources') && <section className="border bg-white p-5">
        <h2 className="text-lg font-semibold">课程资源</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.resources.map((resource) => (
            <div key={resource.id} className="flex items-center gap-3 rounded border p-4">
              <Badge variant="outline">{resource.resourceType}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{resource.title}</p>
                <p className="truncate text-xs text-slate-500">
                  {resource.description || resource.fileName || resource.url}
                </p>
              </div>
              {resource.url ? (
                <Button asChild size="sm" variant="outline">
                  <a href={resource.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 size-4" />
                    打开
                  </a>
                </Button>
              ) : resource.downloadAllowed ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/api/zhiban/resources/${resource.id}`}>
                    <Download className="mr-1 size-4" />
                    下载
                  </Link>
                </Button>
              ) : (
                <span className="text-xs text-slate-400">仅在线学习</span>
              )}
            </div>
          ))}
          {!data.resources.length && <p className="text-sm text-slate-400">暂无已发布资源。</p>}
        </div>
      </section>}
      {sections.includes('discussions') && <section className="border bg-white p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquare className="size-5" />
          课程讨论
        </h2>
        <div className="mt-4 space-y-4">
          {data.topics.map((topic) => (
            <article key={topic.id} className="rounded border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{topic.title}</h3>
                {topic.pinned && <Badge>置顶</Badge>}
                <Badge variant="outline">{topic.status === 'open' ? '讨论中' : '已关闭'}</Badge>
              </div>
              <p className="my-3 text-sm text-slate-600">{topic.description}</p>
              <div className="space-y-2">
                {topic.posts?.map((post) => (
                  <div key={post.id} className="rounded bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between">
                      <b>
                        {post.authorName}
                        {post.aiGenerated ? '（AI）' : ''}
                      </b>
                      <span className="text-xs text-slate-400">
                        {new Date(post.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="my-2 whitespace-pre-wrap">{post.content}</p>
                    <div className="flex gap-2">
                      {topic.status === 'open' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const content = window.prompt(`回复 ${post.authorName}`)?.trim();
                            if (content)
                              void action(
                                {
                                  action: 'post',
                                  topicId: topic.id,
                                  parentPostId: post.id,
                                  content,
                                },
                                '回复已发布',
                              ).catch((error) => toast.error(error.message));
                          }}
                        >
                          回复
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const reason = window.prompt('请输入举报原因')?.trim();
                          if (reason)
                            void action(
                              { action: 'report', postId: post.id, reason },
                              '举报已提交',
                            ).catch((error) => toast.error(error.message));
                        }}
                      >
                        举报
                      </Button>
                    </div>
                  </div>
                ))}
                {!topic.posts?.length && <p className="text-sm text-slate-400">暂无回复。</p>}
              </div>
              {topic.status === 'open' && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget),
                      content = String(form.get('content') ?? '').trim();
                    if (!content) return;
                    void action(
                      { action: 'post', topicId: topic.id, parentPostId: null, content },
                      '发言已发布',
                    )
                      .then(() => event.currentTarget.reset())
                      .catch((error) => toast.error(error.message));
                  }}
                >
                  <textarea
                    name="content"
                    required
                    maxLength={10000}
                    rows={2}
                    placeholder="发表观点或提出问题……"
                    className="min-w-0 flex-1 rounded border p-2 text-sm"
                  />
                  <Button>发表</Button>
                </form>
              )}
            </article>
          ))}
          {!data.topics.length && <p className="text-sm text-slate-400">暂无开放的讨论主题。</p>}
        </div>
      </section>}
    </div>
  );
}
