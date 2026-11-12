import { useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { Link, Plus, Globe } from "lucide-react";
import { useState } from "react";
import { MobileSessions } from "./MobileSessions";
import { MobileInstallOffer, mobileInstallUrl } from "../../components/MobileInstallOffer";
import { ServerLinkCode } from "../../components/ServerLinkCode";
import "./mobile-connection.css";

export function MobileSettingsPanel({ accountId }: { accountId?: string }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false), [guideOpen, setGuideOpen] = useState(false), [copy, setCopy] = useState("");
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) || window.location.hostname.endsWith(".localhost");
  const url = localOnly ? null : mobileInstallUrl(window.location.origin);
  const server = ["mycellios.com", "www.mycellios.com"].includes(window.location.hostname) ? "Mycellios" : window.location.host;
  async function copyLink() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopy(t`Link copied`); }
    catch { setCopy(t`Could not copy. Use the address shown above.`); }
  }
  function showLink() { setCopy(""); setOpen(true); }
  return <div className="rk-general-settings space-y-6">
    <MobileSessions key={accountId ?? "signed-out"} accountId={accountId} onAddPhone={showLink} watch={open && !localOnly}
      connectionLabel={server}
      permanentLink={<button type="button" className="mobile-permanent-link" onClick={showLink}>
        <span className="mobile-device-icon"><Plus aria-hidden size={19} /></span><span><strong>{t`Permanent link`}</strong><span>{t`For a phone you sign in to regularly.`}</span></span>
      </button>} />
    {localOnly && <div className="mobile-connection-notice"><Globe aria-hidden size={17} /><p>{t`This server uses a local address. A phone cannot open your computer’s localhost. Use a reachable address for this same server.`}</p></div>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t`Add phone`}</DialogTitle><DialogDescription>{url ? t`Scan the code, then sign in with the same Mycellios account. This link contains no password or session token.` : t`Connect to a reachable server before adding a phone. This preview cannot be paired from another device.`}</DialogDescription></DialogHeader>
        {url && <><ServerLinkCode url={url} /><p className="text-sm text-muted-foreground">{t`The link stays valid. Only signing in grants access; disconnecting a phone revokes its session.`}</p><Button variant="outline" onClick={() => void copyLink()}><Link aria-hidden size={15} />{t`Copy link`}</Button></>}
        {copy && <p role="status" className="text-sm text-muted-foreground">{copy}</p>}
        <Button variant="ghost" onClick={() => { setOpen(false); setGuideOpen(true); }}>{t`How to install`}</Button>
      </DialogContent>
    </Dialog>
    <MobileInstallOffer mini showOffer={false} open={guideOpen && !localOnly} onOpenChange={setGuideOpen} />
    <Dialog open={guideOpen && localOnly} onOpenChange={setGuideOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t`How to install`}</DialogTitle><DialogDescription>{t`First give this server an HTTPS address your phone can reach. The local preview does not create a public address.`}</DialogDescription></DialogHeader>
      <ol className="list-decimal space-y-3 pl-5 text-sm"><li>{t`Open that server address on your phone and sign in with the same account.`}</li>
        <li>{t`On Android, open the Chrome menu and choose Install or Add to Home Screen.`}</li><li>{t`On iPhone or iPad, open Safari, tap Share and choose Add to Home Screen.`}</li></ol>
    </DialogContent></Dialog>
  </div>;
}
