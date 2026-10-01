/** Подбор материалов с привязкой к комнате */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet, TextInput } from 'react-native';
import { api, type MaterialPick, type MaterialSupplySource, type Room, type Stage } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { filterChipStyles, screenTypography, listRowStyles } from '@/constants/screenTypography';
import { materialPickStatusLabel } from '@/constants/labels';
import { WorkTypeFilter } from '@/components/renova/WorkTypeFilter';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import { useNavFromHere } from '@/lib/navigation';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportCatch } from '@/lib/reportError';
import {
  MATERIAL_SUPPLY_OPTIONS,
  quantityToBuy,
  requiredQty,
  supplyLabel,
  totalAvailableQty,
} from '@/lib/domain/materialSupply';
import {
  alertMaterialPickApproved,
  alertMaterialPickSubmitted,
} from '@/lib/procurementNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { parseNonNegativeNumber } from '@/lib/parseLocaleNumber';
import { useBusyAction } from '@/lib/hooks/useBusyAction';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { resolveSafeDocumentUrl } from '@/lib/documentUrl';
import { notifyError } from '@/lib/notify';
import { materialEditPolicy, parseMaterialForm } from '@/lib/domain/materialPickEdit';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { unitRu } from '@/lib/unitLabel';

const fmtQty = (value: number) => Number(value.toFixed(3)).toLocaleString('ru-RU');

