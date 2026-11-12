import type { Bot, HostedWebAgent, HostedWebDraft } from "@rakazo/contracts";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@rakazo/ui-web";
import { ArrowLeft, ArrowUpRight, Eye, RefreshCw, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { appPath } from "../../lib/app-path";
import {
  readWebEditor,
  writeWebEditor,
} from "../../lib/hosted-web-editor-state";
import type { createSpaceRpc } from "../../lib/rpc";
import { decode, encode, issue, publishedWebPath } from "./hosted-web-files";
import { TaskAgentSelect } from "../tasks/TaskComposer";
import { HostedAppChat } from "./HostedAppChat";

type EditorProps = {
  scope: string;
  initial: HostedWebDraft;
  client: ReturnType<typeof createSpaceRpc>;
  onBack: () => void;
  onPublished: () => void;
  bots: Bot[];
  onOpenBot: (id: string) => void;
  onCreateBot: () => void;
  spaceId: string | null;
};
export function WebEditor({
  scope,
  initial,
  client,
  onBack,
  onPublished,
  bots,
  spaceId,
  onOpenBot,
  onCreateBot,
}: EditorProps) {
  const editorId = useId();
  const restored = readWebEditor(scope);
  const [draft, setDraft] = useState(
    restored?.draft.id === initial.id ? restored.draft : initial,
  );
  const [selected, setSelected] = useState(
    restored?.draft.id === initial.id ? restored.selected : "index.html",
  );
  const [dirty, setDirty] = useState(
    restored?.draft.id === initial.id ? restored.dirty : initial.version === 0,
  );
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [notice, setNotice] = useState("");
  const [agent, setAgent] = useState<HostedWebAgent | null>(null);
  const [working, setWorking] = useState(false);
  const [panel, setPanel] = useState<"chat" | "preview" | "code">("preview");
  const [remoteChanged, setRemoteChanged] = useState(false);
  const latest = useRef({ draft, dirty, busy });
  latest.current = { draft, dirty, busy };
  const saved = draft.version > 0;
  useEffect(() => {
    if (!saved || latest.current.busy) return;
    let live = true;
    void client.webs
      .agent({ id: initial.id })
      .then((value) => {
        if (live) setAgent(value);
      })
      .catch((cause) => {
        if (live) setError(issue(cause));
      });
    return () => {
      live = false;
    };
  }, [client, initial.id, saved]);
  useEffect(() => {
    if (!saved) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    let previewAt = 0,
      previewVersion = -1;
    const poll = async () => {
      try {
        if (document.visibilityState === "visible" && !latest.current.busy) {
          const current = latest.current;
          const version = await client.webs.revision({ id: initial.id });
          if (!live) return;
          setSyncError("");
          if (version !== current.draft.version && latest.current.dirty)
            setRemoteChanged(true);
          else if (
            !latest.current.dirty &&
            (version !== current.draft.version ||
              previewVersion !== version ||
              Date.now() - previewAt > 90000)
          ) {
            const next =
              version !== current.draft.version
                ? await client.webs.draft({ id: initial.id })
                : current.draft;
            const result = await client.webs.preview({
              id: next.id,
              version: next.version,
            });
            if (
              live &&
              !latest.current.dirty &&
              latest.current.draft.version === current.draft.version
            ) {
              setDraft(next);
              setPreview(appPath(result.path));
              setRemoteChanged(false);
              previewAt = Date.now();
              previewVersion = next.version;
            }
          }
        }
      } catch (cause) {
        if (live) setSyncError(issue(cause));
      } finally {
        if (live) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, initial.id, saved]);
  const picker = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    writeWebEditor(scope, { draft, dirty, selected, busy });
  }, [scope, draft, dirty, selected, busy]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (error) {
      if (alive.current) setError(issue(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const change = (patch: Partial<HostedWebDraft>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setDirty(true);
    setPreview("");
    setNotice("");
  };
  const save = async () => {
    if (!dirty) return draft;
    const next = await client.webs.save({
      id: draft.id,
      version: draft.version,
      slug: draft.slug,
      title: draft.title,
      summary: draft.summary,
      bundle: draft.bundle,
    });
    if (alive.current) {
      setDraft(next);
      setDirty(false);
      setNotice("Borrador guardado. Todavía no cambia la web publicada.");
    }
    return next;
  };
  const refreshPreview = () =>
    act(async () => {
      const saved = await save();
      const result = await client.webs.preview({
        id: saved.id,
        version: saved.version,
      });
      if (alive.current) setPreview(appPath(result.path));
    });
  const publish = () =>
    act(async () => {
      const saved = await save();
      if (!alive.current) return;
      // The button itself is the explicit publication action; it freezes this saved version.
      await client.webs.publish({ id: saved.id, version: saved.version });
      if (alive.current) {
        setDraft((value) => ({ ...value, published: true }));
        setNotice(
          "Web publicada. Cualquier persona con su enlace puede abrirla.",
        );
        onPublished();
      }
    });
  const upload = async (files: FileList | null) =>
    act(async () => {
      if (!files?.length) return;
      if (
        files.length > 100 ||
        [...files].some((file) => file.size > 1024 * 1024) ||
        [...files].reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024
      )
        throw new Error(
          "Máximo 100 archivos, 1 MB por archivo y 4 MB en total.",
        );
      const entries = await Promise.all(
        [...files].map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          const relative = file.webkitRelativePath;
          return {
            path: relative ? relative.split("/").slice(1).join("/") : file.name,
            base64: btoa(binary),
          };
        }),
      );
      if (!entries.some((file) => file.path === "index.html"))
        throw new Error(
          "Incluye index.html en la raíz de la selección o de la carpeta.",
        );
      if (alive.current) {
        change({ bundle: { files: entries } });
        setSelected("index.html");
      }
    });
  const file = draft.bundle.files.find((file) => file.path === selected);
  const editable = /\.(html|css|m?js|json|txt|svg)$/i.test(selected);
  return (
    <section className="hw-editor" aria-label="Editor de app">
      <header className="hw-editor-bar">
        <Button
          variant="ghost"
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Hay cambios sin guardar. ¿Salir del editor?")
            )
              onBack();
          }}
        >
          <ArrowLeft /> Hifa Store
        </Button>
        <strong>{draft.title}</strong>
        <span className="hw-caption">
          {dirty ? "Cambios sin guardar" : "Borrador guardado"}
        </span>
        <div className="hw-actions">
          <Button
            variant="secondary"
            disabled={busy || !dirty}
            onClick={() =>
              void act(async () => {
                await save();
              })
            }
          >
            Guardar borrador
          </Button>
          <Button
            disabled={busy || working || remoteChanged}
            onClick={() => void publish()}
          >
            {busy
              ? "Procesando…"
              : draft.published
                ? "Publicar cambios"
                : "Publicar app"}
          </Button>
        </div>
      </header>
      {error && (
        <p className="hw-error" role="alert">
          {error}{" "}
          {error.includes("Reload") && (
            <Button
              variant="secondary"
              onClick={() =>
                void act(async () => {
                  const next = await client.webs.draft({ id: draft.id });
                  if (
                    alive.current &&
                    window.confirm(
                      "Recargar descartará tus cambios locales. ¿Continuar?",
                    )
                  ) {
                    setDraft(next);
                    setDirty(false);
                    setPreview("");
                  }
                })
              }
            >
              Recargar borrador
            </Button>
          )}
        </p>
      )}
      {syncError && (
        <p className="hw-error" role="alert">
          No se puede sincronizar la vista previa. Reintentando… {syncError}
        </p>
      )}
      {notice && (
        <p className="hw-notice" role="status">
          {notice}
        </p>
      )}
      {remoteChanged && (
        <p className="hw-error" role="alert">
          El borrador cambió mientras editabas. Tus cambios locales se
          conservan.{" "}
          <Button
            variant="secondary"
            onClick={() =>
              void act(async () => {
                if (
                  !window.confirm(
                    "¿Recargar el borrador del Mico y descartar tus cambios locales?",
                  )
                )
                  return;
                const next = await client.webs.draft({ id: draft.id });
                setDraft(next);
                setDirty(false);
                setRemoteChanged(false);
                setPreview("");
              })
            }
          >
            Revisar borrador actualizado
          </Button>
        </p>
      )}
      <nav className="hw-editor-tabs" aria-label="Panel de la app">
        <Button
          className="hw-chat-tab"
          variant="ghost"
          aria-pressed={panel === "chat"}
          onClick={() => setPanel("chat")}
        >
          Chat
        </Button>
        <Button
          variant="ghost"
          aria-pressed={panel === "preview"}
          onClick={() => setPanel("preview")}
        >
          Vista previa
        </Button>
        <Button
          variant="ghost"
          aria-pressed={panel === "code"}
          onClick={() => setPanel("code")}
        >
          Código y archivos
        </Button>
        <span className="hw-caption">Borrador privado · cambios en vivo</span>
      </nav>
      <div className="hw-editor-layout">
        <aside
          className="hw-chat-pane"
          data-visible={panel === "chat"}
          aria-label="Mico de la app"
        >
          <div className="hw-chat-heading">
            <strong>Mico de la app</strong>
            <TaskAgentSelect
              bots={bots}
              botId={agent?.botId ?? ""}
              disabled={busy || working || !bots.length}
              onChange={(botId) =>
                void act(async () => {
                  const next = await save();
                  const assigned = await client.webs.assignAgent({
                    id: next.id,
                    botId,
                  });
                  if (alive.current) setAgent(assigned);
                })
              }
            />
            {agent && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || working}
                onClick={() =>
                  void act(async () => {
                    await client.webs.assignAgent({
                      id: draft.id,
                      botId: null,
                    });
                    setAgent(null);
                  })
                }
              >
                Desvincular
              </Button>
            )}
          </div>
          {agent ? (
            <HostedAppChat
              key={agent.threadId}
              agent={agent}
              scope={scope}
              spaceId={spaceId}
              blocked={dirty || busy}
              onWorking={setWorking}
              onOpenBot={onOpenBot}
            />
          ) : (
            <div className="hw-chat-intro">
              <h2>Construye conversando.</h2>
              <p>
                {bots.length
                  ? "Asigna un Mico y pídele que cree o edite esta app. Verás sus cambios en la vista previa."
                  : "Crea un Mico para editar esta app conversando. También puedes subir o editar sus archivos."}
              </p>
              {!bots.length && (
                <Button variant="secondary" onClick={onCreateBot}>
                  Crear Mico
                </Button>
              )}
              <p className="hw-caption">Tú decides cuándo publicar.</p>
            </div>
          )}
        </aside>
        <div className="hw-editor-workspace" data-visible={panel !== "chat"}>
          <div className="hw-editor-source" hidden={panel !== "code"}>
            <fieldset disabled={busy || working}>
              <div className="hw-fields">
                <label htmlFor={`${editorId}-title`}>
                  Nombre
                  <Input
                    id={`${editorId}-title`}
                    value={draft.title}
                    maxLength={80}
                    onChange={(event) => change({ title: event.target.value })}
                  />
                </label>
                <label htmlFor={`${editorId}-summary`}>
                  Descripción
                  <Input
                    id={`${editorId}-summary`}
                    value={draft.summary}
                    maxLength={240}
                    onChange={(event) =>
                      change({ summary: event.target.value })
                    }
                  />
                </label>
                <label htmlFor={`${editorId}-slug`}>
                  Dirección
                  <Input
                    id={`${editorId}-slug`}
                    value={draft.slug}
                    minLength={3}
                    maxLength={60}
                    disabled={draft.published}
                    pattern="[a-z0-9][a-z0-9-]{1,58}[a-z0-9]"
                    onChange={(event) => change({ slug: event.target.value })}
                  />
                  <small>
                    {typeof window !== "undefined"
                      ? window.location.origin
                      : ""}
                    {publishedWebPath(draft.slug)}
                  </small>
                </label>
              </div>
              <div className="hw-files-bar">
                <label className="hw-file-choice" htmlFor={`${editorId}-file`}>
                  Archivo
                  <NativeSelect
                    id={`${editorId}-file`}
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    {draft.bundle.files.map((file) => (
                      <NativeSelectOption key={file.path} value={file.path}>
                        {file.path}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  variant="secondary"
                  onClick={() => picker.current?.click()}
                >
                  <Upload /> Subir archivos
                </Button>
                <Button variant="ghost" onClick={() => folder.current?.click()}>
                  Carpeta
                </Button>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void upload(event.target.files);
                    event.target.value = "";
                  }}
                />
                <input
                  ref={folder}
                  type="file"
                  multiple
                  hidden
                  {...{ webkitdirectory: "" }}
                  onChange={(event) => {
                    void upload(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
              <p className="hw-caption">
                Sube los archivos generados por tu Mico o edita el código. Se
                reemplaza el conjunto completo. Máximo 4 MB.
              </p>
              {file && editable ? (
                <Textarea
                  className="hw-code"
                  aria-label={`Código de ${selected}`}
                  spellCheck={false}
                  value={decode(file.base64)}
                  onChange={(event) =>
                    change({
                      bundle: {
                        files: draft.bundle.files.map((file) =>
                          file.path === selected
                            ? { ...file, base64: encode(event.target.value) }
                            : file,
                        ),
                      },
                    })
                  }
                />
              ) : (
                <p className="hw-status">
                  Archivo de imagen o fuente. Se conserva tal como lo has
                  subido.
                </p>
              )}
            </fieldset>
          </div>
          <div className="hw-editor-preview" hidden={panel === "code"}>
            <div className="hw-preview-bar">
              <h2>Vista previa privada</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void refreshPreview()}
              >
                <RefreshCw /> Actualizar
              </Button>
            </div>
            {preview ? (
              <iframe
                title="Vista previa privada de la app"
                src={preview}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="hw-preview-empty">
                <Eye size={30} strokeWidth={1.2} />
                <p>Guarda y abre una vista previa antes de publicar.</p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void refreshPreview()}
                >
                  Ver mi web
                </Button>
              </div>
            )}
            <p className="hw-caption">
              La vista previa dura 2 minutos. Solo la publicación aparece en el
              directorio.
            </p>
          </div>
        </div>
      </div>
      <footer className="hw-editor-footer">
        <span>
          Al publicar, el código y los archivos serán públicos y se podrán
          clonar. No incluyas claves ni información privada.
        </span>
        {draft.published && (
          <>
            <Button
              variant="secondary"
              render={
                <a
                  href={publishedWebPath(draft.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Abrir publicada <ArrowUpRight />
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (
                    !window.confirm(
                      "¿Retirar esta web del directorio y desactivar su enlace público?",
                    )
                  )
                    return;
                  await client.webs.unpublish({ id: draft.id });
                  if (alive.current) {
                    setDraft((value) => ({ ...value, published: false }));
                    setNotice(
                      "Web retirada. El borrador sigue disponible para editarlo.",
                    );
                    onPublished();
                  }
                })
              }
            >
              Retirar publicación
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
