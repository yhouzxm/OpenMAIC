'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, Loader2, Save, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TeacherTopbar } from './teacher-portal';

export interface TeacherPersonalProfile {
  displayName: string;
  loginName: string;
  employeeNo: string;
  department: string;
  professionalTitle: string;
  employmentStatus: string;
  tenantName: string;
  mobileMasked: string;
  email: string;
  qq: string;
  wechat: string;
  weibo: string;
  bio: string;
  avatarDataUrl: string;
}

const emptyProfile: TeacherPersonalProfile = {
  displayName: '',
  loginName: '',
  employeeNo: '',
  department: '',
  professionalTitle: '',
  employmentStatus: '',
  tenantName: '',
  mobileMasked: '',
  email: '',
  qq: '',
  wechat: '',
  weibo: '',
  bio: '',
  avatarDataUrl: '',
};

export function TeacherPersonalSettings({ principalName }: { principalName: string }) {
  const [profile, setProfile] = useState<TeacherPersonalProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/zhiban/teacher/profile')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '个人信息加载失败');
        setProfile(body.profile);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('请选择 PNG、JPEG、WebP 或 GIF 图片');
      return;
    }
    if (file.size > 1_000_000) {
      toast.error('头像文件不能超过 1 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setProfile((current) => ({ ...current, avatarDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/zhiban/teacher/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '保存失败');
      toast.success('个人信息已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f1f5fb]">
      <TeacherTopbar principalName={profile.displayName || principalName} />
      <div className="mx-auto max-w-7xl p-5 md:p-8">
        <div className="mb-4">
          <Button asChild variant="outline">
            <Link href="/zhiban/teacher/courses">
              <ArrowLeft className="mr-2 size-4" />
              返回我的课程
            </Link>
          </Button>
        </div>
        <Card className="rounded-sm">
          <CardHeader className="border-b bg-slate-50">
            <CardTitle>个人设置</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center p-20">
                <Loader2 className="size-7 animate-spin text-blue-600" />
              </div>
            ) : (
              <form onSubmit={submit}>
                <section className="grid gap-8 p-6 md:grid-cols-[260px_1fr] md:p-8">
                  <div className="text-center">
                    <div className="mx-auto flex size-44 items-center justify-center overflow-hidden rounded-full border-4 border-[#1677e8] bg-blue-50 text-[#1677e8]">
                      {profile.avatarDataUrl ? (
                        <img
                          src={profile.avatarDataUrl}
                          alt="教师头像"
                          className="size-full object-cover"
                        />
                      ) : (
                        <UserRound className="size-28" />
                      )}
                    </div>
                    <Label className="mt-5 inline-flex cursor-pointer items-center rounded bg-[#1677e8] px-4 py-2 text-white hover:bg-blue-700">
                      <Camera className="mr-2 size-4" />
                      上传头像
                      <input
                        className="hidden"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(event) => void chooseAvatar(event)}
                      />
                    </Label>
                    <p className="mt-2 text-xs text-slate-500">
                      支持 PNG、JPEG、WebP、GIF，最大 1 MB
                    </p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Editable label="姓名">
                      <Input
                        value={profile.displayName}
                        onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                        required
                      />
                    </Editable>
                    <Readonly label="平台角色" value="教师" />
                    <Readonly label="人员编号" value={profile.employeeNo} />
                    <Readonly label="登录账号" value={profile.loginName} />
                    <Editable label="院系">
                      <Input
                        value={profile.department}
                        onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                      />
                    </Editable>
                    <Editable label="职称">
                      <Input
                        value={profile.professionalTitle}
                        onChange={(e) =>
                          setProfile({ ...profile, professionalTitle: e.target.value })
                        }
                      />
                    </Editable>
                    <Readonly label="所属机构" value={profile.tenantName} />
                    <Readonly
                      label="在职状态"
                      value={
                        profile.employmentStatus === 'active' ? '在职' : profile.employmentStatus
                      }
                    />
                  </div>
                </section>
                <section className="border-t bg-slate-50 px-6 py-3 font-medium">
                  账号与联系方式
                </section>
                <section className="grid gap-5 p-6 md:grid-cols-2 md:p-8">
                  <Editable label="Email">
                    <Input
                      type="email"
                      value={profile.email}
                      onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    />
                  </Editable>
                  <Readonly label="手机号" value={profile.mobileMasked || '未绑定'} />
                  <Editable label="QQ">
                    <Input
                      value={profile.qq}
                      onChange={(e) => setProfile({ ...profile, qq: e.target.value })}
                    />
                  </Editable>
                  <Editable label="微信">
                    <Input
                      value={profile.wechat}
                      onChange={(e) => setProfile({ ...profile, wechat: e.target.value })}
                    />
                  </Editable>
                  <Editable label="微博">
                    <Input
                      value={profile.weibo}
                      onChange={(e) => setProfile({ ...profile, weibo: e.target.value })}
                    />
                  </Editable>
                  <div className="md:col-span-2">
                    <Editable label="个人简介">
                      <Textarea
                        rows={4}
                        value={profile.bio}
                        onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                      />
                    </Editable>
                  </div>
                </section>
                <div className="border-t px-6 py-5 md:px-8">
                  <Button disabled={saving} className="bg-[#1677e8] hover:bg-blue-700">
                    <Save className="mr-2 size-4" />
                    {saving ? '保存中…' : '保存个人信息'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Editable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex h-10 items-center rounded border bg-slate-50 px-3 text-sm text-slate-600">
        {value || '未设置'}
      </div>
    </div>
  );
}
