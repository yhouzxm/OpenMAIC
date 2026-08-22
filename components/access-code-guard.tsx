'use client';

import { useEffect, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AccessCodeModal } from '@/components/access-code-modal';

export function AccessCodeGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/access-code/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setStatus({
            enabled: data.enabled,
            authenticated: data.authenticated,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Default to requiring auth on error — safer than silently disabling
          setStatus({ enabled: true, authenticated: false, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const isZhibanRoute = pathname.startsWith('/zhiban');
  // Independent Zhiban OpenMAIC activity documents use the native classroom
  // editor/player route, but are protected by the Zhiban session and scoped
  // course RBAC in /api/classroom rather than the legacy site access code.
  const isZhibanActivityDocument = /^\/classroom\/zba_[a-zA-Z0-9_-]+$/.test(pathname);
  const isZhibanActivityGeneration =
    pathname === '/' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('zhibanActivityId');
  const isZhibanActivityGenerationPreview =
    pathname === '/generation-preview' &&
    typeof window !== 'undefined' &&
    Boolean(sessionStorage.getItem('zhibanActivityDraft'));
  const needsAuth =
    !isZhibanRoute &&
    !isZhibanActivityDocument &&
    !isZhibanActivityGeneration &&
    !isZhibanActivityGenerationPreview &&
    !status.loading &&
    status.enabled &&
    !status.authenticated;

  return (
    <>
      {needsAuth && (
        <AccessCodeModal
          open={true}
          onSuccess={() => setStatus((s) => ({ ...s, authenticated: true }))}
        />
      )}
      {children}
    </>
  );
}
