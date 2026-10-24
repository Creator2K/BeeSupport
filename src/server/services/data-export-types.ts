import { HttpError } from "../../lib/auth";
import { MAX_EXPORT_ROWS } from "../../lib/reporting";

export type ExportDateRange = {
  gte: Date;
  lt: Date;
  lte: Date;
};

export type ExportTable = {
  headers: string[];
  rows: unknown[][];
};

export function assertExportRowLimit(count: number): void {
  if (count > MAX_EXPORT_ROWS)
    throw new HttpError(
      413,
      `结果超过 ${MAX_EXPORT_ROWS} 条，请缩小日期范围或增加筛选条件`,
    );
}
