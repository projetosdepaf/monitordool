'use strict';

/**
 * pagina.js — descobre em que página do Diário cada publicação saiu, quando o
 * sumário não informa.
 *
 * O sumário traz um atributo `pagina` em cada matéria, mas o Diário preenche
 * isso de forma tudo-ou-nada: em algumas edições vem em todas as matérias, em
 * outras em nenhuma (conferido em 22/09/2026: 708 de 710 vazias). Sem a
 * página não dá pra montar o link do PDF avulso, que é o que serve de prova
 * pra anexar ao SEI.
 *
 * Como funciona: baixa o PDF de páginas avulsas — /apifront/portal/edicoes/
 * pdf_diario/<edicao>/<pagina>, que é público e devolve UMA página — extrai o
 * texto e procura a "impressão digital" de cada publicação.
 *
 * A impressão digital é uma sequência de dígitos, não um trecho de texto.
 * Comparar texto não funciona: a extração do PDF embaralha o espaçamento
 * ("92104270RAMIRIS CESAR SOUZA MORAES24.08.2025"), mas os dígitos ficam
 * grudados e intactos. Testado na edição 22583: 17 de 17 localizadas.
 *
 * Pra não varrer a edição inteira, a busca começa num palpite e vai abrindo
 * pros dois lados. O palpite vem da proporção onde a Polícia Civil saiu da
 * última vez — proporção, e não número de página, porque as edições variam
 * muito de tamanho. Na edição 22583, das 122 páginas, o conteúdo da PC estava
 * em 4: 85, 86, 87 e 90.
 */

const https = require('https');
const pdfParse = require('pdf-parse');

// Mesmo motivo de lib/dool.js: o servidor do Diário não manda a cadeia
// completa do certificado e o Node, diferente do navegador, não contorna.
const AGENTE = new https.Agent({ rejectUnauthorized: false });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Teto de segurança. Conta páginas SEGUIDAS SEM ACHAR NADA, não o total lido:
// o palpite inicial pode cair longe, e parar no meio do caminho logo depois de
// encontrar a seção é o pior dos mundos — gastou a banda e não resolveu.
// Enquanto estiver achando, continua; quando secar, desiste.
const MAX_SEM_ACHAR = Number(process.env.MAX_PAGINAS_VARRIDAS || 25);

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

const soDigitos = (s) => String(s).replace(/\D/g, '');

/**
 * Impressão digital: uma sequência de dígitos que identifique ESTA publicação
 * dentro da edição.
 *
 * A primeira versão pegava qualquer "Nº <número>" e errava feio: em "no uso de
 * suas atribuições e tendo em vista o disposto na Lei nº 11.370" ela extraía o
 * número da LEI, que aparece em quase toda portaria da Polícia Civil e casaria
 * com qualquer página. Em tabelas de matrícula, colava dígitos de linhas
 * diferentes e formava números que não existem em lugar nenhum.
 *
 * Agora só aceita o número do próprio ato, e só quando vem precedido do nome
 * de uma espécie de documento. Sem isso, devolve null — ficar sem página é
 * melhor que apontar pra página errada.
 */
// O número só vale se vier logo depois do nome de uma espécie de documento.
// É isso que separa "Portaria Nº 01124892" — que identifica o ato — de
// "Lei nº 11.370", que é o fundamento legal e aparece em quase toda portaria
// da Polícia Civil.
const RE_ATO =
  /(?:portaria|despacho|extrato|contrato|edital|decreto|resolu[çc][ãa]o|termo aditivo)[^.;\n]{0,40}?n[ºo°]?\s*(\d[\d.\-/]{4,})/i;

