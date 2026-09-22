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
 * Sequência de dígitos longa o bastante pra ser única dentro da edição.
 * O número do ato ("Portaria Nº 01124892") é a melhor escolha; quando não
 * existe, cai pra maior sequência disponível — matrícula, número de processo.
 * Devolve null quando não há nada confiável: nesse caso é melhor ficar sem
 * página do que arriscar apontar pra página errada.
 */
function impressaoDigital(snippet) {
  const texto = String(snippet || '');

  const ato = texto.match(/N[ºo°]\s*(\d[\d.\-/]{5,})/);
  if (ato) {
    const d = soDigitos(ato[1]);
    if (d.length >= 6) return d;
  }

  const candidatos = (texto.match(/\d[\d.\-/]{7,}/g) || [])
    .map(soDigitos)
    .filter((d) => d.length >= 8);
  if (!candidatos.length) return null;
  return candidatos.sort((a, b) => b.length - a.length)[0];
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
async function descobrirPaginas({
  baseUrl,
  edicaoId,
  totalPaginas,
  publicacoes,
  proporcaoPalpite,
  log = () => {},
}) {
  const pendentes = publicacoes
    .map((p, i) => ({ i, digital: impressaoDigital(p.snippet) }))
    .filter((a) => a.digital && !(publicacoes[a.i].page > 0));

  const semDigital = publicacoes.filter((p) => !(p.page > 0)).length - pendentes.length;

  if (!pendentes.length) {
    if (semDigital) log(`  nenhuma publicação com número identificável pra localizar (${semDigital} sem).`);
    return { achadas: 0, faltando: semDigital, paginasLidas: 0, proporcao: null };
  }
  if (!totalPaginas || totalPaginas < 1) {
    log('  a edição não informou quantas páginas tem; não dá pra procurar.');
    return { achadas: 0, faltando: pendentes.length + semDigital, paginasLidas: 0, proporcao: null };
  }

  // Melhor palpite possível: onde caíram as publicações DESTA MESMA edição que
  // já têm página. Elas saem juntas, na seção do órgão. Só quando não existe
  // nenhuma é que se recorre à proporção histórica.
  const irmas = publicacoes.map((x) => x.page).filter((n) => n > 0);
  const palpite = irmas.length
    ? Math.round(irmas.reduce((soma, n) => soma + n, 0) / irmas.length)
    : proporcaoPalpite
      ? Math.round(proporcaoPalpite * totalPaginas)
      : Math.round(0.6 * totalPaginas);
  const origemPalpite = irmas.length
    ? `média de ${irmas.length} publicação(ões) da mesma edição`
    : proporcaoPalpite
      ? 'proporção das edições anteriores'
      : 'chute inicial'; 

  log(
    `  procurando a página de ${pendentes.length} publicação(ões) em ${totalPaginas} páginas ` +
      `(começando pela ${palpite}, por ${origemPalpite}; desiste após ${MAX_SEM_ACHAR} sem achar nada).`
  );

  const restantes = new Map(pendentes.map((a) => [a.i, a.digital]));
  const paginasComAchado = [];
  let paginasLidas = 0;
  let semAchar = 0;

  for (const p of ordemDeBusca(palpite, totalPaginas)) {
    if (!restantes.size || semAchar >= MAX_SEM_ACHAR) break;

    let r;
    try {
      r = await baixar(`${baseUrl}/apifront/portal/edicoes/pdf_diario/${edicaoId}/${p}`);
    } catch (err) {
      log(`  página ${p}: falhou ao baixar (${err.message}), seguindo.`);
      continue;
    }
    if (r.status !== 200 || r.buf.slice(0, 5).toString() !== '%PDF-') continue;

    paginasLidas++;
    let digitos;
    try {
      digitos = soDigitos((await pdfParse(r.buf)).text);
    } catch {
      continue; // página que o extrator não lê (só imagem, por exemplo)
    }

    let achouAqui = 0;
    for (const [i, digital] of [...restantes]) {
      if (digitos.includes(digital)) {
        publicacoes[i].page = p;
        restantes.delete(i);
        achouAqui++;
      }
    }
    if (achouAqui) {
      paginasComAchado.push(p);
      semAchar = 0; // achou: renova o orçamento, a seção está por perto
    } else {
      semAchar++;
    }
  }

  const achadas = pendentes.length - restantes.size;
  const proporcao = paginasComAchado.length
    ? paginasComAchado.reduce((s, p) => s + p, 0) / paginasComAchado.length / totalPaginas
    : null;

  log(
    `  localizadas ${achadas} de ${pendentes.length} em ${paginasLidas} página(s) lida(s)` +
      (paginasComAchado.length ? `; conteúdo nas páginas ${paginasComAchado.join(', ')}.` : '.')
  );
  if (semDigital) log(`  ${semDigital} publicação(ões) sem número identificável ficaram sem página.`);

  return { achadas, faltando: restantes.size + semDigital, paginasLidas, proporcao };
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

module.exports = { descobrirPaginas, impressaoDigital, ordemDeBusca, lerProporcao, salvarProporcao };
