import { awaitsMySignature, portalDocumentContentPath } from './documentSigning';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const draft = (sigs: { signer_user_id: string; status: string }[]) => ({ status: 'draft', meta: { signatures: sigs } });

must(awaitsMySignature(draft([]), 'cust'), 'unsigned draft awaits');
must(awaitsMySignature(draft([{ signer_user_id: 'ctr', status: 'signed' }]), 'cust'), 'contractor signed first: customer still sees it');
must(!awaitsMySignature(draft([{ signer_user_id: 'ctr', status: 'signed' }]), 'ctr'), 'I already signed: not in my list');
must(awaitsMySignature(draft([{ signer_user_id: 'cust', status: 'failed' }]), 'cust'), 'failed signature does not count');
must(!awaitsMySignature({ status: 'active', meta: { signatures: [] } }, 'cust'), 'active is complete');
must(!awaitsMySignature(draft([]), null), 'no user');
must(portalDocumentContentPath('p1', 'd 2') === '/api/v1/portal/projects/p1/documents/d%202/content', 'path encoded');
console.log('documentSigning ok');
