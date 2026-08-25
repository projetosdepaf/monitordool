'use strict';

/**
 * Remove acentos e baixa a caixa, pra comparar texto de forma tolerante
 * (PDF de diário oficial às vezes perde acentuação na extração).
 */
function normalize(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // o PDF do Diário costuma inserir espaços duplos/triplos entre palavras
    // (justificação de texto) — sem isso, uma busca por "Planejamento,
    // Administração" pode falhar só porque saiu "Planejamento,  Administração"
    // no texto extraído.
    .replace(/\s+/g, ' ');
}

// Regras de classificação por palavra-chave, checadas na ordem abaixo.
// A primeira que bater define o tipo. Ajuste/adicione conforme for vendo
// os tipos reais de publicação que saem sobre a DEPAF.
const TYPE_RULES = [
  { type: 'Nomeação', patterns: [/\bnomei\w*/, /\bnomea\w*/] },
  { type: 'Exoneração', patterns: [/\bexonera\w*/] },
  { type: 'Designação', patterns: [/\bdesigna\w*/] },
  { type: 'Aposentadoria', patterns: [/\baposenta\w*/] },
  { type: 'Licença', patterns: [/\blicenc\w*/] },
  { type: 'Cessão / Remoção', patterns: [/\bcessao\b/, /\bremocao\b/, /\bremovid\w*/] },
  { type: 'Convocação', patterns: [/\bconvoca\w*/] },
  { type: 'Diárias / Viagem', patterns: [/\bdiaria/] },
  { type: 'Retificação', patterns: [/\bretifica\w*/] },
  { type: 'Edital', patterns: [/\bedital\b/] },
  { type: 'Contrato / Licitação', patterns: [/\bcontrat\w*/, /\blicitac\w*/, /\bpregao\b/, /\bdispensa de licitacao\b/] },
  { type: 'Portaria', patterns: [/\bportaria\b/] },
  { type: 'Ato / Decreto', patterns: [/\bdecreto\b/, /\bato\b/] },
];

/**
 * Classifica um trecho de publicação em um "tipo de movimentação" legível.
 * Cai em "Outro" quando nenhuma regra bate — melhor que inventar um tipo errado.
 */
function classifyType(snippet) {
  const norm = normalize(snippet);
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some((re) => re.test(norm))) return rule.type;
  }
  return 'Outro';
}

/**
 * Quebra o texto completo de uma edição em blocos de publicação individuais.
 * Diários oficiais brasileiros normalmente separam cada ato por linha(s) em
 * branco e/ou por um cabeçalho em maiúsculas (PORTARIA Nº..., ATO Nº...).
 * Essa heurística é propositalmente simples — ajuste depois de ver o texto
 * real extraído (rode "npm run probe" e olhe /tmp/doe-ultima-edicao.txt).
 */
function splitIntoPublications(fullText) {
  const raw = String(fullText).replace(/\r\n/g, '\n');
  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 20); // ignora ruído tipo cabeçalho de página solto

  // Se o texto não tiver quebras de parágrafo claras (PDF mal extraído vira
  // um bloco só), tenta quebrar por cabeçalhos de ato em maiúsculas como
  // segunda tentativa, pra não perder tudo num único "parágrafo" gigante.
  if (blocks.length <= 1 && raw.length > 2000) {
    const bySections = raw.split(/(?=\n?(?:PORTARIA|ATO|DECRETO|EDITAL|EXTRATO)\s+N[ºO°]?)/i);
    if (bySections.length > 1) return bySections.map((b) => b.trim()).filter((b) => b.length > 20);
  }

  return blocks;
}

/**
 * Procura por qualquer um dos termos do departamento em cada publicação do
 * texto e devolve os achados já classificados.
 * @param {string} fullText texto extraído da edição
 * @param {string[]} terms termos a procurar, ex.: ["DEPAF", "Departamento de Planejamento, Administração e Finanças"]
 */
function findMatches(fullText, terms) {
  const normTerms = terms.map((t) => ({ original: t, norm: normalize(t) })).filter((t) => t.norm.length > 0);
  const publications = splitIntoPublications(fullText);
  const found = [];

  for (const pub of publications) {
    const normPub = normalize(pub);
    const hit = normTerms.find((t) => normPub.includes(t.norm));
    if (!hit) continue;

    found.push({
      matchedTerm: hit.original,
      movementType: classifyType(pub),
      // limita o tamanho do trecho guardado, mas mantém contexto suficiente pra entender do que se trata
      snippet: pub.length > 800 ? pub.slice(0, 800) + '…' : pub,
    });
  }

  return found;
}

module.exports = { normalize, classifyType, splitIntoPublications, findMatches };
