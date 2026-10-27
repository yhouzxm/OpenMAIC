import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStageStore } from '@/lib/store/stage';
import {
  sharedPlaybackCursor,
  applySharedPlayback,
  pauseSharedPlayback,
} from '@/lib/classroom/shared-playback';
import type { PublicPlayback } from '@/lib/zhiban/infrastructure/classroom-live/model';
type Shared = {
  revision: string;
  active: boolean;
  controller: string | null;
  state: PublicPlayback | null;
};
export function ClassroomSharing({ base, teacher }: { base: string; teacher: boolean }) {
  const [current, setCurrent] = useState<Shared>({
      revision: '0',
      active: false,
      controller: null,
      state: null,
    }),
    [follow, setFollow] = useState(false),
    [broadcast, setBroadcast] = useState(false),
    [board, setBoard] = useState(''),
    [summary, setSummary] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef(crypto.randomUUID()),
    state = useRef(current),
    sharing = useRef(false),
    following = useRef(false),
    draft = useRef({ board, summary }),
    alive = useRef(true),
    lastApplied = useRef(''),
    pending = useRef(false),
    polling = useRef(false);
  state.current = current;
  sharing.current = broadcast;
  following.current = follow;
  draft.current = { board, summary };
  const api = useCallback(
    async (payload?: unknown) => {
      const r = await fetch(
        base + '/shared',
        payload
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(5000),
            }
          : { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok)
        throw Error(
          r.status === 409
            ? '共享控制或版本已变化，请核对后重新接管。'
            : '课程资格、发布版本或连接已变化；已暂停跟随。',
        );
      return (await r.json()) as Shared;
    },
    [base],
  );
  const capture = useCallback((): PublicPlayback => {
    const s = useStageStore.getState(),
      cursor = sharedPlaybackCursor();
    if (!s.currentSceneId) throw Error('课件尚未载入，请稍后再共享');
    return {
      ...draft.current,
      sceneId: s.currentSceneId,
      actionIndex:
        cursor?.sceneId === s.currentSceneId
          ? Math.min(
              cursor.actionIndex,
              Math.max(
                0,
                (s.scenes.find((scene) => scene.id === s.currentSceneId)?.actions?.length ?? 0) - 1,
              ),
            )
          : 0,
      mode: cursor?.sceneId === s.currentSceneId ? cursor.mode : 'paused',
    };
  }, []);
  const publish = useCallback(
    async (kind: 'START' | 'UPDATE' | 'STOP') => {
      const value = await api({
        kind,
        revision: state.current.revision,
        controller: controller.current,
        state: capture(),
      });
      state.current = value;
      if (alive.current) setCurrent(value);
      return value;
    },
    [api, capture],
  );
  useEffect(() => {
    alive.current = true;
    let running = false;
    const tick = async () => {
      if (running || pending.current) return;
      running = true;
      polling.current = true;
      try {
        if (sharing.current && !pending.current) {
          const v = await publish('UPDATE');
          if (alive.current) setCurrent(v);
        } else {
          const v = await api();
          if (!alive.current) return;
          state.current = v;
          setCurrent(v);
          if (following.current) {
            if (!v.active || !v.state) {
              pauseSharedPlayback();
              lastApplied.current = '';
              setNotice('共享已停止或超过心跳期限，当前播放已暂停。');
            } else {
              const key = JSON.stringify({
                scene: v.state.sceneId,
                action: v.state.actionIndex,
                mode: v.state.mode,
              });
              if (key !== lastApplied.current) {
                const s = useStageStore.getState();
                if (s.scenes.some((x) => x.id === v.state!.sceneId)) {
                  if (s.currentSceneId !== v.state.sceneId) s.setCurrentSceneId(v.state.sceneId);
                  else if (await applySharedPlayback(v.state)) lastApplied.current = key;
                }
              }
              setNotice('正在跟随教师共享；可随时退出跟随。');
            }
          }
        }
      } catch (e) {
        if (alive.current) {
          pauseSharedPlayback();
          setBroadcast(false);
          setFollow(false);
          setCurrent({
            revision: state.current.revision,
            active: false,
            state: null,
            controller: null,
          });
          setNotice((e as Error).message);
        }
      } finally {
        running = false;
        polling.current = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      alive.current = false;
      clearInterval(t);
      if (following.current) pauseSharedPlayback();
    };
  }, [api, publish]);
  const action = async (kind: 'START' | 'STOP') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      while (polling.current) await new Promise((resolve) => setTimeout(resolve, 25));
      await publish(kind);
      setBroadcast(kind === 'START');
      setNotice(
        kind === 'START'
          ? '已共享当前课件位置、播放状态和下方公开文字。'
          : '已停止共享并清除共享文字。',
      );
    } catch (e) {
      setBroadcast(false);
      setNotice((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="classroom-sharing" aria-label="教师课堂共享">
      <details open={follow || broadcast || current.active}>
        <summary>教师课堂共享 · {current.active ? '进行中' : '未共享'}</summary>
        <p>共享课件位置、播放状态及教师公开文字；学生需主动跟随，退出后恢复自主学习。</p>
        {teacher ? (
          <>
            <label>
              公开板书
              <textarea
                aria-label="公开板书"
                maxLength={8000}
                value={board}
                onChange={(e) => setBoard(e.target.value)}
              />
            </label>
            <label>
              公开课堂小结
              <textarea
                aria-label="公开课堂小结"
                maxLength={4000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <button disabled={busy} onClick={() => void action('START')}>
              {broadcast ? '重新发布共享' : current.active ? '接管课堂共享' : '开始课堂共享'}
            </button>
            <button disabled={busy || !current.active} onClick={() => void action('STOP')}>
              停止课堂共享
            </button>
            <small>开启期间每两秒发送当前公开状态；关闭页面后 15 秒内停止共享。</small>
          </>
        ) : (
          <button
            disabled={!current.active && !follow}
            onClick={() => {
              const next = !follow;
              following.current = next;
              setFollow(next);
              lastApplied.current = '';
              if (!next) pauseSharedPlayback();
            }}
          >
            {follow ? '退出跟随' : '跟随教师'}
          </button>
        )}
        {current.active && current.state && (
          <div className="shared-public-text">
            <strong>教师公开板书</strong>
            <pre>{current.state.board || '暂无板书'}</pre>
            <strong>课堂小结</strong>
            <p>{current.state.summary || '暂无小结'}</p>
          </div>
        )}
        <p role="status">{notice}</p>
      </details>
    </section>
  );
}
