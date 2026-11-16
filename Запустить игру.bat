@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Между мирами — Осколки ключа
where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 main.py
) else (
    python main.py
)
if errorlevel 1 (
    echo.
    echo Не удалось запустить игру. Нужен Python 3.10 или новее.
    pause
)
