import { CUSTOMER_PRO_LIMIT_NOTICE, canPurchasePro } from './paywallPolicy';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

must(canPurchasePro('contractor') === true, 'contractor can buy Pro');
must(canPurchasePro('customer') === false, 'customer must never see a purchase CTA');
must(canPurchasePro(null) === false, 'unknown role must not see a purchase CTA');
must(/исполнител/i.test(CUSTOMER_PRO_LIMIT_NOTICE.message), 'notice must point at the contractor');
must(!/Про \d|Подключите Про/i.test(CUSTOMER_PRO_LIMIT_NOTICE.message), 'notice must not offer a purchase');

console.log('paywallPolicy.test OK');