function impressaoDigital(snippet) {
  const ato = String(snippet || '').match(RE_ATO);
  if (!ato) return null;

  const d = soDigitos(ato[1]);
  // 6 a 20 dígitos: abaixo disso não é único na edição, acima é quase sempre
  // colagem de células de tabela
  if (d.length < 6 || d.length > 20) return null;
  // sequência de zeros ou de um dígito só não identifica nada
  if (/^(\d)\1*$/.test(d)) return null;
  return d;
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
 * Preenche o campo `page` das publicações que estão sem ele.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl        raiz do site do Diário
 * @param {string|number} opts.edicaoId
 * @param {number} opts.totalPaginas   quantas páginas a edição tem
 * @param {object[]} opts.publicacoes  objetos com { snippet, page } — `page` é alterado no lugar
 * @param {number} [opts.proporcaoPalpite] onde a PC saiu da última vez, de 0 a 1
 * @param {function} [opts.log]
 * @returns {Promise<{achadas:number, faltando:number, paginasLidas:number, proporcao:number|null}>}
 */
/**
 * Confere as páginas que o Diário informou e procura as que faltam.
 *
 * Duas fases, porque a página do sumário não é confiável: numa amostra de 16
 * edições, 2 apontavam pra página errada (o sumário da edição 22483 diz que o
 * termo aditivo está na 85, e não está). Link errado pra um documento que vai
 * servir de prova é pior do que link nenhum, então nada é dado como bom sem
 * conferir o conteúdo.
 *
 * Marca `paginaConferida` em cada publicação: só com isso o painel oferece o
 * PDF. Publicação sem número identificável no texto nunca é conferida — fica
 * sem o botão, de propósito.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string|number} opts.edicaoId
 * @param {number} opts.totalPaginas
 * @param {object[]} opts.publicacoes  alterados no lugar
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
  const textoDaPagina = new Map(); // cache: uma página baixada é reaproveitada
  let paginasLidas = 0;

  async function lerPagina(p) {
    if (textoDaPagina.has(p)) return textoDaPagina.get(p);
    let digitos = null;
    try {
      const r = await baixar(`${baseUrl}/apifront/portal/edicoes/pdf_diario/${edicaoId}/${p}`);
      if (r.status === 200 && r.buf.slice(0, 5).toString() === '%PDF-') {
        paginasLidas++;
        digitos = soDigitos((await pdfParse(r.buf)).text);
      }
    } catch (err) {
      log(`  página ${p}: ${err.message}`);
    }
    textoDaPagina.set(p, digitos);
    return digitos;
  }

  const comDigital = publicacoes
    .map((pub, i) => ({ i, pub, digital: impressaoDigital(pub.snippet) }))
    .filter((a) => a.digital);
  const semDigital = publicacoes.length - comDigital.length;

  // --- fase 1: conferir o que o Diário informou -------------------------
  let confirmadas = 0;
  let desmentidas = 0;
  const aProcurar = [];
  for (const a of comDigital) {
    if (a.pub.paginaConferida && a.pub.page > 0) continue; // já conferida antes
    if (!(a.pub.page > 0)) {
      aProcurar.push(a);
      continue;
    }
    const digitos = await lerPagina(a.pub.page);
    if (digitos && digitos.includes(a.digital)) {
      a.pub.paginaConferida = true;
      confirmadas++;
    } else {
      // a página informada não tem o ato: descarta e procura de verdade
      a.pub.page = 0;
      a.pub.paginaConferida = false;
      desmentidas++;
      aProcurar.push(a);
    }
  }
  if (confirmadas || desmentidas) {
    log(`  conferência: ${confirmadas} página(s) do sumário batem, ${desmentidas} não batem.`);
  }

  // --- fase 2: procurar as que ficaram sem página -----------------------
  if (!aProcurar.length) {
    return { confirmadas, desmentidas, achadas: 0, faltando: semDigital, paginasLidas, proporcao: null };
  }
  if (!totalPaginas || totalPaginas < 1) {
    log('  a edição não informou quantas páginas tem; não dá pra procurar.');
    return { confirmadas, desmentidas, achadas: 0, faltando: aProcurar.length + semDigital, paginasLidas, proporcao: null };
  }

  // Melhor palpite: onde caíram as publicações DESTA edição que já foram
  // conferidas. Elas saem juntas, na seção do órgão.
  const irmas = publicacoes.filter((x) => x.paginaConferida && x.page > 0).map((x) => x.page);
  const palpite = irmas.length
    ? Math.round(irmas.reduce((soma, n) => soma + n, 0) / irmas.length)
    : proporcaoPalpite
      ? Math.round(proporcaoPalpite * totalPaginas)
      : Math.round(0.6 * totalPaginas);
  const origem = irmas.length
    ? `média de ${irmas.length} já conferida(s)`
    : proporcaoPalpite
      ? 'proporção das edições anteriores'
      : 'chute inicial';

  log(`  procurando ${aProcurar.length} publicação(ões), a partir da página ${palpite} (${origem}).`);

  const restantes = new Map(aProcurar.map((a) => [a.i, a.digital]));
  const paginasComAchado = [];
  let semAchar = 0;

  for (const p of ordemDeBusca(palpite, totalPaginas)) {
    if (!restantes.size || semAchar >= MAX_SEM_ACHAR) break;
    const digitos = await lerPagina(p);
    if (!digitos) continue;

    let achouAqui = 0;
    for (const [i, digital] of [...restantes]) {
      if (digitos.includes(digital)) {
        publicacoes[i].page = p;
        publicacoes[i].paginaConferida = true;
        restantes.delete(i);
        achouAqui++;
      }
    }
    if (achouAqui) {
      paginasComAchado.push(p);
      semAchar = 0;
    } else {
      semAchar++;
    }
  }

  const achadas = aProcurar.length - restantes.size;
  const proporcao = paginasComAchado.length
    ? paginasComAchado.reduce((s, p) => s + p, 0) / paginasComAchado.length / totalPaginas
    : null;

  log(
    `  localizadas ${achadas} de ${aProcurar.length}; ${paginasLidas} página(s) de PDF lida(s)` +
      (paginasComAchado.length ? `; conteúdo nas páginas ${paginasComAchado.join(', ')}.` : '.')
  );
  if (semDigital) log(`  ${semDigital} sem número identificável ficaram sem página.`);

  return { confirmadas, desmentidas, achadas, faltando: restantes.size + semDigital, paginasLidas, proporcao };
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

module.exports = { conferirEDescobrir, impressaoDigital, ordemDeBusca, lerProporcao, salvarProporcao };
