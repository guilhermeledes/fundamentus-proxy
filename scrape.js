// scrape.js
import axios from 'axios';
import { load } from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import iconv from 'iconv-lite';

const URL = 'https://www.fundamentus.com.br/resultado.php';
const COOKIE = process.env.FUNDAMENTUS_COOKIE || '';

async function fetchHtml() {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (COOKIE) headers['Cookie'] = COOKIE;

  const resp = await axios.get(URL, {
    headers,
    responseType: 'arraybuffer',
    timeout: 30000,
    validateStatus: () => true,
  });
  if (resp.status >= 400 || !resp.data) {
    throw new Error(`HTTP ${resp.status} ao baixar Fundamentus`);
  }

  const ct = (resp.headers['content-type'] || '').toLowerCase();
  const m = ct.match(/charset=([^;]+)/i);
  const charsetHeader = m ? m[1].trim() : null;

  const buf = Buffer.from(resp.data);

  const tryDecode = (b) => {
    const candidates = [charsetHeader, 'utf-8', 'iso-8859-1', 'windows-1252'].filter(Boolean);
    for (const enc of candidates) {
      try {
        const s = iconv.decode(b, enc);
        const bad = (s.match(/\uFFFD/g) || []).length;
        if (bad < 5) return s;
      } catch {
        /* next */
      }
    }
    return iconv.decode(b, 'utf-8');
  };

  let html = tryDecode(buf);

  if (/<meta[^>]*charset=/i.test(html)) {
    html = html.replace(/<meta[^>]*charset=[^>]*>/i, '<meta charset="utf-8">');
  } else {
    html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
  }

  return html;
}

// ---------- helpers de normalização (pt-BR) ----------

// limpa texto de célula
function tidy(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ') // nbsp
    .replace(/\s+/g, ' ')
    .trim();
}

// remove separador de milhar e mantém vírgula decimal (pt-BR)
// "1.035.540.000" -> "1035540000"
// "8,88" -> "8,88"
function stripThousandsKeepComma(numStr) {
  let s = tidy(numStr);
  // mantém sinais, dígitos, vírgula e ponto; depois remove pontos que são milhar
  // regra simples: se houver vírgula, todos os pontos são milhar
  if (s.includes(',')) {
    s = s.replace(/\./g, '');
  } else {
    // se não há vírgula e há >=2 pontos, remova todos (milhar)
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount >= 1) s = s.replace(/\./g, '');
  }
  return s;
}

// converte percentuais "7,87%" -> "0,0787" (pt-BR, vírgula decimal)
function percentToDecimalBR(pctStr) {
  let s = tidy(pctStr).replace('%', '').trim();
  if (s === '') return '';
  // para dividir, troca vírgula por ponto, divide por 100, depois volta vírgula
  const asFloat = parseFloat(s.replace('.', '').replace(',', '.')); // remove milhar e usa ponto decimal
  if (isNaN(asFloat)) return '';
  const dec = asFloat / 100;
  // volta para vírgula decimal
  // toString pode usar notação científica em números muito pequenos; usa toFixed com trims
  let out = dec.toString().replace('.', ',');
  // arredonda para até 6 casas para não virar cauda infinita
  out = dec.toFixed(6).replace('.', ',');
  // remove zeros à direita desnecessários
  out = out.replace(/,(\d*?)0+$/, (m, g1) => (g1.length ? ',' + g1 : ''));
  return out;
}

// tenta normalizar valor numérico genérico da tabela
// - tira milhar
// - mantém vírgula como decimal
// - converte "" e "-" para ""
function normalizeNumberBR(s) {
  const t = tidy(s);
  if (!t || t === '-') return '';
  // se contém %, deixe para percentToDecimalBR tratar fora
  if (t.includes('%')) return percentToDecimalBR(t);
  // moeda/negativos com parênteses? remove símbolos
  const cleaned = stripThousandsKeepComma(t.replace(/R\$\s?/i, ''));
  // valida: se virar algo tipo "8,88" ou "1035540000" ok; se ficar lixo, retorna original
  // (Sheets pt-BR vai interpretar "8,88" como número)
  return cleaned;
}
// -----------------------------------------------------

function extractAndNormalize(html) {
  const $ = load(html);
  const $table = $('table').first();
  if (!$table || $table.length === 0) throw new Error('Tabela não encontrada');

  $table.find('br').replaceWith('\n');

  // cabeçalho
  const headerCells = $table.find('thead tr').first().find('th,td');
  const firstRowCells = headerCells.length ? headerCells : $table.find('tr').first().find('th,td');
  const header = firstRowCells
    .toArray()
    .map((th) => tidy($(th).text()).replace(/\s+/g, ' '));

  // mapeia nomes -> índice
  const colIdx = {};
  header.forEach((h, i) => (colIdx[h] = i));

  // nomes de colunas que nos interessam (como aparecem no Fundamentus)
  const COLS = {
    PAPEL: 'Papel',
    EV_EBIT: 'EV/EBIT',
    P_VP: 'P/VP',
    DIVY: 'Div.Yield',
    LIQ2M: 'Liq.2meses',
  };

  const bodyRows = [];
  $table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td,th').toArray().map((td) => tidy($(td).text()));
    if (!cells.length) return;

    // monta registro completo (todas as colunas originais) normalizando números
    const normalized = header.map((h, i) => {
      if ([COLS.EV_EBIT, COLS.P_VP, COLS.DIVY, COLS.LIQ2M, 'P/L', 'Cotação'].includes(h)) {
        return normalizeNumberBR(cells[i] ?? '');
      }
      return tidy(cells[i] ?? '');
    });

    bodyRows.push(normalized);
  });

  // CSV completo limpo (todas as colunas)
  const allCsv = [header.join(';'), ...bodyRows.map((r) => r.join(';'))].join('\n');

  // CSV enxuto só com as colunas usadas na planilha
  const slimHeader = [COLS.PAPEL, COLS.EV_EBIT, COLS.P_VP, COLS.DIVY, COLS.LIQ2M];
  const slimIdx = slimHeader.map((name) => colIdx[name] ?? -1);
  const slimRows = bodyRows.map((row) => slimIdx.map((i) => (i >= 0 ? row[i] : '')));
  const slimCsv = [slimHeader.join(';'), ...slimRows.map((r) => r.join(';'))].join('\n');

  const tableHtml = `<meta charset="utf-8"><table>${$table.html()}</table>`;
  return { allCsv, slimCsv, html: tableHtml };
}

async function main() {
  const outDir = path.join(process.cwd(), 'docs');
  fs.mkdirSync(outDir, { recursive: true });

  const html = await fetchHtml();

  const { allCsv, slimCsv, html: tableHtml } = extractAndNormalize(html);

  // CSV “completo” limpo (todas as colunas da tabela original)
  fs.writeFileSync(path.join(outDir, 'resultado.csv'), allCsv, 'utf8');

  // CSV “enxuto” para a planilha (Papel;EV/EBIT;P/VP;Div.Yield;Liq.2meses)
  fs.writeFileSync(path.join(outDir, 'resultado-clean.csv'), slimCsv, 'utf8');

  // HTML original (para visualização no GitHub Pages)
  fs.writeFileSync(path.join(outDir, 'resultado.html'), tableHtml, 'utf8');

  console.log('Gerados:');
  console.log(' - docs/resultado.csv        (todas as colunas, normalizado)');
  console.log(' - docs/resultado-clean.csv   (Papel;EV/EBIT;P/VP;Div.Yield;Liq.2meses)');
  console.log(' - docs/resultado.html');
}

main().catch((err) => {
  console.error('[ERRO]', err.message);
  process.exit(1);
});
