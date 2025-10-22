import fs from "fs";
import path from "path";

const outDir = path.join(process.cwd(), "docs");
fs.mkdirSync(outDir, { recursive: true });

const html = `<!doctype html>
<meta charset="utf-8">
<title>fundamentus-proxy</title>
<h1>fundamentus-proxy</h1>
<ul>
  <li><a href="./resultado.html">resultado.html</a></li>
  <li><a href="./resultado.csv">resultado.csv</a></li>
  <li><a href="./resultado-clean.csv">resultado-clean.csv</a> (recomendado p/ Sheets)</li>
</ul>
`;
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
console.log("[prepare:docs] ok");