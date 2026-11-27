export type BenchNote = { id: string; path: string; content: string; updatedAt: string; scope: "bot" | "user"; inclusion?: "essential" | "searchable" };
export type BenchCase = {
  id: string;
  split: "dev" | "holdout";
  tags: string[];
  previousUserMessage?: string;
  message: string;
  /** Exact substrings of some note content that a good answer needs. Empty array = nothing should be needed (chit-chat). */
  facts: string[];
  /** Ids of notes that contain those facts. */
  notes: string[];
};
export type BenchVault = { id: string; description: string; notes: BenchNote[]; cases: BenchCase[] };

export const MEMORY_RECALL_BENCH: BenchVault[] = [
  // ---------------------------------------------------------------------------
  // Vault 1: Marta, madre organizando la vida familiar en Zaragoza
  // ---------------------------------------------------------------------------
  {
    id: "v1-familia-marta",
    description: "Marta, 41, madre de dos niños en Zaragoza; organiza colegio, extraescolares, salud, perro, coche y viajes.",
    notes: [
      {
        id: "m1-memory",
        path: "MEMORY.md",
        scope: "bot",
        inclusion: "searchable",
        updatedAt: "2026-11-24T19:12:00Z",
        content: `# Memoria de Marta
Marta vive en Zaragoza, en el barrio de Delicias.
Su marido se llama Pablo y trabaja de electricista.
Tiene dos hijos: Hugo (9 años) y Alba (6 años).
Prefiere que le hablen de tú y sin rodeos.
Su hermana Lucía vive en Valencia y es enfermera.
El perro de la familia es Toby, un beagle de cuatro años.
Marta trabaja media jornada en una gestoría por las mañanas.
Los martes Marta sale más tarde de la gestoría.
A Hugo no le gusta el pescado salvo las sardinas.
Alba tiene la piel atópica y usa crema sin perfume.
La comunidad de vecinos se reúne el primer lunes de cada mes.
Quiere aprender a hacer pan de masa madre.
El seguro del hogar vence en marzo.
Pablo juega al pádel los jueves por la tarde.
Marta corre 5 km los domingos por el parque del Agua.
Marta va al dentista cada seis meses.
Su mejor amiga es Nuria, compañera de la gestoría.
Está pensando en cambiar la lavadora porque hace mucho ruido.
No guardar contraseñas en la memoria; Marta las tiene en papel.
Hugo va a natación dos tardes por semana.
Alba hace patinaje los viernes.
Les gusta ir a Jaca en invierno.
Marta no bebe café, toma té rooibos.
El coche familiar es un Seat León de 2017.
Pablo es del Real Zaragoza y va al fútbol con Hugo.
La tutora de Alba se llama Begoña.
Marta lee novela negra antes de dormir.
Quieren pintar el salón este invierno.
La abuela Carmen cumple 80 años en abril de 2027.
Hugo está aprendiendo a tocar la guitarra.
La cuenta conjunta está en una caja rural.
Marta odia las reuniones largas del AMPA.
La vecina del 3ºB, Rosario, les cuida las plantas en verano.
Alba duerme mal cuando hay tormenta.
Los sábados hacen la compra grande en el mercado central.
Pablo ronca y Marta usa tapones.
Marta tiene miopía y usa lentillas mensuales.
Hugo quiere un móvil pero han decidido esperar a los 12.
Pablo quiere hacer el Camino de Santiago en bici.
Marta quiere renovar el DNI antes de Navidad.
Marta está ahorrando para un viaje a Escocia.
Alba colecciona piedras bonitas de la playa.
El fontanero de confianza es Andrés, su teléfono está en la agenda del móvil.
Hugo saca muy buenas notas en matemáticas pero le cuesta lengua.
Las vacaciones de verano suelen ser en Peñíscola.
Marta quiere apuntarse a clases de cerámica los miércoles.
Toby tiene miedo a los petardos.
Pablo es alérgico a la penicilina.
Los niños meriendan fruta y un bocadillo pequeño.
Marta prefiere recetas que se hagan en menos de 30 minutos.
La gestoría cierra la primera quincena de agosto.
Hugo se rompió la muñeca en 2024 jugando al fútbol.
Lucía viene a pasar la Navidad con ellos cada dos años.
Alba quiere ser veterinaria de mayor.
Tienen una thermomix que casi no usan.
El padre de Marta, Jesús, murió en 2021.
Marta paga la cuota del gimnasio aunque no va.
La factura de la luz sube mucho en enero.
Les encantan los juegos de mesa; el favorito es Carcassonne.`,
      },
      {
        id: "m1-hugo",
        path: "people/hugo.md",
        scope: "bot",
        updatedAt: "2026-09-10T08:30:00Z",
        content: `# Hugo

Hijo mayor de Marta y Pablo, nacido el 12 de mayo de 2017.
Va a 4º de primaria. Cole: [[colegio]].
Actividades: [[extraescolares]].
Le encantan Minecraft y los cómics de Astérix.
Talla de ropa 10 años, pie 34.
Su mejor amigo del cole es Dani.`,
      },
      {
        id: "m1-alba",
        path: "people/alba.md",
        scope: "bot",
        updatedAt: "2026-09-10T08:34:00Z",
        content: `# Alba

Hija pequeña, nacida el 28 de septiembre de 2020.
Va a 1º de primaria con la tutora Begoña. Ver [[colegio]].
Temas médicos en [[salud]].
Le encantan los caballos y dibujar.
Talla 6-7 años, pie 28.`,
      },
      {
        id: "m1-carmen",
        path: "people/abuela-carmen.md",
        scope: "bot",
        updatedAt: "2026-10-02T17:45:00Z",
        content: `# Abuela Carmen

Madre de Pablo. Vive sola en la calle Unceta, a diez minutos andando.
Recoge a Hugo y Alba los martes a la salida del cole y les da la merienda.
No conduce; si hay que llevarla al médico la lleva Pablo.
Toma Sintrom por la mañana; ojo con los antiinflamatorios.
Cumple 80 el 9 de abril de 2027: queremos hacerle una comida sorpresa. Ver [[cumpleanos]].`,
      },
      {
        id: "m1-colegio",
        path: "colegio.md",
        scope: "bot",
        updatedAt: "2026-11-18T13:05:00Z",
        content: `# Colegio CEIP Río Ebro

Hugo está en 4ºB y Alba en 1ºA.
Entrada a las 9:00 y salida a las 14:00 (jornada continua).
Comedor hasta las 16:00, solo lunes y miércoles.
Próxima reunión con la tutora de Hugo: 2 de diciembre a las 16:30.
La tutora de Hugo es Silvia; la de Alba, Begoña.
Excursión de 4º en diciembre: [[salidas/la-torrecilla]].
AMPA: cuota anual 20 € por familia.`,
      },
      {
        id: "m1-torrecilla",
        path: "salidas/la-torrecilla.md",
        scope: "bot",
        updatedAt: "2026-11-20T09:15:00Z",
        content: `# La Torrecilla (granja escuela)

Fecha: viernes 11 de diciembre de 2026.
Salida del autobús a las 8:45, vuelta sobre las 17:00.
Material: almuerzo, botas de agua, ropa que se pueda manchar y la autorización firmada.
Precio: 18 euros por Bizum a la AMPA antes del 4 de diciembre.
Van con los monitores Raúl y Eva.`,
      },
      {
        id: "m1-extraescolares",
        path: "extraescolares.md",
        scope: "bot",
        updatedAt: "2026-09-15T18:20:00Z",
        content: `# Extraescolares 2026-27

- Natación (Hugo): lunes y miércoles de 17:30 a 18:30 en el CDM Delicias. 32 € al mes.
- Patinaje (Alba): viernes de 17:00 a 18:00 en el pabellón Siglo XXI. 25 € al mes.
- Guitarra (Hugo): sábados a las 11:00 con el profe Iván, 40 € al mes.

El gorro de natación tiene que ser de silicona.`,
      },
      {
        id: "m1-salud",
        path: "salud.md",
        scope: "bot",
        updatedAt: "2026-06-03T10:00:00Z",
        content: `# Salud de la familia

- Alba: alergia a frutos secos. Lleva siempre el autoinyector de adrenalina (caduca en marzo de 2027).
- Pediatra: doctor Ferrer, centro de salud Delicias Sur. Citas por la app.
- Hugo: vacunas al día; revisión de la vista en enero.
- Marta: miopía, lentillas mensuales.
- Teléfono de urgencias pediátricas en la nevera.`,
      },
      {
        id: "m1-toby",
        path: "mascotas/toby.md",
        scope: "bot",
        updatedAt: "2026-03-22T11:40:00Z",
        content: `# Toby

Beagle macho, 4 años, adoptado en la protectora en 2022.
Come pienso light dos veces al día; nada de comida de la mesa.
Paseos: Pablo por la mañana, Marta por la noche.
Se pone nervioso con los petardos y las tormentas.
Veterinaria: [[clinica-veterinaria]].`,
      },
      {
        id: "m1-clinica",
        path: "clinica-veterinaria.md",
        scope: "bot",
        updatedAt: "2026-10-14T16:10:00Z",
        content: `# Clínica Veterinaria Los Sitios

La doctora es Elena Marco.
Próxima cita: 14 de enero de 2027, rabia y polivalente.
Horario: de lunes a viernes de 10 a 14 y de 17 a 20.
El chip está registrado a nombre de Pablo.
Última desparasitación: septiembre de 2026.`,
      },
      {
        id: "m1-coche",
        path: "coche.md",
        scope: "bot",
        updatedAt: "2026-10-28T12:00:00Z",
        content: `# Coche

Seat León de 2017, gris, matrícula 4821 KLM.
La ITV caduca en junio de 2027.
Taller de confianza: Talleres Gómez, calle Escoriaza.
Cambio de aceite cada 15.000 km; el último a los 98.400 km en octubre de 2026.
Seguro a todo riesgo con franquicia, renovación el 15 de mayo.`,
      },
      {
        id: "m1-escocia",
        path: "viajes/escocia.md",
        scope: "bot",
        updatedAt: "2026-07-30T21:00:00Z",
        content: `# Viaje a Escocia

Idea: julio de 2027, los cuatro.
Vuelo Barcelona-Edimburgo y coche de alquiler por las Highlands.
Presupuesto total: unos 3.500 €.
Cómo vamos de dinero: [[finanzas/ahorro]].
A Alba le hace ilusión ver el lago Ness.`,
      },
      {
        id: "m1-ahorro",
        path: "finanzas/ahorro.md",
        scope: "bot",
        updatedAt: "2026-11-26T20:30:00Z",
        content: `# Ahorro

Apartamos 250 € al mes en la cuenta de la caja rural para el viaje grande.
A finales de noviembre de 2026 llevamos 2.100 €.
Fondo de emergencia: 6.000 €, no tocar.`,
      },
      {
        id: "m1-cenas",
        path: "recetas/cenas-rapidas.md",
        scope: "bot",
        updatedAt: "2026-05-11T19:50:00Z",
        content: `# Cenas rápidas (menos de 30 min)

- Tortilla de calabacín y cebolla.
- Crema de calabaza con queso fresco.
- Pasta con atún y tomate.
- Hamburguesas caseras de lentejas.
- Merluza al horno (Hugo no la come).
Lista de la compra en [[compras]].`,
      },
      {
        id: "m1-cumples",
        path: "cumpleanos.md",
        scope: "bot",
        updatedAt: "2026-01-07T09:00:00Z",
        content: `# Cumpleaños

- Pablo: 3 de febrero
- Hugo: 12 de mayo
- Alba: 28 de septiembre
- Lucía (hermana): 17 de noviembre
- Abuela Carmen: 9 de abril
- Nuria: 22 de junio`,
      },
      {
        id: "m1-reformas",
        path: "casa/reformas.md",
        scope: "bot",
        updatedAt: "2026-11-02T18:25:00Z",
        content: `# Reformas pendientes

- Pintar el salón de verde salvia. Presupuesto de Pinturas Ebro: 640 € con materiales.
- Cambiar la lavadora (mirar modelos silenciosos).
- Persiana del cuarto de Alba atascada; llamar al persianero en enero.`,
      },
      {
        id: "m1-sobremi",
        path: "sobre-mi.md",
        scope: "user",
        inclusion: "essential",
        updatedAt: "2025-12-01T10:00:00Z",
        content: `# Sobre mí

Soy Marta Gil, 41 años, de Zaragoza. Madre de Hugo y Alba.
Háblame en español, de tú y sin rollos.`,
      },
      {
        id: "m1-compras",
        path: "compras.md",
        scope: "user",
        inclusion: "searchable",
        updatedAt: "2026-04-19T10:30:00Z",
        content: `# Compras

Compra grande los sábados en el Mercado Central; el resto en el súper de la esquina.
Presupuesto semanal de comida: 140 €.
Intento comprar fruta de temporada y productos de Aragón.`,
      },
    ],
    cases: [
      { id: "v1-01", split: "dev", tags: ["direct"], message: "¿A qué hora es la reunión con la tutora de Hugo?", facts: ["2 de diciembre a las 16:30"], notes: ["m1-colegio"] },
      { id: "v1-02", split: "holdout", tags: ["direct"], message: "cuánto pagamos al mes por la natación de Hugo?", facts: ["32 € al mes"], notes: ["m1-extraescolares"] },
      { id: "v1-03", split: "dev", tags: ["inflection"], message: "Tengo unos calabacines que se van a poner malos, ¿qué cena rápida tenía apuntada?", facts: ["Tortilla de calabacín y cebolla"], notes: ["m1-cenas"] },
      { id: "v1-04", split: "holdout", tags: ["inflection"], message: "¿A qué hora patina Alba el viernes?", facts: ["viernes de 17:00 a 18:00"], notes: ["m1-extraescolares"] },
      { id: "v1-05", split: "dev", tags: ["accents"], message: "cuando es el cumple de lucia??", facts: ["Lucía (hermana): 17 de noviembre"], notes: ["m1-cumples"] },
      { id: "v1-06", split: "holdout", tags: ["accents"], message: "la medicacion q toma la abuela carmen cual era? que le duele una muela", facts: ["Toma Sintrom por la mañana"], notes: ["m1-carmen"] },
      { id: "v1-07", split: "dev", tags: ["followup"], previousUserMessage: "¿Qué días tiene natación Hugo?", message: "¿y a qué hora termina?", facts: ["lunes y miércoles de 17:30 a 18:30"], notes: ["m1-extraescolares"] },
      { id: "v1-08", split: "holdout", tags: ["followup"], previousUserMessage: "¿A qué taller solemos llevar el León?", message: "¿y cuándo fue la última vez que le cambiaron el aceite?", facts: ["el último a los 98.400 km en octubre de 2026"], notes: ["m1-coche"] },
      { id: "v1-09", split: "dev", tags: ["linked"], message: "¿Cuándo le tocan las vacunas a Toby?", facts: ["14 de enero de 2027, rabia y polivalente"], notes: ["m1-clinica"] },
      { id: "v1-10", split: "holdout", tags: ["linked"], message: "oye qué tiene que llevar Hugo a la excursión del cole?", facts: ["botas de agua"], notes: ["m1-torrecilla"] },
      { id: "v1-11", split: "dev", tags: ["buried", "synonym"], message: "Pablo tiene una infección de muelas y el dentista le quiere mandar antibiótico, ¿hay algo que deba tener en cuenta?", facts: ["Pablo es alérgico a la penicilina"], notes: ["m1-memory"] },
      { id: "v1-12", split: "dev", tags: ["buried", "direct"], message: "¿Cómo se llamaba el fontanero de confianza? Gotea otra vez el grifo de la cocina", facts: ["El fontanero de confianza es Andrés"], notes: ["m1-memory"] },
      { id: "v1-13", split: "holdout", tags: ["buried"], message: "esta noche toca juego de mesa en familia, ¿cuál era el que más nos gusta?", facts: ["el favorito es Carcassonne"], notes: ["m1-memory"] },
      { id: "v1-14", split: "holdout", tags: ["buried"], message: "Estoy recortando gastos, ¿me compensa darme de baja del gimnasio?", facts: ["paga la cuota del gimnasio aunque no va"], notes: ["m1-memory"] },
      { id: "v1-15", split: "dev", tags: ["buried", "inflection"], message: "¿Hugo se ha roto algún hueso antes? Me lo pregunta el de urgencias", facts: ["Hugo se rompió la muñeca en 2024"], notes: ["m1-memory"] },
      { id: "v1-16", split: "dev", tags: ["synonym"], message: "¿Cómo se llama el médico de los niños?", facts: ["Pediatra: doctor Ferrer"], notes: ["m1-salud"] },
      { id: "v1-17", split: "holdout", tags: ["synonym"], message: "¿Cuánto nos pedían por pintar el comedor?", facts: ["Pinturas Ebro: 640 €"], notes: ["m1-reformas"] },
      { id: "v1-18", split: "dev", tags: ["multi"], message: "Quiero hacerle una tarta a Alba por su cumple, ¿cuándo es exactamente y qué ingredientes tengo que evitar?", facts: ["Alba: 28 de septiembre", "Alba: alergia a frutos secos"], notes: ["m1-cumples", "m1-salud"] },
      { id: "v1-19", split: "holdout", tags: ["multi"], message: "El martes tengo lío en el trabajo, ¿quién se encarga de los niños y a qué hora salen?", facts: ["a Hugo y Alba los martes", "salida a las 14:00"], notes: ["m1-carmen", "m1-colegio"] },
      { id: "v1-20", split: "dev", tags: ["chitchat"], message: "hola! qué tal?", facts: [], notes: [] },
      { id: "v1-21", split: "dev", tags: ["chitchat"], message: "gracias, me has salvado la tarde", facts: [], notes: [] },
      { id: "v1-22", split: "holdout", tags: ["chitchat"], message: "explícame qué es la fotosíntesis de forma sencilla", facts: [], notes: [] },
      { id: "v1-23", split: "dev", tags: ["direct"], message: "¿Qué matrícula tiene nuestro coche? Me la piden para el parking", facts: ["matrícula 4821 KLM"], notes: ["m1-coche"] },
      { id: "v1-24", split: "dev", tags: ["accents"], message: "cuando caduca la itv del leon", facts: ["La ITV caduca en junio de 2027"], notes: ["m1-coche"] },
      { id: "v1-25", split: "dev", tags: ["linked"], message: "¿Cuánto tenemos ya juntado para lo de Escocia?", facts: ["llevamos 2.100 €"], notes: ["m1-ahorro"] },
    ],
  },

  // ---------------------------------------------------------------------------
  // Vault 2: Javier, desarrollador freelance en Madrid
  // ---------------------------------------------------------------------------
  {
    id: "v2-freelance-javier",
    description: "Javier, desarrollador freelance en Madrid; clientes, proyectos, servidor, facturación y vida personal.",
    notes: [
      {
        id: "j-memory",
        path: "MEMORY.md",
        scope: "bot",
        inclusion: "searchable",
        updatedAt: "2026-11-25T22:40:00Z",
        content: `# MEMORY
Javier es desarrollador freelance y vive en Madrid, en Lavapiés.
Trabaja sobre todo con TypeScript, React y Node.
Su pareja se llama Irene y es arquitecta.
Prefiere respuestas con código y poca teoría.
Usa Neovim como editor principal.
Tiene un gato llamado Bug.
Cobra 55 € la hora a clientes nuevos.
No trabaja los viernes por la tarde.
Su portátil es un ThinkPad X1 con Linux.
Le gusta el café de especialidad, sobre todo etíope.
Está aprendiendo Rust en sus ratos libres.
Odia las reuniones sin agenda.
Su madre vive en Salamanca.
Juega al baloncesto los miércoles con antiguos compañeros de la universidad.
Estudió Ingeniería Informática en la Politécnica.
Tiene la cuenta de autónomo en un banco online.
Prefiere PostgreSQL antes que MySQL.
Usa indentación de 2 espacios.
Quiere montar un SaaS propio algún día.
Su hermano Raúl trabaja en un banco en Londres.
No le gusta escribir tests end-to-end pero los hace.
Va a la oficina de coworking los martes y jueves.
El coworking se llama La Nave y está en Embajadores.
Tiene un teclado mecánico split.
Duerme mal cuando tiene entregas.
Escucha podcasts de tecnología en inglés.
Su tema de color favorito es gruvbox oscuro.
Irene y él quieren adoptar un perro el año que viene.
Usa Linear para gestionar tareas.
Hace la declaración trimestral con una gestora online.
Prefiere desplegar con Docker Compose en un VPS.
Tuvo un burnout en 2023 y ahora limita la jornada a 7 horas.
Le interesan los mapas y la cartografía.
Su serie favorita es The Wire.
Su web personal es javierlopez.dev.
No usa redes sociales salvo Mastodon.
Lleva gafas para la pantalla.
Corre los domingos con Irene por Madrid Río.
Tiene alergia al polen de gramíneas en primavera.
Su primer trabajo fue en una consultora de Alcobendas.
El router de casa se reinicia solo a veces; sospecha del firmware.
Le gusta cocinar ramen casero los sábados.
La tarifa plana de autónomos se le acaba en marzo de 2027.
Quiere comprarse una silla ergonómica de segunda mano.
El cumpleaños de Irene es el 14 de agosto.
Prefiere commits pequeños y mensajes en inglés.
Su abuela le enseñó a jugar al mus.
Tiene una moto de 125 para moverse por Madrid.
Nunca trabaja con clientes de apuestas online.
Sus vacaciones de Navidad serán del 22 de diciembre al 7 de enero.
Lleva las facturas en una hoja de cálculo además de la gestora.
Usa un gestor de contraseñas y nunca guarda claves en notas.
Le cuesta decir que no a encargos pequeños.
Tiene un huerto urbano en el balcón con tomates y albahaca.
Su objetivo para 2027 es facturar 70.000 €.`,
      },
      {
        id: "j-panaderia",
        path: "clientes/panaderia-sol.md",
        scope: "bot",
        updatedAt: "2026-08-21T10:15:00Z",
        content: `# Cliente: Panadería El Sol

Contacto: Merche Ruiz (dueña), merche@ejemplo.com.
Proyecto: [[proyectos/tienda-online]].
Tarifa pactada: 45 € la hora, máximo 20 horas al mes.
Facturar el día 1 de cada mes.
Prefiere que la llamen por teléfono antes que emails largos.`,
      },
      {
        id: "j-tienda",
        path: "proyectos/tienda-online.md",
        scope: "bot",
        updatedAt: "2026-11-19T17:02:00Z",
        content: `# Tienda online Panadería El Sol

Stack: Next.js + Stripe + Postgres. Infraestructura en [[servidor-vps]].
Entrega de la fase 2 (pedidos programados): 15 de diciembre de 2026.
Pendiente: integrar los envíos con la API de repartos de Rutasur.
El catálogo tiene 64 productos.
Bug abierto: el carrito pierde los productos al cambiar de idioma.`,
      },
      {
        id: "j-vps",
        path: "servidor-vps.md",
        scope: "bot",
        updatedAt: "2026-06-30T23:10:00Z",
        content: `# Servidor VPS

Proveedor: NubeIbérica, 4 vCPU, 8 GB RAM, Ubuntu 24.04.
IP: 203.0.113.24, SSH por el 2222.
Copias de seguridad diarias a las 3:00 en un bucket compatible con S3.
Certificados con Caddy, renovación automática.
Aquí corren los proyectos de clientes.`,
      },
      {
        id: "j-agencia",
        path: "clientes/agencia-norte.md",
        scope: "bot",
        updatedAt: "2026-10-05T09:30:00Z",
        content: `# Cliente: Agencia Norte (marketing)

Contacto: Óscar Vidal, project manager.
Proyecto: [[proyectos/app-reservas]].
Pagan a 60 días, ojo con la tesorería.
Reunión semanal los lunes a las 10:00 por videollamada.
Quieren presupuesto para una landing nueva en enero.`,
      },
      {
        id: "j-reservas",
        path: "proyectos/app-reservas.md",
        scope: "bot",
        updatedAt: "2026-11-23T12:45:00Z",
        content: `# App de reservas

React Native + Node, para una cadena de fisioterapia con 6 clínicas.
Demo para el cliente final: 3 de diciembre de 2026.
Incidencia: las notificaciones push no llegan en Android 14.
Repositorio en GitLab de la agencia; despliegues los jueves.`,
      },
      {
        id: "j-facturacion",
        path: "facturacion.md",
        scope: "bot",
        updatedAt: "2026-04-02T11:00:00Z",
        content: `# Facturación e impuestos

IVA 21% en todas las facturas a empresas españolas.
Retención IRPF del 15% (ya no aplica el 7% de nuevo autónomo).
Numeración: 2026-001, 2026-002...
Modelos 303 y 130 cada trimestre; los del 4T antes del 30 de enero.
Quién me lleva las cuentas: [[gestora]].`,
      },
      {
        id: "j-gestora",
        path: "gestora.md",
        scope: "bot",
        updatedAt: "2026-02-14T10:20:00Z",
        content: `# Gestora online

Me lleva la contabilidad Ana Belén, de Cuentas Claras.
Cuota: 49 € al mes.
Le mando las facturas antes del día 5 del mes siguiente.
Contacto por WhatsApp, mejor por la mañana.`,
      },
      {
        id: "j-irene",
        path: "people/irene.md",
        scope: "bot",
        updatedAt: "2026-03-08T21:00:00Z",
        content: `# Irene

Pareja de Javier desde 2019. Arquitecta en un estudio de Chamberí.
Vegetariana desde hace años: nada de carne ni pescado.
Le gustan las plantas, la cerámica y las novelas de Murakami.
Sus padres viven en Cádiz; vamos en Semana Santa.`,
      },
      {
        id: "j-stack",
        path: "stack.md",
        scope: "bot",
        updatedAt: "2025-11-12T15:00:00Z",
        content: `# Preferencias técnicas

- Lenguaje: TypeScript estricto, nada de any.
- Tests: Vitest; e2e con Playwright.
- Formateo: Prettier con comillas simples y sin punto y coma.
- Base de datos: PostgreSQL con Drizzle.
- Despliegue: Docker Compose y Caddy.`,
      },
      {
        id: "j-agenda",
        path: "agenda-semana.md",
        scope: "bot",
        updatedAt: "2026-11-27T08:00:00Z",
        content: `# Agenda de la semana

- Lunes 30 nov, 10:00: reunión semanal con Agencia Norte.
- Martes 1 dic: facturar a Panadería El Sol.
- Miércoles 2 dic, 19:00: baloncesto.
- Jueves 3 dic: coworking todo el día.
- Viernes 4 dic: dentista a las 9:30.`,
      },
      {
        id: "j-saas",
        path: "ideas/saas.md",
        scope: "bot",
        updatedAt: "2026-07-12T22:15:00Z",
        content: `# Idea de SaaS

Gestor de turnos y cuotas para pequeños gimnasios de barrio.
Precio objetivo: 19 € al mes por centro.
Competencia: hojas de cálculo y apps genéricas.
Validar con 5 gimnasios antes de programar nada.`,
      },
      {
        id: "j-bug",
        path: "mascotas/bug.md",
        scope: "bot",
        updatedAt: "2026-02-20T19:00:00Z",
        content: `# Bug

Gato común atigrado, 3 años.
Come pienso renal por recomendación del veterinario.
Vacuna anual en febrero.
Se esconde cuando viene gente a casa.`,
      },
      {
        id: "j-estilo",
        path: "estilo.md",
        scope: "user",
        inclusion: "essential",
        updatedAt: "2025-10-01T09:00:00Z",
        content: `# Cómo responderme

Respuestas cortas, con código cuando haga falta. Si no sabes algo, dilo.`,
      },
      {
        id: "j-trabajo",
        path: "trabajo.md",
        scope: "user",
        inclusion: "searchable",
        updatedAt: "2026-01-09T09:30:00Z",
        content: `# Trabajo

Horario: de 9:00 a 16:00, con pausa para comer a las 14:00.
No acepto proyectos con plazo de menos de una semana.
Descuentos solo para ONG.`,
      },
    ],
    cases: [
      { id: "v2-01", split: "dev", tags: ["direct"], message: "¿Para cuándo es la entrega de la fase 2 de la tienda online?", facts: ["fase 2 (pedidos programados): 15 de diciembre de 2026"], notes: ["j-tienda"] },
      { id: "v2-02", split: "holdout", tags: ["direct"], message: "qué bug teníamos abierto en el carrito de la tienda?", facts: ["el carrito pierde los productos al cambiar de idioma"], notes: ["j-tienda"] },
      { id: "v2-03", split: "dev", tags: ["linked"], message: "tengo que entrar a la máquina donde está la tienda de la panadería, ¿por qué puerto era?", facts: ["SSH por el 2222"], notes: ["j-vps"] },
      { id: "v2-04", split: "holdout", tags: ["linked"], message: "Lo de Agencia Norte, ¿para cuándo tenía que estar enseñable?", facts: ["Demo para el cliente final: 3 de diciembre de 2026"], notes: ["j-reservas"] },
      { id: "v2-05", split: "dev", tags: ["synonym"], message: "¿Cuánto me cobra la asesora al mes?", facts: ["Cuota: 49 € al mes"], notes: ["j-gestora"] },
      { id: "v2-06", split: "holdout", tags: ["synonym"], message: "Esta noche cocino yo para mi novia, ¿alguna idea de cena?", facts: ["Vegetariana desde hace años"], notes: ["j-irene"] },
      { id: "v2-07", split: "dev", tags: ["inflection"], message: "Voy a empezar a testear la app de reservas, ¿con qué herramientas suelo hacerlo?", facts: ["Tests: Vitest; e2e con Playwright"], notes: ["j-stack"] },
      { id: "v2-08", split: "holdout", tags: ["inflection"], message: "¿Qué reuniones tengo esta semana?", facts: ["reunión semanal con Agencia Norte"], notes: ["j-agenda"] },
      { id: "v2-09", split: "dev", tags: ["accents"], message: "a que hora tengo el dentista el viernes", facts: ["dentista a las 9:30"], notes: ["j-agenda"] },
      { id: "v2-10", split: "holdout", tags: ["accents"], message: "q pienso le compro a bug? se me ha acabado", facts: ["Come pienso renal"], notes: ["j-bug"] },
      { id: "v2-11", split: "dev", tags: ["followup"], previousUserMessage: "¿Cuánto le cobro a la Panadería El Sol por hora?", message: "¿y cuándo le mando la factura?", facts: ["Facturar el día 1 de cada mes"], notes: ["j-panaderia"] },
      { id: "v2-12", split: "holdout", tags: ["followup"], previousUserMessage: "¿Qué le pasaba a la app de reservas en Android?", message: "vale, ¿y qué día se suele subir a producción?", facts: ["despliegues los jueves"], notes: ["j-reservas"] },
      { id: "v2-13", split: "dev", tags: ["buried", "direct"], message: "¿Cuándo se me acaba la tarifa plana de autónomos?", facts: ["se le acaba en marzo de 2027"], notes: ["j-memory"] },
      { id: "v2-14", split: "dev", tags: ["buried"], message: "Me ha escrito una empresa de apuestas deportivas para hacerles una web, ¿me encaja?", facts: ["Nunca trabaja con clientes de apuestas online"], notes: ["j-memory"] },
      { id: "v2-15", split: "holdout", tags: ["buried"], message: "¿Qué días tenía cogidos de vacaciones en Navidad?", facts: ["del 22 de diciembre al 7 de enero"], notes: ["j-memory"] },
      { id: "v2-16", split: "holdout", tags: ["buried", "synonym", "inflection"], message: "a las tomateras del balcón se les están poniendo las hojas amarillas, qué hago?", facts: ["huerto urbano en el balcón con tomates"], notes: ["j-memory"] },
      { id: "v2-17", split: "dev", tags: ["buried"], message: "¿Cuándo es el cumple de Irene? Quiero ir mirando regalo", facts: ["El cumpleaños de Irene es el 14 de agosto"], notes: ["j-memory"] },
      { id: "v2-18", split: "dev", tags: ["multi"], message: "Merche me pide 25 horas este mes para la tienda, ¿entra en lo pactado y cuánto sería con impuestos?", facts: ["45 € la hora, máximo 20 horas al mes", "IVA 21%"], notes: ["j-panaderia", "j-facturacion"] },
      { id: "v2-19", split: "holdout", tags: ["multi"], message: "Si hoy le facturo a Agencia Norte, ¿cuándo cobraría y qué retención le pongo?", facts: ["Pagan a 60 días", "Retención IRPF del 15%"], notes: ["j-agencia", "j-facturacion"] },
      { id: "v2-20", split: "dev", tags: ["chitchat"], message: "buenas! cómo va?", facts: [], notes: [] },
      { id: "v2-21", split: "dev", tags: ["chitchat"], message: "¿Qué diferencia hay entre una promesa y async/await en JavaScript?", facts: [], notes: [] },
      { id: "v2-22", split: "holdout", tags: ["chitchat"], message: "perfecto, gracias crack", facts: [], notes: [] },
      { id: "v2-23", split: "holdout", tags: ["chitchat"], message: "cuéntame un chiste de programadores", facts: [], notes: [] },
      { id: "v2-24", split: "dev", tags: ["direct"], message: "¿Qué precio objetivo había pensado para la idea del SaaS de gimnasios?", facts: ["19 € al mes por centro"], notes: ["j-saas"] },
    ],
  },

  // ---------------------------------------------------------------------------
  // Vault 3: Carla, estudiante de Biología en Granada
  // ---------------------------------------------------------------------------
  {
    id: "v3-estudiante-carla",
    description: "Carla, 21, estudiante de Biología en Granada; exámenes, TFG, Erasmus, trabajo en cafetería y piso compartido.",
    notes: [
      {
        id: "c-memory",
        path: "MEMORY.md",
        scope: "bot",
        inclusion: "searchable",
        updatedAt: "2026-11-21T23:55:00Z",
        content: `# MEMORY
Carla tiene 21 años y estudia Biología en la Universidad de Granada.
Es de Almería; sus padres siguen viviendo allí.
Comparte piso en el Realejo con Sara y Noelia.
Trabaja los fines de semana en una cafetería.
Es vegetariana pero come huevos.
Le cuesta mucho madrugar.
Tiene ansiedad antes de los exámenes orales.
Su hermano pequeño, Iker, tiene 15 años.
Toca el ukelele.
Quiere hacer el máster en Biología Marina.
Su asignatura favorita es Ecología.
Usa Notion para tomar apuntes.
Va a la facultad en bici.
Lleva gafas solo para leer.
Le gusta el k-pop.
Ha suspendido Bioquímica una vez.
Su portátil es antiguo y se calienta mucho.
Prefiere estudiar en la biblioteca de Ciencias.
Su mejor amiga del pueblo es Andrea.
Su novio se llama Marcos y estudia Medicina.
Tiene un lunar en la espalda que la dermatóloga revisa cada año.
Le encanta el senderismo en Sierra Nevada.
Tiene beca del ministerio este curso.
Odia los trabajos en grupo.
Su color favorito es el verde.
Hace voluntariado en un refugio de animales una vez al mes.
Le dan miedo las arañas aunque estudie Biología.
Su abuela le manda tuppers de comida cuando va a casa.
Quiere aprender alemán.
Tiene el carnet de conducir pero no coche.
Su serie favorita es Dark.
Paga 290 € al mes de alquiler.
Le gusta hacer fotos de insectos con el móvil.
Lleva un diario en papel.
En verano trabaja de socorrista en Almería.
Bebe mucho té matcha.
Su cumpleaños es el 2 de marzo.
Prefiere explicaciones con esquemas y ejemplos.
Se apuntó a yoga los jueves pero casi nunca va.
Su número de la suerte es el 7.
Tiene una planta carnívora llamada Dionea.
El casero se llama Paco y tarda en arreglar las cosas.
Le gustaría vivir en Noruega algún día.
Ha leído toda la saga de Harry Potter tres veces.
Marcos cumple años el 19 de enero.
Su madre es profesora de primaria y su padre agricultor.
La tarjeta del autobús se recarga en el estanco de la esquina.
Es alérgica al ibuprofeno.
Prefiere el turno de mañana en la cafetería.
Está ahorrando para comprarse un portátil nuevo.
Su grupo de prácticas de laboratorio es el B2.
Se marea en los barcos.
Una vez vio una orca en Tarifa.`,
      },
      {
        id: "c-examenes",
        path: "examenes.md",
        scope: "bot",
        updatedAt: "2026-11-10T18:00:00Z",
        content: `# Exámenes enero 2027

- Genética: 12 de enero, 9:00, aula A-14.
- Bioquímica: 18 de enero, 16:00, aula B-03.
- Ecología: 22 de enero, oral, despacho del profesor Ortega.
- Microbiología: 27 de enero, 10:00.
Revisión de notas: una semana después de cada examen.`,
      },
      {
        id: "c-genetica",
        path: "asignaturas/genetica.md",
        scope: "bot",
        updatedAt: "2026-10-20T20:10:00Z",
        content: `# Genética

Profesora: Dra. Inés Calvo.
Temas que entran: 1 a 9 (el 10 no entra).
Lo que más me cuesta: ligamiento y mapas genéticos.
Las prácticas cuentan un 20% de la nota.
Fecha del examen en [[examenes]].`,
      },
      {
        id: "c-bioquimica",
        path: "asignaturas/bioquimica.md",
        scope: "bot",
        updatedAt: "2026-10-22T19:40:00Z",
        content: `# Bioquímica

Profesor: Dr. Luis Herrera.
Suspendí en la convocatoria de junio de 2026; esta vez voy con resúmenes por temas.
El examen es tipo test con penalización: cada fallo resta 0,25.
Temas clave: glucólisis, ciclo de Krebs y cadena respiratoria.`,
      },
      {
        id: "c-tfg",
        path: "tfg.md",
        scope: "bot",
        updatedAt: "2026-11-15T12:30:00Z",
        content: `# TFG

Tema: microplásticos en el intestino de peces de la costa de Almería.
Tutora: [[people/dra-montes]].
Entrega del borrador del marco teórico: 20 de diciembre de 2026.
Defensa prevista: julio de 2027.
Necesito 40 referencias como mínimo.`,
      },
      {
        id: "c-montes",
        path: "people/dra-montes.md",
        scope: "bot",
        updatedAt: "2026-09-29T10:05:00Z",
        content: `# Dra. Pilar Montes

Departamento de Zoología, despacho 2.07.
Tutorías los miércoles de 11:00 a 13:00, pedir cita por correo.
Prefiere los documentos en PDF y con control de cambios.
Correo: pmontes@ugr-ejemplo.es`,
      },
      {
        id: "c-erasmus",
        path: "erasmus.md",
        scope: "bot",
        updatedAt: "2026-11-02T17:20:00Z",
        content: `# Erasmus 2027-28

Primera opción: Universidad de Bergen (Noruega). Segunda: Gotemburgo.
Nivel de inglés necesario: B2 certificado.
Plazo de solicitud: 15 de febrero de 2027.
Papeles pendientes: [[erasmus/documentos]].
Coordinador de la facultad: profesor Juan Ortega.`,
      },
      {
        id: "c-erasmus-docs",
        path: "erasmus/documentos.md",
        scope: "bot",
        updatedAt: "2026-11-26T21:00:00Z",
        content: `# Documentos

- Certificado B2 de Cambridge: lo tengo (First, 2024).
- Expediente académico: pedirlo en secretaría, tarda unos 10 días.
- Learning agreement: sin hacer.
- Carta de motivación en inglés: borrador al 50%.`,
      },
      {
        id: "c-cafeteria",
        path: "trabajo-cafeteria.md",
        scope: "bot",
        updatedAt: "2026-09-05T15:30:00Z",
        content: `# Trabajo en la cafetería

Cafetería La Alacena, en la calle Navas.
Turnos: sábados y domingos de 8:00 a 15:00.
Sueldo: 9,50 € la hora, cobro el día 5.
Encargada: Rocío. Si necesito cambiar turno, avisarla con una semana.
Compañero que suele cubrirme: Álex.`,
      },
      {
        id: "c-piso",
        path: "piso.md",
        scope: "bot",
        updatedAt: "2026-10-01T22:00:00Z",
        content: `# Piso del Realejo

Compañeras: [[people/sara]] y Noelia.
Alquiler: 870 € entre las tres, se paga al casero antes del día 3.
Turnos de limpieza: semana 1 Carla, semana 2 Sara, semana 3 Noelia.
Internet: fibra a nombre de Noelia, 30 € al mes que se divide.
La lavadora pierde agua si se pone el centrifugado a tope.`,
      },
      {
        id: "c-sara",
        path: "people/sara.md",
        scope: "bot",
        updatedAt: "2026-09-12T13:00:00Z",
        content: `# Sara

Compañera de piso, estudia Traducción (inglés y alemán).
Es de Jaén. Es celíaca: nada de gluten cuando cocinamos juntas.
Se ofreció a ayudarme con el alemán.
Cumple el 30 de noviembre.`,
      },
      {
        id: "c-gastos",
        path: "gastos.md",
        scope: "bot",
        updatedAt: "2026-11-01T11:00:00Z",
        content: `# Gastos mensuales

- Alquiler: 290 €
- Comida: unos 150 €
- Bonobús: 20 €
- Móvil: 12 €
- Gimnasio de la uni: 15 €
Ingresos: cafetería (unos 530 €) + beca + 100 € de mis padres.`,
      },
      {
        id: "c-sobremi",
        path: "sobre-mi.md",
        scope: "user",
        inclusion: "essential",
        updatedAt: "2025-09-20T10:00:00Z",
        content: `# Sobre mí

Carla, 21, estudiante de Biología en Granada. Explícame las cosas con esquemas y ejemplos.`,
      },
      {
        id: "c-horario",
        path: "horario.md",
        scope: "user",
        inclusion: "searchable",
        updatedAt: "2026-09-16T08:00:00Z",
        content: `# Horario de clases (primer cuatrimestre)

Lunes y miércoles: 9:00-14:00 teoría.
Martes: prácticas de laboratorio de 16:00 a 19:00.
Jueves: seminario de Ecología a las 12:00.
Viernes: libre (lo uso para el TFG).`,
      },
    ],
    cases: [
      { id: "v3-01", split: "dev", tags: ["direct"], message: "¿A qué hora y en qué aula es el examen de Genética?", facts: ["Genética: 12 de enero, 9:00, aula A-14"], notes: ["c-examenes"] },
      { id: "v3-02", split: "holdout", tags: ["direct"], message: "¿cuántas referencias necesito como mínimo para el TFG?", facts: ["40 referencias como mínimo"], notes: ["c-tfg"] },
      { id: "v3-03", split: "dev", tags: ["accents", "inflection"], message: "el examen de bioquimica resta por los fallos??", facts: ["cada fallo resta 0,25"], notes: ["c-bioquimica"] },
      { id: "v3-04", split: "holdout", tags: ["accents"], message: "cuando era el oral de ecologia? me estoy agobiando", facts: ["Ecología: 22 de enero, oral"], notes: ["c-examenes"] },
      { id: "v3-05", split: "dev", tags: ["linked"], message: "Necesito resolver dudas del TFG en persona, ¿qué día puedo pasarme?", facts: ["Tutorías los miércoles de 11:00 a 13:00"], notes: ["c-montes"] },
      { id: "v3-06", split: "holdout", tags: ["linked"], message: "¿qué me falta todavía para lo del Erasmus?", facts: ["Learning agreement: sin hacer"], notes: ["c-erasmus-docs"] },
      { id: "v3-07", split: "dev", tags: ["synonym"], message: "¿cuánto gano por hora en el curro?", facts: ["9,50 € la hora"], notes: ["c-cafeteria"] },
      { id: "v3-08", split: "holdout", tags: ["synonym", "accents"], message: "q dia tengo labo esta semana", facts: ["Martes: prácticas de laboratorio de 16:00 a 19:00"], notes: ["c-horario"] },
      { id: "v3-09", split: "dev", tags: ["followup"], previousUserMessage: "Si quiero cambiar el turno del domingo en la cafetería, ¿a quién se lo digo?", message: "¿y con cuánta antelación?", facts: ["avisarla con una semana"], notes: ["c-cafeteria"] },
      { id: "v3-10", split: "holdout", tags: ["followup"], previousUserMessage: "¿Qué temas entran en el examen de Genética?", message: "¿y cuánto pesan las prácticas?", facts: ["Las prácticas cuentan un 20% de la nota"], notes: ["c-genetica"] },
      { id: "v3-11", split: "dev", tags: ["inflection"], message: "¿Cuándo me toca limpiar a mí en el piso?", facts: ["semana 1 Carla"], notes: ["c-piso"] },
      { id: "v3-12", split: "holdout", tags: ["inflection", "multi"], message: "¿Qué profesores tengo en genética y en bioquímica? Tengo que mandarles un correo", facts: ["Profesora: Dra. Inés Calvo", "Profesor: Dr. Luis Herrera"], notes: ["c-genetica", "c-bioquimica"] },
      { id: "v3-13", split: "dev", tags: ["buried", "accents"], message: "en q grupo de practicas de labo estaba yo?", facts: ["Su grupo de prácticas de laboratorio es el B2"], notes: ["c-memory"] },
      { id: "v3-14", split: "dev", tags: ["buried"], message: "Me duele muchísimo la cabeza, ¿qué me puedo tomar?", facts: ["Es alérgica al ibuprofeno"], notes: ["c-memory"] },
      { id: "v3-15", split: "holdout", tags: ["buried"], message: "¿Cuándo cumple años Marcos? Que no se me pase", facts: ["Marcos cumple años el 19 de enero"], notes: ["c-memory"] },
      { id: "v3-16", split: "holdout", tags: ["buried", "inflection"], message: "Me han invitado a una salida en barco para ver delfines en Málaga, ¿es buena idea?", facts: ["Se marea en los barcos"], notes: ["c-memory"] },
      { id: "v3-17", split: "dev", tags: ["buried"], message: "se nos ha roto la caldera otra vez, cómo se llamaba el casero?", facts: ["El casero se llama Paco"], notes: ["c-memory"] },
      { id: "v3-18", split: "dev", tags: ["multi"], message: "Voy a hacer cena para las del piso, ¿qué no puede comer Sara y qué como yo?", facts: ["Es celíaca", "Es vegetariana pero come huevos"], notes: ["c-sara", "c-memory"] },
      { id: "v3-19", split: "holdout", tags: ["multi", "linked"], message: "¿Me da tiempo a sacarme el certificado de inglés antes del plazo del Erasmus?", facts: ["Plazo de solicitud: 15 de febrero de 2027", "Certificado B2 de Cambridge: lo tengo"], notes: ["c-erasmus", "c-erasmus-docs"] },
      { id: "v3-20", split: "dev", tags: ["chitchat"], message: "holaaa", facts: [], notes: [] },
      { id: "v3-21", split: "dev", tags: ["chitchat"], message: "explícame qué es la meiosis con un esquema", facts: [], notes: [] },
      { id: "v3-22", split: "holdout", tags: ["chitchat"], message: "jajaja vale gracias", facts: [], notes: [] },
      { id: "v3-23", split: "holdout", tags: ["chitchat"], message: "¿Cuál es la capital de Australia?", facts: [], notes: [] },
      { id: "v3-24", split: "dev", tags: ["direct"], message: "¿me recuerdas cuándo tengo que entregar el borrador del marco teórico?", facts: ["marco teórico: 20 de diciembre de 2026"], notes: ["c-tfg"] },
    ],
  },

  // ---------------------------------------------------------------------------
  // Vault 4: Ramón, dueño de una ferretería en Lugo
  // ---------------------------------------------------------------------------
  {
    id: "v4-ferreteria-ramon",
    description: "Ramón, 58, dueño de una ferretería en Lugo; proveedores, pedidos, empleada, local, salud y familia.",
    notes: [
      {
        id: "r-memory",
        path: "MEMORY.md",
        scope: "bot",
        inclusion: "searchable",
        updatedAt: "2026-11-26T13:20:00Z",
        content: `# MEMORY
Ramón tiene una ferretería en Lugo, Ferretería Lago, desde 1998.
Tiene 58 años y está casado con Pilar.
Su hija Sofía estudia Derecho en Santiago.
La tienda abre de 9:00 a 13:30 y de 16:30 a 20:00.
Los sábados solo abre por la mañana.
Les habla a los clientes en gallego y castellano.
Su empleada es Inés, lleva con él seis años.
Prefiere los mensajes cortos, lee mal en el móvil.
Es diabético tipo 2.
Juega a las cartas en el bar Castro los domingos.
Es del Celta de Vigo.
El local es alquilado.
Usa un TPV antiguo que a veces se cuelga.
No le gusta vender por internet pero se lo está pensando.
Su hermano Manolo tiene un taller mecánico en Monforte.
El repartidor de Suministros Galicia viene los martes.
Le gustan las rosquillas de anís.
Tiene una furgoneta Citroën Berlingo para repartos.
Pilar le lleva la contabilidad algunos meses.
Ha pensado jubilarse a los 65 y traspasar el negocio.
Inés quiere hacer un curso de escaparatismo.
El mejor mes de ventas suele ser mayo.
En agosto cierra dos semanas.
Los clientes mayores piden que les corten las llaves al momento.
La máquina de copiar llaves se compró en 2019.
Vende bombonas de butano.
Tiene una perra, Lúa, que se queda en la trastienda.
Le preocupa la apertura de una gran superficie de bricolaje en las afueras.
Hace descuentos del 10% a la asociación de vecinos.
Pilar trabaja en el ayuntamiento.
Le gusta pescar truchas en el Miño.
Tiene la tensión un poco alta.
Nunca abre los domingos.
Cobra con datáfono desde 2015.
El escaparate se cambia cuatro veces al año.
Su proveedor de tornillería es Suministros Galicia.
Su gestor es de una asesoría de la plaza Mayor.
Ha tenido dos robos en la tienda, el último en 2022.
Prefiere pagar a proveedores por transferencia a 30 días.
Sofía cumple 22 años el 8 de marzo.
El seguro del local vence el 31 de enero.
Le duele la rodilla izquierda al subir la escalera del almacén.
Tiene ganas de ir a Portugal en verano con Pilar.
Los paraguas se venden muy bien en otoño.
Inés libra los lunes por la mañana.
La clave de la alarma no se guarda aquí; Ramón la sabe de memoria.
Le cuesta usar el correo electrónico.
Vende leña en invierno a algunos clientes de confianza.
En el barrio le conocen como el de los tornillos.
La revisión de los extintores toca en febrero.
Tiene un sobrino, Brais, que le ayuda con el ordenador.
La persiana metálica de la entrada hace mucho ruido y hay que engrasarla.
Las facturas de la luz del local rondan los 180 € al mes.
Quiere abrir una cuenta de Instagram para la tienda.`,
      },
      {
        id: "r-suministros",
        path: "proveedores/suministros-galicia.md",
        scope: "bot",
        updatedAt: "2026-05-14T10:00:00Z",
        content: `# Suministros Galicia

Proveedor de tornillería, herramientas manuales y adhesivos.
Comercial: Xosé Varela, móvil en la agenda.
Pedido mínimo: 300 € para porte gratis.
Pedidos hasta el lunes a las 12:00 para que lleguen el martes.
Descuento del 5% si se paga al contado.`,
      },
      {
        id: "r-pinturas",
        path: "proveedores/pinturas-do-norte.md",
        scope: "bot",
        updatedAt: "2026-03-03T16:45:00Z",
        content: `# Pinturas do Norte

Pinturas, barnices y rodillos.
Pedido mínimo 200 €.
La máquina de color es suya; si falla, ver [[tintometrica]].
Pagos a 60 días.`,
      },
      {
        id: "r-tinto",
        path: "tintometrica.md",
        scope: "bot",
        updatedAt: "2026-03-03T16:50:00Z",
        content: `# Tintométrica

Modelo TintoMix 300, instalada en marzo de 2024.
Técnico: Damián, viene desde Ourense, tarda unos dos días.
Teléfono de averías: 982 000 431.
Limpiar las boquillas cada viernes para que no se sequen.`,
      },
      {
        id: "r-ines",
        path: "empleados/ines.md",
        scope: "bot",
        updatedAt: "2026-01-31T19:00:00Z",
        content: `# Inés

Dependienta, contrato de 30 horas semanales.
Sabe mucho de pintura y fontanería.
Vacaciones 2026: del 1 al 15 de agosto (cuando cierra la tienda) y 3 días en Navidad.
Nómina el último día del mes, unos 1.150 € netos.`,
      },
      {
        id: "r-pedidos",
        path: "pedidos-pendientes.md",
        scope: "bot",
        updatedAt: "2026-11-25T18:30:00Z",
        content: `# Pedidos pendientes

- Señora Amparo: 3 metros de cadena galvanizada, avisar cuando llegue.
- Constructora Miño: 40 sacos de cemento cola para el 4 de diciembre. Ver [[clientes/constructora-mino]].
- Pedro el del bar: un termo eléctrico de 80 litros.
- Reponer bombillas LED E27, quedan pocas.`,
      },
      {
        id: "r-mino",
        path: "clientes/constructora-mino.md",
        scope: "bot",
        updatedAt: "2026-11-20T12:10:00Z",
        content: `# Constructora Miño

Contacto: Lois Fernández (jefe de obra).
Compran a crédito: facturo a fin de mes y pagan a 30 días.
Deuda pendiente a noviembre de 2026: 2.340 €.
Siempre piden factura con su CIF.
Si se retrasan más de 60 días, cortar el crédito.`,
      },
      {
        id: "r-local",
        path: "local.md",
        scope: "bot",
        updatedAt: "2025-12-15T10:00:00Z",
        content: `# El local

Calle San Marcos 14, Lugo. Alquiler: 950 € al mes al dueño, don Aurelio.
Contrato renovado en 2024 por cinco años.
Alarma: [[alarma]].
El almacén de atrás tiene humedad en invierno; usar el deshumidificador.`,
      },
      {
        id: "r-alarma",
        path: "alarma.md",
        scope: "bot",
        updatedAt: "2026-09-18T11:00:00Z",
        content: `# Alarma

Empresa: Seguridad Lucense, contrato 3SL-7781.
Si salta de noche llaman primero a Ramón y luego a Inés.
Cuota: 42 € al mes.
Revisión anual hecha en septiembre de 2026.`,
      },
      {
        id: "r-salud",
        path: "salud.md",
        scope: "bot",
        updatedAt: "2026-07-16T09:20:00Z",
        content: `# Salud de Ramón

Diabetes tipo 2 desde 2019: metformina en desayuno y cena.
Analítica cada seis meses; la próxima, el 15 de enero de 2027 en el centro de salud de Fingoi.
Médica de cabecera: doctora Castiñeira.
Evitar dulces; las rosquillas, solo de vez en cuando.`,
      },
      {
        id: "r-familia",
        path: "familia.md",
        scope: "bot",
        updatedAt: "2026-09-25T20:00:00Z",
        content: `# Familia

Pilar (mujer), funcionaria del ayuntamiento.
Sofía (hija), estudia 4º de Derecho en Santiago; vuelve a Lugo los viernes en el bus de las 18:15.
Manolo (hermano), taller en Monforte.
Lúa, la perra, una mestiza de 9 años.`,
      },
      {
        id: "r-negocio",
        path: "negocio.md",
        scope: "user",
        inclusion: "essential",
        updatedAt: "2025-11-03T09:00:00Z",
        content: `# Mi negocio

Ferretería Lago, Lugo. Háblame claro y corto, que leo mal en el móvil.`,
      },
      {
        id: "r-contactos",
        path: "contactos.md",
        scope: "user",
        inclusion: "searchable",
        updatedAt: "2026-02-08T12:00:00Z",
        content: `# Contactos útiles

- Fontanero: Suso, 600 112 233
- Electricista: Marcial, 600 445 566
- Asesoría Pombo (gestor): 982 222 111
- Cerrajero de urgencias: Toño, 600 778 899`,
      },
    ],
    cases: [
      { id: "v4-01", split: "dev", tags: ["direct"], message: "¿Hasta cuándo puedo hacer el pedido a Suministros Galicia para que llegue el martes?", facts: ["hasta el lunes a las 12:00"], notes: ["r-suministros"] },
      { id: "v4-02", split: "holdout", tags: ["direct"], message: "¿Cuánto pago de alquiler del local?", facts: ["Alquiler: 950 € al mes"], notes: ["r-local"] },
      { id: "v4-03", split: "dev", tags: ["accents"], message: "cual es el pedido minimo de pinturas do norte", facts: ["Pedido mínimo 200 €"], notes: ["r-pinturas"] },
      { id: "v4-04", split: "holdout", tags: ["accents"], message: "q descuento me hace suministros galicia si pago al contado", facts: ["Descuento del 5% si se paga al contado"], notes: ["r-suministros"] },
      { id: "v4-05", split: "dev", tags: ["linked"], message: "La de hacer colores no funciona, la que puso Pinturas do Norte, ¿a quién aviso?", facts: ["Teléfono de averías: 982 000 431"], notes: ["r-tinto"] },
      { id: "v4-06", split: "holdout", tags: ["linked"], message: "los del cemento cola, ¿cuánto nos deben ya?", facts: ["Deuda pendiente a noviembre de 2026: 2.340 €"], notes: ["r-mino"] },
      { id: "v4-07", split: "dev", tags: ["synonym"], message: "¿qué pastilla tomo para el azúcar? Se me ha olvidado el nombre", facts: ["metformina en desayuno y cena"], notes: ["r-salud"] },
      { id: "v4-08", split: "holdout", tags: ["synonym"], message: "necesito el teléfono del de la luz, el que nos arregló el cuadro", facts: ["Electricista: Marcial, 600 445 566"], notes: ["r-contactos"] },
      { id: "v4-09", split: "dev", tags: ["synonym"], message: "¿A qué hora llega la niña de Santiago los viernes?", facts: ["vuelve a Lugo los viernes en el bus de las 18:15"], notes: ["r-familia"] },
      { id: "v4-10", split: "dev", tags: ["followup"], previousUserMessage: "¿Cómo se llamaba mi doctora del centro de salud?", message: "¿y cuándo tengo que volver a ir?", facts: ["la próxima, el 15 de enero de 2027"], notes: ["r-salud"] },
      { id: "v4-11", split: "holdout", tags: ["followup"], previousUserMessage: "¿Cuánto nos debe la Constructora Miño?", message: "¿y con quién hablo allí?", facts: ["Lois Fernández (jefe de obra)"], notes: ["r-mino"] },
      { id: "v4-12", split: "dev", tags: ["inflection"], message: "Ha llamado una señora preguntando por las cadenas que encargó, ¿quién era?", facts: ["Señora Amparo: 3 metros de cadena galvanizada"], notes: ["r-pedidos"] },
      { id: "v4-13", split: "holdout", tags: ["inflection"], message: "¿cada cuánto se limpian las boquillas de la tintométrica?", facts: ["Limpiar las boquillas cada viernes"], notes: ["r-tinto"] },
      { id: "v4-14", split: "dev", tags: ["buried", "synonym"], message: "cuando vence el seguro de la tienda?", facts: ["El seguro del local vence el 31 de enero"], notes: ["r-memory"] },
      { id: "v4-15", split: "dev", tags: ["buried", "inflection"], message: "¿Cuándo hay que revisar los extintores?", facts: ["La revisión de los extintores toca en febrero"], notes: ["r-memory"] },
      { id: "v4-16", split: "holdout", tags: ["buried"], message: "¿Puede venir Inés el lunes por la mañana a ayudarme con el inventario?", facts: ["Inés libra los lunes por la mañana"], notes: ["r-memory"] },
      { id: "v4-17", split: "holdout", tags: ["buried", "synonym"], message: "¿Cuántos años cumple mi hija en marzo?", facts: ["Sofía cumple 22 años el 8 de marzo"], notes: ["r-memory"] },
      { id: "v4-18", split: "dev", tags: ["buried"], message: "el ordenador de la tienda va lentísimo, ¿quién me podía echar una mano?", facts: ["Brais, que le ayuda con el ordenador"], notes: ["r-memory"] },
      { id: "v4-19", split: "dev", tags: ["multi"], message: "Si le mando el cemento cola a la Miño, ¿cuánto me deben ya y para cuándo lo quieren?", facts: ["Deuda pendiente a noviembre de 2026: 2.340 €", "40 sacos de cemento cola para el 4 de diciembre"], notes: ["r-mino", "r-pedidos"] },
      { id: "v4-20", split: "holdout", tags: ["multi", "linked"], message: "¿Cuánto me cuestan al mes el alquiler del local y la alarma juntos?", facts: ["Alquiler: 950 € al mes", "Cuota: 42 € al mes"], notes: ["r-local", "r-alarma"] },
      { id: "v4-21", split: "dev", tags: ["chitchat"], message: "bos días!", facts: [], notes: [] },
      { id: "v4-22", split: "dev", tags: ["chitchat"], message: "¿Qué tiempo suele hacer en Galicia en diciembre?", facts: [], notes: [] },
      { id: "v4-23", split: "holdout", tags: ["chitchat"], message: "moitas grazas, ata mañá", facts: [], notes: [] },
      { id: "v4-24", split: "holdout", tags: ["chitchat"], message: "¿cómo se escribe bien, 'haber' o 'a ver', en esta frase: vamos ___ si llega el pedido?", facts: [], notes: [] },
    ],
  },

  // ---------------------------------------------------------------------------
  // Vault 5: Sam, English-speaking designer living in Valencia (mixes Spanish)
  // ---------------------------------------------------------------------------
  {
    id: "v5-english-sam",
    description: "Sam, British UX designer living in Valencia; mostly English notes with some Spanish, work client, residency paperwork, health, running and trips.",
    notes: [
      {
        id: "s-memory",
        path: "MEMORY.md",
        scope: "bot",
        inclusion: "searchable",
        updatedAt: "2026-11-26T18:05:00Z",
        content: `# MEMORY
Sam is from Leeds, UK, and moved to Valencia in March 2025.
Sam works remotely as a UX designer.
Partner: Maya, a marine biologist from Toronto.
Prefers British spelling in written answers.
Is learning Spanish; currently around A2-B1.
Lives in Ruzafa, near the market.
Has a cat called Pickle.
Drinks oat flat whites, no sugar.
Plays five-a-side football on Thursdays.
Doesn't eat pork.
Uses Figma all day and dislikes Miro.
Sam's mum lives in Leeds and visits twice a year.
Wants to buy a second-hand road bike.
Le gusta mucho la horchata.
Supports Leeds United.
Has a mild fear of flying.
Bank account in Spain is with a neobank; UK account still open.
Watches a lot of Scandinavian crime dramas.
Morning person: starts work at 7:30.
Maya works with the Oceanogràfic research team.
Is vegetarian on weekdays as an experiment.
Prefers short answers with bullet points.
Uses an iPhone and a MacBook Air.
Takes metro line 5 to the beach.
Wants to run the Valencia half marathon.
Dislikes video calls before 10am.
His brother Tom lives in Bristol with two kids.
Learned to make paella from the neighbour, Doña Amparo.
Doña Amparo lives in 2ºA.
Has a standing desk at home.
Gets hay fever in April.
Pays rent by bank transfer on the 1st.
Plays guitar badly.
Has a UK driving licence that needs exchanging.
Ordered a new sofa that arrives in December.
Loves the Albufera at sunset.
Mum's birthday is on 4 June.
Uses Duolingo every morning.
Thinking about getting a dog with Maya in 2027.
Sam's dentist is in Calle Sueca; check-up every six months.
Hates coriander.
Watches Valencia CF sometimes, mostly for the atmosphere.
Tom's kids are called Olly and Freya.
Prefers trains to planes whenever possible.
Su vecino del 3º toca el piano a las 11 de la noche.
The gym membership at the polideportivo costs 28 euros a month.
Sam's blood type is O negative.
Keeps receipts for taxes in a folder called hacienda.
Wants to visit Granada at Easter.
Sam's laptop charger is USB-C 70W.
Pickle hates the carrier and must be lured with treats.
Maya's birthday is 30 September.
Has a Spanish SIM with a 20GB plan.`,
      },
      {
        id: "s-maya",
        path: "people/maya.md",
        scope: "bot",
        updatedAt: "2026-10-11T20:20:00Z",
        content: `# Maya

Sam's partner since 2023. Marine biologist from Toronto.
Works on seagrass restoration.
She's allergic to shellfish (serious, carries an EpiPen).
Her parents, Linda and Rob, visit from Canada at Christmas 2026.
She's teaching Sam to snorkel.`,
      },
      {
        id: "s-flat",
        path: "home/flat.md",
        scope: "bot",
        updatedAt: "2026-11-05T09:45:00Z",
        content: `# The flat

Calle Puerto Rico 22, 4º, Ruzafa.
Rent: 1,050 euros a month, paid to the landlord, Sr. Vicente Ortiz.
Contract ends 28 February 2027; we want to renew.
Boiler is in the kitchen cupboard; reset button on the left.
Residency paperwork: [[paperwork/nie]].`,
      },
      {
        id: "s-nie",
        path: "paperwork/nie.md",
        scope: "bot",
        updatedAt: "2026-11-12T14:00:00Z",
        content: `# NIE and TIE

NIE obtained in May 2025.
TIE card renewal appointment: 9 December 2026 at 10:20, Comisaría de Patraix.
Bring: passport, padrón certificate, photo and the 790-012 fee form.
Padrón registered at the Ruzafa council office.`,
      },
      {
        id: "s-spanish",
        path: "spanish-lessons.md",
        scope: "bot",
        updatedAt: "2026-09-30T19:30:00Z",
        content: `# Clases de español

Profesora: Nuria, online, martes y jueves a las 19:00.
20 euros per class, paid monthly by Bizum.
Working on: subjunctive, ser vs estar, phone calls.
Goal: pass DELE B1 in May 2027.`,
      },
      {
        id: "s-client",
        path: "work/brightloom.md",
        scope: "bot",
        updatedAt: "2026-11-24T16:00:00Z",
        content: `# Client: Brightloom

London fintech; main contact is Priya Shah.
Project: redesign of the onboarding flow in the mobile app.
Invoice in GBP on the last working day of the month; day rate 420 GBP.
Next design review: 2 December 2026, 3pm UK time (4pm in Valencia).
They use Jira and Slack; no Figma comments after Friday noon.`,
      },
      {
        id: "s-health",
        path: "health.md",
        scope: "bot",
        updatedAt: "2026-10-27T12:15:00Z",
        content: `# Health

GP: Dra. Ferrando at the Ruzafa centro de salud.
SIP card number is in the wallet, not here.
Physio for the left ankle: Clínica Moviment, Wednesdays at 18:00.
Sprained the ankle playing football in October 2026.`,
      },
      {
        id: "s-running",
        path: "running.md",
        scope: "bot",
        updatedAt: "2026-10-20T07:10:00Z",
        content: `# Running

Training for the Valencia half marathon (October 2027).
Current long run: 14 km on Sundays along the Turia.
Shoes: replaced in September 2026, 200 km on them now.
Injury notes: [[health]].`,
      },
      {
        id: "s-porto",
        path: "trips/porto.md",
        scope: "bot",
        updatedAt: "2026-11-08T21:30:00Z",
        content: `# Porto trip

Going by train via Vigo.
Dates: 18-21 December 2026.
Hotel: Casa do Rio, booked, confirmation PT-55812.
Maya wants to see the Livraria Lello.`,
      },
      {
        id: "s-recipes",
        path: "recipes.md",
        scope: "bot",
        updatedAt: "2026-06-14T13:00:00Z",
        content: `# Recetas que me salen bien

- Paella valenciana (pollo y conejo), Doña Amparo's version.
- Shakshuka for Sunday brunch.
- Lentil dhal with spinach.
- Tortilla de patatas, con cebolla.`,
      },
      {
        id: "s-about",
        path: "about-me.md",
        scope: "user",
        inclusion: "essential",
        updatedAt: "2025-04-02T10:00:00Z",
        content: `# About me

Sam, UX designer living in Valencia. Answer in English unless I write in Spanish. British spelling.`,
      },
      {
        id: "s-workhours",
        path: "work-hours.md",
        scope: "user",
        inclusion: "searchable",
        updatedAt: "2026-02-01T09:00:00Z",
        content: `# Work hours

Working day: 7:30-15:30 Spanish time.
No meetings on Friday afternoons.
Focus block 9:00-11:00, phone on silent.`,
      },
    ],
    cases: [
      { id: "v5-01", split: "dev", tags: ["direct", "english"], message: "When's the next design review with Brightloom?", facts: ["Next design review: 2 December 2026"], notes: ["s-client"] },
      { id: "v5-02", split: "holdout", tags: ["direct", "english"], message: "When does my flat contract end?", facts: ["Contract ends 28 February 2027"], notes: ["s-flat"] },
      { id: "v5-03", split: "dev", tags: ["synonym", "english"], message: "What's my daily fee with Brightloom again?", facts: ["day rate 420 GBP"], notes: ["s-client"] },
      { id: "v5-04", split: "holdout", tags: ["synonym", "english"], message: "Who's my family doctor here?", facts: ["GP: Dra. Ferrando"], notes: ["s-health"] },
      { id: "v5-05", split: "dev", tags: ["synonym", "english"], message: "what's the reservation code for where we're staying in Portugal?", facts: ["confirmation PT-55812"], notes: ["s-porto"] },
      { id: "v5-06", split: "dev", tags: ["linked", "english"], message: "Can I do my long run along the Turia this Sunday or is it too soon?", facts: ["Sprained the ankle playing football in October 2026"], notes: ["s-health"] },
      { id: "v5-07", split: "holdout", tags: ["linked", "english"], message: "For the flat renewal, what residency stuff do I still need to sort?", facts: ["TIE card renewal appointment: 9 December 2026 at 10:20"], notes: ["s-nie"] },
      { id: "v5-08", split: "dev", tags: ["followup", "english"], previousUserMessage: "When are we going to Porto?", message: "and where are we staying?", facts: ["Hotel: Casa do Rio"], notes: ["s-porto"] },
      { id: "v5-09", split: "holdout", tags: ["followup", "english"], previousUserMessage: "How much do I pay Nuria per class?", message: "and when's the exam I'm aiming for?", facts: ["pass DELE B1 in May 2027"], notes: ["s-spanish"] },
      { id: "v5-10", split: "dev", tags: ["accents"], message: "a que hora es mi clase de espanol?", facts: ["martes y jueves a las 19:00"], notes: ["s-spanish"] },
      { id: "v5-11", split: "holdout", tags: ["accents", "english"], message: "whens the tie appointmnet?", facts: ["9 December 2026 at 10:20"], notes: ["s-nie"] },
      { id: "v5-12", split: "dev", tags: ["inflection", "english"], message: "Which day is my physiotherapy session?", facts: ["Wednesdays at 18:00"], notes: ["s-health"] },
      { id: "v5-13", split: "holdout", tags: ["inflection", "english"], message: "Are my running shoes due for replacing yet?", facts: ["200 km on them now"], notes: ["s-running"] },
      { id: "v5-14", split: "dev", tags: ["buried", "english"], message: "What's my blood type again? Filling in a donor form", facts: ["Sam's blood type is O negative"], notes: ["s-memory"] },
      { id: "v5-15", split: "dev", tags: ["buried", "direct", "english"], message: "How much is the gym membership at the polideportivo?", facts: ["costs 28 euros a month"], notes: ["s-memory"] },
      { id: "v5-16", split: "holdout", tags: ["buried", "english"], message: "When's Maya's birthday? I want to book something early", facts: ["Maya's birthday is 30 September"], notes: ["s-memory"] },
      { id: "v5-17", split: "holdout", tags: ["buried", "synonym", "english"], message: "I'm sending Christmas cards to my nephew and niece, remind me of their names?", facts: ["Tom's kids are called Olly and Freya"], notes: ["s-memory"] },
      { id: "v5-18", split: "dev", tags: ["buried"], message: "el vecino de arriba otra vez con el piano... ¿a qué hora suele ponerse?", facts: ["Su vecino del 3º toca el piano a las 11 de la noche"], notes: ["s-memory"] },
      { id: "v5-19", split: "dev", tags: ["multi", "english"], message: "I want to cook paella for Maya this weekend, what kind should I make?", facts: ["allergic to shellfish", "Doesn't eat pork"], notes: ["s-maya", "s-memory"] },
      { id: "v5-20", split: "holdout", tags: ["multi", "english"], message: "Does the Brightloom review fit inside my working day?", facts: ["4pm in Valencia", "Working day: 7:30-15:30 Spanish time"], notes: ["s-client", "s-workhours"] },
      { id: "v5-21", split: "dev", tags: ["chitchat", "english"], message: "hey! how's it going?", facts: [], notes: [] },
      { id: "v5-22", split: "dev", tags: ["chitchat", "english"], message: "can you explain what inflation is in simple terms?", facts: [], notes: [] },
      { id: "v5-23", split: "holdout", tags: ["chitchat", "english"], message: "cheers, that's perfect", facts: [], notes: [] },
      { id: "v5-24", split: "holdout", tags: ["chitchat"], message: "¿cómo se dice 'I'm looking forward to it' en español?", facts: [], notes: [] },
      { id: "v5-25", split: "dev", tags: ["buried", "english"], message: "I need to book a check-up, where's my dentist?", facts: ["Sam's dentist is in Calle Sueca"], notes: ["s-memory"] },
    ],
  },
];
