'use strict';

/**
 * pagina.js — descobre em que página(s) do Diário cada publicação saiu.
 *
 * Por que isso existe: o sumário traz um atributo `pagina`, mas ele não é
 * confiável. Em algumas edições vem vazio em todas as matérias; quando vem
 * preenchido, erra em 7,7% dos casos (medido em 897 páginas, 75 edições).
 * E sem a página não dá pra oferecer o PDF avulso, que é o que serve de prova
 * pra anexar ao processo no SEI.
 *
 * COMO LOCALIZA
 *
 * Comparando o texto, com tudo que não é letra ou número apagado dos dois
 * lados. A extração do PDF embaralha o espaçamento — "92104270RAMIRIS CESAR
 * SOUZA MORAES24.08.2025" — então comparar texto normal falha. Apagando
 * espaços e pontuação, os dois lados viram a mesma sequência e a comparação
 * volta a funcionar.
 *
 * Uma versão anterior localizava pelo número do ato. Parecia mais barato e
 * deu errado de duas formas: números curtos como "02/2026" parecem data e
 * casam por acaso em qualquer página — foi assim que a portaria 247 foi dada
 * como conferida estando incompleta; e publicações sem número de ato
 * (acordos de cooperação, avisos de licitação, atos de decreto em lote)
 * ficavam de fora, 383 delas.
 *
 * PRIMEIRA E ÚLTIMA PÁGINA
 *
 * Uma publicação pode atravessar a virada da página. Por isso procuram-se a
 * ÂNCORA DE INÍCIO e a ÂNCORA DE FIM separadamente: só com as duas é que se
 * sabe onde o documento começa e onde termina. Achar só o começo não basta —
 * foi o que fez o painel oferecer uma portaria pela metade.
 *
 * O QUE NÃO SE SABE, NÃO SE OFERECE
 *
 * Se qualquer uma das duas âncoras não for encontrada, a publicação fica sem
 * página e sem botão. Melhor não oferecer nada do que induzir alguém a
 * anexar a página errada — ou só metade do documento — a um processo.
 */

const https = require('https');
const pdfParse = require('pdf-parse');

// Mesmo motivo de lib/dool.js: o servidor do Diário não manda a cadeia
// completa do certificado e o Node, diferente do navegador, não contorna.
const AGENTE = new https.Agent({ rejectUnauthorized: false });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Teto de segurança. Conta páginas SEGUIDAS SEM ACHAR NADA, não o total lido:
// o palpite inicial pode cair longe, e parar logo depois de encontrar a seção
// é o pior dos mundos — gastou a banda e não resolveu.
const MAX_SEM_ACHAR = Number(process.env.MAX_PAGINAS_VARRIDAS || 25);

// Tamanho da âncora, em caracteres já "crus". 110 é longo o bastante pra ser
// único dentro de uma edição e curto o bastante pra caber numa página.
const ANCORA = 110;

// Abaixo disso o texto é curto demais pra gerar duas âncoras que não se
// confundam com outra publicação parecida.
const MIN_TEXTO = 260;

function baixar(url) {
  return new Promise((ok, erro) => {
    const req = https.get(url, { agent: AGENTE, headers: { 'User-Agent': UA } }, (res) => {
      const pedacos = [];
      res.on('data', (c) => pedacos.push(c));
      res.on('end', () => ok({ status: res.statusCode, buf: Buffer.concat(pedacos) }));
    });
    req.on('error', erro);
    req.setTimeout(30000, () => req.destroy(new Error('tempo esgotado')));
  });
}

/**
 * Apaga acentos, caixa e tudo que não for letra ou número. É o que permite
 * comparar o texto da publicação com o texto extraído do PDF, que vem com o
 * espaçamento destruído.
 */
