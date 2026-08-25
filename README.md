# Monitor DOE-BA · DEPAF

Um robô que lê o Diário Oficial do Estado da Bahia todo dia útil e publica um painel web com tudo que sai sobre a Polícia Civil da Bahia, destacando separadamente o que menciona a DEPAF diretamente. Roda sozinho, de graça, hospedado inteiramente no GitHub — sem servidor, sem banco de dados, sem depender de mais ninguém pra continuar funcionando.

## Como funciona (visão geral)

- **GitHub Actions** roda `scraper.js` todo dia útil de manhã: baixa a edição do dia, separa as publicações, procura pela DEPAF / Polícia Civil da Bahia, e salva o resultado em `docs/data/matches.json`, dentro do próprio repositório (é ele quem comita o arquivo atualizado — sem você precisar fazer nada).
- **GitHub Pages** publica a pasta `docs/` como um site — é o painel que qualquer pessoa do DEPAF pode abrir e ver as movimentações mais recentes, sem precisar de login nem instalar nada.

Testado com uma edição real (22/08/2026): o robô separou as 521 publicações daquela edição corretamente, achou 22 publicações da Polícia Civil da Bahia, e dentro delas 4 que citam a DEPAF diretamente — incluindo a nomeação da Cíntia. Esses mesmos 22 já estão pré-carregados em `docs/data/matches.json`, então o painel já nasce com conteúdo.

## O que ainda falta confirmar

O robô acha sozinho o link da edição do dia na página inicial do site, mas essa parte específica eu não consegui testar contra o site ao vivo (minha ferramenta de navegação não abre esse domínio). Se, depois de publicado, o robô não achar a edição do dia sozinho, ele avisa no log do Actions e não quebra nada — só não atualiza naquele dia. Nesse caso me manda o log que eu ajusto.

## Passo a passo pra publicar (sem terminal)

**1. Criar uma conta no GitHub**, se você ainda não tiver uma: github.com → "Sign up". Gratuito.

**2. Criar um repositório novo:**
No canto superior direito, ícone "+" → "New repository". Dá um nome (ex.: `monitor-doe-depaf`), deixa como "Public" (os dados são todos públicos mesmo, é o Diário Oficial), e clica em "Create repository".

**3. Subir os arquivos deste zip — sem terminal, direto pelo navegador:**
Na página do repositório recém-criado, clica em "uploading an existing file" (ou "Add file" → "Upload files"). Arrasta TODOS os arquivos e pastas deste zip pra ali (inclusive a pasta `.github`, que pode vir escondida — se o seu computador não mostrar arquivos/pastas que começam com ponto, me avisa que eu preparo um jeito alternativo de subir ela). Clica em "Commit changes".

**4. Ativar o GitHub Pages:**
Na página do repositório, vai em "Settings" → "Pages" (no menu lateral esquerdo). Em "Source", escolhe "Deploy from a branch". Em "Branch", escolhe `main` e a pasta `/docs`. Salva. Em alguns minutos o GitHub te dá um link tipo `https://seu-usuario.github.io/monitor-doe-depaf/` — esse é o painel.

**5. Testar o robô manualmente uma vez** (antes de esperar o agendamento):
Vai na aba "Actions" do repositório → clica no workflow "Monitor DOE-BA DEPAF" → botão "Run workflow" → "Run workflow" de novo pra confirmar. Espera terminar (ícone verde ✓) e olha se `docs/data/matches.json` foi atualizado.

Depois disso, ele roda sozinho todo dia útil às 8h (horário da Bahia), sem você precisar fazer mais nada.

## Ajustar as palavras-chave

Editando o começo do arquivo `scraper.js` diretamente pelo GitHub (clica no arquivo → ícone de lápis "Edit"), você pode mudar os termos padrão, ou usar variáveis de ambiente do GitHub Actions se preferir não editar código (`Settings` → `Secrets and variables` → `Actions` → `Variables`, criando `DEPAF_TERMS` e `AMPLO_TERMS`). Separe múltiplos termos com `|`.

## Testar num PDF antes de confiar no robô

```
npm install
node tools/test-local-pdf.js caminho/para/algum-diario.pdf
```
Isso não grava nada, só mostra o que encontraria — bom pra conferir de vez em quando se as regras continuam pegando tudo certo.

## Como funciona por dentro (resumo técnico)

O PDF de cada edição tem marcadores invisíveis no texto (tipo `<#E.G.B#123456#5#789>`) que separam cada publicação — é a mesma numeração que aparece no menu do site. O robô usa esses marcadores pra cortar a edição em publicações individuais, e dentro de decretos "em lote" (que juntam várias nomeações/exonerações num documento só) ele ainda separa cada nomeação/exoneração isoladamente, procurando por verbos como "nomear", "exonerar", "designar" no início de cada uma. O tipo de movimentação (`lib/classify.js`) também é decidido por palavra-chave — se notar publicações caindo em "Outro" que deveriam ter um tipo específico, me manda o trecho que eu ajusto a regra.

O botão "marcar como visto" no painel é só uma lembrança pessoal salva no navegador de cada pessoa — não é compartilhado entre quem acessa, de propósito (o painel é uma referência coletiva do DEPAF, não uma caixa de entrada pessoal).
