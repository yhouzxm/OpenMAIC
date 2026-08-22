import { TeacherTeachingAnalytics } from '@/components/zhiban/teacher-teaching-analytics';
export default async function Page({params}:{params:Promise<{courseId:string}>}){const{courseId}=await params;return <TeacherTeachingAnalytics courseId={courseId}/>;}
