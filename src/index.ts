import axios, { AxiosResponse } from "axios";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

// =============================================================
// CONFIGURACIÓN GENERAL
// =============================================================

const URL_BASE =
    "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";

// Puedes cambiar estas fechas directamente o enviarlas por argumentos:
// npm run dev -- --from=04/09/2026 --to=11/09/2026
const FECHA_INICIO =
    getStringArg("--from")
    ?? "04/09/2026";

const FECHA_FIN =
    getStringArg("--to")
    ?? "11/09/2026";

// Permite probar con pocos procesos:
// npm run dev -- --limit=3
// Si no se especifica, recorrerá todos los procesos encontrados.
const LIMITE_PROCESOS =
    getNumberArg("--limit")
    ?? Number.POSITIVE_INFINITY;

// Pausa preventiva entre peticiones normales.
const DELAY_ENTRE_REQUESTS_MS =
    750;

// Cantidad máxima de reintentos adicionales ante HTTP 429 / errores de red.
const MAX_REINTENTOS_PDF =
    5;

// Límite de seguridad para evitar un ciclo infinito por un cambio inesperado
// en la paginación del portal.
const MAX_PAGINAS_SEGURIDAD =
    500;

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";


// =============================================================
// TIPOS
// =============================================================

type DocumentType =
    "html"
    |
    "download";

interface ProcessSummary {

    processNumber: string;

    title: string;

    lastMovement: string;

    cells: string[];

    detailPath: string;

}

interface ProcessDocument {

    text: string;

    type: DocumentType;

    url: string;

    idProcessoDocumento: string | null;

    idBin: string | null;

    date: string | null;

    documentType: string | null;

    downloaded?: boolean;

    filePath?: string | null;

    httpStatus?: number | null;

    contentText?: string | null;

    htmlFilePath?: string | null;

}

interface FailedDownload {

    processNumber: string;

    idProcessoDocumento: string | null;

    idBin: string | null;

    text: string;

    url: string;

    status: number | null;

    reason: string;

}

interface TableData {

    index: number;

    rows: string[][];

}

interface DetailData {

    headings: string[];

    fields: Record<string, string[]>;

    tables: TableData[];

    detailText: string;

}

interface ProcessData {

    processNumber: string;

    summary: {

        title: string;

        lastMovement: string;

        cells: string[];

    };

    detail: DetailData;

    documents: ProcessDocument[];

    detailHttpStatus: number;

}

interface SearchPreparation {

    baseFormData: URLSearchParams;

    postUrl: string;

    searchActionName: string;

    viewState: string;

}

interface A4jAction {

    formId: string;

    similarityGroupingId: string | null;

    actionUrl: string | null;

    parameters: Record<string, string>;

    rawOnclick: string;

}


// =============================================================
// COOKIE JAR SIMPLE
// =============================================================
//
// El portal utiliza sesión. En lugar de conservar solamente las cookies
// entregadas por la primera respuesta, mantenemos un pequeño cookie jar y
// actualizamos las cookies después de cada request.

const cookieJar =
    new Map<string, string>();


function updateCookies(
    response: AxiosResponse<unknown>
): void {

    const setCookies =
        response.headers[
            "set-cookie"
        ];


    if (!setCookies) {

        return;

    }


    for (
        const cookie
        of setCookies
    ) {

        const firstPart =
            cookie
                .split(";")[0]
                .trim();


        const separatorPosition =
            firstPart.indexOf("=");


        if (
            separatorPosition <= 0
        ) {

            continue;

        }


        const name =
            firstPart
                .substring(
                    0,
                    separatorPosition
                )
                .trim();


        const value =
            firstPart
                .substring(
                    separatorPosition + 1
                )
                .trim();


        cookieJar.set(
            name,
            value
        );

    }

}


function getCookieHeader(): string {

    return Array
        .from(
            cookieJar.entries()
        )
        .map(
            ([name, value]) =>
                `${name}=${value}`
        )
        .join("; ");

}


function buildHeaders(
    referer?: string,
    extra?: Record<string, string>
): Record<string, string> {

    const headers:
        Record<string, string> = {

            "User-Agent":
                USER_AGENT,

            ...(extra ?? {})

        };


    const cookieHeader =
        getCookieHeader();


    if (
        cookieHeader
    ) {

        headers[
            "Cookie"
        ] =
            cookieHeader;

    }


    if (
        referer
    ) {

        headers[
            "Referer"
        ] =
            referer;

    }


    return headers;

}


// =============================================================
// PETICIONES HTTP
// =============================================================

async function httpGetText(
    requestUrl: string,
    referer?: string
): Promise<AxiosResponse<string>> {

    const response =
        await axios.get<string>(
            requestUrl,
            {

                timeout:
                    30000,

                headers:
                    buildHeaders(
                        referer
                    ),

                validateStatus:
                    () => true

            }
        );


    updateCookies(
        response
    );


    return response;

}


async function httpGetBuffer(
    requestUrl: string,
    referer?: string
): Promise<AxiosResponse<ArrayBuffer>> {

    const response =
        await axios.get<ArrayBuffer>(
            requestUrl,
            {

                timeout:
                    30000,

                responseType:
                    "arraybuffer",

                maxRedirects:
                    5,

                headers:
                    buildHeaders(
                        referer
                    ),

                validateStatus:
                    () => true

            }
        );


    updateCookies(
        response
    );


    return response;

}


async function httpPostForm(
    requestUrl: string,
    formData: URLSearchParams,
    referer: string
): Promise<AxiosResponse<string>> {

    const response =
        await axios.post<string>(
            requestUrl,
            formData.toString(),
            {

                timeout:
                    30000,

                headers:
                    buildHeaders(
                        referer,
                        {

                            "Content-Type":
                                "application/x-www-form-urlencoded; charset=UTF-8",

                            "X-Requested-With":
                                "XMLHttpRequest"

                        }
                    ),

                validateStatus:
                    () => true

            }
        );


    updateCookies(
        response
    );


    return response;

}


// =============================================================
// UTILIDADES GENERALES
// =============================================================

function sleep(
    milliseconds: number
): Promise<void> {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );

}


function normalizeText(
    value: string
): string {

    return value
        .replace(
            /\s+/g,
            " "
        )
        .trim();

}


function sanitizeFileName(
    value: string
): string {

    return value
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        )
        .replace(
            /\s+/g,
            "_"
        )
        .substring(
            0,
            160
        );

}


