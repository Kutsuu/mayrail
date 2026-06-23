# Локальный запуск

Самый простой вариант на Windows:

1. Открой папку сайта.
2. Запусти `start-local-server.bat`.
3. Браузер откроет `http://localhost:8000/`.

Альтернативно из терминала:

```powershell
node local-server.js
```

После этого открой:

```text
http://localhost:8000/
```

Так сайт сможет читать `data/routes.csv` напрямую, как на GitHub Pages.
