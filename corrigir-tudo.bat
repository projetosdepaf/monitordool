@echo off
cd /d "%~dp0"

git config user.name "DEPAF"
git config user.email "monitordool@depaf.local"

echo Salvando e enviando tudo pro GitHub... > corrigir-log.txt

git add docs\data\matches.json docs\data\processed-editions.json
git add scraper.js lib\dool.js lib\portal.js
git add tools\backfill.js tools\remover-edicao.js
git add preencher-agosto.bat rodar-diario.bat diagnostico.bat limpar-e-refazer-22.bat diagnostico-git.bat

git commit -m "Corrige robo: motor novo (lib/dool.js) + dados de agosto/2026" >> corrigir-log.txt 2>&1
git push >> corrigir-log.txt 2>&1

echo. >> corrigir-log.txt
echo === Fim === >> corrigir-log.txt
echo.
echo Pronto! Pode fechar e me mandar o corrigir-log.txt
pause