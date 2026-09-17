/**
 * Mobile test files that fail on current `main`.
 *
 * None of these is new breakage. Every one is a file that was never executed:
 * `npm run mobile:test` is a hand-maintained `&&` chain, so a test only ran if
 * someone remembered to append it. 118 of 226 files were never listed. When
 * automatic discovery is switched on they run for the first time, and 26 fail.
 *
 * `grep -c "FAIL" ` over the discovery run confirms **zero** of these is part
 * of the current chain, so nothing that CI checks today regresses.
 *
 * They are quarantined, not deleted. The bridge asserts each one *still fails*,
 * so fixing a file makes the suite fail with "expected to fail" until the entry
 * is removed here. The list can only shrink.
 *
 * Roughly two kinds:
 *
 *  - rotted source-string assertions: the test greps the implementation for a
 *    literal that a later refactor renamed (`sync.w92` wants `if (synced > 0)`);
 *  - behavioural claims that may be real defects and need a human decision:
 *    `purchaseTransitionIntegrity` ("delivery increments inventory once"),
 *    `financialFormIntegrity`, `aggregateBudgetByPeriod` ("planned share"),
 *    `materialPickLifecycleIntegrity`.
 *
 * `paymentEventHistoryIntegrity` left the list: its claim was measuring the
 * wrong thing — see backend/tests/test_route_table_has_no_shadowed_routes.py,
 * which asserts the property itself on the runtime route table.
 *
 * Triage belongs in its own issue, not in the change that made them visible.
 */
export const QUARANTINED_MOBILE_TESTS: ReadonlyArray<readonly [string, string]> = [
  ['apps/mobile/lib/chatThreadOpen.w100.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/domain/aggregateBudgetByPeriod.test.ts', 'Error: planned share'],
  ['apps/mobile/lib/domain/moreMenuA11y.w77.test.ts', 'Error: empty'],
  ['apps/mobile/lib/financialFormIntegrity.test.ts', 'Error: manual expense durable write boundary'],
  ['apps/mobile/lib/journeyUnify.w101.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w107.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w111.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w115.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w116.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w118.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w119.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w120.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w122.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w123.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/journeyUnify.w126.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/leanWsNotif.w147.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/materialPickLifecycleIntegrity.test.ts', 'Error: price mutation requires editable material'],
  ['apps/mobile/lib/offline/sync.w92.test.ts', 'Error: W92 sync.ts missing: if (synced > 0)'],
  ['apps/mobile/lib/offline/sync.w94.test.ts', 'Error: missing writeQueue'],
  ['apps/mobile/lib/portalPayHonesty.w144.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/projectDataBus.w99.test.ts', 'Error: EstimateDocumentsLayer.tsx missing syncProjectSideEffects'],
  ['apps/mobile/lib/purchaseTransitionIntegrity.test.ts', 'Error: delivery increments inventory once'],
  ['apps/mobile/lib/rateLimit.soft.test.ts', 'assertion helper threw (see file)'],
  ['apps/mobile/lib/useProjectDataReload.w95.test.ts', 'Error: DocumentsHub OCR should sync side effects'],
  ['apps/mobile/lib/useProjectDataReload.w98.test.ts', 'Error: expected W98 sync comment near task create'],
];

export const QUARANTINED_PATHS: ReadonlySet<string> = new Set(
  QUARANTINED_MOBILE_TESTS.map(([path]) => path),
);
