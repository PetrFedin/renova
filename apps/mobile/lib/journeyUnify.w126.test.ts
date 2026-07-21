/** W126: warranty post-closeout → QC/closeout SoT (Buildertrend) + digest→inbox */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/warrantyNav.ts'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const qc = readFileSync(join(mobile, 'components/screens/QualityControlScreen.tsx'), 'utf8');
const slug = readFileSync(join(mobile, 'lib/resolveCatchAllSlug.ts'), 'utf8');
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');

console.assert(nav.includes('alertWarrantyCreated') && nav.includes('openQcIssue'), 'created→QC');
console.assert(nav.includes('alertWarrantyClosed') && nav.includes("'/documents'"), 'closed→docs');
console.assert(docs.includes('alertWarrantyCreated') && docs.includes('alertWarrantyClosed'), 'docs wired');
console.assert(docs.includes('openQcIssue') && docs.includes("'В QC'"), 'docs open items→QC');
console.assert(docs.includes("pushOsNav('/inbox'"), 'digest→inbox');
console.assert(qc.includes('alertWarrantyCreated') && qc.includes('alertWarrantyClosed'), 'QC wired');
console.assert(slug.includes("return '/quality-control'") && slug.includes('W126'), 'slug both→QC');
console.assert(push.includes("case 'warranty'") && push.includes("'/quality-control'"), 'push warranty→QC');

console.log('journeyUnify.w126.test.ts OK');
