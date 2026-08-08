'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ZhibanLogoutButton({
  variant = 'secondary',
  className = '',
}: {
  variant?: 'secondary' | 'outline';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/zhiban/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/zhiban/login');
      router.refresh();
    }
  }
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={busy}
      onClick={() => void logout()}
    >
      <LogOut className="mr-2 size-4" />
      {busy ? '退出中…' : '退出'}
    </Button>
  );
}
