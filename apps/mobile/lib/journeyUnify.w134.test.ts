/** W134: chat/team invite, stage, estimate line, OCR, receipt bulk → SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/fieldCommsNav.ts'), 'utf8');
const receipt = readFileSync(join(mobile, 'lib/receiptNav.ts'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
const profile = readFileSync(join(mobile, 'components/screens/profile/ContractorProfileScreen.tsx'), 'utf8');
const stage = readFileSync(join(mobile, 'components/renova/CreateStageSheet.tsx'), 'utf8');
const line = readFileSync(join(mobile, 'components/renova/AddEstimateLineForm.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const bulkLink = readFileSync(join(mobile, 'components/renova/ReceiptBulkLinkPanel.tsx'), 'utf8');
const bulkCat = readFileSync(join(mobile, 'components/renova/ReceiptBulkCategoryPanel.tsx'), 'utf8');

console.assert(nav.includes('alertChatInviteSent') && nav.includes('alertTeamInviteSent'), 'comms invites');
console.assert(nav.includes('alertTeamCreated') && nav.includes('alertRequisitesSaved'), 'team+req');
console.assert(nav.includes('alertStageCreated') && nav.includes('alertEstimateLineAdded'), 'stage+line');
console.assert(nav.includes('alertDocumentOcrDone') && nav.includes('budgetTabRoute'), 'ocr→expenses');
console.assert(receipt.includes('alertReceiptsBulkLinked') && receipt.includes('alertReceiptsBulkCategorized'), 'bulk');
console.assert(chat.includes('alertChatInviteSent'), 'chat wired');
console.assert(profile.includes('alertTeamInviteSent') && profile.includes('alertTeamCreated'), 'profile team');
console.assert(profile.includes('alertRequisitesSaved'), 'requisites');
console.assert(stage.includes('alertStageCreated'), 'stage sheet');
console.assert(line.includes('alertEstimateLineAdded'), 'estimate line');
console.assert(docs.includes('alertDocumentOcrDone') && !docs.includes("Alert.alert('OCR'"), 'ocr wired');
console.assert(bulkLink.includes('alertReceiptsBulkLinked'), 'bulk link');
console.assert(bulkCat.includes('alertReceiptsBulkCategorized'), 'bulk cat');

console.log('journeyUnify.w134.test.ts OK');
