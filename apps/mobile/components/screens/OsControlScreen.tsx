/** P3.4: deprecated «control» hub → канонические экраны приёмки / QC */
import { Redirect } from 'expo-router';
import type { OsRole } from '@/constants/osSections';

export function OsControlScreen({ role }: { role: OsRole }) {
  const href = role === 'contractor' ? '/quality-control' : '/work-acceptance';
  return <Redirect href={href as never} />;
}
