// scrape.js
import axios from 'axios';
import { load } from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import iconv from 'iconv-lite'; // <<-- novo

const URL = 'https://www.fundamentus.com.br/resultado.php';
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

    // Pegue em binário para controlar a decodificação
    const resp = await axios.get(URL, {
        headers,
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: () => true
    });
    if (resp.status >= 400 || !resp.data) {
        throw new Error(`HTTP ${resp.status} ao baixar Fundamentus`);
    }

    // Detecta charset do header, senão tenta heurísticas comuns
    const ct = (resp.headers['content-type'] || '').toLowerCase();
    const m = ct.match(/charset=([^;]+)/i);
    const charsetHeader = m ? m[1].trim() : null;

    const buf = Buffer.from(resp.data);
    let html;

    const tryDecode = (b) => {
        // tenta em ordem: header -> utf8 -> latin1 -> win1252
        const candidates = [
            charsetHeader,
            'utf-8',
            'iso-8859-1',
            'windows-1252'
        ].filter(Boolean);

        for (const enc of candidates) {
            try {
                const s = iconv.decode(b, enc);
                // heurística simples: se virar muito "�", tenta próximo
                const bad = (s.match(/\uFFFD/g) || []).length;
                if (bad < 5) return s;
            } catch { /* tenta próxima */ }
        }
        return iconv.decode(b, 'utf-8'); // fallback
    };

    html = tryDecode(buf);

    // Garanta meta UTF-8 no topo
    // (substitui meta existente ou injeta uma)
    if (/<meta[^>]*charset=/i.test(html)) {
        html = html.replace(/<meta[^>]*charset=[^>]*>/i, '<meta charset="utf-8">');
    } else {
        html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
    }

    return html;
}

function extractMainTable(html) {
    const $ = load(html);
    const $table = $('table').first();
    if (!$table || $table.length === 0) throw new Error('Tabela não encontrada');

    $table.find('br').replaceWith('\n');

    const rows = [];
    $table.find('tr').each((_, tr) => {
        const cols = [];
        $(tr).find('th,td').each((__, td) => {
            let text = $(td).text()
                .replace(/\u00A0/g, ' ') // NBSP -> espaço normal
                .trim()
                .replace(/\s+/g, ' ');
            text = text.replace(/;/g, ',');
            cols.push(text);
        });
        if (cols.length) rows.push(cols);
    });

    const csv = rows.map(r => r.join(';')).join('\n');
    const tableHtml = `<meta charset="utf-8"><table>${$table.html()}</table>`;
    return { csv, html: tableHtml };
}

async function main() {
    const outDir = path.join(process.cwd(), 'docs');
    fs.mkdirSync(outDir, { recursive: true });

    const html = await fetchHtml();

    const { csv, html: tableHtml } = extractMainTable(html);
    fs.writeFileSync(path.join(outDir, 'resultado.csv'), csv, 'utf8');
    fs.writeFileSync(path.join(outDir, 'resultado.html'), tableHtml, 'utf8');

    console.log('Gerados: docs/resultado.csv e docs/resultado.html');
}

main().catch(err => {
    console.error('[ERRO]', err.message);
    process.exit(1);
});