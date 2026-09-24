export type TrackerView = "BOARD" | "CUSTOMERS" | "NOTES" | "LINES";
export type TrackerResult = {
  filters: { reportId: string; view: TrackerView; [key: string]: unknown };
  report: { id: string; name: string; version: number; [key: string]: unknown };
  rows: Record<string, any>[];
  counts: { stage: string; count: number }[];
  summary: Record<string, number>;
  total: number;
  page: number;
};
export type TrackerDirectory = {
  customers: {
    customer_key: string;
    customer: string;
    customer_code: string;
  }[];
  snapshots: {
    id: string;
    filename: string;
    report_date: string;
    created_at: string;
    state: string;
    uploader: string;
  }[];
};
