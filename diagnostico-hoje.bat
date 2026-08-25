@echo off
cd /d "%~dp0"
echo Baixando a edicao 24463 (25/08/2026) direto, sem tentar descobrir sozinho...
echo.
call node scraper.js --probe --id=24463
echo.
echo Pronto! Arrasta o arquivo diagnostico\doe-ultima-edicao.txt pra cima da
echo nossa conversa (ou anexa ele) que eu confiro o texto real pela primeira vez.
pause