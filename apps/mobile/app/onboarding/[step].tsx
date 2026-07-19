import { Redirect, useLocalSearchParams } from 'expo-router';
import OnboardingRole from './_screens/role';
import OnboardingProject from './_screens/project';
import OnboardingDetailQuiz from './_screens/detail-quiz';

/** P3-W39: role|project|detail-quiz → один route-файл */
export default function OnboardingStep() {
  const { step } = useLocalSearchParams<{ step: string }>();
  const seg = Array.isArray(step) ? step[0] : step;
  if (seg === 'project') return <OnboardingProject />;
  if (seg === 'detail-quiz') return <OnboardingDetailQuiz />;
  if (seg === 'role') return <OnboardingRole />;
  return <Redirect href="/onboarding/role" />;
}
