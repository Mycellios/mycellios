import { Trans } from "@lingui/react/macro";
import { isMycelliosBaseUrl, isOllamaCloudBaseUrl } from "@rakazo/contracts";
import { Disclosure } from "@rakazo/ui-web";
import type { ReactNode } from "react";

export function CompatibleKeyField({
  baseUrl,
  className,
  children,
  required = false,
  alwaysVisible = false,
}: {
  baseUrl: string;
  className?: string;
  children: ReactNode;
  required?: boolean;
  alwaysVisible?: boolean;
}) {
  return alwaysVisible || required || isMycelliosBaseUrl(baseUrl) || isOllamaCloudBaseUrl(baseUrl) ? (
    <div className={className}>
      <span>
        <Trans>API key</Trans>
      </span>
      {children}
    </div>
  ) : (
    <Disclosure className={className} summary={<Trans>API key</Trans>}>
      {children}
    </Disclosure>
  );
}
