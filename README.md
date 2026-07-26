# Observatório Brasil

Plataforma de monitoramento integrado de eventos ambientais utilizando dados públicos.

## Funcionalidades
- Mapa interativo
- Busca por cidade, estado e país
- Painel em cards
- Dados em tempo real do USGS
- Atualização automática

## Estrutura
```
index.html
app.js
styles.css
README.md
```

## Como executar

### VS Code (recomendado)
1. Abra a pasta do projeto.
2. Instale a extensão Live Server.
3. Clique com o botão direito em `index.html`.
4. Escolha **Open with Live Server**.

### Python
```bash
python -m http.server 8000
```
Acesse: http://localhost:8000

### Node.js
```bash
npx serve
```

## GitHub Pages
Após alterações:
```bash
git add .
git commit -m "Atualização"
git push origin main
```
Se o GitHub Pages estiver habilitado, a publicação será automática.

## Roadmap
- INPE
- ANA
- Cemaden
- Meteorologia
- Qualidade do ar
- Satélites
- IA para análise territorial