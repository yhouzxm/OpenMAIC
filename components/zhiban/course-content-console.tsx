'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Link2, MessageSquare, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ActivityContentRecord,
  CourseResourceRecord,
  DiscussionTopicRecord,
} from '@/lib/zhiban/content';

type Activity = { id: string; title: string; type: string; chapterTitle: string };
type Data = {
  activities: Activity[];
  contents: ActivityContentRecord[];
  resources: CourseResourceRecord[];
  topics: DiscussionTopicRecord[];
  gradeItems: Array<{ id: string; name: string; maxScore: number }>;
};

export function CourseContentConsole({ courseId, initialContentActivityId = '' }: { courseId: string; initialContentActivityId?: string }) {
  const [data, setData] = useState<Data>({
    activities: [],
    contents: [],
    resources: [],
    topics: [],
    gradeItems: [],
  });
  const [tab, setTab] = useState<'content' | 'resources' | 'discussions'>('content');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/content`),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '课程内容加载失败');
    setData(body);
  }, [courseId]);
  useEffect(() => {
    void fetch(`/api/zhiban/teacher/courses/${courseId}/content`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '课程内容加载失败');
        setData(body);
      })
      .catch((error) => toast.error(error.message));
  }, [courseId]);
  const act = async (payload: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/content`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      toast.success(message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="course-content" className="scroll-mt-20 border bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b p-4">
        <h2 className="mr-auto text-lg font-semibold">内容、资源与讨论</h2>
        <Button asChild variant="outline">
          <Link href={`/zhiban/teacher/courses/${courseId}/grades?courseId=${courseId}`}>
            作业与测评
          </Link>
        </Button>
        <Tab active={tab === 'content'} onClick={() => setTab('content')} icon={FileText}>
          章节内容
        </Tab>
        <Tab active={tab === 'resources'} onClick={() => setTab('resources')} icon={Upload}>
          课程资源
        </Tab>
        <Tab
          active={tab === 'discussions'}
          onClick={() => setTab('discussions')}
          icon={MessageSquare}
        >
          讨论区
        </Tab>
      </header>
      <div className="p-5">
        {tab === 'content' && (
          <ContentManager
            activities={data.activities}
            contents={data.contents}
            initialActivityId={initialContentActivityId}
            busy={busy}
            onSave={(payload) => act(payload, '章节内容已保存')}
          />
        )}{' '}
        {tab === 'resources' && (
          <ResourceManager
            courseId={courseId}
            activities={data.activities}
            resources={data.resources}
            busy={busy}
            reload={load}
            onAction={act}
          />
        )}{' '}
        {tab === 'discussions' && (
          <DiscussionManager
            activities={data.activities}
            topics={data.topics}
            gradeItems={data.gradeItems}
            busy={busy}
            onAction={act}
          />
        )}
      </div>
    </section>
  );
}

function ContentManager({
  activities,
  contents,
  initialActivityId,
  busy,
  onSave,
}: {
  activities: Activity[];
  contents: ActivityContentRecord[];
  initialActivityId: string;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const eligible = useMemo(() => activities.filter((item) =>
    ['content', 'summary', 'ai_support'].includes(item.type),
  ), [activities]);
  const [activityId, setActivityId] = useState(initialActivityId);
  const selected = contents.find((item) => item.activityId === activityId);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">章节图文内容</h3>
        <p className="mt-1 text-sm text-slate-500">
          为图文、章节总结或 AI 辅导活动编写内容；发布后学生可阅读。
        </p>
      </div>
      <form
        key={`${activityId}-${selected?.version ?? 0}`}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            action: 'save_content',
            activityId: String(form.get('activityId')),
            format: String(form.get('format')),
            body: String(form.get('body') ?? ''),
            status: String(form.get('status')),
          });
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <select
            name="activityId"
            required
            value={activityId}
            onChange={(event) => setActivityId(event.target.value)}
            className="h-9 rounded border bg-white px-3 text-sm"
          >
            <option value="">选择学习活动</option>
            {eligible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.chapterTitle} / {item.title}
              </option>
            ))}
          </select>
          <select
            name="format"
            defaultValue={selected?.format ?? 'markdown'}
            className="h-9 rounded border bg-white px-3 text-sm"
          >
            <option value="markdown">Markdown</option>
            <option value="plain_text">纯文本</option>
            <option value="html">HTML</option>
          </select>
          <select
            name="status"
            defaultValue={selected?.status ?? 'draft'}
            className="h-9 rounded border bg-white px-3 text-sm"
          >
            <option value="draft">草稿</option>
            <option value="published">发布</option>
          </select>
        </div>
        <textarea
          name="body"
          rows={14}
          defaultValue={selected?.body ?? ''}
          placeholder="输入章节正文……"
          className="w-full rounded border p-3 font-mono text-sm"
          maxLength={200000}
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>{selected ? `当前版本 v${selected.version}` : '尚未保存内容'}</span>
          <Button disabled={busy || !activityId}>保存内容</Button>
        </div>
      </form>
      {!eligible.length && (
        <p className="rounded bg-amber-50 p-4 text-sm text-amber-700">
          请先在课程结构中创建“图文内容”“章节总结”或“AI 辅导”活动。
        </p>
      )}
    </div>
  );
}

