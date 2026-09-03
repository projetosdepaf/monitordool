'use strict';

/**
 * reclassificar.js — preenche os campos "assunto" e "motivo" no
 * docs/data/matches.json que já está gravado, usando o texto de cada
 * publicação que o próprio arquivo guarda.
 *
 * Ao contrário do recorrigir-depaf.js, aqui pode sobrescrever à vontade:
 * assunto e motivo são derivados do texto, não vieram do Diário. Sempre que
 * as regras de lib/assunto.js mudarem, é só rodar de novo.
 *
 * Uso:
 *   node tools/reclassificar.js           (mostra o resumo, não grava)
 *   node tools/reclassificar.js --gravar  (grava de verdade)
 */

const fs = require('fs');
const path = require('path');
const { classificarAssunto, ASSUNTOS } = require('../lib/assunto');

const MATCHES_FILE = path.join(__dirname, '..', 'docs', 'data', 'matches.json');
const GRAVAR = process.argv.includes('--gravar');

function main() {
  const dados = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  let mudaram = 0;

  const porAssunto = new Map();
  const porMotivo = new Map();

  for (const m of dados) {
    const { assunto, motivo } = classificarAssunto(m.snippet || '');
    if (m.assunto !== assunto || m.motivo !== motivo) mudaram++;
    m.assunto = assunto;
    m.motivo = motivo;
    porAssunto.set(assunto, (porAssunto.get(assunto) || 0) + 1);
    const chave = `${assunto} > ${motivo}`;
    porMotivo.set(chave, (porMotivo.get(chave) || 0) + 1);
  }

  console.log(`${dados.length} publicações · ${mudaram} com classificação nova ou diferente.\n`);

  console.log('Por assunto:');
  for (const a of ASSUNTOS) {
    if (porAssunto.has(a)) console.log(`  ${String(porAssunto.get(a)).padStart(5)}  ${a}`);
  }

  console.log('\nPor motivo:');
  for (const [chave, n] of [...porMotivo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${chave}`);
  }

  if (!GRAVAR) {
    console.log('\n(simulação — nada foi gravado. Rode com --gravar pra valer.)');
    return;
  }

  fs.writeFileSync(MATCHES_FILE, JSON.stringify(dados, null, 2) + '\n');
  console.log(`\nGravado em ${MATCHES_FILE}`);
}

main();
