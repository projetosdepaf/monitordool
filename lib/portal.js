'use strict';

const cheerio = require('cheerio');
const { normalize, classifyType } = require('./classify');

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
        if ($link.length && ancestrais.some((n) => pastaBate(n, termosNorm))) {
          const identificador = $link.attr('identificador') || $link.attr('data-materia-id');
          const pagina = Number($link.attr('pagina'));
          achados.push({
            identificador,
            pagina: Number.isFinite(pagina) ? pagina : null,
            titulo: $link.text().trim(),
            caminho: ancestrais.join(' > '),
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
  const termoDepaf = depafTerms.find((t) => normTexto.includes(normalize(t)));
  return {
    isDepafMention: Boolean(termoDepaf),
    matchedTerm: termoDepaf || 'Polícia Civil da Bahia',
    movementType: classifyType(texto),
  };
}

module.exports = { coletarMateriasRelevantes, extrairTextoConteudo, avaliarConteudo };