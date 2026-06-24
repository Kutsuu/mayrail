# Расписания

Сайт читает расписания из `manifest.json`.

Сейчас основной источник - опубликованная CSV-ссылка Google Sheets:

```json
{
  "files": [
    "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
  ]
}
```

Если нужно добавить еще один лист Google Sheets, добавь его CSV-ссылку в массив `files`.
Период действия берется из содержимого самой таблицы.
