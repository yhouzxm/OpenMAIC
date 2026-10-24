'use client';
import { useState, useCallback, useRef } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { Slide } from '@openmaic/dsl';
import type { Scene, SlideContent } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';
import { inlineHtmlAssets, createAssetFetcher } from './inline-assets';
import type { FetchAsset } from './inline-assets';
import { createProxiedFetch } from './proxied-fetch';
import {
  listInteractivePages,
  pptxDeckScenes,
  planPptxDeck,
  slidesOnlyDeck,
  type PptxDeckEntry,
} from './pptx-scene-placeholders';
import { classroomPageUrl } from '@/lib/classroom/scene-deep-link';
import { resolveStoredBytes } from '@/lib/media/resolve-stored-bytes';
import {
  isConcreteMediaAddress,
  renderableMediaUrl,
  type MediaTaskState,
} from '@/lib/media/resolve-media-ref';
import { lookupMediaTask, resolveVideoMediaForElement } from '@/lib/media/media-task-resolution';
import { buildPptxBlob as buildNativePptx } from './pptx-builder';
import type { AssetUrlLeaseState } from '@/lib/media/use-asset-url';
import { MISSING_ASSET_LEASE, resolveMediaRef } from '@/lib/media/resolve-media-ref';
export {
  derivePptxMediaReferenceSet,
  isPptxManifestForeignRef,
  assertPptxMediaReferenceParity,
} from './pptx-builder';
const log = createLogger('ExportPPTX');
export function resolvePptxMediaBinding(
  ref: string | undefined,
  task: MediaTaskState | undefined,
  lease: AssetUrlLeaseState = MISSING_ASSET_LEASE,
  mediaGenerationDisabled = false,
) {
  const resolution = resolveMediaRef(ref, task, lease, mediaGenerationDisabled);
  return { resolution, src: renderableMediaUrl(resolution) ?? '' };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function resolvePptxEmbeddableSrc(
  ref: string | undefined,
  task: MediaTaskState | undefined,
  stageId?: string,
): Promise<string> {
  if (!ref) return '';
  if (!isConcreteMediaAddress(ref)) {
    const stored = await resolveStoredBytes(ref, {
      stageId,
      resolutionGating: true,
      loadCompatRow: true,
      taskUrlFallback: true,
      fetchPolicy: { requireOk: true, requireNonEmpty: false },
    });
    if (stored) return blobToDataUrl(stored);
  }
  const tasks = useMediaGenerationStore.getState().tasks;
  const effectiveTask = task ?? lookupMediaTask(tasks, ref, stageId);
  return renderableMediaUrl(resolvePptxMediaBinding(ref, effectiveTask).resolution) ?? '';
}

/** Preserve the native owner hook contract, supplying its original media paths explicitly. */
export function buildPptxBlob(
  slides: Slide[],
  slideScenes: Scene[],
  viewportRatio: number,
  viewportSize: number,
  ratioPx2Inch: number,
  ratioPx2Pt: number,
  stageId?: string,
  deck: readonly PptxDeckEntry[] = slidesOnlyDeck(slides.length),
): Promise<Blob> {
  return buildNativePptx(
    slides,
    slideScenes,
    viewportRatio,
    viewportSize,
    ratioPx2Inch,
    ratioPx2Pt,
    stageId,
    deck,
    false,
    {
      resolve: resolvePptxEmbeddableSrc,
      video: (el, id, elements) =>
        resolveVideoMediaForElement(useMediaGenerationStore.getState().tasks, el, id, elements),
    },
  );
}
// ── Resource Pack assembly (PPTX + interactive HTML pages as ZIP) ──
// Pure/async builder extracted from the hook so the assembly logic — which
// scenes make it into the ZIP, whether the PPTX builder runs — is unit-testable
// without a React/jsdom harness. The hook stays the only runtime caller.
//
// `getPptxBlob` is invoked whenever the lesson has a scene that gets a PPTX
// slide (`pptxDeckScenes`): a slide, a quiz, a PBL project or an interactive
// page, or only a slide for a slides-only export. With placeholders, every
// shipped HTML page has a placeholder slide, so a non-empty pack holds a PPTX;
// slides only, a lesson without slides ships its HTML pages alone
// (`skippedPptx`). Returns `empty: true` (and a null blob) when there is
// nothing to ship. The HTML page paths come from
// `listInteractivePages`, the same list the PPTX placeholder links use.

export interface ResourcePackResult {
  /** Generated ZIP blob, or null when there is nothing to ship. */
  blob: Blob | null;
  /** True when no scene could be exported (no PPTX slide, no HTML page). */
  empty: boolean;
  /**
   * True when the pack ships HTML pages without a PPTX: placeholder slides
   * are not wanted and the lesson has no slide scene.
   */
  skippedPptx: boolean;
  /** External asset URLs that could not be inlined into the HTML pages. */
  failedAssetUrls: string[];
}

export async function buildResourcePackZip(
  scenes: Scene[],
  opts: {
    viewportRatio: number;
    viewportSize: number;
    ratioPx2Inch: number;
    ratioPx2Pt: number;
    fileName: string;
    /** Called only when the lesson has PPTX content; produces the PPTX blob. */
    getPptxBlob: () => Promise<Blob>;
    /** Whether the PPTX includes placeholder slides (default true). */
    includePlaceholders?: boolean;
    /** Passed through to `inlineHtmlAssets`; tests inject a no-op fetcher. */
    fetcher?: FetchAsset;
  },
): Promise<ResourcePackResult> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const failedAssetUrls: string[] = [];

  const hasPptx =
    pptxDeckScenes(scenes, { includePlaceholders: opts.includePlaceholders }).length > 0;
  const pages = listInteractivePages(scenes);

  // Nothing to ship: no PPTX slide and no interactive page.
  if (!hasPptx && pages.length === 0) {
    return { blob: null, empty: true, skippedPptx: false, failedAssetUrls };
  }

  // 1. Add interactive HTML pages
  for (const page of pages) {
    const { html: inlinedHtml, report } = await inlineHtmlAssets(page.html, {
      fetcher: opts.fetcher,
    });
    for (const f of report.failed) {
      if (!failedAssetUrls.includes(f.url)) failedAssetUrls.push(f.url);
    }
    zip.file(page.path, inlinedHtml);
  }

  // 2. Generate the PPTX (slides, plus placeholders unless slides only).
  if (hasPptx) {
    const pptxBlob = await opts.getPptxBlob();
    // Convert to ArrayBuffer so jszip stores a plain byte buffer rather than a
    // Blob (which it can't reliably round-trip outside the browser).
    zip.file(`${opts.fileName}.pptx`, await pptxBlob.arrayBuffer());
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, empty: false, skippedPptx: !hasPptx, failedAssetUrls };
}

