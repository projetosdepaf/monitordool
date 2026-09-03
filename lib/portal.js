'use strict';

const cheerio = require('cheerio');
const { normalize, classifyType, acharMencaoDepaf } = require('./classify');

/**
 * O sumário de cada edição (endereço /html/<id>.html) vem como uma árvore de
 * pastas — uma por órgão/tema — igual um explorador de arquivos. A gente
 * caminha essa árvore carregando o "caminho" de pastas até cada matéria, e
 * marca como relevante qualquer uma que esteja dentro de uma pasta cujo nome
 * bata com algum dos termos configurados (normalmente variações de "Polícia
 * Civil da Bahia" e "DEPAF"). Descoberto inspecionando o site real — ver
 * conversa com a Cíntia em 25/08/2026.
 */
function pastaBate(nomePasta, termosNormalizados) {
  const nome = normalize(nomePasta);
  return termosNormalizados.some((t) => t && nome.includes(t));
}

// Pastas de "Decreto..." (numerados, simples, financeiros, ou qualquer outra
// variação) não ficam dentro da pasta da Polícia Civil (são assinados pelo
// Governador, então ficam soltos, junto de decretos de todas as
// secretarias) — mas é exatamente ali que saem nomeação/exoneração de cargo
// comissionado (DAS), incluindo da DEPAF. Cada edição normalmente tem UM
// documento só em cada uma dessas pastas, juntando dezenas de atos de
// secretarias diferentes num texto só — por isso a gente sempre abre
// qualquer pasta cujo nome comece com "Decreto" (mesmo sem "Polícia Civil"
// no nome) e depois separa ato por ato, mantendo só os que falam de Polícia
// Civil/DEPAF. Abrir uma pasta de decreto que não tenha nada a ver não é
// problema — o conteúdo é que decide a relevância, então só custa um pouco
// de tempo a mais. Descoberto junto com a Cíntia em 25/08/2026, comparando
// com o que ela lembrava de verdade ter saído no dia 22/08/2026 (a
// nomeação dela, a do Ednei e duas exonerações) e que o robô estava
// perdendo.
function ehPastaLote(nomePasta) {
  return normalize(nomePasta).startsWith('decreto');
}
// Dentro de um decreto em lote, cada ato (uma nomeação, uma exoneração...)
// é um parágrafo <p> inteiro e autocontido, sempre começando com um desses
// verbos. Parágrafos de cabeçalho ("O GOVERNADOR...", "R E S O L V E") e
// linhas em branco não começam com nenhum deles, então ficam de fora.
const VERBO_ATO_RE =
  /^(exonerar|nomear|designar|considerar|aposentar|conceder|convocar|tornar sem efeito|retificar|remover|readaptar)\b/i;

/**
 * @param {string} sumarioHtml HTML bruto devolvido por /html/<id>.html
 * @param {string[]} termosFolder termos (não normalizados) que, se aparecerem
 *   no nome de uma pasta, marcam tudo que estiver dentro dela como relevante
 * @returns {{identificador:string, pagina:number|null, titulo:string, caminho:string}[]}
 */
function coletarMateriasRelevantes(sumarioHtml, termosFolder) {
  const $ = cheerio.load(sumarioHtml);
  const termosNorm = termosFolder.map((t) => normalize(t)).filter(Boolean);
  const achados = [];

  function walk($ul, ancestrais) {
    if (!$ul || !$ul.length) return;
    $ul.children('li').each((_, li) => {
      const $li = $(li);
      const $folderSpan = $li.children('span.folder').first();
      if ($folderSpan.length) {
        const nome = $folderSpan.text().trim();
        const $subUl = $li.children('ul').first();
        walk($subUl, ancestrais.concat(nome));
        return;
      }
      const $fileSpan = $li.children('span.file').first();
      if ($fileSpan.length) {
        const $link = $fileSpan.children('a.linkMateria').first();
        if (!$link.length) return;
        const relevantePorPasta = ancestrais.some((n) => pastaBate(n, termosNorm));
        const ehLote = ancestrais.some((n) => ehPastaLote(n));
        if (relevantePorPasta || ehLote) {
          const identificador = $link.attr('identificador') || $link.attr('data-materia-id');
          const pagina = Number($link.attr('pagina'));
          achados.push({
            identificador,
            pagina: Number.isFinite(pagina) ? pagina : null,
            titulo: $link.text().trim(),
            caminho: ancestrais.join(' > '),
            loteDecreto: ehLote,
          });
        }
      }
    });
  }

  walk($('#tree'), []);
  return achados;
}

/**
 * Limpa o HTML (exportado do Word) devolvido por
 * /apifront/portal/edicoes/publicacoes_ver_conteudo/<identificador> e devolve
 * só o texto legível da publicação.
 */
function extrairTextoConteudo(conteudoHtml) {
  const $ = cheerio.load(conteudoHtml);
  const texto = $('body').text();
  return texto
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Decide se uma matéria já baixada é "DEPAF" (menção direta) ou só "amplo"
 * (Polícia Civil da Bahia em geral), e classifica o tipo de movimentação.
 */
function avaliarConteudo(texto, depafTerms) {
  const normTexto = normalize(texto);
  // Primeiro os termos configurados (DEPAF_TERMS no .env, para quem quiser
  // acrescentar algo sem mexer no código); depois o reconhecimento tolerante,
  // que pega as abreviações do campo de lotação. Ver acharMencaoDepaf.
  const termoDepaf =
    depafTerms.find((t) => normTexto.includes(normalize(t))) || acharMencaoDepaf(texto);
  return {
    isDepafMention: Boolean(termoDepaf),
    matchedTerm: termoDepaf || 'Polícia Civil da Bahia',
    movementType: classifyType(texto),
  };
}

/**
 * Separa um decreto "em lote" (um documento só com várias nomeações,
 * exonerações etc. de secretarias diferentes) em atos individuais. Cada ato
 * real é um <p> inteiro começando com um verbo de ato (ver VERBO_ATO_RE);
 * parágrafos de cabeçalho e linhas em branco ficam de fora automaticamente
 * por não baterem o padrão.
 * @param {string} conteudoHtml HTML bruto da matéria (documento em lote)
 * @returns {string[]} um item de texto por ato encontrado
 */
function dividirAtosDecreto(conteudoHtml) {
  const $ = cheerio.load(conteudoHtml);
  const atos = [];
  $('body')
    .find('p')
    .each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && VERBO_ATO_RE.test(t)) atos.push(t);
    });

  // Se a estrutura vier diferente do esperado (sem <p> reconhecíveis), não
  // quebra o robô — devolve o documento inteiro como um "ato" só, pra não
  // perder a publicação por completo (mesmo que sem separar corretamente).
  if (!atos.length) {
    const textoTudo = extrairTextoConteudo(conteudoHtml);
    if (textoTudo) atos.push(textoTudo);
  }
  return atos;
}

/**
 * Verifica se um trecho de texto solto (ex.: um ato já separado de um
 * decreto em lote, que não veio de dentro de uma pasta já filtrada) fala de
 * algum dos termos amplos configurados (normalmente "Polícia Civil"/"DEPAF").
 */
function atoRelevante(texto, termosAmplos) {
  const normTexto = normalize(texto);
  return termosAmplos.some((t) => t && normTexto.includes(normalize(t)));
}

module.exports = {
  coletarMateriasRelevantes,
  extrairTextoConteudo,
  avaliarConteudo,
  dividirAtosDecreto,
  atoRelevante,
};