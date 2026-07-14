function guessMime(name, mime) {
  if (mime && mime !== 'application/octet-stream') return mime;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

const cases = [
  ['a.PDF', null, 'application/pdf'],
  ['x.txt', '', 'text/plain'],
  ['p.jpg', 'image/jpeg', 'image/jpeg'],
  ['f.docx', null, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
];
for (const [name, mime, expect] of cases) {
  const got = guessMime(name, mime);
  if (got !== expect) {
    console.error('FAIL', name, got, expect);
    process.exit(1);
  }
}
console.log('OK documentUploadPick mime');
