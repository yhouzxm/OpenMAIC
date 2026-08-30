import Link from 'next/link';
import { GraduationCap, LogIn } from 'lucide-react';

import { LearningCenter } from '@/components/zhiban/learning-center';
import { Button } from '@/components/ui/button';

export function PublicLearningCenterHome() {
  return (
    <div className="min-h-screen bg-[#f1f5fb] text-slate-800">
      <header className="sticky top-0 z-40 flex h-[52px] items-center justify-between bg-[#176fda] px-4 text-white shadow-sm md:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="智伴·创学首页">
          <span className="flex size-8 items-center justify-center rounded-full border-2 border-white">
            <GraduationCap className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg">智伴·创学</span>
        </Link>
        <Button
          asChild
          variant="outline"
          className="border-white/70 bg-transparent text-white hover:bg-white/15 hover:text-white"
        >
          <Link href="/zhiban/login">
            <LogIn className="mr-2 size-4" aria-hidden="true" />
            登录
          </Link>
        </Button>
      </header>
      <LearningCenter courseId="mech-mechatronics-system" publicMode />
    </div>
  );
}
