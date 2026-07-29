import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const formStyles = src('constants/formStyles.ts');
must(formStyles.includes('formSurfaceStyles'), 'shared form styles export');
must(formStyles.includes('minHeight: RenovaTheme.minTouch'), 'shared form touch target');
must(formStyles.includes('multilineInput'), 'shared multiline input');

const stagePicker = src('components/renova/StagePickerChips.tsx');
must(stagePicker.includes('optional = true') && stagePicker.includes('disabled = false'), 'stage picker optional/disabled contract');
must(stagePicker.includes('filterChipStyles') && stagePicker.includes('accessibilityState={{ selected, disabled }}'), 'stage picker shared accessible chips');

const roomPicker = src('components/renova/RoomPickerChips.tsx');
must(roomPicker.includes('disabled = false'), 'room picker disabled contract');
must(roomPicker.includes('filterChipStyles') && roomPicker.includes('accessibilityState={{ selected, disabled }}'), 'room picker shared accessible chips');

const payment = src('components/renova/CreatePaymentForm.tsx');
must(payment.includes('const busyRef = useRef(false)'), 'payment create duplicate guard');
must(payment.includes('let created = false') && payment.includes('if (!created) return'), 'payment durable write boundary');
must(payment.indexOf('if (!created) return') < payment.indexOf('clearDraft();'), 'payment clears only after durable success');
must(payment.includes("stage_id: paymentType === 'stage' ? stageId : null"), 'material payment clears stage relation');
must(payment.includes('setStageId(null)') && payment.includes("if (next !== 'stage')"), 'hidden stage state cleared');
must(payment.includes('OFFLINE_PAYMENT_CREATE_BLOCKED') && payment.includes('Введённые данные сохранены в форме'), 'payment offline/error draft preservation');
must(payment.includes('void syncProjectSideEffects') && payment.includes("reportCatch('CreatePaymentForm.sideEffects')"), 'payment best-effort side effects');
must(!payment.includes('await syncProjectSideEffects'), 'payment secondary sync must not control durable write result');
must(payment.includes('optional={false}') && payment.includes('disabled={busy}'), 'payment requires stage and disables picker');
must(payment.includes('formSurfaceStyles') && !payment.includes('StyleSheet.create'), 'payment shared form surface');

const expense = src('components/renova/ManualExpenseForm.tsx');
must(expense.includes('const busyRef = useRef(false)'), 'manual expense duplicate guard');
must(expense.includes('let saved = false') && expense.includes('if (!saved) return'), 'manual expense durable write boundary');
must(expense.indexOf('if (!saved) return') < expense.indexOf('onSaved?.()'), 'manual expense callback after write');
must(expense.includes("notifyOfflineQueued('Расход без чека')") && expense.includes('clearDraft();'), 'manual expense queued draft handling');
must(expense.includes('void syncProjectSideEffects') && expense.includes("reportCatch('ManualExpenseForm.sideEffects')"), 'manual expense best-effort side effects');
must(!expense.includes('await syncProjectSideEffects'), 'manual expense secondary sync must not control durable write result');
must(expense.includes('formSurfaceStyles') && !expense.includes('StyleSheet.create'), 'manual expense shared form surface');

const estimate = src('components/renova/AddEstimateLineForm.tsx');
must(estimate.includes('const busyRef = useRef(false)') && estimate.includes('if (busyRef.current) return'), 'estimate duplicate guard');
must(estimate.includes('let saved = false') && estimate.includes('if (!saved) return'), 'estimate durable write boundary');
must(estimate.includes("title: 'Цена'") && estimate.includes('unitPrice < 0'), 'estimate negative price validation');
must(!estimate.includes('Alert.alert'), 'estimate no Alert fallback');
must(estimate.includes("notifyOfflineQueued('Строка сметы')") && estimate.includes('clearDraft();'), 'estimate offline queued handling');
must(estimate.includes('void syncProjectSideEffects') && estimate.includes("reportCatch('AddEstimateLineForm.sideEffects')"), 'estimate best-effort side effects');
must(!estimate.includes('await syncProjectSideEffects'), 'estimate secondary sync must not control durable write result');
must(estimate.includes('filterChipStyles') && estimate.includes('accessibilityState={{ selected, disabled: busy }}'), 'estimate accessible shared chips');
must(estimate.includes('<RoomPickerChips') && estimate.includes('disabled={busy}'), 'estimate room picker guarded');
must(estimate.includes('formSurfaceStyles') && !estimate.includes('StyleSheet.create'), 'estimate shared form surface');

console.log('financialFormIntegrity.test OK');
