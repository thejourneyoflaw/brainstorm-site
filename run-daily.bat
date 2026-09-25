@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
echo ===== %date% %time% ===== >> logs\collect.log
node collect.mjs >> logs\collect.log 2>&1
