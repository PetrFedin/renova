/** Исправленный файл должен становиться версией документа, а не вторым документом. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/documents.ts');
const hub = src('components/renova/DocumentsHub.tsx');

if (!apiSrc.includes('document_id?: string')) throw new Error('клиент не умеет адресовать версию документу');
if (!apiSrc.includes("form.append('document_id', fields.document_id)")) {
  throw new Error('document_id не уходит в форме загрузки');
}

if (!hub.includes("text: 'Загрузить новую версию'")) throw new Error('нет действия «новая версия»');
if (!hub.includes('{ document_id: doc.id }')) throw new Error('новая версия не привязана к документу');
if (!hub.includes('остался одним документом')) throw new Error('человеку не сказано, что документ не задвоился');

const menu = hub.split("text: 'Загрузить новую версию'")[1]?.slice(0, 900) ?? '';
if (!menu.includes('pickDocumentForUpload()')) throw new Error('файл для версии не выбирается');
if (!menu.includes('reloadIndex()')) throw new Error('список документов не обновляется');

console.log('documentNewVersion.test OK');