function ResourceManager({
  courseId,
  activities,
  resources,
  busy,
  reload,
  onAction,
}: {
  courseId: string;
  activities: Activity[];
  resources: CourseResourceRecord[];
  busy: boolean;
  reload: () => Promise<void>;
  onAction: (payload: Record<string, unknown>, message: string) => void;
}) {
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/resources`, {
        method: 'POST',
        body: form,
      }),
      body = await response.json();
    if (!response.ok) {
      toast.error(body.error ?? '上传失败');
      return;
    }
    toast.success('资源已上传');
    event.currentTarget.reset();
    await reload();
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-2">
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onAction(
              {
                action: 'create_link_resource',
                title: String(form.get('title')),
                description: String(form.get('description') ?? ''),
                url: String(form.get('url')),
                resourceType: 'link',
                activityIds: form.getAll('activityIds').map(String),
                downloadAllowed: true,
                aiIndexEnabled: form.get('aiIndexEnabled') === 'on',
              },
              '链接资源已创建',
            );
            event.currentTarget.reset();
          }}
        >
          <h3 className="font-semibold">
            <Link2 className="mr-2 inline size-4" />
            新增链接资源
          </h3>
          <Input name="title" required placeholder="资源名称" />
          <Input name="url" required type="url" placeholder="https://..." />
          <Input name="description" placeholder="资源说明" />
          <ActivityChecks activities={activities} />
          <label className="flex gap-2 text-sm">
            <input name="aiIndexEnabled" type="checkbox" />
            纳入 Tutor 知识库
          </label>
          <Button disabled={busy}>保存链接</Button>
        </form>
        <form className="space-y-3 rounded border p-4" onSubmit={(event) => void upload(event)}>
          <h3 className="font-semibold">
            <Upload className="mr-2 inline size-4" />
            上传文件资源
          </h3>
          <Input name="title" required placeholder="资源名称" />
          <Input name="description" placeholder="资源说明" />
          <Input name="file" type="file" required />
          <select name="resourceType" className="h-9 w-full rounded border bg-white px-3 text-sm">
            <option value="document">文档</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="image">图片</option>
            <option value="dataset">数据集</option>
            <option value="other">其他</option>
          </select>
          <ActivityChecks activities={activities} />
          <label className="flex gap-2 text-sm">
            <input name="aiIndexEnabled" value="true" type="checkbox" />
            纳入 Tutor 知识库
          </label>
          <input type="hidden" name="downloadAllowed" value="true" />
          <Button disabled={busy}>上传（最大 15MB）</Button>
        </form>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">资源列表</h3>
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm"
          >
            <Badge variant="outline">{resource.resourceType}</Badge>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{resource.title}</p>
              <p className="text-xs text-slate-500">
                {resource.fileName || resource.url} ·{' '}
                {resource.aiIndexEnabled ? '已纳入 AI 知识库' : '未纳入 AI 知识库'}
              </p>
            </div>
            {resource.url ? (
              <Button asChild size="sm" variant="outline">
                <a href={resource.url} target="_blank" rel="noreferrer">
                  打开
                </a>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href={`/api/zhiban/resources/${resource.id}`}>下载</Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const title = window.prompt('资源名称', resource.title)?.trim();
                if (!title) return;
                const description =
                  window.prompt('资源说明', resource.description) ?? resource.description;
                onAction(
                  {
                    action: 'update_resource',
                    id: resource.id,
                    title,
                    description,
                    status: resource.status,
                    activityIds: resource.activityIds,
                    downloadAllowed: resource.downloadAllowed,
                    aiIndexEnabled: resource.aiIndexEnabled,
                  },
                  '资源信息已修改',
                );
              }}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={resource.status === 'archived'}
              onClick={() =>
                onAction(
                  {
                    action: 'update_resource',
                    id: resource.id,
                    title: resource.title,
                    description: resource.description,
                    status: 'archived',
                    activityIds: resource.activityIds,
                    downloadAllowed: resource.downloadAllowed,
                    aiIndexEnabled: resource.aiIndexEnabled,
                  },
                  '资源已归档',
                )
              }
            >
              归档
            </Button>
            {!resource.url && resource.status !== 'archived' && (
              <form onSubmit={(event) => void upload(event)} className="flex items-center gap-2">
                <input type="hidden" name="resourceId" value={resource.id} />
                <input name="file" type="file" required className="max-w-48 text-xs" />
                <Button size="sm" variant="outline">
                  替换文件
                </Button>
              </form>
            )}
            {resource.versions?.map((version) => (
              <Button
                key={version.id}
                size="sm"
                variant="ghost"
                onClick={() =>
                  onAction(
                    { action: 'restore_resource', resourceId: resource.id, versionId: version.id },
                    `已恢复历史版本 v${version.version}`,
                  )
                }
              >
                恢复 v{version.version}
              </Button>
            ))}
          </div>
        ))}
        {!resources.length && <p className="text-sm text-slate-400">暂无课程资源。</p>}
      </div>
    </div>
  );
}

function DiscussionManager({
  activities,
  topics,
  gradeItems,
  busy,
  onAction,
}: {
  activities: Activity[];
  topics: DiscussionTopicRecord[];
  gradeItems: Array<{ id: string; name: string; maxScore: number }>;
  busy: boolean;
  onAction: (payload: Record<string, unknown>, message: string) => void;
}) {
  const discussionActivities = activities.filter((item) => item.type === 'discussion');
  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 rounded border p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onAction(
            {
              action: 'create_topic',
              activityId: String(form.get('activityId') || '') || null,
              title: String(form.get('title')),
              description: String(form.get('description') ?? ''),
              status: 'open',
              pinned: form.get('pinned') === 'on',
              graded: form.get('graded') === 'on',
              gradeItemId: String(form.get('gradeItemId') || '') || null,
            },
            '讨论主题已创建',
          );
          event.currentTarget.reset();
        }}
      >
        <h3 className="font-semibold md:col-span-2">创建讨论主题</h3>
        <Input name="title" required placeholder="讨论主题" />
        <select name="activityId" className="h-9 rounded border bg-white px-3 text-sm">
          <option value="">课程公共讨论</option>
          {discussionActivities.map((item) => (
            <option key={item.id} value={item.id}>
              {item.chapterTitle} / {item.title}
            </option>
          ))}
        </select>
        <textarea
          name="description"
          rows={3}
          placeholder="讨论说明"
          className="rounded border p-3 text-sm md:col-span-2"
        />
        <label className="flex gap-2 text-sm">
          <input name="pinned" type="checkbox" />
          置顶
        </label>
        <select name="gradeItemId" className="h-9 rounded border bg-white px-3 text-sm">
          <option value="">不关联成绩项</option>
          {gradeItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}（{item.maxScore}分）
            </option>
          ))}
        </select>
        <label className="flex gap-2 text-sm">
          <input name="graded" type="checkbox" />
          计入讨论参与评价
        </label>
        <Button disabled={busy} className="md:col-span-2">
          创建并开放
        </Button>
      </form>
      <div className="space-y-3">
        {topics.map((topic) => (
          <article key={topic.id} className="rounded border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">{topic.title}</h4>
              {topic.pinned && <Badge>置顶</Badge>}
              <Badge variant="outline">{topic.status}</Badge>
              <span className="ml-auto text-xs text-slate-500">{topic.postCount} 条回复</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onAction(
                    {
                      action: 'update_topic',
                      id: topic.id,
                      title: topic.title,
                      description: topic.description,
                      status: topic.status === 'open' ? 'closed' : 'open',
                      pinned: topic.pinned,
                      graded: topic.graded,
                      gradeItemId: topic.gradeItemId ?? null,
                    },
                    topic.status === 'open' ? '讨论已关闭' : '讨论已开放',
                  )
                }
              >
                {topic.status === 'open' ? '关闭' : '重新开放'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const title = window.prompt('讨论主题', topic.title)?.trim();
                  if (!title) return;
                  const description =
                    window.prompt('讨论说明', topic.description) ?? topic.description;
                  onAction(
                    {
                      action: 'update_topic',
                      id: topic.id,
                      title,
                      description,
                      status: topic.status,
                      pinned: topic.pinned,
                      graded: topic.graded,
                      gradeItemId: topic.gradeItemId ?? null,
                    },
                    '讨论主题已修改',
                  );
                }}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={topic.status === 'archived'}
                onClick={() =>
                  onAction(
                    {
                      action: 'update_topic',
                      id: topic.id,
                      title: topic.title,
                      description: topic.description,
                      status: 'archived',
                      pinned: topic.pinned,
                      graded: topic.graded,
                      gradeItemId: topic.gradeItemId ?? null,
                    },
                    '讨论主题已归档',
                  )
                }
              >
                归档
              </Button>
            </div>
            <p className="my-2 text-sm text-slate-600">{topic.description}</p>
            <div className="space-y-2">
              {topic.posts?.map((post) => (
                <div
                  key={post.id}
                  className={`rounded bg-slate-50 p-3 text-sm ${post.status !== 'published' ? 'opacity-50' : ''}`}
                >
                  <div className="flex justify-between">
                    <b>{post.authorName}</b>
                    <span className="text-xs">
                      {post.status} · {new Date(post.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="my-2 whitespace-pre-wrap">{post.content}</p>
                  {post.status === 'published' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onAction(
                            {
                              action: 'moderate_post',
                              postId: post.id,
                              moderationAction: 'hide',
                              reason: '教师审核隐藏',
                            },
                            '帖子已隐藏',
                          )
                        }
                      >
                        隐藏
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const content = window.prompt(`回复 ${post.authorName}`)?.trim();
                          if (content)
                            onAction(
                              {
                                action: 'teacher_post',
                                topicId: topic.id,
                                parentPostId: post.id,
                                content,
                              },
                              '教师回复已发布',
                            );
                        }}
                      >
                        回复
                      </Button>
                      {topic.graded && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const raw = window.prompt(
                              `为 ${post.authorName} 的讨论参与评分（0-100）`,
                            );
                            if (raw === null) return;
                            const score = Number(raw);
                            if (!Number.isFinite(score) || score < 0 || score > 100)
                              return toast.error('请输入 0-100 的分数');
                            const feedback = window.prompt('评分反馈') ?? '';
                            onAction(
                              {
                                action: 'score_discussion',
                                topicId: topic.id,
                                studentId: post.authorId,
                                score,
                                feedback,
                              },
                              '讨论评分已保存',
                            );
                          }}
                        >
                          评分
                        </Button>
                      )}
                    </div>
                  ) : post.status === 'hidden' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onAction(
                          {
                            action: 'moderate_post',
                            postId: post.id,
                            moderationAction: 'restore',
                            reason: '教师恢复',
                          },
                          '帖子已恢复',
                        )
                      }
                    >
                      恢复
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
        {!topics.length && <p className="text-sm text-slate-400">暂无讨论主题。</p>}
      </div>
    </div>
  );
}

function ActivityChecks({ activities }: { activities: Activity[] }) {
  return (
    <div className="max-h-28 space-y-1 overflow-y-auto rounded border p-2">
      {activities.map((item) => (
        <label key={item.id} className="flex gap-2 text-xs">
          <input type="checkbox" name="activityIds" value={item.id} />
          {item.chapterTitle} / {item.title}
        </label>
      ))}
      {!activities.length && <span className="text-xs text-slate-400">暂无活动</span>}
    </div>
  );
}
function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" variant={active ? 'default' : 'outline'} onClick={onClick}>
      <Icon className="mr-2 size-4" />
      {children}
    </Button>
  );
}
