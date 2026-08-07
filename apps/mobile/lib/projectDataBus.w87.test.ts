/**
 * W87: sync + runWithProjectSideEffects.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w87.test.ts
 */
import {
  notifyProjectDataChanged,
  subscribeProjectDataChanged,
  syncProjectSideEffects,
  runWithProjectSideEffects,
} from "./projectDataBus";

async function main() {
  let n = 0;
  const count = () => n;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  await syncProjectSideEffects({ user: null, project: null });
  if (count() !== 1) throw new Error(`expected 1, got ${count()}`);

  const out = await runWithProjectSideEffects(
    { user: null, project: null },
    async () => "ok",
  );
  if (out !== "ok") throw new Error("runWith result");
  if (count() !== 2) throw new Error(`expected 2 after runWith, got ${count()}`);

  off();
  const frozen = count();
  notifyProjectDataChanged();
  if (count() !== frozen) throw new Error("listener leaked");

  console.log("projectDataBus.w87.test OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
