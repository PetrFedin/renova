/** Шапка профиля — роль, имя, номер профиля */
import { View, Text } from 'react-native';
import { profileScreenStyles as ps } from './profileScreenStyles';

type Props = {
  title: string;
  subtitle?: string;
  name?: string | null;
  profileCode?: string | null;
  badge?: string | null;
};

export function ProfileHeader({ title, subtitle, name, profileCode, badge }: Props) {
  return (
    <View style={ps.headerBlock}>
      <Text style={ps.pageTitle}>{title}</Text>
      {subtitle ? <Text style={ps.roleSubtitle}>{subtitle}</Text> : null}
      {name ? <Text style={ps.userName}>{name}</Text> : null}
      {profileCode ? <Text style={ps.userMeta}>Номер профиля: {profileCode}</Text> : null}
      {badge ? <Text style={ps.badge}>{badge}</Text> : null}
    </View>
  );
}
