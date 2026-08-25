'use strict';

const { classifyType, normalize } = require('./classify');

// Cada matéria (ato/publicação) do Diário vem cercada por marcadores invisíveis
// no texto do PDF, no formato <#E.G.B#<id_da_materia>#<pagina>#<seq>> ... <.../>
// Esse <id_da_materia> é o MESMO id que aparece no menu do site (ver-html),
// então dá pra usar como link direto depois. Descoberto inspecionando um PDF real.
const TAG_RE = /<#E\.G\.B#(\d+)#(\d+)#(\d+)(\/?)>/g;

// Verbos que costumam abrir uma cláusula individual dentro de um decreto/portaria
// "em lote" (ex.: DECRETOS SIMPLES do dia, que junta várias nomeações/exonerações
// num único documento). Cada ocorrência no início de uma linha marca o começo de
// um novo ato dentro do bloco.
const CLAUSE_START_RE =
  /^(nomear|exonerar|designar|considerar nomead[oa]|considerar exonerad[oa]|dispensar|cessar|conceder|autorizar|declarar|retificar|tornar sem efeito|passar a disposicao|reverter|promover|remover|reconduzir|prorrogar|readaptar|aposentar)\b/;

/**
 * Quebra o texto completo da edição em blocos de matéria, usando os marcadores
 * <#E.G.B#...>. Cada bloco carrega o id (bate com o menu do site), a página e
 * um rótulo de seção (o texto solto entre o fim de uma matéria e o início da
 * próxima, tipo "DESPACHOS" ou "Retificação" — nem sempre presente).
 */
function splitIntoMaterias(fullText) {
  const materias = [];
  let openTag = null; // { id, page }
  let contentStart = 0;
  let lastCloseEnd = 0;
  let pendingLabel = '';

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(fullText)) !== null) {
    const [full, id, page, , isClose] = m;
    if (!isClose) {
      // texto entre a matéria anterior e esta é candidato a rótulo de seção
      const between = fullText.slice(lastCloseEnd, m.index).trim();
      if (between && between.length < 120) pendingLabel = between.replace(/\s+/g, ' ');
      openTag = { id, page: Number(page) };
      contentStart = m.index + full.length;
    } else if (openTag && openTag.id === id) {
      const content = fullText.slice(contentStart, m.index).trim();
      materias.push({ id, page: openTag.page, label: pendingLabel, content });
      lastCloseEnd = m.index + full.length;
      openTag = null;
    }
    // tag de fechamento sem par de abertura correspondente: ignora (não deve acontecer)
  }

  return materias;
}

/**
 * Dentro de uma matéria "em lote" (várias cláusulas tipo nomear/exonerar em
 * sequência), separa cada cláusula individual. Se não achar mais de uma
 * cláusula, devolve o conteúdo inteiro como um item só.
 */
function splitIntoClauses(content) {
  const lines = content.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    if (CLAUSE_START_RE.test(normalize(line).trim())) starts.push(i);
  });

  if (starts.length <= 1) return [content];

  const clauses = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    clauses.push(lines.slice(from, to).join('\n').trim());
  }
  return clauses;
}

/**
 * Função principal: acha, em toda a edição, as cláusulas/matérias que
 * mencionam qualquer um dos termos, já classificadas por tipo.
 * @param {string} fullText texto extraído do PDF da edição (via pdf-parse)
 * @param {string[]} terms termos a procurar
 */
function findMatchesInEdition(fullText, terms) {
  const normTerms = terms.map((t) => ({ original: t, norm: normalize(t) })).filter((t) => t.norm);
  const materias = splitIntoMaterias(fullText);
  const found = [];

  for (const materia of materias) {
    if (!materia.content) continue;
    const normContent = normalize(materia.content);
    const anyHit = normTerms.some((t) => normContent.includes(t.norm));
    if (!anyHit) continue;

    const clauses = splitIntoClauses(materia.content);
    for (const clause of clauses) {
      const normClause = normalize(clause);
      const hit = normTerms.find((t) => normClause.includes(t.norm));
      if (!hit) continue;

      const cleanSnippet = clause.replace(/[ \t]+/g, ' ').trim();
      found.push({
        materiaId: materia.id,
        page: materia.page,
        sectionLabel: materia.label,
        matchedTerm: hit.original,
        movementType: classifyType(clause),
        snippet: cleanSnippet.length > 800 ? cleanSnippet.slice(0, 800) + '…' : cleanSnippet,
      });
    }
  }

  return found;
}

module.exports = { splitIntoMaterias, splitIntoClauses, findMatchesInEdition };
