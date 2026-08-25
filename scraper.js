'use strict';

/**
 * scraper.js — busca a edição mais recente do Diário Oficial do Estado da
 * Bahia (portal DOOL/EGBA), separa cada publicação (matéria) usando os
 * marcadores internos do PDF, procura menções à DEPAF / Polícia Civil da
 * Bahia e grava os achados em docs/data/matches.json (sem banco de dados —
 * o próprio arquivo, versionado no git, é o "banco").
 *
 * Pensado pra rodar todo dia via GitHub Actions (ver .github/workflows/scrape.yml),
 * que depois comita o arquivo atualizado de volta no repositório. O
 * GitHub Pages serve docs/ como site estático, então o painel (docs/index.html)
 * só precisa ler esse JSON — sem servidor rodando o tempo todo.
 *
 * A lógica de extração (lib/extract.js) já foi testada contra uma edição
 * real (22/08/2026) e encontrou corretamente, entre outras, a própria
 * nomeação da Cíntia para a DEPAF publicada naquele dia.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const { findMatchesInEdition } = require('./lib/extract');

const BASE_URL = process.env.DOE_BASE_URL || 'https://dool.egba.ba.gov.br/';
const DEPAF_TERMS = (process.env.DEPAF_TERMS || 'DEPAF|Departamento de Planejamento, Administração e Finanças')
  .split('|').map((t) => t.trim()).filter(Boolean);
const AMPLO_TERMS = (process.env.AMPLO_TERMS || 'Polícia Civil da Bahia')
  .split('|').map((t) => t.trim()).filter(Boolean);

const DATA_DIR = path.join(__dirname, 'docs', 'data');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const EDITIONS_FILE = path.join(DATA_DIR, 'processed-editions.json');

const IS_PROBE = process.argv.includes('--probe');
const ID_OVERRIDE = (process.argv.find((a) => a.startsWith('--id=')) || '').split('=')[1];

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/pdf,application/xhtml+xml,*/*',
};

// Link de uma edição no portal DOOL/EGBA sempre segue o padrão
// /ver-html/<id>/, /ver-pdf/<id>/ ou /ver-flip/<id>/.
const EDITION_LINK_RE = /ver-(html|pdf|flip)\/(\d+)/i;

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

function editionUrl(id, kind = 'pdf') {
  return `${BASE_URL.replace(/\/$/, '')}/ver-${kind}/${id}/`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function hashSnippet(snippet) {
  return crypto.createHash('sha256').update(snippet).digest('hex');
}

async function discoverLatestEditionId() {
  const res = await axios.get(BASE_URL, { headers: HTTP_HEADERS, timeout: 20000 });
  const $ = cheerio.load(res.data);
  let found = null;
  $('a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href') || '';
    const m = href.match(EDITION_LINK_RE);
    if (m) found = m[2];
  });
  return { id: found, homepageHtml: res.data };
}

async function downloadEditionText(id) {
  const url = editionUrl(id, 'pdf');
  const res = await axios.get(url, { headers: HTTP_HEADERS, timeout: 30000, responseType: 'arraybuffer' });
  const parsed = await pdfParse(Buffer.from(res.data));
  return { text: parsed.text, pageCount: parsed.numpages, url };
}

/** Roda a extração/classificação e marca cada achado como "DEPAF" (específico) ou só "amplo". */
function findAllMatches(text) {
  const depaf = findMatchesInEdition(text, DEPAF_TERMS).map((m) => ({ ...m, isDepafMention: true }));
  const amplo = findMatchesInEdition(text, AMPLO_TERMS).map((m) => ({ ...m, isDepafMention: false }));
  const seen = new Map();
  for (const m of [...depaf, ...amplo]) {
    const key = m.materiaId + '|' + hashSnippet(m.snippet);
    const prev = seen.get(key);
    if (!prev || (m.isDepafMention && !prev.isDepafMention)) seen.set(key, m);
  }
  return [...seen.values()];
}

async function runProbe() {
  log('Modo sondagem — não grava nada.');
  let id = ID_OVERRIDE;

  if (!id) {
    log('Procurando o link da edição mais recente em', BASE_URL);
    try {
      const disc = await discoverLatestEditionId();
      fs.writeFileSync('/tmp/doe-homepage.html', disc.homepageHtml);
      if (!disc.id) {
        log('Não achei nenhum link de edição na página inicial (salvei o HTML em /tmp/doe-homepage.html pra investigar).');
        log('Roda de novo passando o id manualmente, tipo: node scraper.js --probe --id=22422');
        return;
      }
      id = disc.id;
      log('Achei o id da edição mais recente:', id);
    } catch (err) {
      log('Não consegui abrir a página inicial:', err.message);
      return;
    }
  }

  log('Baixando e extraindo o PDF da edição', id, '...');
  const { text, pageCount, url } = await downloadEditionText(id);
  fs.writeFileSync('/tmp/doe-ultima-edicao.txt', text);
  log(`PDF de ${url} tem ${pageCount} página(s), ${text.length} caracteres extraídos (salvo em /tmp/doe-ultima-edicao.txt).`);

  const matches = findAllMatches(text);
  const depafCount = matches.filter((m) => m.isDepafMention).length;
  log(`Encontrei ${matches.length} publicação(ões) no total (${depafCount} mencionando "DEPAF" diretamente).`);
  matches.forEach((m, i) =>
    log(`  [${i}] ${m.isDepafMention ? 'DEPAF' : 'PC/BA'} | ${m.movementType} | pág.${m.page} | ${m.snippet.replace(/\n/g, ' ').slice(0, 100)}...`)
  );
}

async function runOnce() {
  let id = ID_OVERRIDE;
  if (!id) {
    const disc = await discoverLatestEditionId();
    if (!disc.id) {
      log('Nenhum link de edição encontrado na página inicial. Rode "npm run probe" pra investigar.');
      process.exitCode = 0;
      return;
    }
    id = disc.id;
  }

  const processedEditions = readJson(EDITIONS_FILE, []);
  if (processedEditions.includes(id)) {
    log(`Edição ${id} já processada antes. Nada a fazer.`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let text, url;
  try {
    const downloaded = await downloadEditionText(id);
    text = downloaded.text;
    url = downloaded.url;
  } catch (err) {
    log('Erro baixando/extraindo a edição:', err.message);
    // não marca como processada — tenta de novo na próxima rodada
    return;
  }

  const found = findAllMatches(text);
  log(`Edição ${id}: ${found.length} publicação(ões) relevante(s) encontrada(s).`);

  const existingMatches = readJson(MATCHES_FILE, []);
  const existingIds = new Set(existingMatches.map((m) => m.id));

  for (const m of found) {
    const matchId = m.materiaId + '-' + hashSnippet(m.snippet).slice(0, 12);
    if (existingIds.has(matchId)) continue;
    existingMatches.push({
      id: matchId,
      editionId: id,
      editionDate: today,
      matchedTerm: m.matchedTerm,
      movementType: m.movementType,
      isDepafMention: m.isDepafMention,
      materiaId: m.materiaId,
      page: m.page,
      snippet: m.snippet,
      sourceUrl: url,
    });
  }

  existingMatches.sort((a, b) => (a.editionDate < b.editionDate ? 1 : -1));
  writeJson(MATCHES_FILE, existingMatches);

  processedEditions.push(id);
  writeJson(EDITIONS_FILE, processedEditions);

  log(`Gravado. Total acumulado: ${existingMatches.length} publicação(ões) em ${MATCHES_FILE}.`);
}

async function main() {
  if (IS_PROBE) {
    await runProbe();
    return;
  }
  await runOnce();
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
