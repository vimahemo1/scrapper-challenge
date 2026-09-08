import axios from "axios";
import fs from "fs";
import * as cheerio from "cheerio";


const url =
    "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";


async function main() {

    console.log("Consultando el portal...");


    // =========================================================
    // 1. PETICIÓN GET INICIAL
    // =========================================================

    const response = await axios.get<string>(
        url,
        {
            timeout: 30000,

            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            }
        }
    );


    console.log(
        "HTTP:",
        response.status
    );


    // =========================================================
    // 2. OBTENER COOKIES DE SESIÓN
    // =========================================================

    const setCookies =
        response.headers["set-cookie"];


    const cookies = setCookies
        ?.map(cookie => cookie.split(";")[0])
        .join("; ");


    if (!cookies) {

        throw new Error(
            "No se encontraron cookies en la respuesta HTTP."
        );

    }


    console.log(
        "Cookies de sesión obtenidas correctamente."
    );


    // =========================================================
    // 3. GUARDAR HTML INICIAL
    // =========================================================

    console.log(
        "Tamaño HTML:",
        response.data.length
    );


    fs.writeFileSync(
        "response.html",
        response.data,
        "utf-8"
    );


    console.log(
        "Archivo response.html guardado."
    );


    // =========================================================
    // 4. CARGAR HTML CON CHEERIO
    // =========================================================

    const $ =
        cheerio.load(response.data);


    // =========================================================
    // 5. OBTENER VIEWSTATE
    // =========================================================

    const viewState = $(
        "input[name='javax.faces.ViewState']"
    ).attr("value");


    if (!viewState) {

        throw new Error(
            "No se encontró el valor de javax.faces.ViewState."
        );

    }


    console.log(
        "Valor de javax.faces.ViewState:",
        viewState
    );


    // =========================================================
    // 6. BUSCAR FORMULARIO
    // =========================================================

    const form =
        $("form#fPP");


    if (form.length === 0) {

        throw new Error(
            "No se encontró el formulario con ID 'fPP'."
        );

    }


    console.log(
        "Formulario encontrado con ID 'fPP'."
    );


    console.log(
        "Action:",
        form.attr("action")
    );


    console.log(
        "Method:",
        form.attr("method")
    );


    // =========================================================
    // 7. BUSCAR BOTÓN PESQUISAR
    // =========================================================

    const searchButton = form
        .find(
            "input[type='button'][value='Pesquisar']"
        )
        .first();


    if (searchButton.length === 0) {

        throw new Error(
            "No se encontró el botón de búsqueda con valor 'Pesquisar'."
        );

    }


    console.log(
        "Botón de búsqueda encontrado."
    );


    console.log({

        id:
            searchButton.attr("id"),

        name:
            searchButton.attr("name"),

        value:
            searchButton.attr("value"),

        onclick:
            searchButton.attr("onclick"),

    });


    // =========================================================
    // 8. INSPECCIONAR RECAPTCHA
    // =========================================================

    const possibleMarkers = [
        "function executarReCaptcha",
        "executarReCaptcha =",
        "executarReCaptcha:"
    ];


    let recaptchaPosition = -1;
    let markerFound = "";


    for (const marker of possibleMarkers) {

        const position =
            response.data.indexOf(marker);


        if (position >= 0) {

            recaptchaPosition =
                position;

            markerFound =
                marker;

            break;
        }

    }


    if (recaptchaPosition >= 0) {

        const start =
            Math.max(
                0,
                recaptchaPosition - 1000
            );


        const end =
            Math.min(
                response.data.length,
                recaptchaPosition + 5000
            );


        const recaptchaCode =
            response.data.substring(
                start,
                end
            );


        fs.writeFileSync(
            "recaptcha-debug.txt",
            recaptchaCode,
            "utf-8"
        );


        console.log(
            "Definición de executarReCaptcha encontrada con:",
            markerFound
        );


        console.log(
            "Código guardado en recaptcha-debug.txt"
        );

    } else {

        console.log(
            "No se encontró la definición directa de executarReCaptcha."
        );

    }


    // =========================================================
    // 9. MOSTRAR CAMPOS DEL FORMULARIO
    // =========================================================

    const campos: {
        name: string;
        type: string;
        value: string;
    }[] = [];


    form.find("input[name]").each(
        (_, element) => {

            const input =
                $(element);


            const name =
                input.attr("name");


            if (!name) {
                return;
            }


            campos.push({

                name,

                type:
                    input.attr("type")
                    ?? "text",

                value:
                    input.attr("value")
                    ?? ""

            });

        }
    );


    console.log(
        "Campos encontrados en el formulario:",
        campos
    );


    // =========================================================
    // 10. CONSTRUIR DATOS DEL FORMULARIO
    // =========================================================

    const formData =
        new URLSearchParams();


    // ---------------------------------------------------------
    // INPUTS
    // ---------------------------------------------------------

    form.find("input[name]").each(
        (_, element) => {

            const input =
                $(element);


            const name =
                input.attr("name");


            if (!name) {
                return;
            }


            const type = (
                input.attr("type")
                ?? "text"
            ).toLowerCase();


            // Botones se agregan manualmente
            if (
                type === "button"
                ||
                type === "submit"
            ) {
                return;
            }


            // Radio y checkbox solo si están seleccionados
            if (
                type === "radio"
                ||
                type === "checkbox"
            ) {

                if (!input.is(":checked")) {
                    return;
                }

            }


            const value =
                input.attr("value")
                ?? "";


            formData.append(
                name,
                value
            );

        }
    );


    // ---------------------------------------------------------
    // SELECTS
    // ---------------------------------------------------------

    form.find("select[name]").each(
        (_, element) => {

            const select =
                $(element);


            const name =
                select.attr("name");


            if (!name) {
                return;
            }


            const selectedOption =
                select
                    .find("option:selected")
                    .first();


            const value =
                selectedOption.length > 0

                    ? selectedOption.attr("value") ?? ""

                    : select
                        .find("option")
                        .first()
                        .attr("value") ?? "";


            formData.append(
                name,
                value
            );

        }
    );


    // =========================================================
    // 11. OBTENER ACCIÓN AJAX REAL DE BÚSQUEDA
    // =========================================================

    let pesquisaScript = "";


    $("script").each(
        (_, element) => {

            const content =
                $(element).html()
                ?? "";


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


    if (!pesquisaScript) {

        throw new Error(
            "No se encontró la definición de executarPesquisa."
        );

    }


    const actionMatch =
        pesquisaScript.match(
            /similarityGroupingId':'([^']+)'/
        );


    if (!actionMatch) {

        throw new Error(
            "No se pudo determinar la acción AJAX de executarPesquisa."
        );

    }


    const searchActionName =
        actionMatch[1];


    console.log(
        "Acción AJAX real de búsqueda:",
        searchActionName
    );


    formData.set(
        searchActionName,
        searchActionName
    );


    // =========================================================
    // 12. AGREGAR FECHAS
    // =========================================================

    formData.set(
        "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate",
        "04/09/2026"
    );


    formData.set(
        "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate",
        "11/09/2026"
    );


    // =========================================================
    // 13. PARÁMETROS AJAX DE RICHFACES
    // =========================================================

    formData.set(
        "AJAXREQUEST",
        "_viewRoot"
    );


    formData.set(
        "AJAX:EVENTS_COUNT",
        "1"
    );


    // =========================================================
    // 14. MOSTRAR DATOS QUE SE ENVIARÁN
    // =========================================================

    console.log(
        "Datos del formulario:"
    );


    for (
        const [key, value]
        of formData.entries()
    ) {

        console.log(
            `${key} = ${value}`
        );

    }


    // =========================================================
    // 15. OBTENER URL DEL POST
    // =========================================================

    const action =
        form.attr("action");


    if (!action) {

        throw new Error(
            "El formulario no tiene atributo action."
        );

    }


    const postUrl =
        new URL(
            action,
            url
        ).toString();


    console.log(
        "Enviando búsqueda a:",
        postUrl
    );


    // =========================================================
    // 16. REALIZAR POST DE BÚSQUEDA
    // =========================================================

    const searchResponse =
        await axios.post<string>(

            postUrl,

            formData.toString(),

            {

                timeout: 30000,


                headers: {

                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",

                    "Cookie":
                        cookies,

                    "Referer":
                        url,

                    "X-Requested-With":
                        "XMLHttpRequest"

                },


                validateStatus:
                    () => true

            }

        );


    // =========================================================
    // 17. INFORMACIÓN DE LA RESPUESTA
    // =========================================================

    console.log(
        "HTTP búsqueda:",
        searchResponse.status
    );


    console.log(
        "Content-Type búsqueda:",
        searchResponse.headers["content-type"]
    );


    console.log(
        "Tamaño respuesta:",
        searchResponse.data.length
    );


    // =========================================================
    // 18. GUARDAR RESPUESTA
    // =========================================================

    fs.writeFileSync(
        "search-response.xml",
        searchResponse.data,
        "utf-8"
    );


    console.log(
        "Respuesta guardada en search-response.xml"
    );


    // =========================================================
    // 19. LEER RESULTADOS
    // =========================================================

    const $results =
        cheerio.load(
            searchResponse.data
        );


    const resultRows =
        $results(
            '[id="fPP:processosTable:tb"] tr'
        );


    console.log(
        "Cantidad de filas encontradas:",
        resultRows.length
    );


    // =========================================================
    // 20. MOSTRAR PRIMERAS 5 FILAS
    // =========================================================

    resultRows
        .slice(0, 5)
        .each(
            (index, element) => {

                const row =
                    $results(element);


                const cells: string[] =
                    [];


                row.find("td").each(
                    (_, td) => {

                        const text =
                            $results(td)
                                .text()
                                .replace(
                                    /\s+/g,
                                    " "
                                )
                                .trim();


                        cells.push(
                            text
                        );

                    }
                );


                console.log(
                    `Fila ${index + 1}:`
                );


                console.log(
                    cells
                );

            }
        );


    // =========================================================
    // 21. MOSTRAR ENLACES DE PRIMERAS 5 FILAS
    // =========================================================

    resultRows
        .slice(0, 5)
        .each(
            (index, element) => {

                const row =
                    $results(element);


                const links: {
                    text: string;
                    href: string;
                }[] = [];


                row.find("a[href]").each(
                    (_, linkElement) => {

                        const link =
                            $results(linkElement);


                        links.push({

                            text:
                                link
                                    .text()
                                    .replace(
                                        /\s+/g,
                                        " "
                                    )
                                    .trim(),

                            href:
                                link.attr("href")
                                ?? ""

                        });

                    }
                );


                console.log(
                    `Enlaces fila ${index + 1}:`,
                    links
                );

            }
        );


    // =========================================================
    // 22. INSPECCIONAR ACCIONES DE DETALLE
    // =========================================================

    resultRows
        .slice(0, 3)
        .each(
            (index, element) => {

                const row =
                    $results(element);


                console.log(
                    `\n--- ACCIONES FILA ${index + 1} ---`
                );


                row.find("a").each(
                    (_, linkElement) => {

                        const link =
                            $results(linkElement);


                        console.log({

                            text:
                                link
                                    .text()
                                    .replace(
                                        /\s+/g,
                                        " "
                                    )
                                    .trim(),

                            id:
                                link.attr("id")
                                ?? "",

                            href:
                                link.attr("href")
                                ?? "",

                            onclick:
                                link.attr("onclick")
                                ?? ""

                        });

                    }
                );

            }
        );


    // =========================================================
    // 23. OBTENER URL DEL PRIMER DETALLE
    // =========================================================

    const firstRow =
        resultRows.first();


    if (firstRow.length === 0) {

        throw new Error(
            "No existen filas para consultar el detalle."
        );

    }


    const firstDetailLink =
        firstRow
            .find("a")
            .first();


    const detailOnclick =
        firstDetailLink.attr("onclick")
        ?? "";


    console.log(
        "Onclick del primer detalle:",
        detailOnclick
    );


    const detailMatch =
        detailOnclick.match(
            /openPopUp\([^,]+,'([^']+)'\)/
        );


    if (!detailMatch) {

        throw new Error(
            "No se pudo extraer la URL del detalle."
        );

    }


    const detailPath =
        detailMatch[1];


    const detailUrl =
        new URL(
            detailPath,
            url
        ).toString();


    console.log(
        "URL detalle:",
        detailUrl
    );


    // =========================================================
    // 24. CONSULTAR DETALLE DEL PRIMER PROCESO
    // =========================================================

    const detailResponse =
        await axios.get<string>(
            detailUrl,
            {
                timeout: 30000,

                headers: {

                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

                    "Cookie":
                        cookies,

                    "Referer":
                        postUrl

                },

                validateStatus:
                    () => true
            }
        );


    console.log(
        "HTTP detalle:",
        detailResponse.status
    );


    console.log(
        "Content-Type detalle:",
        detailResponse.headers["content-type"]
    );


    console.log(
        "Tamaño detalle:",
        detailResponse.data.length
    );


    // =========================================================
    // 25. GUARDAR HTML DEL DETALLE
    // =========================================================

    fs.writeFileSync(
        "detail-response.html",
        detailResponse.data,
        "utf-8"
    );


    console.log(
        "Detalle guardado en detail-response.html"
    );

// =========================================================
// 26. CARGAR DETALLE CON CHEERIO
// =========================================================

const $detail =
    cheerio.load(
        detailResponse.data
    );


// =========================================================
// 27. INSPECCIONAR ENLACES DEL DETALLE
// =========================================================

const detailLinks: {
    text: string;
    href: string;
    onclick: string;
    id: string;
}[] = [];


$detail("a").each(
    (_, element) => {

        const link =
            $detail(element);


        const text =
            link
                .text()
                .replace(/\s+/g, " ")
                .trim();


        const href =
            link.attr("href")
            ?? "";


        const onclick =
            link.attr("onclick")
            ?? "";


        const id =
            link.attr("id")
            ?? "";


        const combined =
            `${text} ${href} ${onclick}`
                .toLowerCase();


        if (
            combined.includes("document")
            ||
            combined.includes("pdf")
            ||
            combined.includes("download")
            ||
            combined.includes("visual")
        ) {

            detailLinks.push({
                text,
                href,
                onclick,
                id
            });

        }

    }
);


console.log(
    "\nEnlaces relacionados con documentos/PDF:"
);


console.log(
    detailLinks
);


// =========================================================
// 28. INSPECCIONAR BOTONES DEL DETALLE
// =========================================================

const detailButtons: {
    id: string;
    name: string;
    value: string;
    onclick: string;
    type: string;
}[] = [];


$detail(
    "input[type='button'], input[type='submit'], button"
).each(
    (_, element) => {

        const button =
            $detail(element);


        const id =
            button.attr("id")
            ?? "";


        const name =
            button.attr("name")
            ?? "";


        const value =
            button.attr("value")
            ??
            button.text().trim();


        const onclick =
            button.attr("onclick")
            ?? "";


        const type =
            button.attr("type")
            ?? "";


        const combined =
            `${id} ${name} ${value} ${onclick}`
                .toLowerCase();


        if (
            combined.includes("pdf")
            ||
            combined.includes("document")
            ||
            combined.includes("download")
            ||
            combined.includes("visual")
        ) {

            detailButtons.push({
                id,
                name,
                value,
                onclick,
                type
            });

        }

    }
);


console.log(
    "\nBotones relacionados con documentos/PDF:"
);


console.log(
    detailButtons
);
    // =========================================================
    // 26. ANALIZAR RÁPIDAMENTE EL DETALLE
    // =========================================================

    const detailHtml =
        detailResponse.data;


    console.log(
        "¿Detalle contiene Processo?:",
        detailHtml
            .toLowerCase()
            .includes("processo")
    );


    console.log(
        "¿Detalle contiene Documento?:",
        detailHtml
            .toLowerCase()
            .includes("documento")
    );


    console.log(
        "¿Detalle contiene PDF?:",
        detailHtml
            .toLowerCase()
            .includes("pdf")
    );


    console.log(
        "¿Detalle contiene movimentação?:",
        detailHtml
            .toLowerCase()
            .includes("movimenta")
    );


    // =========================================================
    // 27. ANALIZAR RESPUESTA XML DE BÚSQUEDA
    // =========================================================

    const xml =
        searchResponse.data;


    console.log(
        "¿Contiene ViewState?:",
        xml.includes(
            "javax.faces.ViewState"
        )
    );


    console.log(
        "¿Contiene referencia a procesos?:",
        xml
            .toLowerCase()
            .includes("processo")
    );


    console.log(
        "¿Contiene CAPTCHA?:",
        xml
            .toLowerCase()
            .includes("captcha")
    );


    console.log(
        "¿Contiene error?:",
        xml
            .toLowerCase()
            .includes("erro")
    );

}


// =============================================================
// EJECUTAR PROGRAMA
// =============================================================

main().catch(
    (error) => {

        console.error(

            "Error:",

            error instanceof Error
                ? error.message
                : error

        );

    }
);