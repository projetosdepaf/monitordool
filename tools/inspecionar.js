'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

const HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });
const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
};

const caminhoArg = process.argv.find((a) => a.startsWith('--caminho='));
const caminho = caminhoArg ? caminhoArg.split('=').slice(1).join('=') : '/apifront/portal/edicoes/edicoes_from_data.json';
const url = `https://dool.egba.ba.gov.br${caminho}`;
const nomeArquivo = caminho.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo';

async function main() {
  console.log('Buscando', url, '...');
  const res = await axios.get(url, {
    headers: HTTP_HEADERS,
    timeout: 30000,
    responseType: 'arraybuffer',
    httpsAgent: HTTPS_AGENT,
    maxRedirects: 5,
  });

  const buf = Buffer.from(res.data);
  const dir = path.join(__dirname, '..', 'diagnostico');
  fs.mkdirSync(dir, { recursive: true });

  const infoFile = path.join(dir, `${nomeArquivo}-info.txt`);
  const bodyFile = path.join(dir, `${nomeArquivo}.txt`);
  const LIMITE = 500000;

  fs.writeFileSync(
    infoFile,
    [
      `URL: ${url}`,
      `Status: ${res.status}`,
      `Content-Type: ${res.headers['content-type']}`,
      `Tamanho: ${buf.length} bytes`,
      `Primeiros bytes (hex): ${buf.slice(0, 8).toString('hex')}`,
      '(Se começar com 25504446, é um PDF de verdade.)',
    ].join('\n')
  );
  const corpo = buf.length > LIMITE ? buf.slice(0, LIMITE) : buf;
  fs.writeFileSync(bodyFile, corpo.toString('utf8') + (buf.length > LIMITE ? '\n\n[...cortado, arquivo maior que isso...]' : ''));

  console.log(`Status: ${res.status} | Content-Type: ${res.headers['content-type']} | ${buf.length} bytes`);
  console.log('Salvo em', bodyFile, 'e', infoFile);
}

main().catch((err) => {
  console.error('Erro:', err.message);
});