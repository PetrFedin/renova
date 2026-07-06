/** Маршрут «домой» по роли пользователя */
export function homeRoute(role?: string | null) {
  if (role === 'contractor') return '/(contractor)/(tabs)/';
  return '/(customer)/(tabs)/';
}