function getStringArg(
    name: string
): string | null {

    const prefix =
        `${name}=`;


    const value =
        process.argv
            .find(
                item =>
                    item.startsWith(
                        prefix
                    )
            );


    if (!value) {

        return null;

    }


    return value.substring(
        prefix.length
    );

}


function getNumberArg(
    name: string
): number | null {

    const value =
        getStringArg(
            name
        );


    if (!value) {

        return null;

    }


    const parsed =
        Number(
            value
        );


    if (
        Number.isNaN(
            parsed
        )
        ||
        parsed <= 0
    ) {

        return null;

    }


    return parsed;

}


function cloneFormData(
    source: URLSearchParams
): URLSearchParams {

    return new URLSearchParams(
        source.toString()
    );

}


function ensureDirectory(
    directoryPath: string
): void {

    fs.mkdirSync(
        directoryPath,
        {
            recursive:
                true
        }
    );

}


function formatDateForFileName(
    value: string | null
): string {

    if (!value) {

        return "sin-fecha";

    }


    const match =
        value.match(
            /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
        );


    if (!match) {

        return sanitizeFileName(
            value
        );

    }


    const day =
        match[1];

    const month =
        match[2];

    const year =
        match[3];

    const hour =
        match[4];

    const minute =
        match[5];

    const second =
        match[6];


    if (
        hour
        &&
        minute
        &&
        second
    ) {

        return `${year}-${month}-${day}_${hour}-${minute}-${second}`;

    }


    return `${year}-${month}-${day}`;

}


function extractDocumentMetadata(
    text: string
): {
    date: string | null;
    documentType: string | null;
} {

    const normalized =
        normalizeText(
            text
        );


    const dateMatch =
        normalized.match(
            /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/
        );


    const date =
        dateMatch
            ?
            dateMatch[1]
            :
            null;


    let documentType:
        string | null =
        null;


    const separatorPosition =
        normalized.indexOf(
            " - "
        );


    if (
        separatorPosition >= 0
    ) {

        const afterSeparator =
            normalized
                .substring(
                    separatorPosition + 3
                )
                .trim();


        documentType =
            afterSeparator
                .replace(
                    /\s*\([^)]*\)\s*$/,
                    ""
                )
                .trim()
            ||
            null;

    }


    return {
        date,
        documentType
    };

}


function saveJson(
    filePath: string,
    data: unknown
): void {

    ensureDirectory(
        path.dirname(
            filePath
        )
    );


    fs.writeFileSync(
        filePath,
        JSON.stringify(
            data,
            null,
            2
        ),
        "utf-8"
    );

}


// =============================================================
// VIEWSTATE
// =============================================================

