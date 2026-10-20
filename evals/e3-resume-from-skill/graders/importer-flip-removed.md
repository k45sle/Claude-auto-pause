---
type: regex
target: { source: file, path: src/invoices/importer.py }
pattern: 'from invoices\.dates import parse_date(?![\s\S]*split\("/"\))'
---
