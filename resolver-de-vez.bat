@echo off
cd /d "%~dp0"
echo Resolvendo os arquivos que estavam travando o envio... > resolver-log.txt

git add baixar-home-js.bat baixar-mais.bat corrigir-tudo.bat diagnosticar-html.bat diagnosticar-url.bat diagnostico-hoje.bat git-diagnostico-log.txt log.txt preencher-log.txt sincronizar-log.txt sincronizar.bat tools\inspecionar.js >> resolver-log.txt 2>&1

git commit -m "Sincroniza arquivos locais de diagnostico" >> resolver-log.txt 2>&1

git pull --no-rebase -X ours origin main >> resolver-log.txt 2>&1

git push >> resolver-log.txt 2>&1

echo. >> resolver-log.txt
echo === Fim === >> resolver-log.txt
echo.
echo Pronto! Me manda o resolver-log.txt
pause