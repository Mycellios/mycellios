// The realistic dataset that `npm run dev:seed` writes into the isolated development account.
// Pure data: no network, database or files, so a dry run and the tests can read it.

export const SEED_VERSION = 1;
export const SEED_MARKER = 'seed.json';
const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SEED_USAGE = [
  'Uso: npm run dev:seed -- [--dry-run] [--if-missing] [--scale=<spec>]',
  '',
  'Siembra la cuenta aislada de Mycellios Dev de esta copia con datos realistas.',
  'La pila tiene que estar arrancada (npm run dev:desktop). No inicia ningún modelo.',
  '',
  '  --dry-run       Muestra el perfil de destino y los recuentos. No cambia nada.',
  '  --if-missing    Sale sin cambios si el perfil ya está sembrado.',
  '  --scale=<spec>  Añade datos generados: bots:N,messages:M',
  '                  (N bots extra con M mensajes cada uno, y M mensajes antiguos',
  '                  más en la conversación principal).',
  '  --help          Muestra esta ayuda.',
].join('\n');

const SCALE_LIMITS = {bots: 200, messages: 5000};
/** @type {Readonly<{bots: number, messages: number}>} */
export const NO_SCALE = Object.freeze({bots: 0, messages: 0});

/** Exit code 2 marks a usage error, as in the other dev commands. */
export class SeedUsageError extends Error {
  constructor(message) {super(message); this.name = 'SeedUsageError';}
}

export function parseSeedArguments(argv) {
  const options = {dryRun: false, ifMissing: false, help: false, scale: NO_SCALE};
  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--if-missing') options.ifMissing = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--scale=')) options.scale = parseSeedScale(argument.slice('--scale='.length));
    else throw new SeedUsageError(`Opción desconocida: ${argument}`);
  }
  return options;
}

export function parseSeedScale(spec) {
  const scale = {...NO_SCALE};
  const seen = new Set();
  for (const part of spec.split(',')) {
    const match = /^(bots|messages):(\d{1,5})$/.exec(part.trim());
    if (!match) throw new SeedUsageError(`Escala no válida: "${part}". Usa bots:N,messages:M.`);
    const [, key, raw] = match;
    if (seen.has(key)) throw new SeedUsageError(`La escala repite ${key}.`);
    seen.add(key);
    const value = Number(raw);
    if (value > SCALE_LIMITS[key]) throw new SeedUsageError(`${key} admite como máximo ${SCALE_LIMITS[key]}.`);
    scale[key] = value;
  }
  return scale;
}

const SECTIONS = [
  {key: 'product', name: 'Producto'},
  {key: 'operations', name: 'Operaciones'},
];

export const SEED_BOTS = [
  {key: 'research', name: 'Lía', title: 'Investigación', section: 'product', avatarFamily: 2,
    description: 'Compara proveedores, lee informes y resume la evidencia con fuentes.'},
  {key: 'writer', name: 'Teo', title: 'Redacción', section: 'product', avatarFamily: 5,
    description: 'Convierte la investigación en textos claros para clientes y el blog.'},
  {key: 'support', name: 'Nora', title: 'Soporte', avatarFamily: 7,
    description: 'Prepara respuestas amables a los tickets de clientes.'},
  {key: 'analyst', name: 'Bruno', title: 'Datos', avatarFamily: 0,
    description: 'Analiza métricas de uso y prepara gráficos semanales.'},
  {key: 'ops', name: 'Vega', title: 'Operaciones', section: 'operations', avatarFamily: 9,
    description: 'Vigila despliegues, nodos y alertas de la red.'},
];
export const ARCHIVED_BOT = {key: 'archived', name: 'Prototipo antiguo', title: 'Archivado', avatarFamily: 4,
  description: 'Un Mico archivado que se puede restaurar.'};

export const SEED_GROUP = {name: 'Equipo de lanzamiento', bots: ['research', 'writer', 'support']};
export const SEED_SPACE = 'Cliente Acme';

