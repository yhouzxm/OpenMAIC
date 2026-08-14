'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'next/navigation';
import { AdministrativeClassConsole } from '@/components/zhiban/administrative-class-console';
import { DirectoryConsole } from '@/components/zhiban/directory-console';
export function StudentRegistryConsole() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'students' ? 'students' : 'classes';
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">学籍管理</h1>
        <p className="mt-1 text-sm text-slate-500">统一管理学生学籍信息和行政班级。</p>
      </div>
      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="classes">行政班级管理</TabsTrigger>
          <TabsTrigger value="students">学生信息管理</TabsTrigger>
        </TabsList>
        <TabsContent value="classes">
          <AdministrativeClassConsole />
        </TabsContent>
        <TabsContent value="students">
          <DirectoryConsole mode="students" embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
