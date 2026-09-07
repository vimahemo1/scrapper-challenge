import axios from "axios";
import fs from "fs";
const url = "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";


async function main() {
    console.log("Consultando el portal...");
    const response = await axios.get(url, {
        timeout: 30000,

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        }
    });    
    console.log("HTTP:", response.status);
    console.log("Tamaño HTML:", response.data.length);
    fs.writeFileSync("response.html", response.data, "utf-8");
    console.log("Archivo response.html guardado.");
}
main();