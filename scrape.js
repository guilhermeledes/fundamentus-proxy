import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import cheerio from 'cheerio';

const URL = 'https://www.fundamentus.com.br/resultado.php';

// Permite passar cookie pelo Secret do GitHub: FUNDAMENTUS_COOKIE
const COOKIE = process.env.FUNDAMENTUS_COOKIE || '';

async function fetchHtml() {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };
    if (COOKIE) headers['Cookie'] = COOKIE;

    const resp = await axios.get(URL, { headers, timeout: 30000, validateStatus: () => true });
    if (resp.status >= 400) {
        throw new Error(`HTTP ${resp.status} ao baixar Fundamentus`);
    }
    return resp.data;
}

function extractMainTable(html) {
    const $ = cheerio.load(html);
    // normalmente é a primeira grande tabela de resultados:
    const $table = $('table').first();
    if (!$table || $table.length === 0) throw new Error('Tabela não encontrada');

    // Normaliza whitespace
    $table.find('br').replaceWith('\n');

    // Constrói CSV
    const rows = [];
    $table.find('tr').each((_, tr) => {
        const cols = [];
        $(tr).find('th,td').each((__, td) => {
            let text = $(td).text().trim().replace(/\s+/g, ' ');
            // troque ; por , no CSV, ou use separador ;
            text = text.replace(/;/g, ',');
            cols.push(text);
        });
        if (cols.length) rows.push(cols);
    });

    const csv = rows.map(r => r.join(';')).join('\n');

    // Gera HTML limpo contendo apenas UMA tabela simples (bom para IMPORTHTML)
    const safeTable = `<meta charset="utf-8"><table>${$table.html()}</table>`;

    return { csv, html: safeTable };
}

async function main() {
    const html = await fetchHtml();
    const { csv, html: tableHtml } = extractMainTable(html);

    const outDir = path.join(process.cwd(), 'docs');
    fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(path.join(outDir, 'resultado.csv'), csv, 'utf8');
    fs.writeFileSync(path.join(outDir, 'resultado.html'), tableHtml, 'utf8');

    console.log('Gerados: docs/resultado.csv e docs/resultado.html');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});