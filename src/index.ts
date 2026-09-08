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

    const response = await axios.get<string>(url, {

        timeout: 30000,

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        }

    });


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
    // 8. MOSTRAR CAMPOS ENCONTRADOS
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

                name: name,

                type:
                    input.attr("type")
                    ?? "text",

                value:
                    input.attr("value")
                    ?? "",

            });

        }
    );


    console.log(
        "Campos encontrados en el formulario:",
        campos
    );


    // =========================================================
    // 9. CONSTRUIR DATOS DEL FORMULARIO
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


            // Los botones se agregan después
            if (
                type === "button"
                || type === "submit"
            ) {

                return;

            }


            // Radios y checkbox:
            // solo se envían si están seleccionados
            if (
                type === "radio"
                || type === "checkbox"
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
    // 10. AGREGAR BOTÓN PESQUISAR
    // =========================================================

    const searchButtonName =
        searchButton.attr("name");


    if (!searchButtonName) {

        throw new Error(
            "El botón de búsqueda no tiene atributo 'name'."
        );

    }


    formData.set(
        searchButtonName,
        searchButtonName
    );


    // =========================================================
    // 11. AGREGAR FECHAS
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
    // 12. PARÁMETROS AJAX DE RICHFACES
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
    // 13. MOSTRAR DATOS QUE SE ENVIARÁN
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
    // 14. OBTENER URL DEL POST
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
    // 15. REALIZAR POST
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
                        "XMLHttpRequest",

                },


                // Nos permite revisar respuestas como 403, 429, etc.
                // sin que Axios lance inmediatamente una excepción.
                validateStatus: () => true,

            }

        );


    // =========================================================
    // 16. INFORMACIÓN DE LA RESPUESTA
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
    // 17. GUARDAR RESPUESTA DEL POST
    // =========================================================

    fs.writeFileSync(
        "search-response.xml",
        searchResponse.data,
        "utf-8"
    );


    console.log(
        "Respuesta guardada en search-response.xml"
    );

}


// =============================================================
// EJECUTAR
// =============================================================

main().catch((error) => {

    console.error(
        "Error:",
        error instanceof Error
            ? error.message
            : error
    );

});