// ── Hook ──

export interface UseExportPPTXOptions {
  /**
   * Origin the placeholder slides link to (`<origin>/classroom/<id>`).
   * Defaults to the page's own origin; hosts serving the classroom elsewhere
   * can override it.
   */
  classroomOrigin?: string;
}

/** Per-export choices, made in the export menu. */
export interface PptxExportChoice {
  /**
   * Whether the PPTX includes placeholder slides for quiz, interactive and
   * PBL scenes (default true). When false it holds the slide scenes only.
   */
  includePlaceholders?: boolean;
}

export function useExportPPTX({ classroomOrigin }: UseExportPPTXOptions = {}) {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const { t } = useI18n();

  const scenes = useStageStore((s) => s.scenes);
  const stage = useStageStore((s) => s.stage);
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();

  const ratioPx2Inch = 96 * (viewportSize / 960);
  const ratioPx2Pt = (96 / 72) * (viewportSize / 960);

  const slideScenes = scenes.filter((s) => s.content.type === 'slide');
  const slides = slideScenes.map((s) => (s.content as SlideContent).canvas);

  // The online classroom page the placeholder slides link to (button + QR
  // code). Anyone with the link can open a classroom, so no status lookup is
  // needed; without a stage id there is nothing to link to.
  const getClassroomUrl = useCallback(
    () =>
      stage?.id ? classroomPageUrl(classroomOrigin ?? window.location.origin, stage.id) : undefined,
    [stage?.id, classroomOrigin],
  );

  // Shared guard + state wrapper for export actions.
  // `hasPptxContent` is passed by actions that need something to put in the
  // PPTX: slides, quizzes, PBL projects and interactive pages all become PPTX
  // slides (only slides when placeholders are off). The resource pack reports
  // an empty lesson itself via `result.empty`. When the guard rejects, callers
  // get a toast instead of silence.
  const withExportGuard = useCallback(
    (action: () => Promise<void>, hasPptxContent = true) => {
      if (exportingRef.current) return;
      if (!hasPptxContent) {
        toast.warning(t('export.noSlides'));
        return;
      }
      exportingRef.current = true;
      setExporting(true);
      setTimeout(async () => {
        try {
          await action();
        } catch (err) {
          log.error('Export failed:', err);
          toast.error(t('export.exportFailed'));
        } finally {
          exportingRef.current = false;
          setExporting(false);
        }
      }, 100);
    },
    [t],
  );

  // ── Export PPTX only ──
  const exportPPTX = useCallback(
    ({ includePlaceholders = true }: PptxExportChoice = {}) => {
      withExportGuard(
        async () => {
          const fileName = stage?.name || 'slides';
          // No Resource Pack next to a standalone PPTX, so placeholders link to
          // the online classroom only (no offline copy to point at).
          const deck = planPptxDeck(scenes, t, {
            linkInteractivePages: false,
            classroomUrl: getClassroomUrl(),
            includePlaceholders,
          });
          const blob = await buildPptxBlob(
            slides,
            slideScenes,
            viewportRatio,
            viewportSize,
            ratioPx2Inch,
            ratioPx2Pt,
            stage?.id,
            deck,
          );
          saveAs(blob, `${fileName}.pptx`);
          toast.success(t('export.exportSuccess'));
        },
        pptxDeckScenes(scenes, { includePlaceholders }).length > 0,
      );
    },
    [
      withExportGuard,
      getClassroomUrl,
      slides,
      slideScenes,
      scenes,
      stage,
      viewportSize,
      viewportRatio,
      ratioPx2Inch,
      ratioPx2Pt,
      t,
    ],
  );

  // ── Export Resource Pack (PPTX + interactive HTML pages as ZIP) ──
  // No PPTX-content check in the guard: `buildResourcePackZip` reports an
  // empty lesson itself and the hook shows "nothing to export".
  const exportResourcePack = useCallback(
    ({ includePlaceholders = true }: PptxExportChoice = {}) => {
      withExportGuard(async () => {
        const fileName = stage?.name || 'slides';
        const sharedFetcher = createAssetFetcher({ fetchImpl: createProxiedFetch() });
        const classroomUrl = getClassroomUrl();

        const result = await buildResourcePackZip(scenes, {
          viewportRatio,
          viewportSize,
          ratioPx2Inch,
          ratioPx2Pt,
          fileName,
          fetcher: sharedFetcher,
          getPptxBlob: () =>
            buildPptxBlob(
              slides,
              slideScenes,
              viewportRatio,
              viewportSize,
              ratioPx2Inch,
              ratioPx2Pt,
              stage?.id,
              planPptxDeck(scenes, t, {
                linkInteractivePages: true,
                classroomUrl,
                includePlaceholders,
              }),
            ),
          includePlaceholders,
        });

        if (result.empty) {
          toast.warning(t('export.nothingToExport'));
          return;
        }
        if (result.skippedPptx) {
          toast.info(t('export.noSlidesSkipped'));
        }
        saveAs(result.blob!, `${fileName}.zip`);
        toast.success(t('export.exportSuccess'));
        if (result.failedAssetUrls.length > 0) {
          log.warn(
            'Resource Pack: some interactive-scene assets could not be inlined:',
            result.failedAssetUrls,
          );
          const hosts = [
            ...new Set(
              result.failedAssetUrls.map((u) => {
                try {
                  return new URL(u).host;
                } catch {
                  return u;
                }
              }),
            ),
          ];
          toast.warning(t('export.inlinePartial', { count: result.failedAssetUrls.length }), {
            description: hosts.join(', '),
          });
        }
      });
    },
    [
      withExportGuard,
      getClassroomUrl,
      slides,
      slideScenes,
      scenes,
      stage,
      viewportSize,
      viewportRatio,
      ratioPx2Inch,
      ratioPx2Pt,
      t,
    ],
  );

  return { exporting, exportPPTX, exportResourcePack };
}
