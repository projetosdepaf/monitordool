@echo off
cd /d "%~dp0"
echo Buscando junho e julho inteiros (isso demora bem mais que agosto, pode deixar rodando)...
node tools\reprocessar-mes.js --de=2026-06-01 --ate=2026-07-31
echo.
echo Salvando os dados novos...
git add lib\portal.js tools\reprocessar-mes.js docs\data\matches.json docs\data\processed-editions.json
git commit -m "Busca junho e julho inteiros"
echo.
echo Baixando o que tem no GitHub e juntando com o que voce tem local...
git pull --no-rebase -X ours --no-edit origin main
echo.
echo Enviando pro GitHub...
git push
echo.
echo Pronto! Confere o painel.
pause