@echo off
cd /d "%~dp0"
echo Criando lista do que o Git deve ignorar...
(
echo node_modules/
echo *.log.txt
) > .gitignore
echo.
echo Registrando a limpeza...
git add -A
git commit -m "Remove arquivos de diagnostico e limpa o repositorio"
echo.
echo Baixando o que tem no GitHub e juntando com o que voce tem local...
git pull --no-rebase -X ours --no-edit origin main
echo.
echo Enviando pro GitHub...
git push
echo.
echo Pronto.
pause