'use strict';

/**
 * Camada de rede: fala com o site do Diário (portal DOOL/EGBA) usando os
 * mesmos endereços que o próprio site chama por dentro (achados inspecionando
 * o JavaScript dele em 25/08/2026 — ver lib/portal.js pra lógica de
 * extração, sem rede, que também foi testada contra dados reais).
 */

const https = require('https');
const axios = require('axios');
const {
  coletarMateriasRelevantes,
  extrairTextoConteudo,
  avaliarConteudo,
  dividirAtosDecreto,
  atoRelevante,
} = require('./portal');

// O servidor do Diário não manda a cadeia completa do certificado de
// segurança (navegadores contornam isso sozinhos, o Node não). Como aqui só
// se baixa conteúdo público do Diário Oficial, desligamos a checagem só
// pra esse download.
const HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

const BASE_URL = (process.env.DOE_BASE_URL || 'https://dool.egba.ba.gov.br/').replace(/\/$/, '');
const DEPAF_TERMS = (process.env.DEPAF_TERMS || 'DEPAF|Departamento de Planejamento, Administração e Finanças')
  .split('|').map((t) => t.trim()).filter(Boolean);
// Termos usados pra decidir quais PASTAS do sumário (organizado por órgão)
// valem a pena abrir. Mais amplo de propósito — "Polícia Civil" sozinho já
// cobre "Polícia Civil da Bahia", "Polícia Civil da Bahia - PC/BA" etc.
const FOLDER_TERMS = (process.env.AMPLO_TERMS || 'Polícia Civil|DEPAF')
  .split('|').map((t) => t.trim()).filter(Boolean);

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/json,*/*',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rodando no GitHub Actions o servidor do Diário costuma responder bem mais
// devagar (às vezes nem responde de primeira) do que rodando de casa — os
// runners do GitHub saem por IPs de datacenter, que muitos sites de governo
// atrasam ou limitam de propósito. Por isso: timeout maior + até 3 tentativas
// com espera crescente antes de desistir de verdade.
async function comTentativas(fn, tentativas = 3, esperaBaseMs = 4000) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      if (i < tentativas) await sleep(esperaBaseMs * i);
    }
  }
  throw ultimoErro;
}

async function getJSON(caminho) {
  return comTentativas(async () => {
    const res = await axios.get(`${BASE_URL}${caminho}`, {
      headers: HTTP_HEADERS,
      timeout: 45000,
      httpsAgent: HTTPS_AGENT,
    });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  });
}

async function getTexto(caminho) {
  return comTentativas(async () => {
    const res = await axios.get(`${BASE_URL}${caminho}`, {
      headers: HTTP_HEADERS,
      timeout: 45000,
      httpsAgent: HTTPS_AGENT,
    });
    return res.data;
  });
}

function dataBrParaIso(dataBr) {
  const [d, m, a] = dataBr.split('/');
  return `${a}-${m}-${d}`;
}

/** A API às vezes devolve mais de uma edição pro mesmo dia (suplemento,
 * extra); a "principal" é sempre a de menor id. */
function edicaoPrincipal(itens) {
  if (!itens || !itens.length) return null;
  const ordenados = [...itens].sort((a, b) => Number(a.id) - Number(b.id));
  const it = ordenados[0];
  return { id: String(it.id), numero: String(it.numero), data: dataBrParaIso(it.data) };
}

async function discoverLatestEdicao() {
  const data = await getJSON('/apifront/portal/edicoes/edicoes_from_data.json');
  if (data.erro) throw new Error(data.msg || 'erro desconhecido na API de edições');
  return edicaoPrincipal(data.itens);
}

/** @param {string} dataIso formato AAAA-MM-DD */
async function getEdicaoParaData(dataIso) {
  const data = await getJSON(`/apifront/portal/edicoes/edicoes_from_data/${dataIso}.json`);
  if (data.erro) throw new Error(data.msg || 'erro desconhecido na API de edições');
  return edicaoPrincipal(data.itens);
}

/**
 * Baixa o sumário da edição, filtra pra só as pastas relevantes, baixa o
 * texto de cada matéria encontrada e devolve a lista já avaliada
 * (isDepafMention, tipo de movimentação etc.), pronta pra gravar.
 */
async function processarEdicao(edicaoInfo, { log = () => {}, salvarSumario } = {}) {
  const sumarioHtml = await getTexto(`/html/${edicaoInfo.id}.html`);
  if (salvarSumario) salvarSumario(sumarioHtml);

  const candidatos = coletarMateriasRelevantes(sumarioHtml, FOLDER_TERMS);
  log(`Edição ${edicaoInfo.id} (${edicaoInfo.data}, nº ${edicaoInfo.numero}): ${candidatos.length} publicação(ões) em pastas relevantes.`);

  const resultados = [];
  for (const cand of candidatos) {
    if (!cand.identificador) continue;
    const conteudoCaminho = `/apifront/portal/edicoes/publicacoes_ver_conteudo/${cand.identificador}`;
    let conteudoHtml;
    try {
      conteudoHtml = await getTexto(conteudoCaminho);
    } catch (err) {
      log(`  matéria ${cand.identificador}: erro ao baixar o conteúdo (${err.message}), pulando.`);
      await sleep(400);
      continue;
    }

    if (cand.loteDecreto) {
      // Decreto em lote (DECRETOS NUMERADOS/SIMPLES): um documento só com
      // atos de várias secretarias — separa por ato e mantém só os que
      // falam de Polícia Civil/DEPAF.
      const atos = dividirAtosDecreto(conteudoHtml);
      let achadosNoLote = 0;
      atos.forEach((atoTexto, i) => {
        if (!atoRelevante(atoTexto, FOLDER_TERMS)) return;
        achadosNoLote++;
        const avaliacao = avaliarConteudo(atoTexto, DEPAF_TERMS);
        resultados.push({
          materiaId: `${cand.identificador}-${i}`,
          page: cand.pagina,
          caminho: cand.caminho,
          matchedTerm: avaliacao.matchedTerm,
          movementType: avaliacao.movementType,
          assunto: avaliacao.assunto,
          motivo: avaliacao.motivo,
          isDepafMention: avaliacao.isDepafMention,
          snippet: atoTexto.length > 800 ? atoTexto.slice(0, 800) + '…' : atoTexto,
          sourceUrl: `${BASE_URL}${conteudoCaminho}`,
        });
      });
      log(`  ${cand.titulo || cand.identificador} (decreto em lote): ${atos.length} ato(s) no total, ${achadosNoLote} sobre Polícia Civil/DEPAF.`);
    } else {
      const texto = extrairTextoConteudo(conteudoHtml);
      const avaliacao = avaliarConteudo(texto, DEPAF_TERMS);
      resultados.push({
        materiaId: cand.identificador,
        page: cand.pagina,
        caminho: cand.caminho,
        matchedTerm: avaliacao.matchedTerm,
        movementType: avaliacao.movementType,
        assunto: avaliacao.assunto,
        motivo: avaliacao.motivo,
        isDepafMention: avaliacao.isDepafMention,
        snippet: texto.length > 800 ? texto.slice(0, 800) + '…' : texto,
        sourceUrl: `${BASE_URL}${conteudoCaminho}`,
      });
    }
    await sleep(400);
  }
  return resultados;
}

module.exports = {
  BASE_URL,
  discoverLatestEdicao,
  getEdicaoParaData,
  processarEdicao,
  sleep,
};
