import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mycellios/ui-web";
import { useNavigate } from "react-router-dom";
import { onGuestAccountPrompt } from "../../lib/guest-mode";

/**
 * The guest shell's single account offer: anything that needs an account (settings, files, tools,
 * new Micos, the end of the free messages) opens it instead of doing the action.
 */
export function GuestAccountPrompt() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [feature, setFeature] = useState<string | null>(null);
  useEffect(() => onGuestAccountPrompt(value => setFeature(value ?? "")), []);
  const messages = feature === "messages";
  return (
    <Dialog open={feature !== null} onOpenChange={open => { if (!open) setFeature(null); }}>
      <DialogContent className="sm:max-w-md" data-guest-account-prompt>
        <DialogHeader>
          <DialogTitle>{messages ? t`Keep chatting with a free account` : t`Create a free account to use this`}</DialogTitle>
          <DialogDescription>
            {messages
              ? t`You have used the free guest messages. With an account you keep your chats and get your own Micos, files, tools and memory.`
              : t`In guest mode you can chat with Mico. Settings, files, tools, memory, apps and your own Micos need a free account.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setFeature(null); navigate("/sign-in"); }}><Trans>Sign in</Trans></Button>
          <Button onClick={() => { setFeature(null); navigate("/sign-up"); }}><Trans>Create a free account</Trans></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
