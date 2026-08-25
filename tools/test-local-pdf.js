'use strict';

/**
 * Testa a extração/classificação contra um PDF do Diário salvo no seu
 * computador — sem precisar acessar o site. Útil pra conferir de vez em
 * quando se as regras ainda estão pegando tudo certo.
 *
 * Uso:
 *   node tools/test-local-pdf.js caminho/para/edicao.pdf
 */
require('dotenv').config();
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { findMatchesInEdition } = require('../lib/extract');

const DEPAF_TERMS = (process.env.DEPAF_TERMS || 'DEPAF|Departamento de Planejamento, Administração e Finanças')
  .split('|').map((t) => t.trim()).filter(Boolean);
const AMPLO_TERMS = (process.env.AMPLO_TERMS || 'Polícia Civil da Bahia')
  .split('|').map((t) => t.trim()).filter(Boolean);

const path = process.argv[2];
if (!path) {
  console.error('Uso: node tools/test-local-pdf.js caminho/para/edicao.pdf');
  process.exit(1);
}

pdfParse(fs.readFileSync(path)).then((parsed) => {
  console.log(`PDF com ${parsed.numpages} página(s), ${parsed.text.length} caracteres extraídos.`);
  const depaf = findMatchesInEdition(parsed.text, DEPAF_TERMS);
  const amplo = findMatchesInEdition(parsed.text, AMPLO_TERMS);
  console.log(`\nMenções diretas à DEPAF: ${depaf.length}`);
  depaf.forEach((m, i) => console.log(`  [${i}] ${m.movementType} | pág.${m.page} | ${m.snippet.replace(/\n/g, ' ').slice(0, 140)}...`));
  console.log(`\nPublicações da Polícia Civil da Bahia em geral: ${amplo.length}`);
  amplo.forEach((m, i) => console.log(`  [${i}] ${m.movementType} | pág.${m.page} | ${m.snippet.replace(/\n/g, ' ').slice(0, 100)}...`));
}).catch((err) => {
  console.error('Erro lendo o PDF:', err.message);
  process.exit(1);
});
