/** Пользователь и роли */
export type UserRole = 'customer' | 'contractor';

export type User = {
  id: string;
  phone: string;
  role: UserRole;
  full_name: string | null;
  inn: string | null;
  npd_verified: boolean;
  moy_nalog_linked?: boolean;
  profile_code?: string | null;
  /** JWT from login/demo/sms/me — persist via setAccessToken */
  access_token?: string | null;
  refresh_token?: string | null;
  token_type?: string | null;
};