export function MaterialPickList({
  userId,
  projectId,
  role,
  rooms = [],
  stages = [],
  picksOverride,
  readOnly,
  onChanged,
}: {
  userId: string;
  projectId: string;
  role: OsRole;
  rooms?: Room[];
  stages?: Stage[];
  picksOverride?: MaterialPick[];
  readOnly?: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const nav = useNavFromHere();
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<MaterialPick[]>([]);
  const [wt, setWt] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qtyText, setQtyText] = useState('1');
  const [unitText, setUnitText] = useState('шт');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [createSource, setCreateSource] = useState<MaterialSupplySource>(role === 'customer' ? 'customer_to_buy' : 'contractor_to_buy');
  const [createAvailable, setCreateAvailable] = useState('0');
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState<MaterialSupplySource>('contractor_to_buy');
  const [editAvailable, setEditAvailable] = useState('0');
  const [supplyBusyId, setSupplyBusyId] = useState<string | null>(null);
  const [editingPickId, setEditingPickId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const submitAction = useBusyAction();
  const createAction = useBusyAction();
  const editAction = useBusyAction();

  const load = useCallback(() => {
    api.listMaterialPicks(userId, projectId, wt).then(setItems).catch(reportCatch('components.renova.MaterialPickList.1'));
  }, [userId, projectId, wt]);
  const refresh = useCallback(async () => {
    if (onChanged) {
      await onChanged();
      return;
    }
    load();
  }, [load, onChanged]);
  const syncAfter = async () => {
    await syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject ?? ({ id: projectId } as any),
      role,
    });
  };
  useEffect(() => { if (!picksOverride) load(); }, [load, picksOverride]);
  const onBusReload = useCallback(() => { if (!picksOverride) load(); }, [picksOverride, load]);
  useProjectDataReload(onBusReload);
  useEffect(() => { if (picksOverride) setItems(picksOverride); }, [picksOverride]);
  const visible = picksOverride ?? items;
  const roomName = (id?: string | null) => rooms.find((r) => r.id === id)?.name;

  const openSupplyEditor = (pick: MaterialPick) => {
    setEditingSupplyId(pick.id);
    setEditSource(pick.supply_source ?? (role === 'customer' ? 'customer_to_buy' : 'contractor_to_buy'));
    setEditAvailable(String(pick.qty_available ?? 0));
  };

  const chooseEditSource = (pick: MaterialPick, source: MaterialSupplySource) => {
    setEditSource(source);
    if (source === 'customer_on_hand') setEditAvailable(String(requiredQty(pick)));
  };

  const saveSupply = async (pick: MaterialPick) => {
    if (supplyBusyId) return;
    const required = requiredQty(pick);
    const available = editSource === 'customer_on_hand' ? required : parseNonNegativeNumber(editAvailable);
    if (available === null || available > required) {
      showActionConfirm({
        title: 'Проверьте количество',
        message: `Доступно должно быть от 0 до ${fmtQty(required)} ${unitRu(pick.unit)}.`,
      });
      return;
    }
    setSupplyBusyId(pick.id);
    try {
      await api.updateMaterialSupply(userId, projectId, pick.id, {
        supply_source: editSource,
        qty_available: available,
      });
      setEditingSupplyId(null);
      await syncAfter();
      await refresh();
    } catch (error) {
      showActionConfirm({
        title: 'Источник не изменён',
        message: writeResultMessage(error, 'Проверьте данные и повторите.'),
      });
    } finally {
      setSupplyBusyId(null);
    }
  };

  const runPickWrite = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      await syncAfter();
      await refresh();
    } catch (error) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued(label, role);
        return;
      }
      showActionConfirm({ title: 'Не удалось выполнить', message: writeResultMessage(error, 'Проверьте данные и повторите.') });
    }
  };

  const openPickEditor = (pick: MaterialPick) => {
    setEditingPickId(pick.id);
    setEditName(pick.name);
    setEditQty(String(requiredQty(pick)));
    setEditUnit(pick.unit);
  };

  const savePickEdit = (pick: MaterialPick) => {
    const parsed = parseMaterialForm({ name: editName, qty: editQty, unit: editUnit });
    if (!parsed.ok) {
      showActionConfirm({ title: parsed.title, message: parsed.message });
      return;
    }
    void editAction.run(async () => {
      await api.patchMaterialPick(userId, projectId, pick.id, { name: parsed.name, qty: parsed.qty, unit: parsed.unit });
      setEditingPickId(null);
      await syncAfter();
      await refresh();
    }, 'Материал не изменён');
  };

  const confirmDelete = (pick: MaterialPick) => {
    showActionConfirm({
      title: 'Удалить материал?',
      message: `«${pick.name}» будет удалён. Если материал уже входил в закупку, сервер не даст его удалить.`,
      primaryLabel: 'Удалить',
      primaryDestructive: true,
      onPrimary: () => { void runPickWrite('Удаление материала', () => api.deleteMaterialPick(userId, projectId, pick.id)); },
      secondaryLabel: 'Назад',
      onSecondary: () => undefined,
    });
  };

  const confirmRevoke = (pick: MaterialPick) => {
    showActionConfirm({
      title: 'Отозвать согласование?',
      message: `«${pick.name}» вернётся в черновик — исполнитель сможет поправить его и отправить заново. Если по материалу уже есть закупка, сначала отмените её.`,
      primaryLabel: 'Отозвать',
      onPrimary: () => { void runPickWrite('Отзыв согласования', () => api.revokeMaterialPick(userId, projectId, pick.id)); },
      secondaryLabel: 'Назад',
      onSecondary: () => undefined,
    });
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Подбор материалов</Text>
      {/* REP-24: при переданном списке (хаб «Материалы») фильтр по виду работ ничего бы не фильтровал — не показываем */}
      {!picksOverride ? <WorkTypeFilter value={wt} onChange={setWt} /> : null}
      {visible.map((p) => {
        const required = requiredQty(p);
        const available = totalAvailableQty(p);
        const toBuy = quantityToBuy(p);
        const editingSupply = editingSupplyId === p.id;
        return (
          <View key={p.id} style={s.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Открыть материал: ${p.name}`}
              onPress={() => nav.material(p.id)}
            >
              <Text style={s.n}>{p.name} · {materialPickStatusLabel(p.status)}{p.room_id && roomName(p.room_id) ? ` · ${roomName(p.room_id)}` : ''}</Text>
              <Text style={s.m}>{p.qty} {unitRu(p.unit)} · {formatRub(p.total)} {p.analog_of_id ? '· аналог' : ''}</Text>
            </Pressable>
            <Text style={s.supplyMeta}>{supplyLabel(p.supply_source)}</Text>
            <Text style={s.m}>
              Доступно {fmtQty(available)} из {fmtQty(required)} {unitRu(p.unit)}{toBuy > 0 ? ` · к покупке ${fmtQty(toBuy)}` : ''}
            </Text>

            {!readOnly && p.status !== 'purchased' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Изменить источник материала: ${p.name}`}
                accessibilityState={{ expanded: editingSupply, disabled: Boolean(supplyBusyId) }}
                style={s.supplyToggle}
                disabled={Boolean(supplyBusyId)}
                onPress={() => editingSupply ? setEditingSupplyId(null) : openSupplyEditor(p)}
              >
                <Text style={s.link}>{editingSupply ? 'Скрыть источник' : 'Источник и наличие'}</Text>
              </Pressable>
            ) : null}

            {editingSupply ? (
              <View style={s.supplyEditor}>
                <Text style={s.editorLabel}>Кто обеспечивает материал</Text>
                <View style={filterChipStyles.row}>
                  {MATERIAL_SUPPLY_OPTIONS.map((option) => {
                    const selected = editSource === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityLabel={`Источник: ${option.label}`}
                        accessibilityState={{ selected, disabled: supplyBusyId === p.id }}
                        style={[filterChipStyles.chip, selected && filterChipStyles.chipOn]}
                        disabled={supplyBusyId === p.id}
                        onPress={() => chooseEditSource(p, option.value)}
                      >
                        <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {editSource !== 'customer_on_hand' ? (
                  <TextInput
                    accessibilityLabel={`Доступное количество: ${p.name}`}
                    style={s.inp}
                    placeholder={`Доступно, ${unitRu(p.unit)}`}
                    value={editAvailable}
                    onChangeText={setEditAvailable}
                    keyboardType="decimal-pad"
                  />
                ) : (
                  <Text style={s.m}>В наличии полностью: {fmtQty(required)} {unitRu(p.unit)}</Text>
                )}
                {p.status === 'approved' ? (
                  <Text style={s.reapprovalHint}>Изменение источника или наличия потребует повторного согласования.</Text>
                ) : null}
                <PrimaryButton
                  title="Сохранить источник"
                  loading={supplyBusyId === p.id}
                  disabled={Boolean(supplyBusyId) && supplyBusyId !== p.id}
                  onPress={() => { void saveSupply(p); }}
                  fullWidth
                />
              </View>
            ) : null}

            {(() => {
              const policy = materialEditPolicy(p.status, role, readOnly);
              if (!policy.canEdit && !policy.canRevoke) return null;
              if (editingPickId === p.id) {
                return (
                  <View style={s.supplyEditor}>
                    <TextInput accessibilityLabel={`Название: ${p.name}`} style={s.inp} placeholder="Название" value={editName} onChangeText={setEditName} />
                    <View style={s.qtyRow}>
                      <TextInput accessibilityLabel={`Количество: ${p.name}`} style={[s.inp, s.qtyInp]} placeholder="Кол-во" value={editQty} onChangeText={setEditQty} keyboardType="decimal-pad" />
                      <TextInput accessibilityLabel={`Единица: ${p.name}`} style={[s.inp, s.unitInp]} placeholder="Ед." value={editUnit} onChangeText={setEditUnit} />
                    </View>
                    {p.status === 'pending' ? <Text style={s.reapprovalHint}>Материал вернётся с согласования в черновик и его нужно отправить заново.</Text> : null}
                    <PrimaryButton title="Сохранить" loading={editAction.busy} onPress={() => savePickEdit(p)} fullWidth />
                    <PrimaryButton title="Отмена" variant="outline" onPress={() => setEditingPickId(null)} fullWidth />
                  </View>
                );
              }
              return (
                <View style={s.actionRow}>
                  {policy.canEdit ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Изменить материал: ${p.name}`} style={s.supplyToggle} onPress={() => openPickEditor(p)}>
                      <Text style={s.link}>Изменить</Text>
                    </Pressable>
                  ) : null}
                  {policy.canDelete ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Удалить материал: ${p.name}`} style={s.supplyToggle} onPress={() => confirmDelete(p)}>
                      <Text style={s.linkDanger}>Удалить</Text>
                    </Pressable>
                  ) : null}
                  {policy.canRevoke ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Отозвать согласование: ${p.name}`} style={s.supplyToggle} onPress={() => confirmRevoke(p)}>
                      <Text style={s.link}>Отозвать согласование</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })()}

            {p.shop_url && role === 'contractor' && (
              <PrimaryButton
                title="↻ цена"
                variant="outline"
                onPress={async () => {
                  try {
                    const updated = await api.syncMaterialPrice(userId, projectId, p.id);
                    await refresh();
                    if (!updated?.price_verified) {
                      showActionConfirm({
                        title: 'Цена не подтверждена',
                        message: 'Поставщик не отдал доказуемую цену. Сохранённое значение не изменено.',
                      });
                    }
                  } catch (e) {
                    showActionConfirm({
                      title: 'Цена не проверена',
                      message: writeResultMessage(e, 'Не удалось обновить цену'),
                    });
                  }
                }}
              />
            )}
            {p.shop_url && resolveSafeDocumentUrl(p.shop_url) ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  Linking.openURL(resolveSafeDocumentUrl(p.shop_url) as string).catch((error) => {
                    notifyError('Ссылка не открылась', error, 'Скопируйте адрес и откройте его в браузере.');
                  });
                }}
              >
                <Text style={s.link}>{p.shop_name || p.shop_url}</Text>
              </Pressable>
            ) : null}
            {!readOnly && role === 'customer' && p.status === 'pending' && (
              <PrimaryButton title="Согласовать" onPress={() => {
                showActionConfirm({
                  title: 'Согласовать материал?',
                  message: `«${p.name}» · ${supplyLabel(p.supply_source)} · ${formatRub(p.price)}. После согласия система применит источник и рассчитает остаток к закупке.`,
                  primaryLabel: 'Согласовать',
                  onPrimary: () => {
                    void (async () => {
                      try {
                        await api.approveMaterialPick(userId, projectId, p.id);
                        await syncAfter();
                        await refresh();
                        alertMaterialPickApproved(role);
                      } catch (e: unknown) {
                        showActionConfirm({
                          title: 'Ошибка',
                          message: writeResultMessage(e, 'Не удалось согласовать'),
                        });
                      }
                    })();
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                });
              }} />
            )}
            {!readOnly && role === 'contractor' && p.status === 'draft' && (
              <PrimaryButton title="На согласование" variant="outline" loading={submitAction.busy} onPress={() => {
                void submitAction.run(async () => {
                  await api.submitMaterialPick(userId, projectId, p.id);
                  await syncAfter();
                  await refresh();
                  alertMaterialPickSubmitted(role);
                }, 'Не удалось отправить на согласование');
              }} />
            )}
          </View>
        );
      })}
      {!readOnly && showForm && (
        <View style={s.form}>
          <TextInput accessibilityLabel="Название материала" style={s.inp} placeholder="Название" value={name} onChangeText={setName} />
          <View style={s.qtyRow}>
            <TextInput accessibilityLabel="Количество нового материала" style={[s.inp, s.qtyInp]} placeholder="Количество" value={qtyText} onChangeText={setQtyText} keyboardType="decimal-pad" />
            <TextInput accessibilityLabel="Единица измерения" style={[s.inp, s.unitInp]} placeholder="Ед." value={unitText} onChangeText={setUnitText} />
          </View>
          <TextInput accessibilityLabel="Цена за единицу" style={s.inp} placeholder="Цена за единицу, ₽" value={price} onChangeText={setPrice} keyboardType="numeric" />
          {rooms.length > 0 && <RoomPickerChips rooms={rooms} value={roomId} onChange={setRoomId} optional={false} />}
          <Text style={s.editorLabel}>Источник</Text>
          <View style={filterChipStyles.row}>
            {MATERIAL_SUPPLY_OPTIONS.map((option) => {
              const selected = createSource === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Источник нового материала: ${option.label}`}
                  accessibilityState={{ selected }}
                  style={[filterChipStyles.chip, selected && filterChipStyles.chipOn]}
                  onPress={() => setCreateSource(option.value)}
                >
                  <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {createSource !== 'customer_on_hand' ? (
            <TextInput
              style={s.inp}
              accessibilityLabel="Доступное количество нового материала"
              placeholder={`Уже доступно, ${unitText || 'ед.'}`}
              value={createAvailable}
              onChangeText={setCreateAvailable}
              keyboardType="decimal-pad"
            />
          ) : null}
          <PrimaryButton title="Сохранить" loading={createAction.busy} onPress={() => {
            const parsed = parseMaterialForm({
              name,
              qty: qtyText,
              unit: unitText,
              price,
              allInStock: createSource === 'customer_on_hand',
              availableText: createAvailable,
            });
            if (!parsed.ok) {
              showActionConfirm({ title: parsed.title, message: parsed.message });
              return;
            }
            void createAction.run(async () => {
              await api.createMaterialPick(userId, projectId, {
                name: parsed.name,
                price: parsed.price,
                qty: parsed.qty,
                unit: parsed.unit,
                work_type: wt,
                room_id: roomId,
                supply_source: createSource,
                qty_available: parsed.available,
              });
              setName('');
              setPrice('');
              setQtyText('1');
              setUnitText('шт');
              setRoomId(null);
              setCreateSource(role === 'customer' ? 'customer_to_buy' : 'contractor_to_buy');
              setCreateAvailable('0');
              setShowForm(false);
              await syncAfter();
              await refresh();
            }, 'Материал не сохранён');
          }} />
        </View>
      )}
      {!showForm && !readOnly && (
        <PrimaryButton title="+ Материал" variant="outline" onPress={() => setShowForm(true)} />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  form: { gap: 8, marginTop: 8 },
  inp: {
    minHeight: RenovaTheme.minTouch,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: RenovaTheme.colors.surface,
    color: RenovaTheme.colors.text,
  },
  box: { marginVertical: 10 },
  head: { ...screenTypography.section, marginTop: 0, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  row: { ...listRowStyles.row },
  n: { ...screenTypography.listTitle },
  m: { ...screenTypography.listMeta },
  supplyMeta: { ...screenTypography.listMeta, color: RenovaTheme.colors.text, marginTop: 4 },
  supplyToggle: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  supplyEditor: { gap: 8, marginTop: 4 },
  editorLabel: { ...screenTypography.listMeta, color: RenovaTheme.colors.text },
  reapprovalHint: { ...screenTypography.listMeta, color: RenovaTheme.colors.warningText },
  link: { ...screenTypography.listLink },
  linkDanger: { ...screenTypography.listLink, color: RenovaTheme.colors.danger },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  qtyRow: { flexDirection: 'row', gap: 8 },
  qtyInp: { flex: 2 },
  unitInp: { flex: 1 },
});