function extractViewState(
    responseText: string,
    fallback: string
): string {

    const $ =
        cheerio.load(
            responseText
        );


    const inputViewState =
        $(
            "input[name='javax.faces.ViewState']"
        )
            .last()
            .attr(
                "value"
            );


    if (
        inputViewState
    ) {

        return inputViewState;

    }


    const updateMatch =
        responseText.match(
            /<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/i
        );


    if (
        updateMatch
    ) {

        const value =
            normalizeText(
                updateMatch[1]
            );


        if (
            value
        ) {

            return value;

        }

    }


    const genericMatch =
        responseText.match(
            /name=["']javax\.faces\.ViewState["'][^>]*value=["']([^"']+)["']/i
        );


    if (
        genericMatch
    ) {

        return genericMatch[1];

    }


    return fallback;

}


// =============================================================
// PREPARAR FORMULARIO DE BÚSQUEDA
// =============================================================

function prepareSearch(
    initialHtml: string
): SearchPreparation {

    const $ =
        cheerio.load(
            initialHtml
        );


    const form =
        $(
            "form#fPP"
        );


    if (
        form.length === 0
    ) {

        throw new Error(
            "No se encontró el formulario con ID 'fPP'."
        );

    }


    const viewState =
        $(
            "input[name='javax.faces.ViewState']"
        )
            .attr(
                "value"
            );


    if (!viewState) {

        throw new Error(
            "No se encontró javax.faces.ViewState."
        );

    }


    const action =
        form.attr(
            "action"
        );


    if (!action) {

        throw new Error(
            "El formulario no tiene atributo action."
        );

    }


    const postUrl =
        new URL(
            action,
            URL_BASE
        ).toString();


    const baseFormData =
        new URLSearchParams();


    // ---------------------------------------------------------
    // INPUTS
    // ---------------------------------------------------------

    form
        .find(
            "input[name]"
        )
        .each(
            (_, element) => {

                const input =
                    $(
                        element
                    );


                const name =
                    input.attr(
                        "name"
                    );


                if (!name) {

                    return;

                }


                const type =
                    (
                        input.attr(
                            "type"
                        )
                        ??
                        "text"
                    )
                        .toLowerCase();


                if (
                    type === "button"
                    ||
                    type === "submit"
                ) {

                    return;

                }


                if (
                    type === "radio"
                    ||
                    type === "checkbox"
                ) {

                    if (
                        !input.is(
                            ":checked"
                        )
                    ) {

                        return;

                    }

                }


                const value =
                    input.attr(
                        "value"
                    )
                    ??
                    "";


                baseFormData.append(
                    name,
                    value
                );

            }
        );


    // ---------------------------------------------------------
    // SELECTS
    // ---------------------------------------------------------

    form
        .find(
            "select[name]"
        )
        .each(
            (_, element) => {

                const select =
                    $(
                        element
                    );


                const name =
                    select.attr(
                        "name"
                    );


                if (!name) {

                    return;

                }


                const selectedOption =
                    select
                        .find(
                            "option:selected"
                        )
                        .first();


                const value =
                    selectedOption.length > 0
                        ?
                        selectedOption.attr(
                            "value"
                        )
                        ??
                        ""
                        :
                        select
                            .find(
                                "option"
                            )
                            .first()
                            .attr(
                                "value"
                            )
                        ??
                        "";


                baseFormData.append(
                    name,
                    value
                );

            }
        );


    // ---------------------------------------------------------
    // VALORES NECESARIOS DEL FORMULARIO
    // ---------------------------------------------------------

    baseFormData.set(
        "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate",
        FECHA_INICIO
    );


    baseFormData.set(
        "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate",
        FECHA_FIN
    );


    baseFormData.set(
        "AJAXREQUEST",
        "_viewRoot"
    );


    baseFormData.set(
        "AJAX:EVENTS_COUNT",
        "1"
    );


    // ---------------------------------------------------------
    // DESCUBRIR LA ACCIÓN AJAX REAL DE BÚSQUEDA
    // ---------------------------------------------------------

    let pesquisaScript =
        "";


    $(
        "script"
    ).each(
        (_, element) => {

            const content =
                $(
                    element
                ).html()
                ??
                "";


            if (
                content.includes(
                    "executarPesquisa=function"
                )
            ) {

                pesquisaScript =
                    content;


                return false;

            }

        }
    );


    if (
        !pesquisaScript
    ) {

        throw new Error(
            "No se encontró la definición de executarPesquisa."
        );

    }


    const actionMatch =
        pesquisaScript.match(
            /similarityGroupingId':'([^']+)'/
        );


    if (
        !actionMatch
    ) {

        throw new Error(
            "No se pudo determinar la acción AJAX real de búsqueda."
        );

    }


    return {
        baseFormData,
        postUrl,
        searchActionName:
            actionMatch[1],
        viewState
    };

}


// =============================================================
// EXTRAER PROCESOS DE UNA PÁGINA DE RESULTADOS
// =============================================================

function extractProcessesFromSearchResponse(
    responseText: string
): ProcessSummary[] {

    const $ =
        cheerio.load(
            responseText
        );


    const processes:
        ProcessSummary[] =
        [];


    const rows =
        $(
            '[id="fPP:processosTable:tb"] tr'
        );


    rows.each(
        (_, element) => {

            const row =
                $(
                    element
                );


            const cells:
                string[] =
                [];


            row
                .find(
                    "td"
                )
                .each(
                    (_, td) => {

                        cells.push(
                            normalizeText(
                                $(
                                    td
                                ).text()
                            )
                        );

                    }
                );


            if (
                cells.length === 0
            ) {

                return;

            }


            const title =
                cells[1]
                ??
                normalizeText(
                    row.text()
                );


            const lastMovement =
                cells[2]
                ??
                "";


            const processNumberMatch =
                title.match(
                    /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/
                );


            if (
                !processNumberMatch
            ) {

                return;

            }


            const detailLink =
                row
                    .find(
                        "a[onclick*='openPopUp']"
                    )
                    .first();


            const detailOnclick =
                detailLink.attr(
                    "onclick"
                )
                ??
                "";


            const detailMatch =
                detailOnclick.match(
                    /openPopUp\(\s*'[^']*'\s*,\s*'([^']+)'\s*\)/
                );


            if (
                !detailMatch
            ) {

                return;

            }


            processes.push({

                processNumber:
                    processNumberMatch[0],

                title,

                lastMovement,

                cells,

                detailPath:
                    detailMatch[1]

            });

        }
    );


    return processes;

}


// =============================================================
// TOTAL DE RESULTADOS
// =============================================================

function extractTotalResults(
    responseText: string
): number | null {

    const $ =
        cheerio.load(
            responseText
        );


    const text =
        normalizeText(
            $.root().text()
        );


    const match =
        text.match(
            /(\d[\d\.,]*)\s+resultados\s+encontrados/i
        );


    if (
        !match
    ) {

        return null;

    }


    const numericValue =
        match[1]
            .replace(
                /[^0-9]/g,
                ""
            );


    if (
        !numericValue
    ) {

        return null;

    }


    return Number(
        numericValue
    );

}


// =============================================================
// PARSEAR ACCIÓN A4J / RICHFACES
// =============================================================

function decodeJavascriptEscapes(
    value: string
): string {

    return value
        .replace(
            /\\x([0-9a-fA-F]{2})/g,
            (_, hex: string) =>
                String.fromCharCode(
                    parseInt(
                        hex,
                        16
                    )
                )
        )
        .replace(
            /\\u([0-9a-fA-F]{4})/g,
            (_, hex: string) =>
                String.fromCharCode(
                    parseInt(
                        hex,
                        16
                    )
                )
        );

}


function parseA4jAction(
    onclick: string
): A4jAction | null {

    const formMatch =
        onclick.match(
            /A4J\.AJAX\.Submit\(\s*'([^']+)'/
        );


    if (
        !formMatch
    ) {

        return null;

    }


    const groupingMatch =
        onclick.match(
            /['"]similarityGroupingId['"]\s*:\s*'([^']+)'/
        );


    const actionUrlMatch =
        onclick.match(
            /['"]actionUrl['"]\s*:\s*'([^']+)'/
        );


    const parameters:
        Record<string, string> =
        {};


    const parametersMatch =
        onclick.match(
            /['"]parameters['"]\s*:\s*\{([^}]*)\}/
        );


    if (
        parametersMatch
    ) {

        const parameterText =
            parametersMatch[1];


        const pairRegex =
            /['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g;


        let pairMatch:
            RegExpExecArray | null;


        while (
            (
                pairMatch =
                    pairRegex.exec(
                        parameterText
                    )
            )
            !==
            null
        ) {

            parameters[
                pairMatch[1]
            ] =
                decodeJavascriptEscapes(
                    pairMatch[2]
                );

        }

    }


    return {

        formId:
            formMatch[1],

        similarityGroupingId:
            groupingMatch
                ?
                groupingMatch[1]
                :
                null,

        actionUrl:
            actionUrlMatch
                ?
                decodeJavascriptEscapes(
                    actionUrlMatch[1]
                )
                :
                null,

        parameters,

        rawOnclick:
            onclick

    };

}


// =============================================================
// ENCONTRAR ACCIÓN PARA LA SIGUIENTE PÁGINA
// =============================================================
//
// Los IDs de JSF son dinámicos. Por eso no hardcodeamos un j_idXXX.
// Buscamos el control cuyo texto corresponde a la página siguiente y
// analizamos su onclick A4J.AJAX.Submit.

function findNextPageAction(
    responseText: string,
    currentPage: number
): A4jAction | null {

    const $ =
        cheerio.load(
            responseText
        );


    const nextPage =
        String(
            currentPage + 1
        );


    let foundOnclick =
        "";


    const candidates =
        $(
            "[onclick*='A4J.AJAX.Submit']"
        );


    // ---------------------------------------------------------
    // PRIMER INTENTO: ENLACE NUMÉRICO DE LA PÁGINA SIGUIENTE
    // ---------------------------------------------------------

    candidates.each(
        (_, element) => {

            const item =
                $(
                    element
                );


            const text =
                normalizeText(
                    item.text()
                    ||
                    item.attr(
                        "value"
                    )
                    ||
                    ""
                );


            if (
                text === nextPage
            ) {

                foundOnclick =
                    item.attr(
                        "onclick"
                    )
                    ??
                    "";


                return false;

            }

        }
    );


    if (
        foundOnclick
    ) {

        return parseA4jAction(
            foundOnclick
        );

    }


    // ---------------------------------------------------------
    // SEGUNDO INTENTO: BOTÓN PRÓXIMO / > / »
    // ---------------------------------------------------------

    candidates.each(
        (_, element) => {

            const item =
                $(
                    element
                );


            const text =
                normalizeText(
                    item.text()
                    ||
                    item.attr(
                        "value"
                    )
                    ||
                    ""
                )
                .toLowerCase();


            const title =
                normalizeText(
                    item.attr(
                        "title"
                    )
                    ||
                    ""
                )
                .toLowerCase();


            const ariaLabel =
                normalizeText(
                    item.attr(
                        "aria-label"
                    )
                    ||
                    ""
                )
                .toLowerCase();


            const combined =
                `${text} ${title} ${ariaLabel}`;


            if (
                combined.includes(
                    "próxim"
                )
                ||
                combined.includes(
                    "proxim"
                )
                ||
                combined.includes(
                    "next"
                )
                ||
                text === ">"
                ||
                text === "»"
            ) {

                foundOnclick =
                    item.attr(
                        "onclick"
                    )
                    ??
                    "";


                return false;

            }

        }
    );


    if (
        !foundOnclick
    ) {

        return null;

    }


    return parseA4jAction(
        foundOnclick
    );

}


// =============================================================
// EJECUTAR ACCIÓN DE PAGINACIÓN
// =============================================================

async function executePaginationAction(
    action: A4jAction,
    preparation: SearchPreparation,
    latestViewState: string
): Promise<AxiosResponse<string>> {

    const formData =
        cloneFormData(
            preparation.baseFormData
        );


    formData.set(
        "javax.faces.ViewState",
        latestViewState
    );


    formData.set(
        "AJAXREQUEST",
        "_viewRoot"
    );


    formData.set(
        "AJAX:EVENTS_COUNT",
        "1"
    );


    if (
        action.formId
    ) {

        formData.set(
            action.formId,
            action.formId
        );

    }


    for (
        const [key, value]
        of Object.entries(
            action.parameters
        )
    ) {

        formData.set(
            key,
            value
        );

    }


    if (
        action.similarityGroupingId
        &&
        !formData.has(
            action.similarityGroupingId
        )
    ) {

        formData.set(
            action.similarityGroupingId,
            action.similarityGroupingId
        );

    }


    const requestUrl =
        action.actionUrl
            ?
            new URL(
                action.actionUrl,
                URL_BASE
            ).toString()
            :
            preparation.postUrl;


    return httpPostForm(
        requestUrl,
        formData,
        preparation.postUrl
    );

}


// =============================================================
// EXTRAER TODA LA INFORMACIÓN GENÉRICA DEL DETALLE
// =============================================================
//
// El portal puede cambiar etiquetas o agregar campos. Para no depender
// exclusivamente de nombres fijos, guardamos:
// - encabezados
// - pares clave/valor
// - contenido de todas las tablas
// - texto normalizado completo del detalle

function extractDetailData(
    detailHtml: string
): DetailData {

    const $ =
        cheerio.load(
            detailHtml
        );


    $(
        "script, style, noscript"
    ).remove();


    const headings:
        string[] =
        [];


    $(
        "h1, h2, h3, h4, h5, h6, legend, .rich-panel-header"
    ).each(
        (_, element) => {

            const text =
                normalizeText(
                    $(
                        element
                    ).text()
                );


            if (
                text
                &&
                !headings.includes(
                    text
                )
            ) {

                headings.push(
                    text
                );

            }

        }
    );


    const fields:
        Record<string, string[]> =
        {};


    function addField(
        key: string,
        value: string
    ): void {

        const cleanKey =
            normalizeText(
                key
            );


        const cleanValue =
            normalizeText(
                value
            );


        if (
            !cleanKey
            ||
            !cleanValue
            ||
            cleanKey === cleanValue
            ||
            cleanKey.length > 180
        ) {

            return;

        }


        if (
            !fields[
                cleanKey
            ]
        ) {

            fields[
                cleanKey
            ] =
                [];

        }


        if (
            !fields[
                cleanKey
            ].includes(
                cleanValue
            )
        ) {

            fields[
                cleanKey
            ].push(
                cleanValue
            );

        }

    }


    // ---------------------------------------------------------
    // TABLAS Y PARES CLAVE / VALOR
    // ---------------------------------------------------------

    const tables:
        TableData[] =
        [];


    $(
        "table"
    ).each(
        (tableIndex, tableElement) => {

            const rows:
                string[][] =
                [];


            $(
                tableElement
            )
                .find(
                    "tr"
                )
                .each(
                    (_, rowElement) => {

                        const cells:
                            string[] =
                            [];


                        $(
                            rowElement
                        )
                            .children(
                                "th, td"
                            )
                            .each(
                                (_, cellElement) => {

                                    const text =
                                        normalizeText(
                                            $(
                                                cellElement
                                            ).text()
                                        );


                                    if (
                                        text
                                    ) {

                                        cells.push(
                                            text
                                        );

                                    }

                                }
                            );


                        if (
                            cells.length > 0
                        ) {

                            rows.push(
                                cells
                            );


                            if (
                                cells.length === 2
                            ) {

                                addField(
                                    cells[0],
                                    cells[1]
                                );

                            }

                        }

                    }
                );


            if (
                rows.length > 0
            ) {

                tables.push({
                    index:
                        tableIndex,
                    rows
                });

            }

        }
    );


    // ---------------------------------------------------------
    // DT / DD
    // ---------------------------------------------------------

    $(
        "dt"
    ).each(
        (_, element) => {

            const key =
                normalizeText(
                    $(
                        element
                    ).text()
                );


            const value =
                normalizeText(
                    $(
                        element
                    )
                        .next(
                            "dd"
                        )
                        .text()
                );


            addField(
                key,
                value
            );

        }
    );


    const detailText =
        normalizeText(
            $(
                "body"
            ).text()
        );


    return {
        headings,
        fields,
        tables,
        detailText
    };

}


// =============================================================
// EXTRAER DOCUMENTOS DEL DETALLE
// =============================================================

function extractDocuments(
    detailHtml: string,
    detailUrl: string
): ProcessDocument[] {

    const $ =
        cheerio.load(
            detailHtml
        );


    const documents:
        ProcessDocument[] =
        [];


    const processedUrls =
        new Set<string>();


    $(
        "a"
    ).each(
        (_, element) => {

            const link =
                $(
                    element
                );


            let text =
                normalizeText(
                    link.text()
                );


            const href =
                link.attr(
                    "href"
                )
                ??
                "";


            const onclick =
                link.attr(
                    "onclick"
                )
                ??
                "";


            // -------------------------------------------------
            // DOCUMENTO HTML
            // -------------------------------------------------

            const htmlDocumentMatch =
                onclick.match(
                    /openPopUp\(\s*'[^']*'\s*,\s*'([^']*documentoSemLoginHTML\.seam[^']*)'/
                );


            if (
                htmlDocumentMatch
            ) {

                const documentUrl =
                    new URL(
                        htmlDocumentMatch[1],
                        detailUrl
                    ).toString();


                if (
                    processedUrls.has(
                        documentUrl
                    )
                ) {

                    return;

                }


                processedUrls.add(
                    documentUrl
                );


                text =
                    text
                        .replace(
                            /^Visualizar documentos/i,
                            ""
                        )
                        .trim();


                const parsedUrl =
                    new URL(
                        documentUrl
                    );


                const metadata =
                    extractDocumentMetadata(
                        text
                    );


                documents.push({

                    text,

                    type:
                        "html",

                    url:
                        documentUrl,

                    idProcessoDocumento:
                        parsedUrl
                            .searchParams
                            .get(
                                "idProcessoDoc"
                            ),

                    idBin:
                        null,

                    date:
                        metadata.date,

                    documentType:
                        metadata.documentType,

                    downloaded:
                        false,

                    filePath:
                        null,

                    httpStatus:
                        null,

                    contentText:
                        null,

                    htmlFilePath:
                        null

                });


                return;

            }


            // -------------------------------------------------
            // DOCUMENTO DESCARGABLE / PDF
            // -------------------------------------------------

            if (
                href.includes(
                    "idBin="
                )
                &&
                href.includes(
                    "idProcessoDocumento="
                )
            ) {

                const documentUrl =
                    new URL(
                        href,
                        detailUrl
                    ).toString();


                if (
                    processedUrls.has(
                        documentUrl
                    )
                ) {

                    return;

                }


                processedUrls.add(
                    documentUrl
                );


                const parsedUrl =
                    new URL(
                        documentUrl
                    );


                const metadata =
                    extractDocumentMetadata(
                        text
                    );


                documents.push({

                    text,

                    type:
                        "download",

                    url:
                        documentUrl,

                    idProcessoDocumento:
                        parsedUrl
                            .searchParams
                            .get(
                                "idProcessoDocumento"
                            ),

                    idBin:
                        parsedUrl
                            .searchParams
                            .get(
                                "idBin"
                            ),

                    date:
                        metadata.date,

                    documentType:
                        metadata.documentType,

                    downloaded:
                        false,

                    filePath:
                        null,

                    httpStatus:
                        null,

                    contentText:
                        null,

                    htmlFilePath:
                        null

                });

            }

        }
    );


    return documents;

}


// =============================================================
// EXTRAER CONTENIDO DE DOCUMENTOS HTML
// =============================================================

async function processHtmlDocument(
    document: ProcessDocument,
    processNumber: string,
    referer: string
): Promise<void> {

    if (
        document.type !== "html"
    ) {

        return;

    }


    const documentId =
        document.idProcessoDocumento
        ??
        "sin-id";


    const htmlDirectory =
        path.join(
            "output",
            "html",
            sanitizeFileName(
                processNumber
            )
        );


    ensureDirectory(
        htmlDirectory
    );


    const htmlFilePath =
        path.join(
            htmlDirectory,
            `${sanitizeFileName(documentId)}.html`
        );


    let attempt =
        0;


    while (
        attempt <= 3
    ) {

        const response =
            await httpGetText(
                document.url,
                referer
            );


        document.httpStatus =
            response.status;


        if (
            response.status === 429
        ) {

            const delay =
                calculateRetryDelay(
                    response.headers[
                        "retry-after"
                    ],
                    attempt
                );


            console.log(
                `HTTP 429 en documento HTML ${documentId}. Esperando ${delay} ms...`
            );


            attempt++;


            await sleep(
                delay
            );


            continue;

        }


        if (
            response.status !== 200
        ) {

            console.log(
                `✗ Documento HTML ${documentId} respondió HTTP ${response.status}`
            );


            return;

        }


        fs.writeFileSync(
            htmlFilePath,
            response.data,
            "utf-8"
        );


        const $ =
            cheerio.load(
                response.data
            );


        $(
            "script, style, noscript"
        ).remove();


        document.contentText =
            normalizeText(
                $(
                    "body"
                ).text()
            );


        document.htmlFilePath =
            htmlFilePath;


        document.downloaded =
            true;


        console.log(
            `✓ Documento HTML leído: ${documentId}`
        );


        return;

    }


    console.log(
        `✗ No se pudo leer documento HTML ${documentId} después de varios intentos.`
    );

}


// =============================================================
// BACKOFF EXPONENCIAL
// =============================================================

function calculateRetryDelay(
    retryAfterHeader: unknown,
    attempt: number
): number {

    const exponentialDelay =
        Math.min(
            60000,
            1000
            *
            Math.pow(
                2,
                attempt
            )
        );


    if (
        !retryAfterHeader
    ) {

        return exponentialDelay;

    }


    const retryAfterValue =
        Array.isArray(
            retryAfterHeader
        )
            ?
            String(
                retryAfterHeader[0]
            )
            :
            String(
                retryAfterHeader
            );


    const seconds =
        Number(
            retryAfterValue
        );


    if (
        !Number.isNaN(
            seconds
        )
    ) {

        return Math.max(
            exponentialDelay,
            seconds * 1000
        );

    }


    const retryDate =
        Date.parse(
            retryAfterValue
        );


    if (
        !Number.isNaN(
            retryDate
        )
    ) {

        return Math.max(
            exponentialDelay,
            Math.max(
                0,
                retryDate - Date.now()
            )
        );

    }


    return exponentialDelay;

}


// =============================================================
// DESCARGAR PDF CON REINTENTOS
// =============================================================

async function downloadPdfWithRetry(
    document: ProcessDocument,
    processNumber: string,
    referer: string,
    failedDownloads: FailedDownload[]
): Promise<void> {

    if (
        document.type !== "download"
    ) {

        return;

    }


    const documentId =
        document.idProcessoDocumento
        ??
        "sin-id";


    const processDirectory =
        path.join(
            "pdfs",
            sanitizeFileName(
                processNumber
            )
        );


    ensureDirectory(
        processDirectory
    );


    const descriptiveName =
        sanitizeFileName(
            `${formatDateForFileName(document.date)}_`
            + `${document.documentType ?? "documento"}_`
            + `${documentId}.pdf`
        );


    const filePath =
        path.join(
            processDirectory,
            descriptiveName
        );


    // ---------------------------------------------------------
    // REANUDACIÓN AUTOMÁTICA
    // ---------------------------------------------------------
    //
    // Si el PDF ya existe, lo omitimos. Así una ejecución futura puede
    // continuar con lo que faltó sin repetir todas las descargas.

    if (
        fs.existsSync(
            filePath
        )
    ) {

        document.downloaded =
            true;


        document.filePath =
            filePath;


        document.httpStatus =
            200;


        console.log(
            `↷ PDF ya existe, se omite: ${descriptiveName}`
        );


        return;

    }


    for (
        let attempt = 0;
        attempt <= MAX_REINTENTOS_PDF;
        attempt++
    ) {

        console.log(
            `Descargando PDF ${documentId} - intento ${attempt + 1} de ${MAX_REINTENTOS_PDF + 1}`
        );


        try {

            const response =
                await httpGetBuffer(
                    document.url,
                    referer
                );


            document.httpStatus =
                response.status;


            // =================================================
            // HTTP 429
            // =================================================

            if (
                response.status === 429
            ) {

                if (
                    attempt === MAX_REINTENTOS_PDF
                ) {

                    const failure:
                        FailedDownload = {

                            processNumber,

                            idProcessoDocumento:
                                document.idProcessoDocumento,

                            idBin:
                                document.idBin,

                            text:
                                document.text,

                            url:
                                document.url,

                            status:
                                429,

                            reason:
                                "HTTP 429 persistente después de los reintentos"

                        };


                    failedDownloads.push(
                        failure
                    );


                    saveJson(
                        "output/failed-downloads.json",
                        failedDownloads
                    );


                    console.log(
                        `✗ HTTP 429 persistente: ${documentId}`
                    );


                    return;

                }


                const delay =
                    calculateRetryDelay(
                        response.headers[
                            "retry-after"
                        ],
                        attempt
                    );


                console.log(
                    `HTTP 429. Esperando ${delay} ms antes de reintentar...`
                );


                await sleep(
                    delay
                );


                continue;

            }


            // =================================================
            // OTRO ERROR HTTP
            // =================================================

            if (
                response.status !== 200
            ) {

                const failure:
                    FailedDownload = {

                        processNumber,

                        idProcessoDocumento:
                            document.idProcessoDocumento,

                        idBin:
                            document.idBin,

                        text:
                            document.text,

                        url:
                            document.url,

                        status:
                            response.status,

                        reason:
                            `HTTP ${response.status}`

                    };


                failedDownloads.push(
                    failure
                );


                saveJson(
                    "output/failed-downloads.json",
                    failedDownloads
                );


                console.log(
                    `✗ HTTP ${response.status}: ${documentId}`
                );


                return;

            }


            // =================================================
            // VALIDAR PDF REAL
            // =================================================

            const buffer =
                Buffer.from(
                    response.data
                );


            const signature =
                buffer
                    .subarray(
                        0,
                        5
                    )
                    .toString(
                        "ascii"
                    );


            const contentType =
                String(
                    response.headers[
                        "content-type"
                    ]
                    ??
                    ""
                );


            if (
                signature !== "%PDF-"
            ) {

                const failure:
                    FailedDownload = {

                        processNumber,

                        idProcessoDocumento:
                            document.idProcessoDocumento,

                        idBin:
                            document.idBin,

                        text:
                            document.text,

                        url:
                            document.url,

                        status:
                            response.status,

                        reason:
                            `La respuesta no tiene firma PDF. Content-Type: ${contentType}`

                    };


                failedDownloads.push(
                    failure
                );


                saveJson(
                    "output/failed-downloads.json",
                    failedDownloads
                );


                console.log(
                    `✗ La respuesta no es PDF: ${documentId}`
                );


                return;

            }


            fs.writeFileSync(
                filePath,
                buffer
            );


            document.downloaded =
                true;


            document.filePath =
                filePath;


            console.log(
                `✓ PDF guardado: ${filePath}`
            );


            return;

        } catch (
            error
        ) {

            if (
                attempt === MAX_REINTENTOS_PDF
            ) {

                const failure:
                    FailedDownload = {

                        processNumber,

                        idProcessoDocumento:
                            document.idProcessoDocumento,

                        idBin:
                            document.idBin,

                        text:
                            document.text,

                        url:
                            document.url,

                        status:
                            null,

                        reason:
                            error instanceof Error
                                ?
                                error.message
                                :
                                String(
                                    error
                                )

                    };


                failedDownloads.push(
                    failure
                );


                saveJson(
                    "output/failed-downloads.json",
                    failedDownloads
                );


                console.log(
                    `✗ Error persistente descargando ${documentId}`
                );


                return;

            }


            const delay =
                Math.min(
                    60000,
                    1000
                    *
                    Math.pow(
                        2,
                        attempt
                    )
                );


            console.log(
                `Error de red. Esperando ${delay} ms antes de reintentar...`
            );


            await sleep(
                delay
            );

        }

    }

}


// =============================================================
// PROCESAR UN PROCESO COMPLETO
// =============================================================

async function processOneProcess(
    summary: ProcessSummary,
    searchReferer: string,
    failedDownloads: FailedDownload[]
): Promise<ProcessData> {

    console.log(
        "\n============================================================="
    );


    console.log(
        `PROCESO ${summary.processNumber}`
    );


    console.log(
        "============================================================="
    );


    const detailUrl =
        new URL(
            summary.detailPath,
            URL_BASE
        ).toString();


    const detailResponse =
        await httpGetText(
            detailUrl,
            searchReferer
        );


    console.log(
        "HTTP detalle:",
        detailResponse.status
    );


    if (
        detailResponse.status !== 200
    ) {

        return {

            processNumber:
                summary.processNumber,

            summary: {

                title:
                    summary.title,

                lastMovement:
                    summary.lastMovement,

                cells:
                    summary.cells

            },

            detail: {
                headings: [],
                fields: {},
                tables: [],
                detailText: ""
            },

            documents: [],

            detailHttpStatus:
                detailResponse.status

        };

    }


    const detailData =
        extractDetailData(
            detailResponse.data
        );


    const documents =
        extractDocuments(
            detailResponse.data,
            detailUrl
        );


    const htmlDocuments =
        documents.filter(
            document =>
                document.type === "html"
        );


    const downloadDocuments =
        documents.filter(
            document =>
                document.type === "download"
        );


    console.log(
        "Documentos encontrados:",
        documents.length
    );


    console.log(
        "Documentos HTML:",
        htmlDocuments.length
    );


    console.log(
        "PDF / descargables:",
        downloadDocuments.length
    );


    // =========================================================
    // LEER DOCUMENTOS HTML
    // =========================================================

    for (
        const document
        of htmlDocuments
    ) {

        await processHtmlDocument(
            document,
            summary.processNumber,
            detailUrl
        );


        await sleep(
            DELAY_ENTRE_REQUESTS_MS
        );

    }


    // =========================================================
    // DESCARGAR PDF
    // =========================================================

    for (
        const document
        of downloadDocuments
    ) {

        await downloadPdfWithRetry(
            document,
            summary.processNumber,
            detailUrl,
            failedDownloads
        );


        await sleep(
            DELAY_ENTRE_REQUESTS_MS
        );

    }


    const processData:
        ProcessData = {

            processNumber:
                summary.processNumber,

            summary: {

                title:
                    summary.title,

                lastMovement:
                    summary.lastMovement,

                cells:
                    summary.cells

            },

            detail:
                detailData,

            documents,

            detailHttpStatus:
                detailResponse.status

        };


    saveJson(
        path.join(
            "output",
            "processes",
            `${sanitizeFileName(summary.processNumber)}.json`
        ),
        processData
    );


    return processData;

}


// =============================================================
// FUNCIÓN PRINCIPAL
// =============================================================

async function main(): Promise<void> {

    console.log(
        "Consultando el portal..."
    );


    console.log(
        `Rango de fechas: ${FECHA_INICIO} -> ${FECHA_FIN}`
    );


    if (
        Number.isFinite(
            LIMITE_PROCESOS
        )
    ) {

        console.log(
            `Modo de prueba: máximo ${LIMITE_PROCESOS} procesos.`
        );

    }


    ensureDirectory(
        "output"
    );


    ensureDirectory(
        "pdfs"
    );


    const failedDownloads:
        FailedDownload[] =
        [];


    const allProcesses:
        ProcessData[] =
        [];


    const processedProcessNumbers =
        new Set<string>();


    // =========================================================
    // 1. GET INICIAL
    // =========================================================

    const initialResponse =
        await httpGetText(
            URL_BASE
        );


    console.log(
        "HTTP inicial:",
        initialResponse.status
    );


    if (
        initialResponse.status !== 200
    ) {

        throw new Error(
            `La página inicial respondió HTTP ${initialResponse.status}`
        );

    }


    console.log(
        "Cookies de sesión obtenidas correctamente."
    );


    // Archivos de depuración. Deben estar en .gitignore.
    fs.writeFileSync(
        "response.html",
        initialResponse.data,
        "utf-8"
    );


    // =========================================================
    // 2. PREPARAR BÚSQUEDA
    // =========================================================

    const preparation =
        prepareSearch(
            initialResponse.data
        );


    console.log(
        "ViewState inicial:",
        preparation.viewState
    );


    console.log(
        "Acción AJAX real de búsqueda:",
        preparation.searchActionName
    );


    const searchFormData =
        cloneFormData(
            preparation.baseFormData
        );


    searchFormData.set(
        preparation.searchActionName,
        preparation.searchActionName
    );


    searchFormData.set(
        "javax.faces.ViewState",
        preparation.viewState
    );


    // =========================================================
    // 3. EJECUTAR BÚSQUEDA
    // =========================================================

    console.log(
        "Ejecutando búsqueda..."
    );


    const searchResponse =
        await httpPostForm(
            preparation.postUrl,
            searchFormData,
            URL_BASE
        );


    console.log(
        "HTTP búsqueda:",
        searchResponse.status
    );


    if (
        searchResponse.status !== 200
    ) {

        throw new Error(
            `La búsqueda respondió HTTP ${searchResponse.status}`
        );

    }


    fs.writeFileSync(
        "search-response.xml",
        searchResponse.data,
        "utf-8"
    );


    // =========================================================
    // 4. RECORRER TODAS LAS PÁGINAS
    // =========================================================

    let currentPage =
        1;


    let currentPageResponse =
        searchResponse.data;


    let latestViewState =
        extractViewState(
            searchResponse.data,
            preparation.viewState
        );


    let totalResults =
        extractTotalResults(
            searchResponse.data
        );


    let firstPageSize:
        number | null =
        null;


    let processedCount =
        0;


    while (
        currentPage <= MAX_PAGINAS_SEGURIDAD
    ) {

        console.log(
            "\n============================================================="
        );


        console.log(
            `PÁGINA DE RESULTADOS ${currentPage}`
        );


        console.log(
            "============================================================="
        );


        const pageProcesses =
            extractProcessesFromSearchResponse(
                currentPageResponse
            );


        if (
            currentPage === 1
        ) {

            firstPageSize =
                pageProcesses.length;


            if (
                totalResults === null
            ) {

                totalResults =
                    extractTotalResults(
                        currentPageResponse
                    );

            }

        }


        console.log(
            "Procesos en esta página:",
            pageProcesses.length
        );


        if (
            totalResults !== null
        ) {

            console.log(
                "Resultados totales informados por el portal:",
                totalResults
            );

        }


        if (
            pageProcesses.length === 0
        ) {

            console.log(
                "No hay procesos en esta página. Finalizando paginación."
            );


            break;

        }


        // =====================================================
        // 5. PROCESAR TODOS LOS PROCESOS DE LA PÁGINA
        // =====================================================

        for (
            const summary
            of pageProcesses
        ) {

            if (
                processedProcessNumbers.has(
                    summary.processNumber
                )
            ) {

                console.log(
                    `↷ Proceso duplicado, se omite: ${summary.processNumber}`
                );


                continue;

            }


            if (
                processedCount >= LIMITE_PROCESOS
            ) {

                console.log(
                    "Se alcanzó el límite de procesos solicitado."
                );


                saveJson(
                    "output/processes.json",
                    allProcesses
                );


                saveJson(
                    "output/failed-downloads.json",
                    failedDownloads
                );


                printSummary(
                    allProcesses,
                    failedDownloads,
                    currentPage,
                    totalResults
                );


                return;

            }


            processedProcessNumbers.add(
                summary.processNumber
            );


            try {

                const processData =
                    await processOneProcess(
                        summary,
                        preparation.postUrl,
                        failedDownloads
                    );


                allProcesses.push(
                    processData
                );


                processedCount++;


                // Guardamos el consolidado después de cada proceso.
                // Así, si el scraper se interrumpe, no se pierde lo avanzado.
                saveJson(
                    "output/processes.json",
                    allProcesses
                );


                saveJson(
                    "output/failed-downloads.json",
                    failedDownloads
                );

            } catch (
                error
            ) {

                console.error(
                    `Error procesando ${summary.processNumber}:`,
                    error instanceof Error
                        ?
                        error.message
                        :
                        error
                );


                // Un proceso que falla no debe detener toda la ejecución.
                processedCount++;

            }


            await sleep(
                DELAY_ENTRE_REQUESTS_MS
            );

        }


        // =====================================================
        // 6. DECIDIR SI EXISTE OTRA PÁGINA
        // =====================================================

        const expectedTotalPages =
            totalResults !== null
            &&
            firstPageSize !== null
            &&
            firstPageSize > 0
                ?
                Math.ceil(
                    totalResults
                    /
                    firstPageSize
                )
                :
                null;


        if (
            expectedTotalPages !== null
            &&
            currentPage >= expectedTotalPages
        ) {

            console.log(
                "Se alcanzó la última página según el total de resultados."
            );


            break;

        }


        const nextPageAction =
            findNextPageAction(
                currentPageResponse,
                currentPage
            );


        if (
            !nextPageAction
        ) {

            // Guardamos la respuesta para poder inspeccionarla si el portal
            // cambia la estructura del paginador.
            ensureDirectory(
                "debug"
            );


            fs.writeFileSync(
                path.join(
                    "debug",
                    `pagination-page-${currentPage}.html`
                ),
                currentPageResponse,
                "utf-8"
            );


            if (
                expectedTotalPages !== null
                &&
                currentPage < expectedTotalPages
            ) {

                throw new Error(
                    `El portal indica ${expectedTotalPages} páginas, `
                    + `pero no se pudo descubrir la acción para pasar de `
                    + `la página ${currentPage} a ${currentPage + 1}. `
                    + `Se guardó debug/pagination-page-${currentPage}.html.`
                );

            }


            console.log(
                "No se encontró control de página siguiente. Fin."
            );


            break;

        }


        console.log(
            `Navegando a la página ${currentPage + 1}...`
        );


        await sleep(
            DELAY_ENTRE_REQUESTS_MS
        );


        const nextResponse =
            await executePaginationAction(
                nextPageAction,
                preparation,
                latestViewState
            );


        if (
            nextResponse.status !== 200
        ) {

            throw new Error(
                `La paginación respondió HTTP ${nextResponse.status}`
            );

        }


        latestViewState =
            extractViewState(
                nextResponse.data,
                latestViewState
            );


        currentPageResponse =
            nextResponse.data;


        currentPage++;

    }


    // =========================================================
    // 7. GUARDAR RESULTADOS FINALES
    // =========================================================

    saveJson(
        "output/processes.json",
        allProcesses
    );


    saveJson(
        "output/failed-downloads.json",
        failedDownloads
    );


    printSummary(
        allProcesses,
        failedDownloads,
        currentPage,
        totalResults
    );

}


// =============================================================
// RESUMEN FINAL
// =============================================================

function printSummary(
    processes: ProcessData[],
    failedDownloads: FailedDownload[],
    pagesVisited: number,
    totalResults: number | null
): void {

    const totalDocuments =
        processes.reduce(
            (
                total,
                processData
            ) =>
                total
                +
                processData.documents.length,
            0
        );


    const totalHtmlDocuments =
        processes.reduce(
            (
                total,
                processData
            ) =>
                total
                +
                processData.documents.filter(
                    document =>
                        document.type === "html"
                ).length,
            0
        );


    const totalPdfDocuments =
        processes.reduce(
            (
                total,
                processData
            ) =>
                total
                +
                processData.documents.filter(
                    document =>
                        document.type === "download"
                ).length,
            0
        );


    const downloadedPdfs =
        processes.reduce(
            (
                total,
                processData
            ) =>
                total
                +
                processData.documents.filter(
                    document =>
                        document.type === "download"
                        &&
                        document.downloaded === true
                ).length,
            0
        );


    console.log(
        "\n============================================================="
    );


    console.log(
        "RESUMEN FINAL"
    );


    console.log(
        "============================================================="
    );


    console.log(
        "Páginas visitadas:",
        pagesVisited
    );


    console.log(
        "Resultados totales del portal:",
        totalResults
        ??
        "No informado"
    );


    console.log(
        "Procesos procesados:",
        processes.length
    );


    console.log(
        "Documentos encontrados:",
        totalDocuments
    );


    console.log(
        "Documentos HTML:",
        totalHtmlDocuments
    );


    console.log(
        "Documentos PDF / descargables:",
        totalPdfDocuments
    );


    console.log(
        "PDF descargados:",
        downloadedPdfs
    );


    console.log(
        "Descargas pendientes:",
        failedDownloads.length
    );


    console.log(
        "JSON consolidado: output/processes.json"
    );


    console.log(
        "Fallidos: output/failed-downloads.json"
    );

}


// =============================================================
// EJECUTAR PROGRAMA
// =============================================================

main().catch(
    error => {

        console.error(
            "Error fatal:",
            error instanceof Error
                ?
                error.message
                :
                error
        );


        process.exitCode =
            1;

    }
);
