'use strict';

/**
 * assunto.js — classifica uma publicação em dois níveis:
 *
 *   assunto  (largo)  "Pessoal", "Direitos e vantagens", "Contratos e parcerias"...
 *   motivo   (miúdo)  "Substituição por férias", "Averbação de tempo", "Quinquênio"...
 *
 * Diferente do movementType (lib/classify.js), que só diz que ESPÉCIE de
 * documento é ("Portaria", "Designação"), aqui a pergunta é do que o ato TRATA.
 *
 * DUAS FAMÍLIAS DE REGRA, E A ORDEM IMPORTA
 *
 * 1. INSTRUMENTOS PRÓPRIOS (`cabeca: true`) — documentos que se identificam
 *    logo no começo: "ACORDO DE COOPERAÇÃO TÉCNICA Nº 001/2026", "Extrato do
 *    1º Termo Aditivo", "AVISO DE LICITAÇÃO". Nesses, o que o documento DIZ
 *    SER é o que manda, e só o cabeçalho é examinado.
 *
 *    Isso existe porque decidir por palavra solta no corpo dava errado: um
 *    acordo de cooperação com o município de Vitória da Conquista foi
 *    etiquetado como "Cessão" só porque o texto dizia "mediante a cessão de
 *    servidor do município". O documento não é uma cessão — é um acordo que
 *    menciona uma.
 *
 * 2. CONTEÚDO DO ATO — para portaria, despacho e afins, que são só o veículo.
 *    Uma portaria não é "sobre portaria": o assunto está no corpo, depois do
 *    preâmbulo de atribuições. Aqui a palavra-chave em qualquer posição vale.
 *
 * Dentro de cada família, a primeira regra que bate decide. Por isso as
 * vantagens vêm antes dos verbos de ajuste: "cessar o efeito do ato de GRAT
 * CUMULATIVA" tem que cair em Gratificação, não em "ajuste de ato".
 *
 * Quando nada bate, cai em "Outros" — melhor assumir que não sei do que se
 * trata do que carimbar um assunto errado.
 */

const { normalize } = require('./classify');

// Quanto do começo do texto conta como "cabeçalho". Cabe o nome do
// instrumento, o número e a data; não alcança o corpo.
const TAM_CABECA = 160;

