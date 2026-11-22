import { Button as UiButton } from "./primitives";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePanelI18n } from "../i18n/panel-i18n";

export const TABLE_PAGE_SIZE = 10;

export function TablePagination({
  label,
  page,
  pageCount,
  total,
  onPageChange,
}: {
  label: string;
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = usePanelI18n();
  const safePage = Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
  const start = total === 0 ? 0 : safePage * TABLE_PAGE_SIZE + 1;
  const end = Math.min(total, (safePage + 1) * TABLE_PAGE_SIZE);
  return <nav className="table-pagination" aria-label={t("shell.pagination.label", { label })}>
    <span>{t("shell.pagination.showing", { start, end, total })}</span>
    <div>
      <UiButton type="button" aria-label={t("shell.pagination.previous", { label })} disabled={safePage === 0} onClick={() => onPageChange(Math.max(0, safePage - 1))}>
        <ChevronLeft size={14} />
      </UiButton>
      <span>{t("shell.pagination.page", { page: safePage + 1, count: Math.max(pageCount, 1) })}</span>
      <UiButton type="button" aria-label={t("shell.pagination.next", { label })} disabled={safePage >= pageCount - 1} onClick={() => onPageChange(Math.min(Math.max(pageCount - 1, 0), safePage + 1))}>
        <ChevronRight size={14} />
      </UiButton>
    </div>
  </nav>;
}
