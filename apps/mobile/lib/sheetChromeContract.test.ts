import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const surface = src('components/renova/SheetSurface.tsx');
must(surface.includes('KeyboardAvoidingView'), 'sheet surface keyboard avoidance');
must(surface.includes('useSafeAreaInsets'), 'sheet surface safe area');
must(surface.includes('<ScrollView'), 'sheet surface scroll body');
must(surface.includes('{footer ? <View style={styles.footer}>{footer}</View> : null}'), 'sheet surface sticky footer');
must(surface.includes('if (!busy) onClose()'), 'sheet surface safe close');
must(surface.includes('StyleSheet.absoluteFill'), 'sheet surface separate backdrop action');
must(surface.includes('accessibilityViewIsModal'), 'sheet surface modal accessibility');

const typography = src('constants/screenTypography.ts');
must(typography.includes('sheetTitle:'), 'shared sheet title typography');
must(typography.includes('sheetValue:'), 'shared sheet value typography');
must(typography.includes('sheetSubtitle:'), 'shared sheet subtitle typography');

const confirmSheet = src('components/renova/ActionConfirmSheet.tsx');
must(confirmSheet.includes('SheetSurface'), 'confirm sheet shared surface');
must(confirmSheet.includes('runThenClose') && confirmSheet.includes('queueMicrotask'), 'confirm nested action deferral');
must(confirmSheet.includes('variant="ghost"'), 'confirm close ghost action');
must(confirmSheet.includes("variant={primaryDestructive ? 'danger' : 'primary'}"), 'confirm destructive primary');
must(!confirmSheet.includes('Modal') && !confirmSheet.includes('StyleSheet.create'), 'confirm no local modal chrome');

const expense = src('components/renova/ExpenseDetailSheet.tsx');
must(expense.includes('SheetSurface'), 'expense shared surface');
must(expense.includes('const mutationRef = useRef(false)'), 'expense mutation ref');
must(expense.includes('if (!userId || !projectId || !target || !canEdit || mutationRef.current) return'), 'expense save duplicate guard');
must(expense.includes("title: 'Удалить трату?'"), 'expense delete confirmation');
must(expense.includes('primaryDestructive: true'), 'expense delete destructive intent');
must(expense.includes('variant="dangerOutline"'), 'expense delete danger hierarchy');
must(expense.includes('title="Сохранить"') && expense.includes('title="Закрыть"'), 'expense footer actions');
must(expense.includes('accessibilityLabel={`Открыть комнату ${room.name}`}'), 'expense room accessibility');
must(expense.includes('accessibilityLabel={`Открыть этап ${stage.name}`}'), 'expense stage accessibility');
must(!expense.includes('Alert.alert') && !expense.includes(', card'), 'expense no Alert/local card');

const payment = src('components/renova/PaymentDetailSheet.tsx');
must(payment.includes('SheetSurface'), 'payment shared surface');
must(payment.includes('const mutationRef = useRef(false)'), 'payment mutation ref');
must(payment.includes("type PaymentMutation = 'card' | 'confirm' | 'dispute' | null"), 'payment exact mutation states');
must(payment.includes("loading={mutation === 'card'}"), 'payment card loading');
must(payment.includes("loading={mutation === 'confirm'}"), 'payment confirm loading');
must(payment.includes("loading={mutation === 'dispute'}"), 'payment dispute loading');
must(payment.includes("title: 'Подтвердить оплату?'"), 'payment pre-confirm');
must(payment.includes('beginMutation') && payment.includes('endMutation'), 'payment single mutation orchestration');
must(payment.includes('footer={footer}'), 'payment sticky action footer');
must(payment.includes('<TextInput') && payment.includes('multiline'), 'payment dispute reason uses keyboard-aware multiline input');
must(payment.includes('variant="dangerOutline"') && payment.includes('variant="danger"'), 'payment dispute danger hierarchy');
must(!payment.includes('Alert.alert') && !payment.includes(', card'), 'payment no Alert/local card');

const material = src('components/renova/MaterialPickDetailSheet.tsx');
must(material.includes('SheetSurface'), 'material shared surface');
must(material.includes('const mutationRef = useRef(false)'), 'material mutation ref');
must(material.includes("title: 'Отправить материал на согласование?'"), 'material submit confirm');
must(material.includes("title: 'Убрать закупку из факта?'"), 'material rollback confirm');
must(material.includes('primaryDestructive: true') && material.includes('variant="dangerOutline"'), 'material rollback danger hierarchy');
must(material.includes('api.updatePurchaseStatus') && material.includes("loading={busyAction === 'rollback'}"), 'material canonical rollback loading');
must(!material.includes('Modal') && !material.includes(', card'), 'material no local modal/card');

const primaryButton = src('components/renova/PrimaryButton.tsx');
must(primaryButton.includes('accessibilityLabel={accessibilityLabel ?? title}'), 'shared button accessibility label');
must(primaryButton.includes('accessibilityState={{ disabled: unavailable, busy: Boolean(loading) }}'), 'shared button busy state');

console.log('sheetChromeContract.test OK');
