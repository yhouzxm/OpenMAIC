// Test-only candidate boundary. It is neither an Identity adapter nor a production Policy.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AssetStore, DocumentStore, MaicDocument, RuntimeStore } from '@openmaic/storage';
import type { RuntimeRecordInit, RuntimeSession, Slide } from '@openmaic/dsl';
import {
  validateRuntimeRecord,
  validateRuntimeSession,
  validateScene,
  validateStage,
} from '@openmaic/dsl';
import { projectSlide } from './preview';

export class DiagnosticRejected extends Error {
  constructor() {
    super('DIAGNOSTIC_REJECTED');
    this.name = 'DiagnosticRejected';
  }
}

export type Subject = {
  tenant: string;
  learner: string;
  kind: 'teacher' | 'student' | 'admin';
  active: boolean;
  version: string;
};
export type Mapping = {
  deployment: string;
  owner: string;
  stage: string;
  readers: Set<string>;
  writers: Set<string>;
  assets: Set<string>;
  state: 'ACTIVE' | 'PENDING' | 'ORPHAN' | 'TRANSFERRING' | 'REVOKED';
  tenant: string;
  revision: string;
};
export type RuntimeBinding = { stage: string; learner: string; attempt: string };
export type Stores = {
  document(owner: string): Pick<DocumentStore, 'loadDocument' | 'getScene' | 'saveDocument'>;
  asset: Pick<AssetStore, 'resolve'>;
  runtime: Pick<RuntimeStore, 'getSession' | 'listRecords' | 'appendRecord'>;
  // PG diagnostic hook rechecks fixture authority inside the SAME public-store transaction.
  // This never claims an Identity/mapping distributed transaction.
  runtimeMutation?: (check: () => void) => Pick<RuntimeStore, 'appendRecord'>;
};

const MAX_REVISION = 9223372036854775807n;
function validRevision(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && BigInt(value) <= MAX_REVISION;
}

export class FixtureAuthority {
  readonly subjects = new Map<string, Subject>();
  readonly mappings = new Map<string, Mapping>();
  readonly bindings = new Map<string, RuntimeBinding>();
  private readonly credentials = new Map<string, Buffer>();
  readonly deployment = 'fixture-deployment';

  // Raw admission material stays in the test process and request headers, never in evidence.
  enroll(alias: string, subject: Subject): string {
    if (this.subjects.has(alias)) throw new DiagnosticRejected();
    const credential = randomBytes(32);
    this.credentials.set(alias, credential);
    this.subjects.set(alias, subject);
    return credential.toString('hex');
  }

  authenticate(credential: unknown): string {
    if (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential)) {
      throw new DiagnosticRejected();
    }
    const supplied = Buffer.from(credential, 'hex');
    for (const [alias, expected] of this.credentials) {
      if (timingSafeEqual(supplied, expected)) return alias;
    }
    throw new DiagnosticRejected();
  }

  capture(alias: string, stage: string, write = false) {
    const subject = this.subjects.get(alias);
    const mapping = this.mappings.get(stage);
    if (
      !subject?.active ||
      !validRevision(subject.version) ||
      !mapping ||
      mapping.state !== 'ACTIVE' ||
      !validRevision(mapping.revision) ||
      mapping.deployment !== this.deployment ||
      mapping.stage !== stage ||
      mapping.tenant !== subject.tenant ||
      !(write ? mapping.writers : mapping.readers).has(alias) ||
      (write && subject.kind !== 'teacher')
    )
      throw new DiagnosticRejected();
    return {
      alias,
      stage,
      write,
      version: subject.version,
      revision: mapping.revision,
      learner: subject.learner,
      owner: mapping.owner,
    };
  }

  fresh(proof: ReturnType<FixtureAuthority['capture']>) {
    const current = this.capture(proof.alias, proof.stage, proof.write);
    if (
      current.version !== proof.version ||
      current.revision !== proof.revision ||
      current.owner !== proof.owner ||
      current.learner !== proof.learner
    ) {
      throw new DiagnosticRejected();
    }
    return this.mappings.get(proof.stage)!;
  }
}

