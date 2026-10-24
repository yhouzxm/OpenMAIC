import { extractMedia } from '../../lib/document/extract-media';
import { getMediaExtractorProvider } from '../../lib/document/extractors/media-registry';
/** Credential-free child: official 1.2.0 extractors, text-only, no configurable URL. */
import { extractDocument } from '../../lib/document/extract';
import { getDocumentExtractorProvider } from '../../lib/document/extractors/registry';
async function main() {
  console.log = console.info = console.warn = console.error = () => {};
  let data = '';
  for await (const part of process.stdin) {
    data += part.toString();
    if (data.length > 1500000) throw Error('INPUT_LIMIT');
  }
  const input = JSON.parse(data);
  const providerId = input.config.providerId;
  const media = /^(audio|video)\//.test(input.mime);
  const request = {
    buffer: Buffer.from(input.base64, 'base64'),
    fileName: input.name,
    fileSize: Buffer.from(input.base64, 'base64').length,
    mimeType: input.mime === 'text/csv' ? 'text/plain' : input.mime,
    config: {
      ...input.config,
      providerId,
      textOnly: true,
      allowEnvFallback: false,
      managed: true,
      signal: AbortSignal.timeout(25000),
    },
  };
  const text = media
    ? ((await extractMedia(request)).transcript
        ?.map((b) => `[${b.startMs}ms] ${b.text}`)
        .join('\n') ?? '')
    : (await extractDocument(request)).blocks.map((b) => b.text ?? '').join('\n');
  const provider = media
    ? getMediaExtractorProvider(providerId)
    : getDocumentExtractorProvider(providerId);
  if (text.length > 100000 || !text.isWellFormed() || /\u0000/.test(text))
    throw Error('OUTPUT_LIMIT');
  process.stdout.write(
    JSON.stringify({
      text,
      parser: `${providerId}:${provider!.version}`,
      empty: text.trim().length === 0,
    }),
  );
}
main().catch(() => {
  process.stderr.write('MATERIAL_PARSE_FAILED');
  process.exitCode = 1;
});
