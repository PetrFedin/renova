import { Redirect, useLocalSearchParams } from 'expo-router';
import WizardType from './_screens/type';
import WizardRooms from './_screens/rooms';
import WizardConfirm from './_screens/confirm';

/** P3-W39: type|rooms|confirm → один route-файл */
export default function WizardStep() {
  const { step } = useLocalSearchParams<{ step: string }>();
  const seg = Array.isArray(step) ? step[0] : step;
  if (seg === 'rooms') return <WizardRooms />;
  if (seg === 'confirm') return <WizardConfirm />;
  if (seg === 'type') return <WizardType />;
  return <Redirect href="/wizard/type" />;
}