export class DiagnosticBoundary {
  readonly calls = { document: 0, scene: 0, asset: 0, runtime: 0, write: 0 };
  constructor(
    readonly authority: FixtureAuthority,
    private readonly stores: Stores,
  ) {}

  private async safe<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } catch {
      throw new DiagnosticRejected();
    }
  }

  async document(alias: string, stage: string): Promise<MaicDocument> {
    return this.safe(async () => {
      const proof = this.authority.capture(alias, stage);
      this.calls.document++;
      const doc = await this.stores.document(proof.owner).loadDocument(stage);
      this.authority.fresh(proof);
      if (
        !doc ||
        !validateStage(doc.stage).valid ||
        doc.stage.id !== stage ||
        doc.scenes.some((s) => !validateScene(s).valid || s.stageId !== stage)
      ) {
        throw new DiagnosticRejected();
      }
      return doc;
    });
  }

  async scene(alias: string, stage: string, scene: string) {
    return this.safe(async () => {
      const proof = this.authority.capture(alias, stage);
      this.calls.scene++;
      const result = await this.stores.document(proof.owner).getScene(stage, scene);
      this.authority.fresh(proof);
      if (
        !result ||
        !validateScene(result).valid ||
        result.id !== scene ||
        result.stageId !== stage
      )
        throw new DiagnosticRejected();
      return result;
    });
  }

  async list(alias: string) {
    // Deliberately no global DocumentStore.listDocuments call.
    const allowed = [...this.authority.mappings.keys()].filter((stage) => {
      try {
        this.authority.capture(alias, stage);
        return true;
      } catch {
        return false;
      }
    });
    return Promise.all(allowed.map((stage) => this.document(alias, stage)));
  }

  async batch(alias: string, stages: string[]) {
    if (stages.length > 8) throw new DiagnosticRejected();
    stages.forEach((stage) => this.authority.capture(alias, stage));
    return Promise.all(stages.map((stage) => this.document(alias, stage)));
  }

  async bytes(alias: string, stage: string, asset: string) {
    return this.safe(async () => {
      const proof = this.authority.capture(alias, stage);
      const mapping = this.authority.fresh(proof);
      if (!mapping.assets.has(asset)) throw new DiagnosticRejected();
      this.calls.asset++;
      const bytes = await this.stores.asset.resolve({ key: mapping.owner }, asset);
      const current = this.authority.fresh(proof);
      if (!current.assets.has(asset)) throw new DiagnosticRejected();
      if (!bytes || bytes.bytes.length > 4 * 1024 * 1024 || !safeMedia(bytes.mime, bytes.bytes)) {
        throw new DiagnosticRejected();
      }
      return bytes;
    });
  }

  private async runtimeProof(alias: string, session: string) {
    const binding = this.authority.bindings.get(session);
    if (!binding || !binding.attempt) throw new DiagnosticRejected();
    const proof = this.authority.capture(alias, binding.stage);
    if (binding.learner !== proof.learner) throw new DiagnosticRejected();
    const attempt = binding.attempt;
    const check = () => {
      this.authority.fresh(proof);
      const current = this.authority.bindings.get(session);
      if (
        current !== binding ||
        current.stage !== proof.stage ||
        current.learner !== proof.learner ||
        current.attempt !== attempt
      )
        throw new DiagnosticRejected();
    };
    this.calls.runtime++;
    const row = await this.stores.runtime.getSession(session);
    check();
    if (
      !row ||
      !validateRuntimeSession(row).valid ||
      row.id !== session ||
      row.stageId !== proof.stage ||
      row.learnerKey !== proof.learner ||
      row.status !== 'active' ||
      row.kind !== 'chat'
    ) {
      throw new DiagnosticRejected();
    }
    return { proof, row, check };
  }

  async runtime(alias: string, session: string): Promise<RuntimeSession> {
    return this.safe(async () => (await this.runtimeProof(alias, session)).row);
  }

  async records(alias: string, session: string) {
    return this.safe(async () => {
      const { check } = await this.runtimeProof(alias, session);
      const records = await this.stores.runtime.listRecords(session);
      check();
      if (records.some((row) => !validateRuntimeRecord(row).valid || row.sessionId !== session))
        throw new DiagnosticRejected();
      return records;
    });
  }

  async append(alias: string, session: string, expectedLastSeq: number | null, content: string) {
    return this.safe(async () => {
      if (
        typeof content !== 'string' ||
        content.length > 1024 ||
        (expectedLastSeq !== null &&
          (!Number.isSafeInteger(expectedLastSeq) || expectedLastSeq < 0))
      ) {
        throw new DiagnosticRejected();
      }
      const { check } = await this.runtimeProof(alias, session);
      check();
      const init: RuntimeRecordInit = {
        id: randomBytes(16).toString('hex'),
        sessionId: session,
        createdAt: new Date().toISOString(),
        payload: { role: 'user', content },
      };
      const store = this.stores.runtimeMutation?.(check) ?? this.stores.runtime;
      const row = await store.appendRecord(init, { expectedLastSeq });
      check();
      return row;
    });
  }

  async save(alias: string, stage: string, expectedRevision: string, doc: MaicDocument) {
    return this.safe(async () => {
      const proof = this.authority.capture(alias, stage, true);
      if (
        proof.revision !== expectedRevision ||
        BigInt(proof.revision) === MAX_REVISION ||
        doc.stage.id !== stage ||
        doc.scenes.some((s) => s.stageId !== stage)
      ) {
        throw new DiagnosticRejected();
      }
      const mapping = this.authority.fresh(proof);
      // Test registry CAS reservation. An external write failure stays unreadable.
      // This is explicitly not a durable mapping or distributed transaction.
      mapping.revision = (BigInt(mapping.revision) + 1n).toString();
      mapping.state = 'PENDING';
      const reservation = mapping.revision;
      try {
        this.calls.write++;
        await this.stores.document(proof.owner).saveDocument(doc);
        const subject = this.authority.subjects.get(alias);
        if (
          !subject?.active ||
          subject.version !== proof.version ||
          mapping.revision !== reservation ||
          subject.tenant !== mapping.tenant ||
          subject.learner !== proof.learner ||
          subject.kind !== 'teacher' ||
          !mapping.writers.has(alias) ||
          mapping.owner !== proof.owner ||
          mapping.stage !== stage ||
          mapping.deployment !== this.authority.deployment ||
          mapping.state !== 'PENDING' ||
          this.authority.mappings.get(stage) !== mapping
        ) {
          throw new DiagnosticRejected();
        }
        mapping.state = 'ACTIVE';
      } catch {
        if (mapping.state === 'PENDING' && mapping.revision === reservation)
          mapping.state = 'ORPHAN';
        throw new DiagnosticRejected();
      }
    });
  }

  async preview(alias: string, stage: string): Promise<Slide> {
    const doc = await this.document(alias, stage);
    if (doc.scenes.length !== 1 || doc.scenes[0].type !== 'slide' || doc.scenes[0].actions?.length)
      throw new DiagnosticRejected();
    const canvas = doc.scenes[0].content;
    if (canvas.type !== 'slide') throw new DiagnosticRejected();
    return projectSlide(canvas.canvas, (asset) => {
      if (!this.authority.mappings.get(stage)?.assets.has(asset)) throw new DiagnosticRejected();
      return `/diag/assets/${stage}/${asset}`;
    });
  }
}

export function safeMedia(mime: string, bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 16));
  if (mime === 'image/png')
    return head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'audio/wav')
    return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE';
  if (mime === 'video/webm') return head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  return false;
}
