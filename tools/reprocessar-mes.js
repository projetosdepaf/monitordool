'use strict';

/**
 * reprocessar-mes.js — refaz um período de datas do zero, mesmo que já
 * tenha sido processado antes, usando a extração mais atual (a que também
 * abre os decretos em lote). Diferente do backfill.js normal (que pula
 * dias já processados), este APAGA os resultados antigos de cada edição
 * do período e busca tudo de novo.
 *
 * Uso:
 *   node tools/reprocessar-mes.js --de=2026-08-01 --ate=2026-08-25
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
    log('Uso: node tools/reprocessar-mes.js --de=2026-08-01 --ate=2026-08-25');
    process.exitCode = 1;
    return;
  }

  log(`Reprocessando do zero: ${de} até ${ate} (ignora o que já foi processado antes).`);

  let processedEditions = readJson(EDITIONS_FILE, []);
  let existingMatches = readJson(MATCHES_FILE, []);

  let diasComEdicao = 0;
  let diasSemEdicao = 0;
  let totalAchados = 0;
  let totalRemovidos = 0;

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

    // Guarda o que vai ser apagado: se a edição falhar no meio do caminho,
    // as publicações antigas voltam. Sem isso, uma queda de conexão apagava
    // silenciosamente a edição inteira na próxima gravação.
    const antigasDaEdicao = existingMatches.filter((m) => m.editionId === edicaoInfo.id);
    existingMatches = existingMatches.filter((m) => m.editionId !== edicaoInfo.id);
    const removidos = antigasDaEdicao.length;
    totalRemovidos += removidos;
    processedEditions = processedEditions.filter((id) => id !== edicaoInfo.id);
    if (removidos) log(`${dataIso}: removidas ${removidos} publicação(ões) antiga(s) da edição ${edicaoInfo.id}.`);

    let resultados;
    try {
      resultados = await processarEdicao(edicaoInfo, { log });
    } catch (err) {
      log(`${dataIso}: erro processando a edição ${edicaoInfo.id} (${err.message}), devolvendo as ${removidos} publicação(ões) antiga(s) e seguindo.`);
      existingMatches = existingMatches.concat(antigasDaEdicao);
      totalRemovidos -= removidos;
      continue;
    }

    totalAchados += resultados.length;

    for (const m of resultados) {
      existingMatches.push({
        id: String(m.materiaId),
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

  log('----------------------------------------------------------------');
  log(`Terminado. Dias com edição: ${diasComEdicao} | dias sem edição: ${diasSemEdicao} | publicações antigas removidas: ${totalRemovidos} | publicações encontradas agora: ${totalAchados}.`);
  log(`Total acumulado em ${MATCHES_FILE}: ${existingMatches.length} publicação(ões).`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});