'use strict';

/**
 * scraper.js — busca a edição mais recente do Diário Oficial do Estado da
 * Bahia (portal DOOL/EGBA), localiza — dentro do sumário oficial da edição,
 * que já vem organizado por órgão — as publicações arquivadas sob "Polícia
 * Civil" / "DEPAF", baixa o texto de cada uma e grava os achados em
 * docs/data/matches.json (sem banco de dados — o próprio arquivo,
 * versionado no git, é o "banco").
 *
 * Reescrito em 25/08/2026: a versão original baixava o PDF da edição inteira
 * e tentava separar as publicações com marcadores que nunca tinham sido
 * conferidos contra um PDF real. Essa versão usa os mesmos endereços que o
 * próprio site chama por dentro (ver lib/dool.js e lib/portal.js), achados
 * inspecionando o JavaScript do site com a ajuda da Cíntia.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { discoverLatestEdicao, getEdicaoParaData, processarEdicao } = require('./lib/dool');

const DATA_DIR = path.join(__dirname, 'docs', 'data');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const EDITIONS_FILE = path.join(DATA_DIR, 'processed-editions.json');

// Pasta pra guardar os arquivos de diagnóstico do modo sondagem (--probe).
// Fica dentro do próprio projeto (não em /tmp, que no Windows não existe
// do jeito que uma versão antiga deste arquivo assumia).
const DIAG_DIR = path.join(__dirname, 'diagnostico');

const IS_PROBE = process.argv.includes('--probe');
const ID_OVERRIDE = (process.argv.find((a) => a.startsWith('--id=')) || '').split('=')[1];
const DATA_OVERRIDE = (process.argv.find((a) => a.startsWith('--data=')) || '').split('=')[1]; // AAAA-MM-DD

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
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

/** Decide qual edição buscar: --id= manual, --data= manual, ou a mais recente. */
async function resolverEdicaoAlvo() {
  if (ID_OVERRIDE) {
    return { id: ID_OVERRIDE, numero: ID_OVERRIDE, data: DATA_OVERRIDE || new Date().toISOString().slice(0, 10) };
  }
  if (DATA_OVERRIDE) return getEdicaoParaData(DATA_OVERRIDE);
  return discoverLatestEdicao();
}

async function runProbe() {
  log('Modo sondagem — não grava nada.');
  let edicaoInfo;
  try {
    edicaoInfo = await resolverEdicaoAlvo();
  } catch (err) {
    log('Erro descobrindo a edição:', err.message);
    return;
  }
  if (!edicaoInfo) {
    log('Não achei nenhuma edição pra essa data/id.');
    return;
  }

  fs.mkdirSync(DIAG_DIR, { recursive: true });
  const resultados = await processarEdicao(edicaoInfo, {
    log,
    salvarSumario: (html) => fs.writeFileSync(path.join(DIAG_DIR, `sumario-${edicaoInfo.id}.html`), html),
  });

  const depafCount = resultados.filter((m) => m.isDepafMention).length;
  log(`Encontrei ${resultados.length} publicação(ões) no total (${depafCount} mencionando "DEPAF" diretamente).`);
  resultados.forEach((m, i) =>
    log(`  [${i}] ${m.isDepafMention ? 'DEPAF' : 'PC/BA'} | ${m.movementType} | pág.${m.page} | ${m.snippet.replace(/\n/g, ' ').slice(0, 100)}...`)
  );

  const resultadoFile = path.join(DIAG_DIR, `resultado-${edicaoInfo.id}.json`);
  fs.writeFileSync(resultadoFile, JSON.stringify(resultados, null, 2));
  log(`Detalhe completo salvo em ${resultadoFile}`);
}

async function runOnce() {
  let edicaoInfo;
  try {
    edicaoInfo = await resolverEdicaoAlvo();
  } catch (err) {
    log('Erro descobrindo a edição:', err.message);
    return;
  }
  if (!edicaoInfo) {
    log('Nenhuma edição encontrada. Rode "node scraper.js --probe" pra investigar.');
    return;
  }

  const processedEditions = readJson(EDITIONS_FILE, []);
  if (processedEditions.includes(edicaoInfo.id)) {
    log(`Edição ${edicaoInfo.id} já processada antes. Nada a fazer.`);
    return;
  }

  let resultados;
  try {
    resultados = await processarEdicao(edicaoInfo, { log });
  } catch (err) {
    log('Erro processando a edição:', err.message);
    // não marca como processada — tenta de novo na próxima rodada
    return;
  }

  const existingMatches = readJson(MATCHES_FILE, []);
  const existingIds = new Set(existingMatches.map((m) => m.id));

  for (const m of resultados) {
    const matchId = String(m.materiaId);
    if (existingIds.has(matchId)) continue;
    existingIds.add(matchId);
    existingMatches.push({
      id: matchId,
      editionId: edicaoInfo.id,
      editionNumero: edicaoInfo.numero,
      editionDate: edicaoInfo.data,
      matchedTerm: m.matchedTerm,
      movementType: m.movementType,
      assunto: m.assunto,
      motivo: m.motivo,
      isDepafMention: m.isDepafMention,
      materiaId: m.materiaId,
      page: m.page,
      snippet: m.snippet,
      sourceUrl: m.sourceUrl,
    });
  }

  existingMatches.sort((a, b) => (a.editionDate < b.editionDate ? 1 : -1));
  writeJson(MATCHES_FILE, existingMatches);

  processedEditions.push(edicaoInfo.id);
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