@echo off
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca

echo Baixando a edicao de hoje so pra conferir (nao grava nada no painel)...
echo.
call node scraper.js --probe

echo.
echo ================================================================
echo Pronto. Dentro desta mesma pasta, numa pasta chamada "diagnostico",
echo ficaram 2 arquivos:
echo   - doe-ultima-edicao.txt  (o texto puro que ele leu do PDF de hoje)
echo   - doe-homepage.html      (so existe se ele nao achou a edicao)
echo.
echo Arrasta o arquivo diagnostico\doe-ultima-edicao.txt pra cima da nossa
echo conversa (ou anexa ele) que eu confiro por que essas mencoes nao
echo estao sendo reconhecidas.
echo ================================================================
echo.
pause