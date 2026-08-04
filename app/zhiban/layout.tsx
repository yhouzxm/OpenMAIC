import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '智伴·创学',
  description: '智伴·创学账号与权限管理平台',
};

export default function ZhibanLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-screen bg-slate-50 text-slate-950">{children}</div>;
}
