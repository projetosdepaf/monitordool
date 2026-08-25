@echo off
cd /d "%~dp0"
echo Salvando as edicoes no lib...
git add lib\dool.js lib\portal.js
git commit -m "Corrige extracao para pegar decretos em lote (nomeacoes/exoneracoes DAS)"
echo.
echo Baixando o que tem no GitHub e juntando com o que voce tem local...
git pull --no-rebase -X ours --no-edit origin main
echo.
echo Enviando pro GitHub...
git push
echo.
echo Pronto.
pause