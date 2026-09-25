@echo off
cd /d "%~dp0"
node server.mjs >> logs\server.log 2>&1
