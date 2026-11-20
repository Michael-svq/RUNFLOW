@echo off
rem RunFlow - Estudio virtual (Docker). Ver docs/ESTUDIO.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\estudio\estudio.ps1" parar
