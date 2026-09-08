import axios from "axios";
import fs from "fs";
import * as cheerio from "cheerio";
const url = "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";


async function main() {
    console.log("Consultando el portal...");
    const response = await axios.get<string>(url, {
        timeout: 30000,

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        }
    });

    console.log("HTTP:", response.status);


    //Cookies
    const setCookies = response.headers["set-cookie"];
    const cookies = setCookies?.map(cookie => cookie.split(";")[0]).join("; ");
    console.log("Set-Cookie:", setCookies);
    if(!cookies) {
        throw new Error("No se encontraron cookies en la respuesta HTTP.");
    }
    

    //Guardar Html
    console.log("Tamaño HTML:", response.data.length);
    fs.writeFileSync("response.html", response.data, "utf-8");
    console.log("Archivo response.html guardado.");


    //ViewState
    const $ = cheerio.load(
        response.data
    );
    const viewState = $("input[name='javax.faces.ViewState']").attr("value");
    if (!viewState) {
        throw new Error("No se encontró el valor de javax.faces.ViewState en la respuesta HTML.");
    }
    console.log("Valor de javax.faces.ViewState:", viewState);

    //Formulario
    const form = $("form#fPP");
    if(form.length === 0) {
        throw new Error("No se encontró el formulario con ID 'fPP' en la respuesta HTML.");
    }
    console.log("Formulario encontrado con ID 'fPP'.");

    //Obtener Campos
    const campos: {
        name: string;
        type: string;
        value: string;
    }[] = [];
    form.find("input[name]").each((_, element) => {
        const input = $(element);
        const name = input.attr("name");
        if(!name) {
            return;
        }
        campos.push({
            name: name,
            type: input.attr("type") ?? "text",
            value: input.attr("value") ?? "",
        });
    });
    console.log("Campos encontrados en el formulario:", campos);
}


main().catch((error) => {
    console.error("Error:", error instanceof Error ? error.message : error);
});