const REGRAS = [
  // ===================================================================
  // 1. INSTRUMENTOS QUE SE IDENTIFICAM NO CABEÇALHO
  // ===================================================================
  {
    assunto: 'Contratos e parcerias', motivo: 'Acordo de cooperação', cabeca: true,
    p: [/acordo de coopera/, /termo de coopera/, /\bconvenio\b/, /termo de parceria/],
  },
  {
    assunto: 'Contratos e parcerias', motivo: 'Termo aditivo', cabeca: true,
    p: [/termo aditivo/],
  },
  {
    assunto: 'Contratos e parcerias', motivo: 'Licitação / pregão', cabeca: true,
    p: [/aviso de licitac/, /\bpregao\b/, /inexigibilidade/, /\bdispensa\b/],
  },
  {
    assunto: 'Contratos e parcerias', motivo: 'Ata de registro de preços', cabeca: true,
    p: [/ata de registro de preco/],
  },
  {
    assunto: 'Contratos e parcerias', motivo: 'Apostilamento', cabeca: true,
    p: [/\bapostila/],
  },
  {
    // TRD = Termo de Recebimento Definitivo. O DEPAF publica como "Resumo do
    // TRD nº 008/2026".
    assunto: 'Contratos e parcerias', motivo: 'Termo de recebimento', cabeca: true,
    p: [/\btrd\b/, /termo de recebimento/],
  },
  {
    assunto: 'Contratos e parcerias', motivo: 'Contrato', cabeca: true,
    // No cabeçalho "contrato" sozinho é seguro: o documento está se nomeando.
    // No corpo seria desastroso — "contratante"/"contratada" aparece em
    // qualquer acordo ou convênio.
    p: [/\bcontrato\b/, /\bcontratacao\b/],
  },
  {
    assunto: 'Normas e colegiados', motivo: 'Ato normativo', cabeca: true,
    p: [/instrucao normativa/, /\bresolucao n/, /\bportaria normativa/],
  },

  // ===================================================================
  // 2. CONTEÚDO DO ATO
  // ===================================================================

  // --- Substituições ----------------------------------------------------
  // As portarias de substituição trazem o motivo num campo estruturado:
  // "designar FULANO, para, em razão de Férias no período de X a Y,
  // substituir BELTRANO". É o dado mais confiável da base inteira.
  {
    assunto: 'Pessoal', motivo: 'Substituição por férias',
    p: [/em razao de[^,]{0,40}\bferias\b/],
  },
  {
    assunto: 'Pessoal', motivo: 'Substituição por licença',
    p: [/em razao de[^,]{0,40}\blic(?:enca)?\b/],
  },

  // --- Gestão de contratos ----------------------------------------------
  // Designar servidor como fiscal ou gestor de contrato NÃO é prover cargo:
  // é atribuir um encargo de acompanhar e fiscalizar contrato administrativo.
  // Vinha caindo em "Designação para cargo" porque o texto diz "designar" e
  // a regra de Pessoal pegava primeiro. Por isso esta vem antes.
  {
    assunto: 'Contratos e parcerias', motivo: 'Fiscal / gestor de contrato',
    // sem acento de propósito: são testadas contra normalize(), que os remove
    p: [
      /gestao d[eo]s? contratos?/,
      /responsaveis pela gestao/,
      /na qualidade de representantes/,
      /fiscal d[eo] contrato/,
      /gestor d[eo] contrato/,
      /acompanhar e fiscalizar/,
    ],
  },

  // --- Corregedoria e disciplina ----------------------------------------
  {
    assunto: 'Corregedoria e disciplina', motivo: 'Sindicância / processo disciplinar',
    // PAD é a sigla consagrada de processo administrativo disciplinar; sem ela
    // 17 portarias da Corregedoria ficavam sem assunto.
    p: [/sindicancia/, /processo administrativo disciplinar/, /\bpad\b/, /\bcorregedoria\b/,
        // extincao de punibilidade e prescricao tambem sao materia disciplinar
        /punibilidade/, /pretensao punitiva/],
  },

  // --- Direitos e vantagens ---------------------------------------------
  { assunto: 'Direitos e vantagens', motivo: 'Averbação de tempo', p: [/\baverba\w*/] },
  { assunto: 'Direitos e vantagens', motivo: 'Licença-prêmio', p: [/licenca[- ]premio/] },
  { assunto: 'Direitos e vantagens', motivo: 'Abono de permanência', p: [/abono (?:de )?permanencia/] },
  { assunto: 'Direitos e vantagens', motivo: 'Quinquênio', p: [/quinquenio/] },
  {
    assunto: 'Direitos e vantagens', motivo: 'Gratificação',
    p: [/gratificacao/, /\bgrat\b/, /grat exerc/, /grat cumulativa/, /exercicio cumulativo/],
  },
  {
    assunto: 'Direitos e vantagens', motivo: 'Adicional por tempo de serviço',
    p: [/adicional.{0,25}tempo de servico/],
  },

  // --- Licenças e afastamentos ------------------------------------------
  {
    assunto: 'Licenças e afastamentos', motivo: 'Licença maternidade',
    p: [/lic\.?\s*maternid/, /licenca maternidade/, /licenca a gestante/],
  },
  {
    assunto: 'Licenças e afastamentos', motivo: 'Licença médica',
    p: [/lic\.?\s*atest/, /atestado med/, /licenca (?:para )?tratamento/, /junta medica/, /doenca na familia/, /\blicenc\w*/],
  },

  // --- Pessoal -----------------------------------------------------------
  { assunto: 'Pessoal', motivo: 'Aposentadoria', p: [/\baposenta\w*/] },
  { assunto: 'Pessoal', motivo: 'Nomeação', p: [/\bnomei\w*/, /\bnomea\w*/] },
  { assunto: 'Pessoal', motivo: 'Exoneração', p: [/\bexonera\w*/] },
  { assunto: 'Pessoal', motivo: 'Permuta', p: [/\bpermuta\b/] },
  { assunto: 'Pessoal', motivo: 'Remoção', p: [/\bremocao\b/, /\bremover\b/, /\bremovid\w*/] },
  { assunto: 'Pessoal', motivo: 'Readaptação', p: [/\breadapta\w*/] },
  // "cessão" sozinha pegava qualquer texto que mencionasse uma: exige agora
  // que o ato seja sobre ceder alguém.
  { assunto: 'Pessoal', motivo: 'Cessão', p: [/cessao de servidor/, /\bcedid[oa]\b/, /a disposicao d/] },
  { assunto: 'Pessoal', motivo: 'Convocação', p: [/\bconvoca\w*/] },
  { assunto: 'Pessoal', motivo: 'Designação para função', p: [/\bdesigna\w*/] },

  // --- Normas e colegiados -----------------------------------------------
  {
    assunto: 'Normas e colegiados', motivo: 'Comissão / comitê / GT',
    p: [/\bcomite\b/, /\bcomissao\b/, /grupo de trabalho/],
  },
  { assunto: 'Normas e colegiados', motivo: 'Concurso / seleção', p: [/\bconcurso\b/, /processo seletivo/, /\bedital\b/, /ingresso na carreira/] },
  // O Diário escreve "institui os núcleos", não "instituir": o infinitivo
  // sozinho deixava passar as portarias que criam estrutura.
  { assunto: 'Normas e colegiados', motivo: 'Ato normativo', p: [/\bdecreto\b/, /\binstitu\w*/, /dispoe sobre/, /\bregulament\w*/] },

  // --- Ajustes de atos anteriores ----------------------------------------
  // Só chega aqui quem não tinha assunto próprio: "cessar o efeito do ato de
  // GRAT CUMULATIVA" já foi capturado lá em cima como Gratificação.
  {
    assunto: 'Outros', motivo: 'Ajuste de ato anterior',
    // "retirratificação" não casa com \bretifica: o Diário usa essa forma
    p: [/tornar sem efeito/, /cessar o efeito/, /\bretifica\w*/, /retirratifica/, /\bprorrog\w*/],
  },
  { assunto: 'Outros', motivo: 'Diárias / viagem', p: [/\bdiaria/] },
];

