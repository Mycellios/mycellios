export function settingsMatch(item: { label: string; keywords?: string }, query: string): boolean {
  const clean = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const content = clean(`${item.label} ${item.keywords ?? ""}`);
  return clean(query)
    .trim()
    .split(/\s+/)
    .every((word) => content.includes(word));
}
export const settingsKeywords: Record<string, string> = {
  general:
    "appearance theme language timezone sidebar density developer enter shortcut interface size agent steps stream tool images logo color background font compact actions external links startup login awake battery restore workspace tipografia fuente colores fondo logotipo acciones compactas enlaces externos iniciar sesion segundo plano suspension bateria restaurar general apariencia tema idioma zona horaria densidad desarrollar teclado atajo tamaño interfaz pasos agente respuestas herramientas imágenes",
  "dynamic-island": "dynamic island idle display size width height isla dinamica reposo pantalla ancho alto tamaño",
  "agent-dock": "mico dock position screen agents results automatic hide edge strip panel posicion pantalla resultados ocultar borde",
  profile:
    "profile account name email password passkeys sso security delete perfil cuenta nombre correo contraseña seguridad eliminar",
  notifications:
    "notifications alerts permission previews sound pause completion task click notificaciones avisos alertas permisos vista previa sonido pausa finalizacion tarea clic",
  agents: "agents micos skills marketplace bots models connections queue steer instructions modelos conexiones mensajes tarea cola instrucciones habilidades",
  models:
    "models providers accounts api key oauth defaults backup reasoning tokens modelos proveedores cuentas claves predeterminado respaldo razonamiento límites",
  voice: "voice speech audio microphone transcription voz habla audio micrófono transcripción",
  confirmations:
    "approvals permissions rules tools safety aprobaciones confirmaciones permisos reglas herramientas",
  space: "space members invite rename delete espacio miembros invitar nombre eliminar",
  "space-providers": "providers models api keys proveedores modelos claves",
  "space-voice": "voice speech audio voz habla transcripción",
  "space-approvals": "permissions confirmations permisos reglas confirmaciones",
  "space-mcp": "mcp servers integrations tools servidores integraciones herramientas",
  memory: "memory providers knowledge memoria conocimiento proveedores",
  usage: "usage cost tokens balance uso costes consumo créditos saldo",
  computer:
    "computer access sandbox local tools equipment equipo computadora ordenador acceso entorno archivos",
  mobile: "mobile iphone android install app phone pwa connection móvil teléfono instalar conexión",
  updates:
    "updates version download release restart automatic install channel stable actualizaciones versión descarga novedades reiniciar automaticas instalar canal estable",
  billing: "billing payments subscription factura pago suscripción",
  logs: "logs execution developer registros ejecución desarrollador",
};
