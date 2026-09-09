@echo off
setlocal
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca

echo ---- %date% %time% ---- >> log.txt

echo.
echo   Monitor DOE-BA . DEPAF
echo   ======================
echo.

echo   [1/3] Sincronizando com o GitHub...
git pull >> log.txt 2>&1

echo   [2/3] Buscando o Diario Oficial de hoje...
call node scraper.js >> log.txt 2>&1
if errorlevel 1 goto :falhabusca

git add docs\data
git diff --cached --quiet
if errorlevel 1 goto :temnovidade
echo         Nada novo no Diario de hoje.
echo Nada novo hoje. >> log.txt
goto :enviar

:temnovidade
git commit -m "Atualiza dados do Diario (%date%)" >> log.txt 2>&1
echo         Publicacoes novas encontradas e salvas.

:enviar
rem ------------------------------------------------------------------
rem Envia SEMPRE que houver commit pendente, inclusive de dias
rem anteriores em que o envio falhou. Antes o push so acontecia junto
rem com um commit novo: se o envio falhasse, aquele dia ficava preso
rem aqui para sempre e o site parava de atualizar em silencio.
rem ------------------------------------------------------------------
set PENDENTES=0
for /f %%i in ('git rev-list --count origin/main..main 2^>nul') do set PENDENTES=%%i

if "%PENDENTES%"=="0" goto :nadaenviar

echo   [3/3] Enviando %PENDENTES% atualizacao/oes para o site...
git push >> log.txt 2>&1
if errorlevel 1 goto :falhaenvio

echo         Pronto. Site atualizado.
if exist ENVIO-PENDENTE.txt del ENVIO-PENDENTE.txt
goto :fim

:nadaenviar
echo   [3/3] Nada para enviar, o site ja esta em dia.
goto :fim

:falhabusca
echo.
echo   *** O ROBO NAO CONSEGUIU BUSCAR O DIARIO ***
echo.
echo   O motivo esta nas ultimas linhas do arquivo log.txt
echo.
timeout /t 60 /nobreak >nul 2>&1
goto :fim

:falhaenvio
echo.
echo   *** NAO CONSEGUI ENVIAR PARA O GITHUB ***
echo.
echo   Os dados estao salvos aqui no computador. Nada foi perdido.
echo   Mas o site NAO vai atualizar enquanto isso nao for resolvido.
echo.
echo   O motivo esta nas ultimas linhas do arquivo log.txt
echo.
echo Havia %PENDENTES% atualizacao/oes esperando envio em %date% %time%. > ENVIO-PENDENTE.txt
echo O robo continua coletando normalmente; so o envio ao site esta bloqueado. >> ENVIO-PENDENTE.txt
echo Os dados estao salvos no computador, nada foi perdido. >> ENVIO-PENDENTE.txt
echo Veja o fim do log.txt para o motivo. Apague este arquivo depois de resolver. >> ENVIO-PENDENTE.txt
timeout /t 60 /nobreak >nul 2>&1
goto :fim

:fim
endlocal
