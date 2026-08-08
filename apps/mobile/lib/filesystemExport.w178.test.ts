/** W178: Expo SDK 56 native export/download must stay on the modern File/Paths API. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const helper = src('lib/tempShareFile.ts');
if (!helper.includes("import { File, Paths } from 'expo-file-system'")) {
  throw new Error('temporary share helper must use modern Expo FileSystem API');
}
if (!helper.includes('new File(Paths.cache, safe)') || !helper.includes('file.write(content)')) {
  throw new Error('temporary share helper must write through File/Paths.cache');
}

for (const rel of [
  'lib/downloadFile.ts',
  'lib/exportExpensesCsv.ts',
  'lib/exportGdprJson.ts',
  'lib/exportIcalFile.ts',
]) {
  const content = src(rel);
  if (content.includes('cacheDirectory') || content.includes('writeAsStringAsync') || content.includes('EncodingType.')) {
    throw new Error(`${rel} reintroduced legacy expo-file-system API`);
  }
  if (!content.includes('writeTemporaryShareFile')) {
    throw new Error(`${rel} must use the canonical temporary share helper`);
  }
}

const download = src('lib/downloadFile.ts');
if (!download.includes('new Uint8Array(await blob.arrayBuffer())')) {
  throw new Error('binary downloads must be written as bytes, not text/base64');
}

console.log('filesystemExport.w178.test OK');