export const SEED_ROUTINES = [
  {bot: 'research', name: 'Resumen semanal de proveedores', crons: ['0 9 * * 1'], timezone: 'Europe/Madrid',
    prompt: 'Revisa precios y disponibilidad de GPU de los proveedores comparados y resume los cambios.'},
  {bot: 'ops', name: 'Comprobación diaria de nodos', crons: ['30 7 * * *'], timezone: 'Europe/Madrid',
    prompt: 'Comprueba los nodos con latencia alta y avisa si alguno lleva más de una hora sin latido.'},
];

export const SEED_SCRATCHPAD = [
  {bot: 'research', title: 'Confirmar precio de H100 en Fráncfort', status: 'open', notes: 'El proveedor B no publica precio por hora.'},
  {bot: 'research', title: 'Pedir cuota de GPU en eu-west', status: 'parked', notes: 'Esperando respuesta del comercial.'},
  {bot: 'research', title: 'Comparativa inicial enviada', status: 'done', notes: ''},
];

export const SEED_TICKETS = [
  {bot: 'support', title: 'El cliente no recibe el correo de verificación', priority: 'high', status: 'doing',
    description: 'Llegan los de bienvenida pero no el de verificación. Revisar el proveedor de correo.'},
  {bot: 'writer', title: 'Nota de lanzamiento de la versión 0.6', priority: 'normal', status: 'review'},
  {bot: 'ops', title: 'Nodo de Valencia sin latido desde ayer', priority: 'urgent', status: 'blocked',
    description: 'El nodo responde a ping pero el worker no envía latidos.'},
  {bot: 'analyst', title: 'Gráfico de uso por país', priority: 'low', status: 'todo'},
  {bot: 'research', title: 'Comparativa de GPU', priority: 'normal', status: 'done'},
];

const CSV = [
  'proveedor,gpu,vram_gb,precio_hora_usd,region,disponible',
  'Proveedor A,H100,80,2.49,eu-central,sí',
  'Proveedor B,A100,80,1.79,eu-west,bajo pedido',
  'Proveedor C,L40S,48,0.99,eu-north,sí',
].join('\n') + '\n';

const REPORT_MD = `# Informe de uso de la red · octubre

## Resumen
- 1.284 nodos activos (+12 % frente a septiembre).
- Latencia media de enrutado: 38 ms.
- 3 incidencias, ninguna con pérdida de trabajos pagados.

## Incidencias
| Fecha | Duración | Causa |
| --- | --- | --- |
| 03/10 | 14 min | Certificado caducado en el relé |
| 17/10 | 6 min | Despliegue con migración lenta |
| 29/10 | 41 min | Proveedor de DNS |
`;

const METRICS_JSON = JSON.stringify({
  periodo: '2026-10', nodos: {activos: 1284, nuevos: 163, retirados: 21},
  latencia_ms: {p50: 31, p95: 88, p99: 140},
  paises: [{codigo: 'ES', nodos: 402}, {codigo: 'MX', nodos: 233}, {codigo: 'AR', nodos: 118}],
}, null, 2) + '\n';

