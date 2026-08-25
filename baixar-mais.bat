@echo off
cd /d "%~dp0"
call node tools\inspecionar.js --caminho=/apifront/portal/edicoes/publicacoes_ver_conteudo/1324262
echo.
echo Anexa aqui os arquivos que apareceram na pasta diagnostico com
echo "publicacoes-ver-conteudo-1324262" no nome.
pause