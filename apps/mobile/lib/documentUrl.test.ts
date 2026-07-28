import { isSafeDocumentUrl, resolveSafeDocumentUrl } from './documentUrl';

console.assert(isSafeDocumentUrl('https://example.com/doc.pdf'));
console.assert(isSafeDocumentUrl('http://example.com/doc.pdf'));
console.assert(isSafeDocumentUrl('/media/projects/p1/doc.pdf'));
console.assert(!isSafeDocumentUrl('javascript:alert(1)'));
console.assert(!isSafeDocumentUrl('data:text/html,evil'));
console.assert(!isSafeDocumentUrl(''));
console.assert(resolveSafeDocumentUrl('/media/a.pdf')?.startsWith('http'));
