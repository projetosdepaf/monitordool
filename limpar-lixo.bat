@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set MANTER=package.json package-lock.json scraper.js backfill.js README.md .gitignore .env empurrar.bat refazer-agosto.bat refazer-junho-julho.bat agendar-diario.bat rodar-diario.bat limpar-lixo.bat limpar-e-refazer-22.bat

echo Apagando arquivos soltos que nao sao mais necessarios...
for %%F in (*) do (
  set "PODE_APAGAR=1"
  for %%K in (%MANTER%) do (
    if /I "%%F"=="%%K" set "PODE_APAGAR=0"
  )
  if "!PODE_APAGAR!"=="1" (
    echo   apagando %%F
    del /q "%%F" 2>nul
  )
)

echo.
echo Apagando pasta de diagnostico, se existir...
if exist diagnostico rmdir /s /q diagnostico

echo.
echo Garantindo que o node_modules nunca suba pro GitHub...
(
echo node_modules/
echo *.log.txt
echo log.txt
) > .gitignore

echo.
echo Registrando a limpeza no Git...
git add -A
git commit -m "Limpeza geral: remove scripts de diagnostico antigos"

echo.
echo Baixando o que tem no GitHub e juntando com o que voce tem local...
git pull --no-rebase -X ours --no-edit origin main

echo.
echo Enviando pro GitHub...
git push

echo.
echo Pronto! Confere o repositorio no navegador (com a traducao automatica desligada, pra ver os nomes reais).
pause