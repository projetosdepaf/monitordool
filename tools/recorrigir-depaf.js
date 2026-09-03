'use strict';

/**
 * recorrigir-depaf.js — repassa o docs/data/matches.json que já está gravado e
 * remarca como DEPAF as publicações que citam o departamento numa das formas
 * que o robô antigo não reconhecia ("DEP PLANEJAMENTO ADM E FINANÇAS",
 * "Departamento de Planejamento Administração e Finanças" sem a vírgula...).
 *
 * Serve pra consertar o histórico sem rebaixar tudo do Diário de novo: o texto
 * da publicação já está guardado no próprio arquivo.
 *
 * Só promove de "não é DEPAF" pra "é DEPAF", nunca o contrário. O snippet é
 * cortado em 800 caracteres, então uma publicação pode citar a DEPAF num
 * trecho que não foi guardado — rebaixar por causa disso apagaria um acerto.
 *
 * Uso:
 *   node tools/recorrigir-depaf.js           (mostra o que mudaria, não grava)
 *   node tools/recorrigir-depaf.js --gravar  (grava de verdade)
 */

const fs = require('fs');
const path = require('path');
const { acharMencaoDepaf } = require('../lib/classify');

const MATCHES_FILE = path.join(__dirname, '..', 'docs', 'data', 'matches.json');
const GRAVAR = process.argv.includes('--gravar');

function main() {
  const dados = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  const antes = dados.filter((m) => m.isDepafMention).length;
  const promovidos = [];

  for (const m of dados) {
    if (m.isDepafMention) continue;
    const mencao = acharMencaoDepaf(m.snippet || '');
    if (!mencao) continue;
    m.isDepafMention = true;
    m.matchedTerm = mencao;
    promovidos.push(m);
  }

  console.log(`${dados.length} publicações no arquivo.`);
  console.log(`Marcadas como DEPAF antes: ${antes}`);
  console.log(`Passam a ser DEPAF agora:  ${antes + promovidos.length} (+${promovidos.length})`);

  if (promovidos.length) {
    console.log('\nAs que entraram:');
    for (const m of promovidos) {
      const trecho = String(m.snippet).replace(/\s+/g, ' ').slice(0, 90);
      console.log(`  ${m.editionDate} | ${m.movementType} | ${m.matchedTerm} | ${trecho}...`);
    }
  }

  if (!GRAVAR) {
    console.log('\n(simulação — nada foi gravado. Rode com --gravar pra valer.)');
    return;
  }

  fs.writeFileSync(MATCHES_FILE, JSON.stringify(dados, null, 2) + '\n');
  console.log(`\nGravado em ${MATCHES_FILE}`);
}

main();