/**
 * Classifica o texto de uma publicação.
 * @returns {{assunto: string, motivo: string}}
 */
function classificarAssunto(texto) {
  const norm = normalize(texto);
  const cabeca = norm.slice(0, TAM_CABECA);
  for (const regra of REGRAS) {
    const alvo = regra.cabeca ? cabeca : norm;
    if (regra.p.some((re) => re.test(alvo))) {
      return { assunto: regra.assunto, motivo: regra.motivo };
    }
  }
  return { assunto: 'Outros', motivo: 'Não classificado' };
}

/** Lista dos assuntos, na ordem em que devem aparecer no painel. */
const ASSUNTOS = [
  'Pessoal',
  'Direitos e vantagens',
  'Licenças e afastamentos',
  'Contratos e parcerias',
  'Normas e colegiados',
  'Corregedoria e disciplina',
  'Outros',
];

/** Motivos de cada assunto, também na ordem de exibição. */
const MOTIVOS_POR_ASSUNTO = ASSUNTOS.reduce((acc, a) => {
  acc[a] = [];
  return acc;
}, {});
for (const r of REGRAS) {
  if (!MOTIVOS_POR_ASSUNTO[r.assunto].includes(r.motivo)) MOTIVOS_POR_ASSUNTO[r.assunto].push(r.motivo);
}
MOTIVOS_POR_ASSUNTO['Outros'].push('Não classificado');

// REGRAS sai exportada pra permitir auditoria: saber QUAL padrão decidiu cada
// publicação é a única forma de achar regra larga demais.
module.exports = { classificarAssunto, REGRAS, ASSUNTOS, MOTIVOS_POR_ASSUNTO };
