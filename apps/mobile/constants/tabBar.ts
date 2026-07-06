import { Platform } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

/** Компактная нижняя панель — единая для заказчика и исполнителя */
export const tabBarScreenOptions = {
  tabBarShowLabel: false,
  tabBarActiveTintColor: RenovaTheme.colors.tabActive,
  tabBarInactiveTintColor: RenovaTheme.colors.tabInactive,
  tabBarHideOnKeyboard: true,
  tabBarStyle: {
    height: Platform.OS === 'web' ? 52 : undefined,
    backgroundColor: RenovaTheme.colors.surface,
    borderTopColor: RenovaTheme.colors.border,
    borderTopWidth: 1,
    elevation: 0,
  },
  headerStyle: {
    backgroundColor: RenovaTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
    shadowOpacity: 0,
    elevation: 0,
    height: Platform.OS === 'web' ? 44 : undefined,
  },
  headerTitleStyle: {
    fontWeight: '600' as const,
    fontSize: 16,
    color: RenovaTheme.colors.text,
  },
  headerShadowVisible: false,
  sceneContainerStyle: {
    backgroundColor: RenovaTheme.colors.background,
  },
};

/** Отступ снизу контента — чтобы таббар не перекрывал прокрутку */
export const tabContentPadding = { paddingBottom: Platform.OS === 'web' ? 8 : 16 };