function cru(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** As duas âncoras de uma publicação, ou null se o texto for curto demais. */
function ancoras(texto) {
  const limpo = String(texto || '').replace(/…\s*$/, '');
  const c = cru(limpo);
  if (c.length < MIN_TEXTO) return null;
  return { inicio: c.slice(0, ANCORA), fim: c.slice(-ANCORA) };
}

/** Ordem de visita: começa no palpite e vai abrindo pros dois lados. */
function ordemDeBusca(palpite, total) {
  const ordem = [];
  const visto = new Set();
  const inicio = Math.min(Math.max(1, palpite), total);
  for (let d = 0; d < total; d++) {
    for (const p of [inicio - d, inicio + d]) {
      if (p >= 1 && p <= total && !visto.has(p)) {
        visto.add(p);
        ordem.push(p);
      }
    }
    if (ordem.length >= total) break;
  }
  return ordem;
}

/**
 * Localiza cada publicação e grava `page`, `pageFim` e `paginaConferida`.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string|number} opts.edicaoId
 * @param {number} opts.totalPaginas
 * @param {object[]} opts.publicacoes  alterados no lugar. Cada um precisa de
 *   `snippet`; se tiver `textoCompleto`, é ele que vale — o snippet é cortado
 *   em 800 caracteres e não serve pra achar o fim do documento.
 * @param {number} [opts.proporcaoPalpite]
 * @param {function} [opts.log]
 */
async function conferirEDescobrir({
  baseUrl,
  edicaoId,
  totalPaginas,
  publicacoes,
  proporcaoPalpite,
  log = () => {},
}) {
  const cache = new Map();
  let paginasLidas = 0;

  async function lerPagina(p) {
    if (cache.has(p)) return cache.get(p);
    let texto = null;
    try {
      const r = await baixar(`${baseUrl}/apifront/portal/edicoes/pdf_diario/${edicaoId}/${p}`);
      if (r.status === 200 && r.buf.slice(0, 5).toString() === '%PDF-') {
        paginasLidas++;
        texto = cru((await pdfParse(r.buf)).text);
      }
    } catch (err) {
      log(`  página ${p}: ${err.message}`);
    }
    cache.set(p, texto);
    return texto;
  }

  const alvos = [];
  let semAncora = 0;
  publicacoes.forEach((pub) => {
    const base = pub.textoCompleto || pub.snippet;
    const a = ancoras(base);
    // Texto cortado e sem o original guardado: não dá pra saber onde o
    // documento termina, logo não dá pra garantir que uma página basta.
    const truncado = !pub.textoCompleto && /…\s*$/.test(String(pub.snippet || ''));
    if (!a || truncado) {
      semAncora++;
      pub.page = 0;
      pub.pageFim = 0;
      pub.paginaConferida = false;
      return;
    }
    alvos.push({ pub, inicio: a.inicio, fim: a.fim, pInicio: 0, pFim: 0 });
  });

  if (!alvos.length) {
    log(`  nenhuma publicação com texto suficiente pra localizar (${semAncora} de fora).`);
    return { confirmadas: 0, faltando: semAncora, paginasLidas: 0, proporcao: null };
  }
  if (!totalPaginas || totalPaginas < 1) {
    log('  a edição não informou quantas páginas tem; não dá pra procurar.');
    return { confirmadas: 0, faltando: alvos.length + semAncora, paginasLidas: 0, proporcao: null };
  }

  // Palpite: onde o Diário disse que estão — mesmo errando, erra perto — e na
  // falta disso a proporção das edições anteriores.
  const informadas = publicacoes.map((p) => p.page).filter((n) => n > 0);
  const palpite = informadas.length
    ? Math.round(informadas.reduce((s, n) => s + n, 0) / informadas.length)
    : proporcaoPalpite
      ? Math.round(proporcaoPalpite * totalPaginas)
      : Math.round(0.6 * totalPaginas);

  log(`  localizando ${alvos.length} publicação(ões) a partir da página ${palpite}.`);

  const paginasUteis = [];
  let semAchar = 0;

  for (const p of ordemDeBusca(palpite, totalPaginas)) {
    const pendentes = alvos.filter((a) => !a.pInicio || !a.pFim);
    if (!pendentes.length || semAchar >= MAX_SEM_ACHAR) break;

    const texto = await lerPagina(p);
    if (!texto) continue;

    let achouAqui = 0;
    for (const a of pendentes) {
      if (!a.pInicio && texto.includes(a.inicio)) {
        a.pInicio = p;
        achouAqui++;
      }
      if (!a.pFim && texto.includes(a.fim)) {
        a.pFim = p;
        achouAqui++;
      }
    }
    if (achouAqui) {
      paginasUteis.push(p);
      semAchar = 0;
    } else {
      semAchar++;
    }
  }

  let confirmadas = 0;
  let incompletas = 0;
  let multipagina = 0;
  for (const a of alvos) {
    // as duas âncoras, e o fim não pode vir antes do início
    if (a.pInicio && a.pFim && a.pFim >= a.pInicio) {
      a.pub.page = a.pInicio;
      a.pub.pageFim = a.pFim;
      a.pub.paginaConferida = true;
      confirmadas++;
      if (a.pFim > a.pInicio) multipagina++;
    } else {
      a.pub.page = 0;
      a.pub.pageFim = 0;
      a.pub.paginaConferida = false;
      incompletas++;
    }
  }

  const proporcao = paginasUteis.length
    ? paginasUteis.reduce((s, p) => s + p, 0) / paginasUteis.length / totalPaginas
    : null;

  log(
    `  confirmadas ${confirmadas} de ${alvos.length}` +
      (multipagina ? ` (${multipagina} ocupam mais de uma página)` : '') +
      `; ${paginasLidas} página(s) de PDF lida(s).`
  );
  if (incompletas) log(`  ${incompletas} não localizada(s) por inteiro: ficam sem botão.`);
  if (semAncora) log(`  ${semAncora} sem texto suficiente pra localizar: ficam sem botão.`);

  return { confirmadas, faltando: incompletas + semAncora, paginasLidas, proporcao };
}

/* ------------------------------------------------------------------------
   Dica de onde começar a procurar.

   Guardada como PROPORÇÃO (0 a 1) e não como número de página: as edições
   variam muito de tamanho e a seção da Polícia Civil anda junto. É só o
   palpite inicial — se estiver errado, a busca abre pros lados e acha do
   mesmo jeito, só lendo mais páginas.
   ------------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const ARQUIVO_DICA = path.join(__dirname, '..', 'docs', 'data', 'dica-pagina.json');

function lerProporcao() {
  try {
    const v = Number(JSON.parse(fs.readFileSync(ARQUIVO_DICA, 'utf8')).proporcao);
    return v > 0 && v <= 1 ? v : null;
  } catch {
    return null;
  }
}

function salvarProporcao(proporcao) {
  if (!(proporcao > 0 && proporcao <= 1)) return;
  try {
    // média com o valor antigo, pra uma edição fora do padrão não jogar o
    // palpite pra longe de vez
    const antiga = lerProporcao();
    const nova = antiga ? (antiga + proporcao) / 2 : proporcao;
    fs.mkdirSync(path.dirname(ARQUIVO_DICA), { recursive: true });
    fs.writeFileSync(
      ARQUIVO_DICA,
      JSON.stringify({ proporcao: Number(nova.toFixed(4)), atualizadoEm: new Date().toISOString() }, null, 2) + '\n'
    );
  } catch {
    // dica é otimização, não dado: se não der pra gravar, tudo bem
  }
}

module.exports = { conferirEDescobrir, ancoras, cru, ordemDeBusca, lerProporcao, salvarProporcao };
