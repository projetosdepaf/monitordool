'use strict';

/**
 * backfill.js — preenche o histórico pra um período de datas, edição por
 * edição, perguntando direto pro site "qual foi a edição desse dia?" (ver
 * lib/dool.js). Bem mais simples que a primeira versão deste arquivo, que
 * tentava adivinhar o id da edição caminhando pra trás — não precisa mais
 * disso agora que a gente descobriu o endereço certo pra buscar por data.
 *
 * Uso:
 *   node tools/backfill.js --de=2026-08-01 --ate=2026-08-24
 *
 * Opcional:
 *   --sondagem   não grava nada — só mostra no log o que encontraria
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getEdicaoParaData, processarEdicao } = require('../lib/dool');

const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const EDITIONS_FILE = path.join(DATA_DIR, 'processed-editions.json');

function arg(name, fallback) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
}
const IS_SONDAGEM = process.argv.includes('--sondagem');

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

function* datasNoIntervalo(deIso, ateIso) {
  const de = new Date(deIso + 'T00:00:00Z');
  const ate = new Date(ateIso + 'T00:00:00Z');
  for (let d = de; d <= ate; d = new Date(d.getTime() + 86400000)) {
    yield d.toISOString().slice(0, 10);
  }
}

async function main() {
  const de = arg('de');
  const ate = arg('ate');
  if (!de || !ate) {
    log('Uso: node tools/backfill.js --de=2026-08-01 --ate=2026-08-24 [--sondagem]');
    process.exitCode = 1;
    return;
  }

  log(`Período pedido: ${de} até ${ate}.${IS_SONDAGEM ? ' (modo SONDAGEM — não grava nada)' : ''}`);

  const processedEditions = readJson(EDITIONS_FILE, []);
  const existingMatches = readJson(MATCHES_FILE, []);
  const existingIds = new Set(existingMatches.map((m) => m.id));

  let diasComEdicao = 0;
  let diasSemEdicao = 0;
  let totalAchados = 0;

  for (const dataIso of datasNoIntervalo(de, ate)) {
    let edicaoInfo;
    try {
      edicaoInfo = await getEdicaoParaData(dataIso);
    } catch (err) {
      log(`${dataIso}: erro perguntando pro site (${err.message}), pulando.`);
      continue;
    }
    if (!edicaoInfo) {
      diasSemEdicao++;
      log(`${dataIso}: sem edição (fim de semana/feriado, provavelmente).`);
      continue;
    }
    diasComEdicao++;

    if (processedEditions.includes(edicaoInfo.id)) {
      log(`${dataIso}: edição ${edicaoInfo.id} já processada antes, pulando.`);
      continue;
    }

    let resultados;
    try {
      resultados = await processarEdicao(edicaoInfo, { log });
    } catch (err) {
      log(`${dataIso}: erro processando a edição ${edicaoInfo.id} (${err.message}), pulando.`);
      continue;
    }

    totalAchados += resultados.length;

    if (!IS_SONDAGEM) {
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
    }
  }

  log('----------------------------------------------------------------');
  log(`Terminado. Dias com edição: ${diasComEdicao} | dias sem edição: ${diasSemEdicao} | publicações encontradas: ${totalAchados}.`);
  if (IS_SONDAGEM) {
    log('Isso foi sondagem — nada foi gravado. Roda sem --sondagem pra gravar de verdade.');
  } else {
    log(`Total acumulado em ${MATCHES_FILE}: ${existingMatches.length} publicação(ões).`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});