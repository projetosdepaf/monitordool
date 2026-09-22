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
const axios = require('axios');
const https = require('https');
const { BASE_URL, getEdicaoParaData, sleep } = require('../lib/dool');
const { extrairTextoConteudo } = require('../lib/portal');
const { conferirEDescobrir, lerProporcao, salvarProporcao } = require('../lib/pagina');

const AGENTE = new https.Agent({ rejectUnauthorized: false });

const MATCHES_FILE = path.join(__dirname, '..', 'docs', 'data', 'matches.json');
const SIMULAR = process.argv.includes('--simular');

function arg(nome) {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=').slice(1).join('=') : null;
}

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

/**
 * O matches.json guarda o texto cortado em 800 caracteres. Isso basta pra
 * achar onde a publicação começa, mas não onde ela termina — e sem o fim não
 * dá pra saber se ela atravessa a virada da página. Então, só para as
 * cortadas, busca o texto original de novo no Diário.
 *
 * Atos vindos de decreto em lote ficam de fora: o endereço devolve o decreto
 * inteiro, não o ato, e esse texto não serviria de âncora.
 */
async function buscarTextoCompleto(m) {
  const cortado = /…\s*$/.test(String(m.snippet || ''));
  if (!cortado) return null;
  if (String(m.materiaId).includes('-')) return null;
  try {
    const res = await axios.get(m.sourceUrl, {
      timeout: 45000,
      httpsAgent: AGENTE,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' },
    });
    const texto = extrairTextoConteudo(res.data);
    return texto && texto.length > 200 ? texto : null;
  } catch {
    return null;
  }
}

async function main() {
  const de = arg('de');
  const ate = arg('ate');

  const dados = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  // Pendente não é só quem está sem página: quem tem página vinda do sumário e
  // ainda não foi conferida também entra, porque o sumário erra (ver lib/pagina.js).
  const semPagina = dados.filter(
    (m) => !m.paginaConferida && (!de || m.editionDate >= de) && (!ate || m.editionDate <= ate)
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

    const faltam = info.itens.filter((m) => !m.paginaConferida).length;
    log(`${info.data} (edição ${edicaoId}, ${edicaoInfo.paginas} páginas): ${faltam} a conferir de ${info.itens.length}.`);

    // recupera o texto inteiro das cortadas, pra poder achar o fim do documento
    let recuperados = 0;
    for (const m of info.itens) {
      if (m.paginaConferida) continue;
      const completo = await buscarTextoCompleto(m);
      if (completo) {
        m.textoCompleto = completo;
        recuperados++;
        await sleep(300);
      }
    }
    if (recuperados) log(`  ${recuperados} texto(s) cortado(s) recuperado(s) por inteiro.`);
    const r = await conferirEDescobrir({
      baseUrl: BASE_URL,
      edicaoId,
      totalPaginas: edicaoInfo.paginas,
      publicacoes: info.itens, // mexe nos objetos do próprio matches.json
      proporcaoPalpite: lerProporcao(),
      log,
    });
    if (r.proporcao) salvarProporcao(r.proporcao);
    totalAchadas += r.confirmadas;
    totalPaginasLidas += r.paginasLidas;

    // grava a cada edição concluída: uma interrupção no meio não perde o
    // trabalho já feito
    for (const m of info.itens) delete m.textoCompleto; // campo de trabalho
    if (!SIMULAR) {
      fs.writeFileSync(MATCHES_FILE, JSON.stringify(dados, null, 2) + '\n');
    }
    await sleep(500);
  }

  log('----------------------------------------------------------------');
  log(`Terminado. Localizadas ${totalAchadas}, lendo ${totalPaginasLidas} página(s) de PDF.`);
  const conferidas = dados.filter((m) => m.paginaConferida && m.page > 0).length;
  log(`Páginas conferidas no arquivo inteiro: ${conferidas} de ${dados.length}.`);
  if (SIMULAR) log('(simulação — nada foi gravado)');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
