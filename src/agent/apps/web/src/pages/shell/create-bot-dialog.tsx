import { Trans, useLingui } from "@lingui/react/macro";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  normalizeCreateBotProfile,
  productBrand,
} from "@rakazo/contracts";
import type { CreateBotInput, Me, ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { chatModelChoices, connectedModelChoices, credentialForModel, modelOptionKey, parseModelOptionKey } from "@rakazo/core";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Disclosure,
  Input,
  OptionSelect,
  Textarea,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { AuthMushroom } from "../../components/AuthMushroom";
import { generalChatModel, selectableCatalogEntry, thinkingLevelLabel } from "../../lib/model-catalog";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";
import { ChatModelPicker } from "./chat-model-picker";
import { CreateBotSuggestions } from "./create-bot-suggestions";

export type CreateBotDialogInput = Pick<CreateBotInput, "name" | "color" | "model"> &
  Partial<Pick<CreateBotInput, "description" | "instructions">>;

const EMPTY_CREDENTIALS: ModelCredential[] = [];
const EMPTY_CATALOG: ModelCatalogEntry[] = [];

function CreateBotModelPicker({ me, model, onChange }: {
  me: Me;
  model: CreateBotInput["model"];
  onChange: (model: CreateBotInput["model"]) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const queries = useSpaceQueries();
  const credentialsQuery = useQuery(queries.models.credentials.queryOptions());
  const catalogQuery = useQuery(queries.models.list.queryOptions());
  const credentials = credentialsQuery.data ?? EMPTY_CREDENTIALS;
  const catalog = catalogQuery.data ?? EMPTY_CATALOG;
  const general = generalChatModel(me, catalog);
  const selected = model ? modelOptionKey(model.provider, model.modelId) : "";
  const inherited = t`Use general model`;
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selected,
    general ? `${inherited} · ${general.label}` : inherited,
    general?.entry?.images,
  );
  const entry = model ? selectableCatalogEntry(catalog, model.provider, model.modelId) : undefined;
  const credential = credentialForModel(credentials, model?.provider, model?.modelId);
  const levels = (credential?.thinkingLevels ?? entry?.thinkingLevels ?? [])
    .filter((level) => level !== "off");
  const loadError = credentialsQuery.error ?? catalogQuery.error;
  const modelName = entry?.label ?? model?.modelId ?? "";

  return (
    <Disclosure summary={model ? <span className="max-w-[min(60vw,24rem)] truncate" title={modelName}>{t`Model · ${modelName}`}</span> : t`Model · automatic`}>
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-40 flex-1 gap-1.5 [&_button]:mt-0">
          <label htmlFor={id} className="text-xs font-medium"><Trans>Model</Trans></label>
          <ChatModelPicker
            id={id}
            choices={choices}
            value={selected}
            onChange={(key) => onChange(key ? parseModelOptionKey(key) ?? undefined : undefined)}
          />
        </div>
        {model && levels.length > 0 ? (
          <div className="grid w-32 gap-1.5">
            <span className="text-xs font-medium"><Trans>Thinking</Trans></span>
            <OptionSelect
              aria-label={t`Thinking`}
              value={model.thinkingLevel ?? ""}
              options={[
                { value: "", label: t`Default` },
                ...levels.map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
              ]}
              onValueChange={(value) => onChange({ ...model, thinkingLevel: levels.find((level) => level === value) })}
            />
          </div>
        ) : null}
      </div>
      {loadError ? <p role="status" className="text-xs text-muted-foreground">{errorText(loadError)}</p> : null}
    </div>
    </Disclosure>
  );
}

/** Mounted only while open; the parent unmounts it from `onCancel` or after `onCreate`. */
export function CreateBotDialog({
  onCancel,
  onCreate,
  onImport,
  me,
  inline = false,
}: {
  onCancel?: () => void;
  onCreate: (input: CreateBotDialogInput) => Promise<void>;
  onImport?: () => void;
  me?: Me | null;
  inline?: boolean;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [name, setName] = useState(inline ? productBrand.companionName : "");
  const [description, setDescription] = useState("");
  const [look, setLook] = useState("");
  const [model, setModel] = useState<CreateBotInput["model"]>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const trimmed = name.trim() || (description.trim() ? productBrand.companionName : "");

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const profile = normalizeCreateBotProfile({ name: trimmed, title: "", description });
      await onCreate({
        name: profile.name,
        ...(look ? { color: look } : {}),
        ...(profile.description ? { description: profile.description, instructions: profile.instructions } : {}),
        ...(model ? { model } : {}),
      });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  const Footer = inline ? "div" : DialogFooter;
  const form = (
        <form
          className={inline ? "m-auto grid w-full max-w-md shrink-0 gap-3 px-5 py-5" : "contents"}
          aria-labelledby={inline ? `${id}-title` : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          {inline ? (
            <h1 id={`${id}-title`} className="text-center text-lg font-medium">
              <Trans id="first-mico.title">Create your first Mico</Trans>
            </h1>
          ) : <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New bot</Trans>
            </DialogTitle>
          </DialogHeader>}
          <div className="flex justify-center">
            {look ? (
              <div className="grid size-[74px] place-items-center rounded-full bg-muted">
                <BotAvatar color={look} size={48} />
              </div>
            ) : <AuthMushroom />}
          </div>
          <BotLookPicker compact value={look} onAutomatic={() => setLook("")} onChange={setLook} />
          <fieldset disabled={submitting} className="grid min-w-0 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-name`} className="text-xs font-medium"><Trans>Name</Trans></label>
              <Input
                id={`${id}-name`}
                ref={nameRef}
                autoFocus
                required={!description.trim()}
                placeholder={t`Name your Bot`}
                value={name}
                maxLength={BOT_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-description`} className="text-xs font-medium">
                <Trans id="create-mico.purpose">What should this Mico help with?</Trans>
              </label>
              <Textarea
                id={`${id}-description`}
                rows={3}
                className="max-h-32"
                value={description}
                maxLength={BOT_DESCRIPTION_MAX_LENGTH}
                placeholder={t({ id: "create-mico.purpose-placeholder", message: "Plan trips, compare options or help with daily work." })}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {me ? <Disclosure summary={t`Model · automatic`}><CreateBotModelPicker me={me} model={model} onChange={setModel} /></Disclosure> : null}
            {description.trim() ? <Disclosure summary={t`Review instructions`} open={reviewing} onOpenChange={setReviewing}>
              <p className="whitespace-pre-wrap text-sm">{normalizeCreateBotProfile({ name, title: "", description }).instructions}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t`These instructions will be saved when you create the Mico. You can edit them later.`}</p>
            </Disclosure> : null}
          </fieldset>
          {error ? (
            <p role="alert" data-testid="create-bot-error" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <Footer className={inline ? "flex items-center justify-center gap-2 py-1" : "mx-0 mb-0 mt-1 flex-row items-center justify-end border-t-0 bg-transparent px-0 py-1"}>
            {onImport ? (
              <Button
                type="button"
                variant="ghost"
                className={inline ? undefined : "me-auto"}
                disabled={submitting}
                data-testid="create-bot-import"
                onClick={onImport}
              >
                <Trans>Import</Trans>
              </Button>
            ) : null}
            {onCancel ? (
              <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
                <Trans>Cancel</Trans>
              </Button>
            ) : null}
            <Button type="submit" disabled={!trimmed || submitting}>
              {inline ? <Trans id="first-mico.create">Create Mico</Trans> : <Trans>Create</Trans>}
            </Button>
          </Footer>
        </form>
  );
  const suggestions = (
    <CreateBotSuggestions
      className={inline ? "min-w-0 shrink-0 px-5 pb-3" : "min-w-0 border-t border-border pt-3"}
      draft={{ name, purpose: description, look }}
      disabled={submitting}
      onSelect={(suggestion) => {
        setName(suggestion.name);
        setDescription(suggestion.purpose);
        setLook(suggestion.look);
      }}
    />
  );
  if (inline) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="first-mico-setup">
        {form}
        {suggestions}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onCancel?.(); }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] gap-2.5 overflow-y-auto sm:max-w-md"
        data-testid="create-bot-dialog"
      >
        {form}
        {suggestions}
      </DialogContent>
    </Dialog>
  );
}
