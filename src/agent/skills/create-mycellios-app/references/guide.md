# Guía para crear Apps de Mycellios v1

Este paquete contiene el protocolo de autoría, una plantilla y un validador.
Todavía no implementa el catálogo Apps, el editor visual, la publicación, la base
de datos de proyectos, un ejecutor de estas acciones ni la facturación de Apps.
No instala esta skill en cuentas, bibliotecas o perfiles globales.

## Fuente y ubicación

La definición estructural está en
[app-manifest.ts](../../../packages/contracts/src/app-manifest.ts), las acciones
en [app-actions.ts](../../../packages/contracts/src/app-actions.ts) y las reglas
semánticas en [app-validation.ts](../../../packages/contracts/src/app-validation.ts).
El [estándar normativo](../../../../../specs/apps-standard/spec.md) fija también
las obligaciones del futuro host que un archivo JSON no puede garantizar.

Estas rutas se resuelven desde esta guía dentro del checkout de Mycellios.
Trabaja desde `src/agent`; utiliza sus dependencias fijadas, sin otra instalación
por rutina. Una copia de la skill fuera del checkout necesita un validador de la
misma versión; no se convierte por sí sola en un ejecutor.

## Crear un borrador

1. Copia la carpeta `assets/template` completa a una carpeta de trabajo propia.
2. Define una finalidad y resultados observables. Usa un ID de dominio inverso
   y una versión `MAJOR.MINOR.PATCH`, sin cambiar el ID al actualizar.
3. Declara entradas tipadas y visibles. Los pasos consumen entradas obligatorias
   o salidas de antecesores; no leen el historial del chat ni variables implícitas.
4. Escoge las acciones de v1 y sus versiones exactas. Los componentes admitidos
   son `text`, `field`, `step`, `review` y `result`. Todo texto se muestra como
   texto, nunca como HTML. No hay eventos con expresiones, scripts ni iframes.
5. Dibuja las dependencias: una entrada, sin ciclos, todos los pasos alcanzables.
   Los prerrequisitos se cumplen juntos. Cada revisión tiene un componente visible
   y un recurso real que revisar. Usa `approvalStep` cuando una tarea dependa de
   una revisión concreta; la autorización técnica permanece separada.
6. Declara solo los permisos utilizados, recursos y destinos. Local/Cloud son
   requisitos, no instalaciones demostradas. Ningún destino recibe claves del
   autor. Mantén el límite inicial de gasto en cero hasta configurar presupuesto
   y conexiones del usuario; no significa que las herramientas sean gratuitas.
7. Ajusta los archivos de instrucciones y calcula sus hashes reales. Los recursos
   de la plantilla son propios; no contienen recursos de las referencias de vídeo.

## Comprobar

Desde `src/agent`, el comando del proyecto es:

```sh
npm run apps:validate -- skills/create-mycellios-app/assets/template/app.json --json
npm run apps:validate -- /ruta/mi-app/app.json --previous /ruta/version-anterior/app.json --json
npm run apps:validate -- --schema
```

En el PC de Daniel, ejecuta validaciones y pruebas mediante `compilar.ps1`,
con `WorkingDirectory` en `src/agent`; no anides el planificador. Por ejemplo:

```powershell
pwsh -NoProfile -File "C:\Users\Daniel\Documents\Codex\2026-10-07\mira-x20\outputs\limite-tareas\compilar.ps1" -WorkingDirectory "RUTA_MYCellios\src\agent" -Command "npm run apps:validate -- skills/create-mycellios-app/assets/template/app.json --json"
```

Para calcular un hash sin ejecutar el recurso:

```powershell
(Get-FileHash -LiteralPath "RUTA\prompts\studio.md" -Algorithm SHA256).Hash.ToLowerInvariant()
```

El esquema JSON exportado es ayuda estructural. Sus refinamientos de grafo,
catálogo, rutas, tipos y archivos requieren el validador completo, no solo un
editor que acepte JSON Schema. El validador no escribe archivos, llama a modelos,
descarga recursos, ejecuta acciones ni comprueba licencias o calidad artística.
Una salida correcta incluye explícitamente `runtimeQualification: not-run`,
`authorization: not-run` y `publication: not-run`.

## Actualizar y entregar

Conserva la versión publicada como un paquete inmutable. Un cambio de pantalla,
flujo, instrucciones, permisos o recurso exige una versión superior. El orden de
las claves JSON no altera la identidad; los arrays sí conservan su orden.
Los proyectos existentes retienen versión y digest, incluso si desaparece la
ficha pública. V1 no permite una migración silenciosa de sus datos.

Antes de publicar de verdad, el host deberá verificar editores/propietario,
revalidar un snapshot inmutable de todos los bytes, resolver las acciones a
implementaciones confiables, comprobar cada destino anunciado y mostrar permisos
y costes efectivos. Un `ok: true` del CLI no reemplaza estas fases.

Para Estudio de vídeos, comprueba por separado dibujo, voz y audio con muestras
reales. Decodificar un MP4 no acredita calidad visual, derechos comerciales ni
un número de visualizaciones. No publiques vídeos automáticamente.
