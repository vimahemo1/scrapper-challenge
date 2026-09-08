Scraper Challenge — PJe TRF5

Scraper desarrollado en TypeScript para consultar procesos públicos del portal PJe del Tribunal Regional Federal da 5ª Região (TRF5), recorrer los resultados, acceder al detalle de cada proceso, extraer la información disponible y descargar los documentos PDF asociados.

El proyecto fue desarrollado utilizando únicamente peticiones HTTP y parsing de HTML/XML, sin herramientas de automatización de navegador como Puppeteer, Playwright o Selenium.

Tecnologías

Node.js

TypeScript

Axios

Cheerio

ts-node

Sitio consultado

Portal público de consulta:

https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam

El sitio utiliza una aplicación basada en JSF / RichFaces, por lo que el scraper reproduce las peticiones HTTP necesarias para mantener la sesión, ejecutar búsquedas, recorrer resultados y acceder a los documentos.

Funcionalidades

El scraper implementa:

Inicio y mantenimiento de sesión mediante cookies.

Extracción dinámica de javax.faces.ViewState.

Detección de la acción AJAX utilizada por el formulario de búsqueda.

Consulta por rango de fechas.

Parsing de respuestas JSF/RichFaces.

Recorrido de los procesos obtenidos.

Acceso al detalle de cada proceso.

Extracción de información estructurada del proceso.

Extracción de tablas, campos, encabezados y texto disponible en el detalle.

Detección de documentos HTML.

Detección de documentos descargables.

Descarga de PDFs.

Validación del archivo mediante Content-Type y firma %PDF-.

Delays preventivos entre peticiones.

Manejo de errores HTTP 429 Too Many Requests.

Reintentos con exponential backoff.

Soporte para la cabecera Retry-After.

Continuación con el siguiente documento cuando un PDF falla después de varios intentos.

Registro de documentos fallidos para posteriores reintentos.

Prevención de descargas duplicadas cuando el archivo ya existe.

Persistencia de resultados en JSON.

Organización de PDFs por número de proceso.

Logging del progreso de ejecución.

Instalación

Clonar el repositorio:

git clone <https://github.com/vimahemo1/scrapper-challenge.git>
cd scrapper-challenge

Instalar dependencias:

npm install

Ejecución

Ejecutar el scraper con la configuración predeterminada:

npm run dev

Por defecto se utiliza el rango:

04/09/2026 - 11/09/2026

También es posible definir las fechas desde la línea de comandos:

npm run dev -- --from=04/09/2026 --to=11/09/2026

Ejecutar una prueba con pocos procesos

Para evitar procesar todos los resultados durante desarrollo o pruebas:

npm run dev -- --limit=2

También se pueden combinar las opciones:

npm run dev -- --from=04/09/2026 --to=11/09/2026 --limit=5

Si no se utiliza --limit, el scraper continúa procesando los resultados disponibles.

Compilar TypeScript

npm run build

Ejecutar la versión compilada:

npm start

Flujo general

El scraper sigue este flujo:

GET página inicial
        |
        v
Obtener cookies de sesión
        |
        v
Extraer javax.faces.ViewState
        |
        v
Detectar acción AJAX real de búsqueda
        |
        v
POST formulario de búsqueda
        |
        v
Parsear procesos encontrados
        |
        v
Procesar cada proceso
        |
        +--> Obtener detalle
        |
        +--> Extraer información
        |
        +--> Detectar documentos HTML
        |
        +--> Detectar PDFs
        |
        +--> Descargar PDFs
        |
        v
Procesar siguiente página
        |
        v
Guardar resultados JSON

Manejo de JSF / RichFaces

El portal no utiliza un formulario HTML convencional.

La búsqueda depende de:

cookies de sesión;

javax.faces.ViewState;

identificadores dinámicos generados por JSF;

peticiones AJAX de RichFaces.

Por esta razón, el scraper no utiliza IDs generados de forma fija cuando estos pueden cambiar entre sesiones. La lógica intenta descubrir dinámicamente las acciones necesarias a partir del HTML y JavaScript recibido.

Documentos

Durante el análisis del portal se identificaron dos formas principales de documento.

Documento HTML

Algunos documentos se visualizan mediante una ruta similar a:

documentoSemLoginHTML.seam

Estos documentos se consultan y su contenido textual se incorpora a la información extraída.

Documento descargable

Otros documentos contienen parámetros como:

idBin
idProcessoDocumento

La respuesta de estas rutas puede ser un PDF.

Antes de guardar un archivo, el scraper comprueba:

HTTP status = 200
Content-Type compatible
Firma inicial = %PDF-

De esta forma no se guarda una página HTML de error utilizando incorrectamente la extensión .pdf.

Manejo de HTTP 429

Las descargas de documentos pueden responder:

429 Too Many Requests