/** A minimal one-page PDF that every viewer opens. Offsets are computed, never hand-written. */
export function seedPdf() {
  const text = 'Informe de uso de la red - octubre. 1.284 nodos activos.';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 16 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Files uploaded through the normal artifact API. `png` is read from the web app's icon. */
export const SEED_FILES = [
  {key: 'csv', bot: 'research', name: 'comparativa-gpu.csv', mimeType: 'text/csv', content: () => Buffer.from(CSV)},
  {key: 'pdf', bot: 'research', name: 'informe-octubre.pdf', mimeType: 'application/pdf', content: seedPdf},
  {key: 'report', bot: 'analyst', name: 'informe-uso.md', mimeType: 'text/markdown', content: () => Buffer.from(REPORT_MD)},
  {key: 'metrics', bot: 'analyst', name: 'metricas-octubre.json', mimeType: 'application/json', content: () => Buffer.from(METRICS_JSON)},
  {key: 'png', bot: 'writer', name: 'logo-mycellios.png', mimeType: 'image/png', content: 'apps/web/public/icon-192.png'},
];

const LONG_ANSWER = [
  '## Revisión completa del documento de arquitectura',
  '',
  ...Array.from({length: 24}, (_, index) => [
    `### ${index + 1}. Sección ${index + 1}`,
    '',
    `El apartado ${index + 1} describe cómo el coordinador reparte el trabajo entre nodos con distinta memoria. ` +
      'La propuesta es correcta en lo esencial, pero conviene medir el enlace de vuelta antes de aceptar una ruta, ' +
      'porque un nodo rápido con un enlace lento empeora la latencia total más que uno lento con buen enlace.',
    '',
    `- Riesgo: **${['bajo', 'medio', 'alto'][index % 3]}**`,
    `- Acción: revisar \`route_policy_${index + 1}\` y añadir una prueba.`,
    '',
  ].join('\n')),
].join('\n');

const CHART = {
  kind: 'chart',
  name: 'Nodos activos por semana',
  spec: {marks: [{type: 'barY', x: 'semana', y: 'nodos', fill: 'currentColor'}], x: {label: 'Semana'}, y: {label: 'Nodos', grid: true}},
  data: [
    {semana: 'S40', nodos: 1102}, {semana: 'S41', nodos: 1156}, {semana: 'S42', nodos: 1190},
    {semana: 'S43', nodos: 1231}, {semana: 'S44', nodos: 1284},
  ],
};

const text = value => ({kind: 'text', text: value});

/**
 * Conversations by thread. `at` is minutes before the seed time. A `run` on a user message
 * records the finished task/run it started; nothing is queued, so no model turn starts.
 */
export const SEED_CONVERSATIONS = {
  research: [
    {at: 3 * DAY + 5 * HOUR, role: 'user', run: 'completed', blocks: [text('Necesito comparar tres proveedores de GPU en la nube para el piloto: precio por hora, VRAM y disponibilidad en Europa.')]},
    {at: 3 * DAY + 5 * HOUR - 2, role: 'bot', blocks: [{kind: 'steps', steps: [{label: 'Búsquedas', count: 3}, {label: 'Páginas leídas', count: 4}],
      durationMs: 41200, tools: [
        {id: 'call-1', name: 'web_search', outcome: 'succeeded', durationMs: 2100, detail: 'precio H100 por hora Europa'},
        {id: 'call-2', name: 'web_search', outcome: 'succeeded', durationMs: 1800, detail: 'A100 80GB eu-west disponibilidad'},
        {id: 'call-3', name: 'fetch', outcome: 'error', durationMs: 900, error: 'HTTP 403: la página de precios bloquea lectores automáticos'},
        {id: 'call-4', name: 'web_search', outcome: 'succeeded', durationMs: 2300, detail: 'L40S precio por hora eu-north'},
      ]}]},
    {at: 3 * DAY + 5 * HOUR - 3, role: 'bot', pin: true, react: '👍', blocks: [text([
      'Aquí tienes la comparativa. El proveedor B no publica precios, así que su cifra es la del último presupuesto.',
      '',
      '| Proveedor | GPU | VRAM | Precio/hora | Región | Disponible |',
      '| --- | --- | ---: | ---: | --- | --- |',
      '| A | H100 | 80 GB | 2,49 $ | eu-central | Sí |',
      '| B | A100 | 80 GB | 1,79 $ | eu-west | Bajo pedido |',
      '| C | L40S | 48 GB | 0,99 $ | eu-north | Sí |',
      '',
      '> Para el piloto, **C** es suficiente si el modelo cabe en 48 GB; si no, **A** es la única opción inmediata.',
      '',
      'Fuente: [página de precios del proveedor A](https://example.com/precios?region=eu-central&gpu=h100&periodo=mensual&moneda=usd).',
    ].join('\n'))]},
    {at: 3 * DAY + 4 * HOUR, role: 'user', run: 'completed', blocks: [text('¿Puedes exportarlo a CSV?')]},
    {at: 3 * DAY + 4 * HOUR - 1, role: 'bot', blocks: [text('Hecho. Una fila por proveedor, con el precio en dólares y punto decimal.'), {file: 'csv'}]},
    {at: 2 * DAY + 3 * HOUR, role: 'user', run: 'completed', blocks: [text([
      'Este script falla al subir el modelo, ¿qué pasa?',
      '',
      '```python',
      'from pathlib import Path',
      'import requests',
      '',
      'def upload(path: str, url: str) -> None:',
      '    with open(path) as handle:',
      '        requests.put(url, data=handle.read(), timeout=30)',
      '',
      'upload("model.safetensors", UPLOAD_URL)',
      '```',
      '',
      '```',
      'UnicodeDecodeError: \'utf-8\' codec can\'t decode byte 0x80 in position 64: invalid start byte',
      '```',
    ].join('\n'))]},
    {at: 2 * DAY + 3 * HOUR - 2, role: 'bot', blocks: [text([
      'El archivo se abre en modo texto. Un `.safetensors` es binario: hay que abrirlo con `"rb"` y enviarlo en streaming para no cargar 15 GB en memoria.',
      '',
      '```diff',
      '-    with open(path) as handle:',
      '-        requests.put(url, data=handle.read(), timeout=30)',
      '+    with open(path, "rb") as handle:',
      '+        requests.put(url, data=handle, timeout=600)',
      '```',
      '',
      '1. Modo binario (`rb`).',
      '2. Se pasa el archivo, no su contenido, para que `requests` lo envíe por partes.',
      '3. El tiempo de espera sube a 10 minutos.',
    ].join('\n'))]},
    {at: 2 * DAY + 3 * HOUR - 3, role: 'bot', blocks: [{kind: 'choice', question: '¿Aplico el cambio en la rama y ejecuto la prueba?',
      options: [{id: 'apply', letter: 'A', label: 'Sí, aplícalo y prueba'}, {id: 'diff', letter: 'B', label: 'Solo enséñame el diff'}], answerId: 'apply'}]},
    {at: 2 * DAY + 2 * HOUR, role: 'user', run: 'failed', runError: 'La prueba de subida terminó con código 1.', blocks: [text('A')]},
    {at: 2 * DAY + 2 * HOUR - 4, role: 'bot', blocks: [{kind: 'steps', steps: [{label: 'Comandos', count: 2}], durationMs: 95000, tools: [
      {id: 'call-5', name: 'apply_patch', outcome: 'succeeded', durationMs: 300},
      {id: 'call-6', name: 'run_command', outcome: 'error', durationMs: 94000, command: 'python -m pytest tests/test_upload.py -q', cwd: '~/piloto',
        exitCode: 1, commandStatus: 'done', output: 'F\n=================================== FAILURES ===================================\n___________________________ test_upload_large_file ____________________________\nE   requests.exceptions.ConnectionError: (\'Connection aborted.\', RemoteDisconnected(\'Remote end closed connection without response\'))\n1 failed in 93.41s'},
    ]}, text('El cambio está aplicado, pero la prueba falla: el servidor de subida corta la conexión a los 90 s. Parece un límite del proxy, no del script.')]},
    {at: 2 * DAY + 2 * HOUR - 5, role: 'system', blocks: [{kind: 'meta', text: 'La ejecución terminó con un error.'}]},
    {at: 1 * DAY + 6 * HOUR, role: 'user', run: 'completed', blocks: [text('Resúmeme el informe adjunto.'), {file: 'pdf'}]},
    {at: 1 * DAY + 6 * HOUR - 3, role: 'bot', blocks: [text([
      '## Resumen del informe de octubre',
      '',
      '### Lo importante',
      '- **1.284 nodos activos**, un 12 % más que en septiembre.',
      '- Latencia media de enrutado de **38 ms**.',
      '  - p95: 88 ms',
      '  - p99: 140 ms',
      '',
      '### Flujo de publicación',
      '```mermaid',
      'flowchart LR',
      '  QA[Pruebas] --> Evidencia["Revisión de<br/>evidencia"]',
      '  Evidencia --> Listo{¿Lista?}',
      '  Listo -- sí --> Publicar[Publicar]',
      '  Listo -- no --> Revertir[Revertir]',
      '```',
      '',
      'Nombres mezclados del informe: Zürich, Kraków, 東京, القاهرة, São Paulo 🚀',
    ].join('\n'))]},
    {at: 1 * DAY + 6 * HOUR - 4, role: 'bot', blocks: [CHART]},
    {at: 1 * DAY + 2 * HOUR, role: 'user', run: 'completed', replyTo: -2, replyQuote: '1.284 nodos activos, un 12 % más que en septiembre.',
      blocks: [text('Sobre esto: ¿cuántos están en Latinoamérica?')]},
    {at: 1 * DAY + 2 * HOUR - 1, role: 'bot', blocks: [{kind: 'card', lines: [
      {k: 'México', v: '233 nodos'}, {k: 'Argentina', v: '118 nodos'}, {k: 'Colombia', v: '74 nodos'}, {k: 'Total', v: '425 nodos (33 %)'}]}]},
    {at: 20 * HOUR, role: 'user', run: 'cancelled', blocks: [text('Revisa el documento de arquitectura entero y dame comentarios por sección.')]},
    {at: 20 * HOUR - 6, role: 'bot', blocks: [text(LONG_ANSWER)]},
    {at: 3 * HOUR, role: 'bot', routine: true, blocks: [text('**Resumen semanal de proveedores**\n\nSin cambios de precio. El proveedor B ya tiene A100 disponibles en eu-west sin pedido previo.')]},
    {at: 3 * HOUR - 1, role: 'bot', blocks: [{kind: 'ask', text: '¿Actualizo la comparativa con la nueva disponibilidad del proveedor B?', status: 'answered', answer: 'Sí'}]},
  ],
  writer: [
    {at: 2 * DAY, role: 'user', run: 'completed', blocks: [text('Escribe un borrador corto para anunciar la versión 0.6 en el blog.')]},
    {at: 2 * DAY - 2, role: 'bot', blocks: [text('# Mycellios 0.6\n\nLa nueva versión trae **apps de Hifa Store**, mejores rutas entre nodos y un panel más claro.\n\n¿Lo quieres más técnico o más comercial?')]},
    {at: 2 * DAY - 30, role: 'user', run: 'completed', blocks: [text('Más comercial, y añade el logo.')]},
    {at: 2 * DAY - 32, role: 'bot', blocks: [text('Versión comercial lista, con el logo para la cabecera.'), {file: 'png'}]},
  ],
  support: [
    {at: 5 * HOUR, role: 'user', run: 'completed', blocks: [text('Un cliente dice que no le llega el correo de verificación. ¿Qué le respondo?')]},
    {at: 5 * HOUR - 1, role: 'bot', blocks: [text('Propuesta:\n\n> Hola, Marta. Siento la espera. Revisa la carpeta de spam y, si no está, te reenviamos el enlace desde aquí mismo. Ya lo estamos investigando.\n\n¿La envío así?')]},
    {at: 40, role: 'bot', unread: true, blocks: [text('El cliente ha contestado: el correo estaba en spam. Cierro el ticket si te parece bien.')]},
  ],
  analyst: [
    {at: 1 * DAY + 1 * HOUR, role: 'user', run: 'completed', blocks: [text('Prepárame las métricas de octubre en un archivo.')]},
    {at: 1 * DAY + 1 * HOUR - 2, role: 'bot', blocks: [text('Te dejo el informe en Markdown y los datos en JSON.'), {file: 'report'}, {file: 'metrics'}]},
    {at: 1 * DAY + 1 * HOUR - 3, role: 'bot', blocks: [CHART]},
  ],
  ops: [
    {at: 9 * HOUR, role: 'user', run: 'completed', blocks: [text('¿Por qué el nodo de Valencia no envía latidos?')]},
    {at: 9 * HOUR - 2, role: 'bot', blocks: [{kind: 'steps', steps: [{label: 'Comprobaciones', count: 3}], durationMs: 12000, tools: [
      {id: 'ops-1', name: 'node_status', outcome: 'succeeded', durationMs: 800, detail: 'nodo valencia-02'},
      {id: 'ops-2', name: 'read_logs', outcome: 'succeeded', durationMs: 2400, detail: 'últimas 200 líneas'},
      {id: 'ops-3', name: 'restart_worker', outcome: 'paused', detail: 'Necesita tu aprobación'},
    ]}, text('El worker se quedó sin espacio en disco al preparar el modelo (`ENOSPC`). Necesito permiso para reiniciarlo.')]},
  ],
  group: [
    {at: 1 * DAY + 4 * HOUR, role: 'user', blocks: [text('Equipo: el lanzamiento es el jueves. Lía, pasa la comparativa; Teo, prepara la nota; Nora, avisa a soporte.')]},
    {at: 1 * DAY + 4 * HOUR - 2, role: 'bot', bot: 'research', blocks: [text('Comparativa lista. @Teo, te paso la tabla para la nota.'), {file: 'csv'}]},
    {at: 1 * DAY + 4 * HOUR - 5, role: 'bot', bot: 'writer', blocks: [text('Recibido. Borrador de la nota en 20 minutos.')]},
    {at: 1 * DAY + 4 * HOUR - 6, role: 'bot', bot: 'support', blocks: [{kind: 'subagent', agentId: 'sub-1', name: 'Revisión de macros', task: 'Actualizar las respuestas guardadas para la 0.6', status: 'completed', result: '4 macros actualizadas.'}]},
    {at: 1 * DAY + 3 * HOUR, role: 'bot', bot: 'writer', blocks: [text('Nota publicada en borrador. Falta la revisión final.')]},
  ],
};

export const SEED_APP = {
  slug: 'calculadora-costes-gpu',
  title: 'Calculadora de costes GPU',
  summary: 'Estima el coste mensual de un modelo según horas de uso y proveedor.',
  html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Calculadora de costes GPU</title><style>body{font-family:system-ui,sans-serif;margin:24px;background:#f6f4ef;color:#22201c}
label{display:block;margin:12px 0 4px}input,select{font:inherit;padding:6px}output{display:block;margin-top:16px;font-size:1.4em}</style></head>
<body><h1>Calculadora de costes GPU</h1><label for="p">Proveedor</label><select id="p"><option value="2.49">A · H100</option>
<option value="1.79">B · A100</option><option value="0.99">C · L40S</option></select><label for="h">Horas al mes</label>
<input id="h" type="number" min="0" value="120"><output id="o"></output><script>const p=document.getElementById('p'),h=document.getElementById('h'),o=document.getElementById('o');
function r(){o.textContent=(Number(p.value)*Number(h.value||0)).toFixed(2)+' $ al mes';}p.oninput=r;h.oninput=r;r();</script></body></html>`,
};

function generatedMessage(index, at, botKey) {
  return index % 2 === 0
    ? {at, role: 'user', blocks: [text(`Mensaje de prueba ${index + 1}: ¿puedes revisar el punto ${index + 1} del plan?`)]}
    : {at, role: 'bot', bot: botKey, blocks: [text(`Respuesta ${index + 1}. Revisado: el punto ${index + 1} está bien, salvo una errata en la tabla.`)]};
}

/** Older generated history, oldest first, ending before the hand-written conversation starts. */
export function generatedHistory(count, startBefore, botKey) {
  return Array.from({length: count}, (_, index) => generatedMessage(index, startBefore + (count - index) * 7, botKey));
}

export function generatedBots(count) {
  return Array.from({length: count}, (_, index) => ({
    key: `generated-${index + 1}`, name: `Mico ${index + 1}`, title: 'Generado',
    description: `Mico generado número ${index + 1} para probar listas largas.`, avatarFamily: index % 10,
  }));
}

export {SECTIONS as SEED_SECTIONS};

/** What a seed with this scale writes; printed by --dry-run and stored in the marker. */
export function seedCounts(scale = NO_SCALE) {
  const conversations = Object.values(SEED_CONVERSATIONS);
  const messages = conversations.reduce((total, rows) => total + rows.length, 0) + scale.messages * (1 + scale.bots);
  const runs = conversations.flat().filter(row => row.run).length;
  return {
    bots: SEED_BOTS.length + scale.bots,
    archivedBots: 1,
    sections: SECTIONS.length,
    groups: 1,
    spaces: 1,
    messages,
    runs,
    files: SEED_FILES.length,
    routines: SEED_ROUTINES.length,
    scratchpad: SEED_SCRATCHPAD.length,
    tickets: SEED_TICKETS.length,
    apps: 1,
  };
}
