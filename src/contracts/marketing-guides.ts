/** Public editorial content. Keep translations paired; no account or runtime data. */
export interface MarketingGuide {
  path: string;
  language: "en" | "es";
  alternate: string;
  title: string;
  description: string;
  sections: readonly { title: string; paragraphs: readonly string[] }[];
}

export const MARKETING_GUIDES: readonly MarketingGuide[] = [
  {
    path: "/guides/get-started", language: "en", alternate: "/es/guias/empezar",
    title: "Get started with Mycellios and your first Mico",
    description: "Open Mycellios in your browser or on desktop, create a Mico and choose a model connection. A practical guide to your first AI task.",
    sections: [
      { title: "Choose where to work", paragraphs: ["Open Mycellios Agent in your browser, or download the desktop app from the official downloads page. Use the same Mycellios account for your workspace and Credits. Desktop installers are listed by platform and architecture; check availability before downloading.", "The browser gives you a workspace without installing an application. Actions on a computer depend on a connected executor and its permissions; opening a browser chat alone does not give an agent control of your computer."] },
      { title: "Give your Mico a clear task", paragraphs: ["A Mico is your AI agent. Give it a name and explain what you want help with. Start with a small result you can inspect: a draft email, a plan or an explanation of a file. Add relevant context and state what a successful result should look like.", "Use separate conversations for separate tasks. You can create a conversation directly, let its first message provide a title and rename it later. Folders help organize Micos without changing their model provider."] },
      { title: "Choose a model and review its work", paragraphs: ["The Mycellios provider lets eligible accounts use the available catalog with their Credits. You can also configure your own supported provider. Check the model, price and available balance before sending work; a subscription with another company does not automatically include its API usage.", "Review files, answers and proposed actions. Tool availability depends on the current connection and permissions. If a task needs access you have not granted, connect the required tool rather than repeatedly resending the same instruction."] },
    ],
  },
  {
    path: "/es/guias/empezar", language: "es", alternate: "/guides/get-started",
    title: "Cómo empezar con Mycellios y tu primer Mico",
    description: "Abre Mycellios en el navegador o en escritorio, crea un Mico y elige un modelo. Guía práctica para completar tu primera tarea con IA.",
    sections: [
      { title: "Elige dónde trabajar", paragraphs: ["Abre Mycellios Agent en el navegador o descarga la aplicación de escritorio desde la página oficial. Utiliza la misma cuenta de Mycellios para tu espacio de trabajo y tus Créditos. Los instaladores se muestran por plataforma y arquitectura; comprueba su disponibilidad antes de descargar.", "El navegador te permite trabajar sin instalar una aplicación. Las acciones sobre un ordenador dependen de un ejecutor conectado y de sus permisos; abrir un chat en el navegador no da al agente control de tu equipo por sí solo."] },
      { title: "Dale una tarea clara a tu Mico", paragraphs: ["Un Mico es tu agente de IA. Ponle un nombre y explica en qué quieres que te ayude. Empieza con un resultado pequeño que puedas revisar: un borrador de correo, un plan o la explicación de un archivo. Añade contexto y describe cómo debe ser un buen resultado.", "Usa conversaciones distintas para tareas diferentes. Puedes crear una conversación directamente, dejar que el primer mensaje le dé un título y renombrarla después. Las carpetas permiten organizar tus Micos sin cambiar su proveedor de modelos."] },
      { title: "Elige un modelo y revisa su trabajo", paragraphs: ["El proveedor Mycellios permite a las cuentas habilitadas usar el catálogo disponible con sus Créditos. También puedes configurar tu propio proveedor compatible. Comprueba el modelo, el precio y el saldo antes de enviar una tarea; una suscripción de otra empresa no incluye automáticamente el uso de su API.", "Revisa los archivos, las respuestas y las acciones propuestas. Las herramientas disponibles dependen de la conexión y los permisos. Si una tarea necesita un acceso que no has concedido, conecta la herramienta necesaria en lugar de reenviar la misma instrucción repetidamente."] },
    ],
  },
  {
    path: "/guides/models-and-credits", language: "en", alternate: "/es/guias/modelos-y-creditos",
    title: "Mycellios models, providers and Credits explained",
    description: "Understand Mycellios Credits, the optional managed provider, your own model connections and the difference between Credits and Spore.",
    sections: [
      { title: "One workspace, your choice of provider", paragraphs: ["Mycellios is a workspace and an optional model provider. With the Mycellios provider, you spend Credits through the account's available catalog without supplying an upstream API key. Model availability depends on the network, connected services and operator configuration; not every model or media type is always available.", "You can instead connect a supported provider with your own account or key. That provider's plan, quota and billing rules apply. Access through a subscription and access through an API can have different charges. Changing a model does not mean moving all computation onto your device."] },
      { title: "How Credits are charged", paragraphs: ["One Credit corresponds to one US dollar for paid top-ups. The managed-provider pricing policy is the complete upstream cost, including attributable funding and network fees, plus a 4% Mycellios service fee, charged in Credits. Check the current price before use; model input, output and special modalities can be billed differently.", "The wallet reserves an approved amount before paid work and settles against verified usage. A reservation is not a second charge. Only a genuinely zero-cost upstream request has zero usage cost; a model labeled free can still have limits or billable extras. Do not retry an uncertain paid request just because its final receipt has not arrived.", "Eligible verified new accounts receive 0.20 promotional Credits once. The wallet is the source of truth for your available balance, holds and transactions; a welcome amount is not a recurring grant or a guaranteed balance for every visitor."] },
      { title: "Credits are different from Spore", paragraphs: ["Credits pay for eligible AI usage inside Mycellios. Approved contribution work can earn Credits after its result is independently verified. Switching on contribution alone does not create earnings, and work availability is not guaranteed.", "Spore is the separate proposed token. Token rewards, staking and cash withdrawals must not be inferred from an internal Credit balance. Read the current implementation evidence and published terms before relying on a feature or a financial outcome."] },
    ],
  },
  {
    path: "/es/guias/modelos-y-creditos", language: "es", alternate: "/guides/models-and-credits",
    title: "Modelos, proveedores y Créditos de Mycellios",
    description: "Entiende los Créditos, el proveedor opcional Mycellios y tus propias conexiones de modelos. Conoce los costes y la diferencia con Spore.",
    sections: [
      { title: "Un espacio, el proveedor que elijas", paragraphs: ["Mycellios es un espacio de trabajo y un proveedor opcional de modelos. Con el proveedor Mycellios gastas Créditos en el catálogo disponible para tu cuenta, sin introducir una clave del proveedor externo. La disponibilidad depende de la red, los servicios conectados y la configuración del operador; no todos los modelos o tipos de contenido están siempre disponibles.", "También puedes conectar un proveedor compatible con tu propia cuenta o clave. Se aplicarán su plan, sus límites y su facturación. Una suscripción y una API pueden tener cobros distintos. Cambiar de modelo no significa que todo el cálculo pase a hacerse en tu dispositivo."] },
      { title: "Cómo se cobran los Créditos", paragraphs: ["Un Crédito equivale a un dólar estadounidense en las recargas de pago. La política del proveedor gestionado es cobrar el coste completo del proveedor externo, incluidas las comisiones de financiación y red atribuibles, más un 4% de servicio Mycellios, en Créditos. Comprueba el precio antes de usarlo; la entrada, la salida y las modalidades especiales pueden facturarse de forma distinta.", "El monedero reserva un importe autorizado antes del trabajo de pago y liquida el consumo verificado. Una reserva no es un segundo cobro. Solo una petición cuyo coste externo sea realmente cero tiene coste de uso cero; un modelo gratuito puede tener límites o extras de pago. No repitas una petición de pago incierta solo porque aún no haya llegado su recibo final.", "Las cuentas nuevas verificadas que cumplan los requisitos reciben 0,20 Créditos promocionales una sola vez. El monedero muestra el saldo disponible, las reservas y los movimientos reales; el regalo de bienvenida no es periódico ni garantiza saldo a cualquier visitante."] },
      { title: "Los Créditos no son Spore", paragraphs: ["Los Créditos sirven para pagar usos de IA habilitados en Mycellios. El trabajo de contribución aprobado puede generar Créditos tras una verificación independiente del resultado. Activar la contribución por sí solo no genera ganancias, y no se garantiza que siempre haya tareas.", "Spore es el token propuesto por separado. Un saldo interno de Créditos no implica recompensas en tokens, staking ni retiradas de dinero. Consulta las evidencias de implementación y las condiciones publicadas antes de depender de una función o de un resultado económico."] },
    ],
  },
  {
    path: "/guides/contribute-compute", language: "en", alternate: "/es/guias/aportar-potencia",
    title: "Contribute compute and earn AI Credits with Mycellios",
    description: "Learn how to activate and pause browser contribution, check real earnings and use verified-work Credits for eligible AI models in Mycellios.",
    sections: [
      { title: "Start from your account", paragraphs: ["Open Mycellios Agent and sign in with your Mycellios account so accepted work can be attributed to your wallet. Find Generate AI in the main sidebar and press Play to opt in. You can pause from the same control. Do not use the legacy standalone browser worker as a substitute for an account-bound earnings connection.", "Browser contribution uses compatible resources available to the browser. Desktop and native-node participation have their own runtime and pairing requirements. Device support, model downloads, memory and network conditions determine which tasks a node can accept."] },
      { title: "What earns Credits", paragraphs: ["An approved job must be received, executed and independently verified before earnings are credited. Availability depends on actual funded demand and eligible tasks. An active animation, a benchmark or time spent connected is not proof of billable work.", "Use your real wallet balance and transaction history to check earnings. Do not expect a fixed hourly return. Credits earned from verified work can pay for eligible AI usage; electricity, connectivity and hardware remain your responsibility, so free AI does not mean your device has no operating cost."] },
      { title: "Stay in control", paragraphs: ["Pause contribution when you need your resources or connection. Browsers can throttle or suspend hidden tabs, sleeping devices and background workers. Keep the app's actual state in mind when comparing connected devices with completed jobs.", "The public network page shows observed status when data is available. Conceptual network illustrations on the homepage are not live telemetry. Consult the project's evidence record for the distinction between browser work, native execution and multi-host model experiments."] },
    ],
  },
  {
    path: "/es/guias/aportar-potencia", language: "es", alternate: "/guides/contribute-compute",
    title: "Aporta potencia y gana Créditos para IA en Mycellios",
    description: "Aprende a activar y pausar la contribución desde el navegador, comprobar las ganancias reales y usar Créditos de trabajo verificado para IA.",
    sections: [
      { title: "Empieza desde tu cuenta", paragraphs: ["Abre Mycellios Agent e inicia sesión con tu cuenta para vincular el trabajo aceptado a tu monedero. Busca Generar IA en la barra lateral principal y pulsa Play para activarlo. Puedes pausar desde el mismo control. El antiguo worker de navegador independiente no sustituye una conexión de ganancias vinculada a tu cuenta.", "La contribución web utiliza los recursos compatibles disponibles en el navegador. La participación desde escritorio o un nodo nativo tiene sus propios requisitos de ejecución y emparejamiento. El dispositivo, las descargas de modelos, la memoria y la conexión determinan qué tareas puede aceptar cada nodo."] },
      { title: "Qué genera Créditos", paragraphs: ["Una tarea aprobada debe recibirse, ejecutarse y verificarse de forma independiente antes de abonar ganancias. La disponibilidad depende de la demanda financiada y de tareas compatibles. Una animación activa, un benchmark o el tiempo conectado no demuestran trabajo facturable.", "Consulta el saldo real y los movimientos del monedero para comprobar las ganancias. No esperes una rentabilidad fija por hora. Los Créditos obtenidos por trabajo verificado pueden pagar usos de IA habilitados; la electricidad, la conexión y el equipo siguen corriendo de tu cuenta, por lo que IA gratis no significa que el dispositivo no tenga costes."] },
      { title: "Mantén el control", paragraphs: ["Pausa la contribución cuando necesites tus recursos o la conexión. El navegador puede limitar o suspender pestañas ocultas, dispositivos en reposo y procesos en segundo plano. Ten en cuenta el estado real al comparar dispositivos conectados con tareas terminadas.", "La página pública de la red muestra datos observados cuando están disponibles. Las ilustraciones conceptuales de la portada no son telemetría en vivo. Consulta las evidencias del proyecto para distinguir el trabajo web, la ejecución nativa y los experimentos de modelos entre varios equipos."] },
    ],
  },
];

export const GUIDE_INDEXES = [
  { path: "/guides", language: "en", alternate: "/es/guias", title: "Mycellios guides", description: "Practical guides to Micos, model providers, AI Credits and contributing compute. Choose a workflow and understand its requirements." },
  { path: "/es/guias", language: "es", alternate: "/guides", title: "Guías de Mycellios", description: "Guías prácticas sobre Micos, proveedores de modelos, Créditos para IA y contribución de potencia. Elige cómo trabajar y conoce sus requisitos." },
] as const;
export const MARKETING_GUIDE_PATHS = [...GUIDE_INDEXES, ...MARKETING_GUIDES].map(page => page.path);