Cuando ocurre, el scraper utiliza reintentos con exponential backoff.

Ejemplo:

Intento 1 -> 1 segundo
Intento 2 -> 2 segundos
Intento 3 -> 4 segundos
Intento 4 -> 8 segundos
Intento 5 -> 16 segundos
Intento 6 -> 32 segundos

Si el servidor envía la cabecera Retry-After, el scraper también la tiene en cuenta.

Si el documento continúa fallando después del número máximo de reintentos:

el scraper registra el error;

continúa con el siguiente documento;

guarda el documento pendiente en output/failed-downloads.json.

Esto evita que una descarga problemática detenga toda la ejecución.

Delays

Además del backoff utilizado para errores 429, existe una pausa preventiva entre peticiones para reducir la carga sobre el servidor:

750 ms

Este valor se encuentra definido en el código como:

DELAY_ENTRE_REQUESTS_MS

Archivos generados

Los resultados se almacenan principalmente en:

output/
├── processes.json
├── failed-downloads.json
├── processes/
│   ├── <numero-proceso>.json
│   └── ...
└── html/
    ├── <numero-proceso>/
    │   ├── <id-documento>.html
    │   └── ...
    └── ...

Los PDFs se organizan por proceso:

pdfs/
├── <numero-proceso>/
│   ├── <fecha>_<tipo>_<id>.pdf
│   └── ...
└── ...

El archivo consolidado:

output/processes.json

contiene la información de los procesos procesados y sus documentos.

Información extraída

Para cada proceso se conserva, cuando está disponible:

número del proceso;

título o descripción mostrada en los resultados;

última movimentación;

contenido de las columnas del resultado;

información del detalle;

encabezados;

campos clave/valor;

tablas;

texto del detalle;

documentos asociados;

identificador del documento;

identificador binario;

fecha del documento;

tipo de documento;

URL;

estado de descarga;

ruta local del PDF;

contenido textual de documentos HTML.

La estructura puede variar entre procesos porque depende de la información que publique el portal.

Reanudación de descargas

Antes de descargar un PDF, el scraper verifica si el archivo ya existe.

Si ya fue descargado en una ejecución anterior, se omite:

PDF ya existe. Se omite.

Esto permite ejecutar nuevamente el scraper sin descargar innecesariamente todos los archivos desde cero.

Los documentos que no pudieron descargarse quedan registrados en:

output/failed-downloads.json

para poder identificarlos y reintentarlos posteriormente.

Estructura del proyecto

scrapper-challenge/
├── src/
│   └── index.ts
├── pdfs/
├── output/
├── debug/
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
└── README.md

Las carpetas pdfs, output y debug son generadas durante la ejecución y no necesitan almacenarse en el repositorio.

Scripts de npm

El proyecto utiliza los siguientes scripts:

{
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}

.gitignore

Se recomienda excluir archivos generados, respuestas temporales y datos de sesión:

node_modules/
dist/

response.html
search-response.xml
detail-response.html
recaptcha-debug.txt
first-download-response.bin

pdfs/
output/
debug/

.env
*.log

Esto también evita publicar accidentalmente identificadores temporales de sesión o archivos obtenidos durante las pruebas.

Consideraciones de robustez

El scraper contempla varios escenarios:

respuestas HTTP diferentes de 200;

errores de red;

timeouts;

429 Too Many Requests;

documentos que no son realmente PDF;

documentos ya descargados;

IDs dinámicos generados por JSF;

cambios de ViewState;

ausencia de documentos en un proceso;

fallos individuales que no deben detener toda la ejecución;

límite de seguridad para evitar ciclos infinitos durante la paginación.

Decisiones de implementación

¿Por qué Axios?

Permite controlar de forma explícita:

headers;

cookies;

redirects;

status HTTP;

respuestas binarias;

timeouts.

¿Por qué Cheerio?

El desafío prohíbe automatización de navegador. Cheerio permite analizar el HTML recibido directamente mediante HTTP sin ejecutar un navegador.

¿Por qué validar %PDF-?

Un servidor puede responder 200 incluso cuando devuelve una página HTML inesperada.

Comprobar la firma del archivo evita almacenar contenido inválido como PDF.

¿Por qué no usar IDs JSF hardcodeados?

Elementos como:

j_id123
j_id244
j_id592

pueden cambiar entre ejecuciones.

Cuando es posible, el scraper descubre dinámicamente las acciones a partir del HTML y JavaScript entregado por el servidor.

Pruebas

Durante el desarrollo se recomienda comenzar con pocos procesos:

npm run dev -- --limit=2

Después:

npm run dev -- --limit=30

Finalmente, para permitir el recorrido completo:

npm run dev

El desafío no requiere descargar todos los PDFs en una sola ejecución. El diseño permite que las descargas se completen progresivamente entre ejecuciones.

