/** Согласования, уведомления, статьи */
export type ApprovalItem = {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  status: string;
  room_id?: string | null;
  stage_id?: string | null;
  work_type?: string | null;
};

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  link_path: string | null;
  return_to?: string | null;
  read: boolean;
  notification_type: string;
  created_at: string;
};

export type ArticleSummary = {
  slug: string;
  title: string;
  category: string;
  category_label: string;
  tags: string[];
  read_min: number;
  summary: string;
};

export type ArticleDetail = ArticleSummary & { body: string };
