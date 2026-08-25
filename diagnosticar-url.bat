@echo off
cd /d "%~dp0"
call node tools\inspecionar.js --id=24463
echo.
echo Abre o arquivo diagnostico\resposta-crua-info.txt e me manda o que tiver
echo escrito la, e tambem cola aqui as primeiras 20-30 linhas do arquivo
echo diagnostico\resposta-crua.txt
pause