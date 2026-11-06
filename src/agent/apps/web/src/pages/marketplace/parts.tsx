import { Trans } from "@lingui/react/macro";
import type { Category } from "./catalog";
export function CategoryName({ category }: { category: Category }) {
  switch (category) {
    case "code":
      return <Trans>Programming</Trans>;
    case "design":
      return <Trans>Design</Trans>;
    case "data":
      return <Trans>Data and analytics</Trans>;
    case "documents":
      return <Trans>Documents</Trans>;
    case "productivity":
      return <Trans>Productivity</Trans>;
    default:
      return <Trans>Other apps</Trans>;
  }
}
