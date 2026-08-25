'use strict';
// Remove do matches.json todas as publicações de uma edição específica, e
// tira ela da lista de "já processadas" — pra deixar o robô buscar de novo.
// Uso: node tools/remover-edicao.js --id=22422

const fs = require('fs');
const path = require('path');

const idArg = process.argv.find((a) => a.startsWith('--id='));
const id = idArg ? idArg.split('=')[1] : null;
if (!id) {
  console.log('Uso: node tools/remover-edicao.js --id=22422');
  process.exit(1);
}

const MATCHES_FILE = path.join(__dirname, '..', 'docs', 'data', 'matches.json');
const EDITIONS_FILE = path.join(__dirname, '..', 'docs', 'data', 'processed-editions.json');

const matches = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
const antes = matches.length;
const restantes = matches.filter((m) => String(m.editionId) !== String(id));
fs.writeFileSync(MATCHES_FILE, JSON.stringify(restantes, null, 2) + '\n');
console.log(`Removidas ${antes - restantes.length} publicação(ões) da edição ${id} de matches.json.`);

const processadas = JSON.parse(fs.readFileSync(EDITIONS_FILE, 'utf8'));
const semEla = processadas.filter((pid) => String(pid) !== String(id));
fs.writeFileSync(EDITIONS_FILE, JSON.stringify(semEla, null, 2) + '\n');
console.log(`Edição ${id} tirada da lista de já processadas (tinha: ${processadas.includes(id) || processadas.includes(String(id))}).`);