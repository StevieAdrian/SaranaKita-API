export type ReportRow = {
  id: string;
  reporter_id: string;
  school_id: string;
  title: string;
  description: string | null;
  location: string | null;
  broken_date: string | null;
  category_id: string | null;
  status_id: string | null;
  image_url: string | null;
  is_validate: boolean;
  created_at: string;
};

export type ReportResponse = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  brokenDate: string | null;
  categoryId: string | null;
  statusId: string | null;
  imageUrl: string | null;
  isValidated: boolean;
  createdAt: string;
};
