'use strict';

/**
 * descobrir-paginas.js — preenche a página das publicações que já estão
 * gravadas sem ela, procurando cada uma dentro do PDF da edição.
 *
 * Serve pro histórico. Nas edições novas isso já roda sozinho, dentro do
 * scraper (ver lib/dool.js). Aqui é pra recuperar o que ficou pra trás nos
 * dias em que o Diário publicou o sumário sem o número da página.
 *
 * Não rebaixa nada do Diário: usa o texto que já está no matches.json pra
 * montar a impressão digital, e só baixa os PDFs das páginas.
 *
 * Uso:
 *   node tools/descobrir-paginas.js                          (todas as edições pendentes)
 *   node tools/descobrir-paginas.js --de=2026-09-01          (a partir dessa data)
 *   node tools/descobrir-paginas.js --de=2026-09-22 --ate=2026-09-22
 *   node tools/descobrir-paginas.js --de=2026-09-22 --simular (não grava)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { BASE_URL, getEdicaoParaData, sleep } = require('../lib/dool');
const { descobrirPaginas, lerProporcao, salvarProporcao } = require('../lib/pagina');

const MATCHES_FILE = path.join(__dirname, '..', 'docs', 'data', 'matches.json');
const SIMULAR = process.argv.includes('--simular');

function arg(nome) {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=').slice(1).join('=') : null;
}

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

async function main() {
  const de = arg('de');
  const ate = arg('ate');

  const dados = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  const semPagina = dados.filter(
    (m) => !(m.page > 0) && (!de || m.editionDate >= de) && (!ate || m.editionDate <= ate)
  );

  if (!semPagina.length) {
    log('Nenhuma publicação sem página no período. Nada a fazer.');
    return;
  }

  // Agrupa por edição: uma varredura resolve todas as publicações daquele dia.
  // Entram TODAS as publicações da edição, não só as sem página: as que já têm
  // são o melhor palpite de onde procurar as outras.
  const edicoesPendentes = new Set(semPagina.map((m) => m.editionId));
  const porEdicao = new Map();
  for (const m of dados) {
    if (!edicoesPendentes.has(m.editionId)) continue;
    if (!porEdicao.has(m.editionId)) porEdicao.set(m.editionId, { data: m.editionDate, itens: [] });
    porEdicao.get(m.editionId).itens.push(m);
  }

  const edicoes = [...porEdicao.entries()].sort((a, b) => (a[1].data < b[1].data ? 1 : -1));
  log(`${semPagina.length} publicação(ões) sem página, em ${edicoes.length} edição(ões).`);
  if (SIMULAR) log('(modo simulação — nada será gravado)');

  let totalAchadas = 0;
  let totalPaginasLidas = 0;

  for (const [edicaoId, info] of edicoes) {
    let edicaoInfo;
    try {
      edicaoInfo = await getEdicaoParaData(info.data);
    } catch (err) {
      log(`${info.data}: não consegui perguntar ao site (${err.message}), pulando.`);
      continue;
    }
    if (!edicaoInfo || String(edicaoInfo.id) !== String(edicaoId)) {
      log(`${info.data}: a edição ${edicaoId} não confere com a do site, pulando por segurança.`);
      continue;
    }

    const faltam = info.itens.filter((m) => !(m.page > 0)).length;
    log(`${info.data} (edição ${edicaoId}, ${edicaoInfo.paginas} páginas): ${faltam} sem página de ${info.itens.length}.`);
    const r = await descobrirPaginas({
      baseUrl: BASE_URL,
      edicaoId,
      totalPaginas: edicaoInfo.paginas,
      publicacoes: info.itens, // mexe nos objetos do próprio matches.json
      proporcaoPalpite: lerProporcao(),
      log,
    });
    if (r.proporcao) salvarProporcao(r.proporcao);
    totalAchadas += r.achadas;
    totalPaginasLidas += r.paginasLidas;

    // grava a cada edição concluída: uma interrupção no meio não perde o
    // trabalho já feito
    if (!SIMULAR && r.achadas) {
      fs.writeFileSync(MATCHES_FILE, JSON.stringify(dados, null, 2) + '\n');
    }
    await sleep(500);
  }

  log('----------------------------------------------------------------');
  log(`Terminado. Localizadas ${totalAchadas} de ${semPagina.length}, lendo ${totalPaginasLidas} página(s) de PDF.`);
  const aindaSem = dados.filter((m) => !(m.page > 0)).length;
  log(`Ainda sem página no arquivo inteiro: ${aindaSem} de ${dados.length}.`);
  if (SIMULAR) log('(simulação — nada foi gravado)');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
