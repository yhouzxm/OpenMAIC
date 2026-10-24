import { fileMimes, fileAccept } from '../../domain/learning/file-policy';
import { parserFor, type MaterialParserProfile } from '../../infrastructure/material/config';
import { createHash } from 'node:crypto';
import type { AcademicContext, AcademicStore } from '../academic/service';
import { academicId, requireAcademic, type AcademicActor } from '../../domain/academic/model';
import { materialCommand, type MaterialCommand } from '../../domain/material/model';
import type { SubmissionFileClearance } from '../learning/attachment-assets';
import { parseMaterial, type ParsedMaterial } from '../../infrastructure/material/parser';
export type PreparedMaterial = ParsedMaterial & { digest: string; scannerReference: string };
export interface MaterialTransaction {
  replay(
    a: AcademicActor,
    o: string,
    c: MaterialCommand,
    key: string,
  ): Promise<Record<string, unknown> | null>;
  access(a: AcademicActor, offering: string, write?: boolean): Promise<void>;
  list(a: AcademicActor, offering: string): Promise<Record<string, unknown>>;
  read(
    a: AcademicActor,
    offering: string,
    id: string,
    draft: boolean,
    version: string | null,
    bytes: boolean,
  ): Promise<Record<string, unknown>>;
  execute(
    a: AcademicActor,
    offering: string,
    c: MaterialCommand,
    key: string,
    prepared: PreparedMaterial | null,
  ): Promise<Record<string, unknown>>;
}
export class MaterialService {
  private busy = false;
  constructor(
    private readonly store: AcademicStore,
    private readonly scanner: SubmissionFileClearance | null,
    private readonly parserProfile: MaterialParserProfile = {},
  ) {}
  list(x: AcademicContext, o: string) {
    academicId(o);
    return this.store.run(x, null, (a, tx) => {
      requireAcademic(!!tx.material, 'UNAVAILABLE');
      return tx.material!.list(a, o).then((value) => ({
        ...value,
        upload: {
          scannerReady: this.scanner?.mode === 'TRUSTED_SCANNER',
          accept: fileAccept,
          formats: fileMimes.map((mime) => ({
            mime,
            configured: !!parserFor(mime, this.parserProfile),
          })),
        },
      }));
    });
  }
  read(
    x: AcademicContext,
    o: string,
    id: string,
    draft = false,
    version: string | null = null,
    bytes = false,
  ) {
    academicId(o);
    academicId(id);
    requireAcademic(version === null || /^[1-9][0-9]{0,8}$/.test(version));
    requireAcademic(!draft || version === null);
    return this.store.run(x, null, (a, tx) => {
      requireAcademic(!!tx.material, 'UNAVAILABLE');
      return tx.material!.read(a, o, id, draft, version, bytes);
    });
  }
  async command(x: AcademicContext, o: string, input: unknown, key: string) {
    academicId(o);
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const c = materialCommand(input);
    // Reject unauthorized requests before scanning/parsing; recheck after external work.
    const previous = await this.store.run(x, null, async (a, tx) => {
      requireAcademic(!!tx.material, 'UNAVAILABLE');
      return tx.material!.replay(a, o, c, key);
    });
    if (previous) return previous;
    let prepared: PreparedMaterial | null = null;
    if (c.type === 'UPLOAD_MATERIAL') {
      requireAcademic(!this.busy && this.scanner?.mode === 'TRUSTED_SCANNER', 'UNAVAILABLE');
      requireAcademic(!!parserFor(c.file.mime, this.parserProfile), 'UNAVAILABLE');
      this.busy = true;
      try {
        const evidence = await this.scanner!.check({
          name: c.file.name,
          mime: c.file.mime,
          base64: c.file.base64,
        });
        const digest = createHash('sha256')
          .update(Buffer.from(c.file.base64, 'base64'))
          .digest('hex');
        requireAcademic(
          evidence?.mode === 'TRUSTED_SCANNER' && evidence.digest === digest,
          'UNAVAILABLE',
        );
        let parsed: ParsedMaterial;
        try {
          parsed = await parseMaterial(c.file, this.parserProfile);
        } catch {
          requireAcademic(false, 'INVALID_INPUT');
        }
        prepared = { ...parsed!, digest, scannerReference: evidence!.reference };
      } finally {
        this.busy = false;
      }
    }
    return this.store.run(x, null, (a, tx) => {
      requireAcademic(!!tx.material, 'UNAVAILABLE');
      return tx.material!.execute(a, o, c, key, prepared);
    });
  }
}
