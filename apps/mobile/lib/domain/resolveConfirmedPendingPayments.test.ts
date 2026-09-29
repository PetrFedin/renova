import { resolveConfirmedPendingPayments } from './enrichProjectsPendingPayments';

async function run(): Promise<void> {
  const errors: Array<{ id: string; error: unknown }> = [];

  // #409: a network/server failure must never resolve as a confirmed 0 — the id must
  // be omitted entirely so the caller keeps the project's payment state "unknown".
  const confirmed = await resolveConfirmedPendingPayments(
    ['ok-zero', 'ok-three', 'fails'],
    async (id) => {
      if (id === 'fails') throw new Error('network down');
      if (id === 'ok-zero') return 0;
      return 3;
    },
    (id, error) => errors.push({ id, error }),
  );

  if (confirmed['fails'] !== undefined) throw new Error('failed read must not appear as a confirmed count, not even 0');
  if (confirmed['ok-zero'] !== 0) throw new Error('a real confirmed 0 must be preserved');
  if (confirmed['ok-three'] !== 3) throw new Error('a real confirmed non-zero count must be preserved');
  if (errors.length !== 1 || errors[0].id !== 'fails') throw new Error('failure must be reported exactly once, for the failing id');

  // All reads failing must resolve to an empty map, never a map of zeros.
  const allFailed = await resolveConfirmedPendingPayments(
    ['a', 'b'],
    async () => {
      throw new Error('down');
    },
    () => {},
  );
  if (Object.keys(allFailed).length !== 0) throw new Error('all-failed reads must confirm nothing');

  console.log('resolveConfirmedPendingPayments.test OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
