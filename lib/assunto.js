'use strict';

/**
 * assunto.js — classifica uma publicação em dois níveis:
 *
 *   assunto  (largo)  "Pessoal", "Direitos e vantagens", "Contratos e compras"...
 *   motivo   (miúdo)  "Substituição por férias", "Averbação de tempo", "Quinquênio"...
 *
 * Diferente do movementType (lib/classify.js), que só diz que ESPÉCIE de
 * documento é ("Portaria", "Designação"), aqui a pergunta é do que o ato TRATA.
 * As categorias não foram inventadas: saíram de contar o que aparece nas 1.622
 * publicações já coletadas — o campo "em razão de ___" das portarias de
 * substituição e o verbo do "resolve ___". Ver o histórico do commit.
 *
 * As regras são checadas NA ORDEM e a primeira que bater define os dois níveis.
 * A ordem importa: "cessar o efeito do ato de GRAT CUMULATIVA" tem que cair em
 * Gratificação, não em "ajuste de ato", por isso as vantagens vêm antes dos
 * verbos de ajuste. Quando nada bate, cai em "Outros" — melhor assumir que não
 * sei do que se trata do que carimbar um assunto errado.
 */

const { normalize } = require('./classify');

const REGRAS = [
  // --- Substituições ------------------------------------------------------
  // As portarias de substituição trazem o motivo num campo estruturado:
  // "designar FULANO, para, em razão de Férias no período de X a Y, substituir
  // BELTRANO". É o dado mais confiável da base inteira, então vem primeiro.
  {
    assunto: 'Pessoal', motivo: 'Substituição por férias',
    p: [/em razao de[^,]{0,40}\bferias\b/],
  },
  {
    assunto: 'Pessoal', motivo: 'Substituição por licença',
    p: [/em razao de[^,]{0,40}\blic(?:enca)?\b/],
  },

  // --- Contratos e compras ------------------------------------------------
  { assunto: 'Contratos e compras', motivo: 'Termo aditivo', p: [/termo aditivo/] },
  { assunto: 'Contratos e compras', motivo: 'Licitação / pregão', p: [/licitac/, /\bpregao\b/, /inexigibilidade/] },
  { assunto: 'Contratos e compras', motivo: 'Contrato', p: [/\bcontrato n/, /\bcontratacao\b/, /extrato de contrato/, /\bcontrat\w+/] },

  // --- Corregedoria e disciplina ---------------------------------------------
  {
    assunto: 'Corregedoria e disciplina', motivo: 'Sindicância / processo disciplinar',
    p: [/sindicancia/, /processo administrativo disciplinar/, /\bpad\b/, /corregedoria/],
  },

  // --- Direitos e vantagens -----------------------------------------------
  { assunto: 'Direitos e vantagens', motivo: 'Averbação de tempo', p: [/\baverba\w*/] },
  { assunto: 'Direitos e vantagens', motivo: 'Licença-prêmio', p: [/licenca[- ]premio/] },
  { assunto: 'Direitos e vantagens', motivo: 'Abono de permanência', p: [/abono permanencia/, /abono de permanencia/] },
  { assunto: 'Direitos e vantagens', motivo: 'Quinquênio', p: [/quinquenio/] },
  {
    assunto: 'Direitos e vantagens', motivo: 'Gratificação',
    p: [/gratificacao/, /\bgrat\b/, /\bgrat /, /grat exerc/, /grat cumulativa/],
  },
  {
    assunto: 'Direitos e vantagens', motivo: 'Adicional por tempo de serviço',
    p: [/adicional.{0,25}tempo de servico/],
  },

  // --- Licenças e afastamentos --------------------------------------------
  {
    assunto: 'Licenças e afastamentos', motivo: 'Licença maternidade',
    p: [/lic\.?\s*maternid/, /licenca maternidade/, /licenca a gestante/],
  },
  {
    assunto: 'Licenças e afastamentos', motivo: 'Licença médica',
    p: [/lic\.?\s*atest/, /atestado med/, /licenca (?:para )?tratamento/, /junta medica/, /doenca na familia/, /\blicenc\w*/],
  },

  // --- Pessoal ------------------------------------------------------------
  { assunto: 'Pessoal', motivo: 'Aposentadoria', p: [/\baposenta\w*/] },
  { assunto: 'Pessoal', motivo: 'Nomeação', p: [/\bnomei\w*/, /\bnomea\w*/] },
  { assunto: 'Pessoal', motivo: 'Exoneração', p: [/\bexonera\w*/] },
  { assunto: 'Pessoal', motivo: 'Permuta', p: [/\bpermuta\b/] },
  { assunto: 'Pessoal', motivo: 'Remoção', p: [/\bremocao\b/, /\bremover\b/, /\bremovid\w*/] },
  { assunto: 'Pessoal', motivo: 'Readaptação', p: [/\breadapta\w*/] },
  { assunto: 'Pessoal', motivo: 'Cessão', p: [/\bcessao\b/, /a disposicao d/] },
  { assunto: 'Pessoal', motivo: 'Convocação', p: [/\bconvoca\w*/] },
  { assunto: 'Pessoal', motivo: 'Designação para cargo', p: [/\bdesigna\w*/] },

  // --- Normas e colegiados ------------------------------------------------
  {
    assunto: 'Normas e colegiados', motivo: 'Comissão / comitê / GT',
    p: [/\bcomite\b/, /\bcomissao\b/, /grupo de trabalho/],
  },
  { assunto: 'Normas e colegiados', motivo: 'Concurso / seleção', p: [/\bconcurso\b/, /processo seletivo/, /\bedital\b/] },
  { assunto: 'Normas e colegiados', motivo: 'Decreto / ato normativo', p: [/\bdecreto\b/, /\binstituir\b/, /\bregulament\w*/] },

  // --- Ajustes de atos anteriores -----------------------------------------
  // Só chega aqui quem não tinha assunto próprio. "Cessar o efeito de uma
  // gratificação" já foi capturado lá em cima como Gratificação.
  {
    assunto: 'Outros', motivo: 'Ajuste de ato anterior',
    p: [/tornar sem efeito/, /cessar o efeito/, /\bretifica\w*/, /\bprorrog\w*/],
  },
  { assunto: 'Outros', motivo: 'Diárias / viagem', p: [/\bdiaria/] },
];

/**
 * Classifica o texto de uma publicação.
 * @returns {{assunto: string, motivo: string}}
 */
function classificarAssunto(texto) {
  const norm = normalize(texto);
  for (const regra of REGRAS) {
    if (regra.p.some((re) => re.test(norm))) {
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
  'Contratos e compras',
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

module.exports = { classificarAssunto, ASSUNTOS, MOTIVOS_POR_ASSUNTO };
