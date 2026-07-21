import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ROOM_PRESETS, type RoomTypeId } from '@/constants/roomTypes';
import { useRenova } from '@/lib/context/RenovaContext';
import {
  RoomFormGuideBox,
  PropertyTypeBanner,
  RoomNameField,
  RoomTypeSection,
  RoomFloorSection,
  RoomDimensionsSection,
  applyRoomTypePreset,
} from '@/components/renova/room/RoomSetupFields';

export default function WizardRooms() {
  const { wizard, setWizard } = useRenova();

  function updateRoom(i: number, patch: object) {
    const rooms = [...wizard.rooms];
    rooms[i] = { ...rooms[i], ...patch };
    setWizard({ rooms });
  }

  function applyPresetToRoom(i: number, type: RoomTypeId) {
    const preset = applyRoomTypePreset(type);
    if (!preset) return;
    updateRoom(i, {
      room_type: type,
      ...(preset.name ? { name: preset.name } : {}),
      length_m: parseFloat(preset.length || '0') || wizard.rooms[i].length_m,
      width_m: parseFloat(preset.width || '0') || wizard.rooms[i].width_m,
      height_m: parseFloat(preset.height || '0') || wizard.rooms[i].height_m,
      outlets_count: parseInt(preset.outlets || '0', 10),
      switches_count: parseInt(preset.switches || '0', 10),
      plumbing_points: parseInt(preset.plumbing || '0', 10),
      floor_level: preset.floor ?? wizard.rooms[i].floor_level ?? 1,
    });
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      <View style={styles.topPad}>
        <RoomFormGuideBox />
        <PropertyTypeBanner propertyType={wizard.property_type} />
      </View>

      {wizard.rooms.map((r, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardTitle}>Комната {i + 1}</Text>
          <RoomNameField
            value={r.name}
            onChange={(name) => updateRoom(i, { name })}
            roomType={(r.room_type as RoomTypeId) || 'other'}
          />
          <RoomTypeSection
            value={(r.room_type as RoomTypeId) || 'living'}
            onChange={(room_type) => updateRoom(i, { room_type })}
            onPreset={(type) => applyPresetToRoom(i, type)}
          />
          <RoomFloorSection
            propertyType={wizard.property_type}
            value={r.floor_level ?? 1}
            onChange={(floor_level) => updateRoom(i, { floor_level })}
            max={wizard.property_type === 'house' ? 3 : 1}
          />
          <RoomDimensionsSection
            values={{
              length: String(r.length_m || ''),
              width: String(r.width_m || ''),
              height: String(r.height_m || '2.7'),
              outlets: String(r.outlets_count ?? 0),
              switches: String(r.switches_count ?? 0),
              plumbing: String(r.plumbing_points ?? 0),
            }}
            setters={{
              setLength: (v) => updateRoom(i, { length_m: parseFloat(v) || 0 }),
              setWidth: (v) => updateRoom(i, { width_m: parseFloat(v) || 0 }),
              setHeight: (v) => updateRoom(i, { height_m: parseFloat(v) || 2.7 }),
              setOutlets: (v) => updateRoom(i, { outlets_count: parseInt(v, 10) || 0 }),
              setSwitches: (v) => updateRoom(i, { switches_count: parseInt(v, 10) || 0 }),
              setPlumbing: (v) => updateRoom(i, { plumbing_points: parseInt(v, 10) || 0 }),
            }}
          />
          {wizard.rooms.length > 1 && (
            <Pressable onPress={() => setWizard({ rooms: wizard.rooms.filter((_, j) => j !== i) })}>
              <Text style={styles.del}>Удалить комнату</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Text style={styles.section}>Быстрые шаблоны</Text>
      <View style={styles.templates}>
        {ROOM_PRESETS.map((tpl) => (
          <Pressable
            key={tpl.name}
            style={styles.tpl}
            onPress={() => setWizard({ rooms: [...wizard.rooms, { ...tpl }] })}
          >
            <Text style={styles.tplText}>+ {tpl.name}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() =>
          setWizard({
            rooms: [
              ...wizard.rooms,
              {
                name: `Комната ${wizard.rooms.length + 1}`,
                room_type: 'other' as RoomTypeId,
                floor_level: 1,
                length_m: 3,
                width_m: 3,
                height_m: 2.7,
                outlets_count: 4,
                switches_count: 1,
                plumbing_points: 0,
              },
            ],
          })
        }
      >
        <Text style={styles.link}>+ Пустая комната</Text>
      </Pressable>
      <PrimaryButton title="Рассчитать смету" onPress={() => pushOsNav('/wizard/confirm')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  topPad: { paddingHorizontal: 16, paddingTop: 16 },
  section: { fontWeight: '700', marginBottom: 8, marginTop: 4, paddingHorizontal: 16 },
  card: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
  },
  cardTitle: { fontWeight: '800', fontSize: 15, marginBottom: 8, color: RenovaTheme.colors.text },
  templates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, paddingHorizontal: 16 },
  tpl: { backgroundColor: '#e0f2fe', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  tplText: { color: '#0369a1', fontWeight: '600', fontSize: 12 },
  link: { color: RenovaTheme.colors.primary, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  del: { color: '#b91c1c', fontSize: 12, marginTop: 6, textAlign: 'right' },
});
