'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Camera, Loader2, Save, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Profile = {
  displayName: string;
  loginName: string;
  studentNo: string;
  enrollmentYear: string;
  educationLevel: string;
  majorCode: string;
  majorName: string;
  learningCenter: string;
  studyStatus: string;
  tenantName: string;
  mobileMasked: string;
  email: string;
  qq: string;
  wechat: string;
  bio: string;
  avatarDataUrl: string;
};
const empty: Profile = {
  displayName: '',
  loginName: '',
  studentNo: '',
  enrollmentYear: '',
  educationLevel: '',
  majorCode: '',
  majorName: '',
  learningCenter: '',
  studyStatus: '',
  tenantName: '',
  mobileMasked: '',
  email: '',
  qq: '',
  wechat: '',
  bio: '',
  avatarDataUrl: '',
};

export function StudentPersonalSettings() {
  const [profile, setProfile] = useState<Profile>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void fetch('/api/zhiban/student/profile')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '个人信息加载失败');
        setProfile(body.profile);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);
  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
      return void toast.error('请选择 PNG、JPEG、WebP 或 GIF 图片');
    if (file.size > 1_000_000) return void toast.error('头像文件不能超过 1 MB');
    const reader = new FileReader();
    reader.onload = () =>
      setProfile((value) => ({ ...value, avatarDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/zhiban/student/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '保存失败');
      toast.success('个人信息已保存');
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-7xl p-5 md:p-8">
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
                        alt="学生头像"
                        className="size-full object-cover"
                      />
                    ) : (
                      <UserRound className="size-28" />
                    )}
                  </div>
                  <Label className="mt-5 inline-flex cursor-pointer items-center rounded bg-[#1677e8] px-4 py-2 text-white">
                    <Camera className="mr-2 size-4" />
                    上传头像
                    <input
                      className="hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={chooseAvatar}
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
                  <Readonly label="平台角色" value="学生" />
                  <Readonly label="学号" value={profile.studentNo} />
                  <Readonly label="登录账号" value={profile.loginName} />
                  <Readonly label="入学年份" value={String(profile.enrollmentYear)} />
                  <Readonly label="学历层次" value={profile.educationLevel} />
                  <Readonly label="专业" value={profile.majorName} />
                  <Readonly label="专业代码" value={profile.majorCode} />
                  <Readonly label="学习中心" value={profile.learningCenter} />
                  <Readonly label="所属机构" value={profile.tenantName} />
                </div>
              </section>
              <section className="border-t bg-slate-50 px-6 py-3 font-medium">
                账号绑定与联系方式
              </section>
              <section className="grid gap-5 p-6 md:grid-cols-2 md:p-8">
                <Readonly label="手机号" value={profile.mobileMasked || '未绑定'} />
                <Editable label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  />
                </Editable>
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
                <Button disabled={saving} className="bg-[#1677e8]">
                  <Save className="mr-2 size-4" />
                  {saving ? '保存中…' : '保存个人信息'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
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
