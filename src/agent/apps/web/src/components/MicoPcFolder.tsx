import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";

/** Desktop only: where a This PC Mico keeps its files, once that folder exists. */
export function MicoPcFolder({ botId }: { botId: string }) {
  const { t } = useLingui();
  const computer = desktopBridge()?.computer;
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setFolder(null);
    setError("");
    void computer
      ?.micoFolder?.(botId)
      .then((path) => {
        if (current) setFolder(path);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [botId, computer]);

  if (!folder || !computer?.openMicoFolder) return null;

  async function open() {
    setError("");
    try {
      await computer!.openMicoFolder!(botId);
    } catch {
      setError(t`Could not continue`);
    }
  }

  return (
    <div className="mt-3 text-xs text-muted-foreground">
      <p>
        <Trans>Folder on this PC</Trans>
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate select-all" title={folder}>
          {folder}
        </code>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => void open()}>
          <FolderOpen aria-hidden />
          <Trans>Open folder</Trans>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
